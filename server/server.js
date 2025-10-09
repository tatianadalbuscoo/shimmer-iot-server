// server/server.js
// HTTP API (Express) + realtime notifications (Socket.IO) for Shimmer measurements.
// - Stores data in MongoDB (via Mongoose).
// - When a new measurement arrives, emits `measurement:new` to connected clients.

require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const socketIo = require('socket.io');

// ----------------------------------------------------------------------------
// App & Server
// ----------------------------------------------------------------------------

const app = express();
const server = http.createServer(app);

// Socket.IO (open CORS for development/testing)
const io = socketIo(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});
app.locals.io = io;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));

// ----------------------------------------------------------------------------
// MongoDB
// ----------------------------------------------------------------------------

const MONGODB_URI =
    process.env.MONGODB_URI ||
    'mongodb://admin:adminpass@localhost:27017/shimmerdb?authSource=admin';

// Connect (exit on failure)
mongoose.connect(MONGODB_URI)
    .then(() => console.log('MongoDB connected'))
    .catch(err => {
        console.error('MongoDB connection error:', err.message);
        process.exit(1);
    });

// ----------------------------------------------------------------------------
// Schemas & Model
// ----------------------------------------------------------------------------

const Vec3Schema = new mongoose.Schema({
    x: Number,  // axis X
    y: Number,  // axis Y
    z: Number,  // axis Z
}, { _id: false });

const ExternalADCSchema = new mongoose.Schema({
    adc1: Number,
    adc2: Number,
    adc3: Number,
}, { _id: false });

const IMUSchema = new mongoose.Schema({
    lowNoiseAcc: Vec3Schema,       // low-noise accelerometer (x,y,z)
    wideRangeAcc: Vec3Schema,      // wide-range accelerometer (x,y,z)
    gyroscope: Vec3Schema,         // gyroscope (x,y,z)
    magnetometer: Vec3Schema,      // magnetometer (x,y,z)
    pressure: Number,              // pressure
    temperature: Number,           // temperature
    battery: Number,               // battery
    externalADC: ExternalADCSchema // 3 external ADCs
}, { _id: false });

// EXG channels
const EXGSchema = new mongoose.Schema({
    exg1: { type: Number, required: true },
    exg2: { type: Number, required: true }
}, { _id: false });


const MeasurementSchema = new mongoose.Schema({
    shimmerName: { type: String, required: true }, // device id (e.g., "E0D9")
    isEXG: { type: Boolean, required: true },      // true: EXG+IMU, false: IMU
    imu: IMUSchema,                                // Always present
    exg: EXGSchema,                                // present when isEXG=true
    userName: { type: String },                    // e.g. "Tatiana Dal Busco"
    timestamp: { type: Date, default: Date.now }   // sample time
}, { timestamps: true });

// Main collection model
const Measurement = mongoose.model('Measurement', MeasurementSchema);

// ----------------------------------------------------------------------------
// Validation / normalization helpers
// ----------------------------------------------------------------------------

/**
 * Has numeric x,y,z?
 * @param {object} obj
 * @returns {boolean}
 */
function isVec3(obj) {
    return obj && typeof obj === 'object'
        && ['x','y','z'].every(k => typeof obj[k] === 'number');
}

/**
 * Normalize EXG to { exg1:number, exg2:number }.
 * Accepts object with aliases (exg1/exg2, ch1/ch2, channel1/channel2, c1/c2)
 * or array [exg1, exg2]. Rejects single values.
 * @param {any} input
 * @returns {{exg1:number, exg2:number} | null}
 */
function normalizeExg(input) {
    if (input == null) return null;

    const toNum = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    };

    // Object case + aliases
    if (typeof input === 'object' && !Array.isArray(input)) {
        const a1 = input.exg1 ?? input.ch1 ?? input.channel1 ?? input.c1;
        const a2 = input.exg2 ?? input.ch2 ?? input.channel2 ?? input.c2;
        const n1 = toNum(a1);
        const n2 = toNum(a2);
        if (n1 != null && n2 != null) return { exg1: n1, exg2: n2 };
    }

    // Array case [exg1, exg2]
    if (Array.isArray(input)) {
        if (input.length >= 2) {
            const n1 = toNum(input[0]);
            const n2 = toNum(input[1]);
            if (n1 != null && n2 != null) return { exg1: n1, exg2: n2 };
        }
        return null;
    }

    // Single value: invalid (ambiguous)
    return null;
}


/**
 * Build a clean IMU object from `imu` or a fallback container (e.g., body.data).
 * @param {any} possibleImu - typically body.imu
 * @param {any} fallbackContainer - e.g., body.data
 * @returns {object|null} cleaned IMU or null if nothing valid
 */
function sanitizeIMU(possibleImu, fallbackContainer) {

    // Select source
    const src = (possibleImu && typeof possibleImu === 'object') ? possibleImu
        : (fallbackContainer && typeof fallbackContainer === 'object') ? fallbackContainer
            : null;
    if (!src) return null;

    // Collect valid fields
    const out = {};
    if (src.lowNoiseAcc && isVec3(src.lowNoiseAcc)) out.lowNoiseAcc = src.lowNoiseAcc;
    if (src.wideRangeAcc && isVec3(src.wideRangeAcc)) out.wideRangeAcc = src.wideRangeAcc;

    const gyro = src.gyroscope || src.gyro;
    if (gyro && isVec3(gyro)) out.gyroscope = gyro;

    const mag = src.magnetometer || src.mag;
    if (mag && isVec3(mag)) out.magnetometer = mag;

    if (typeof src.pressure === 'number') out.pressure = src.pressure;
    if (typeof src.temperature === 'number') out.temperature = src.temperature;
    if (typeof src.battery === 'number') out.battery = src.battery;

    // External ADC (object or array)
    if (src.externalADC && typeof src.externalADC === 'object') {
        out.externalADC = {
            adc1: Number.isFinite(src.externalADC.adc1) ? src.externalADC.adc1 : undefined,
            adc2: Number.isFinite(src.externalADC.adc2) ? src.externalADC.adc2 : undefined,
            adc3: Number.isFinite(src.externalADC.adc3) ? src.externalADC.adc3 : undefined
        };
    } else if (Array.isArray(src.adc)) {
        const [a1, a2, a3] = src.adc.map(Number);
        out.externalADC = {
            adc1: Number.isFinite(a1) ? a1 : undefined,
            adc2: Number.isFinite(a2) ? a2 : undefined,
            adc3: Number.isFinite(a3) ? a3 : undefined
        };
    }

    return Object.keys(out).length ? out : null;
}

// ----------------------------------------------------------------------------
// Healthcheck
// ----------------------------------------------------------------------------

app.get('/health', (_req, res) => res.json({ ok: true }));

// -----------------------------------------------------------------------------
// API: Measurements
// -----------------------------------------------------------------------------

/**
 * POST /api/measurements
 * Save a Shimmer measurement.
 * Body (top-level or under data.*):
 *  - shimmerName: string (required)
 *  - isEXG: boolean (required) → if true, both exg and imu are required
 *  - userName?: string
 *  - exg?: { exg1:number, exg2:number }
 *  - imu?: { lowNoiseAcc?, wideRangeAcc?, gyroscope?, magnetometer?, pressure?, temperature?, battery?, externalADC? }
 * @returns 201 { message, id } | 400 { error } | 500 { error }
 */
app.post('/api/measurements', async (req, res) => {
    try {

        // Accept both flat and { data: {...} } shapes
        const body = req.body || {};
        const data = body.data && typeof body.data === 'object' ? body.data : {};

        // Aliases: deviceName -> shimmerName
        const shimmerName = body.shimmerName ?? data.shimmerName ?? body.deviceName;
        const isEXG = (typeof body.isEXG === 'boolean') ? body.isEXG
            : (typeof data.isEXG === 'boolean') ? data.isEXG
                : body.isEXG;
        const userName = body.userName ?? data.userName;

        if (!shimmerName || typeof isEXG !== 'boolean') {
            return res.status(400).json({ error: 'shimmerName (string) and isEXG (boolean) are required' });
        }

        // Raw payloads
        const imuRaw = body.imu ?? data.imu ?? null;
        const exgRaw = body.exg ?? data.exg ?? null;

        const docData = { shimmerName, isEXG, userName };

        if (isEXG) {

            // EXG mode: must have EXG and IMU
            const exgNorm = normalizeExg(exgRaw);
            const imuClean = sanitizeIMU(imuRaw, data);

            if (!exgNorm) {
                return res.status(400).json({ error: 'EXG missing/invalid (required when isEXG=true)' });
            }
            if (!imuClean) {
                return res.status(400).json({ error: 'IMU missing/invalid (required when isEXG=true)' });
            }

            docData.exg = exgNorm;
            docData.imu = imuClean;
        } else {

            // IMU mode: IMU required
            const imuClean = sanitizeIMU(imuRaw, data);
            if (!imuClean) {
                return res.status(400).json({ error: 'IMU missing/invalid' });
            }
            docData.imu = imuClean;
        }

        const saved = await new Measurement(docData).save();

        // Notify subscribers (minimal payload)
        req.app.locals.io.emit('measurement:new', {
            id: saved._id,
            shimmerName: saved.shimmerName,
            isEXG: saved.isEXG,
            timestamp: saved.timestamp
        });

        res.status(201).json({ message: 'Measurement saved', id: saved._id });
    } catch (err) {
        console.error('Error saving measurement:', err);
        res.status(500).json({ error: 'Server error' });
    }
});


/**
 * GET /api/measurements
 * List measurements (most recent first).
 * Query:
 *  - shimmerName?: string
 *  - from?: ISO date (inclusive)
 *  - to?: ISO date (inclusive)
 *  - limit?: number (default 100, max 1000)
 * @returns 200 Array<Measurement> | 500 { error }
 */
app.get('/api/measurements', async (req, res) => {
    try {
        const { shimmerName, from, to, limit = 100 } = req.query;
        const q = {};
        if (shimmerName) q.shimmerName = shimmerName;
        if (from || to) {
            q.timestamp = {};
            if (from) q.timestamp.$gte = new Date(from);
            if (to) q.timestamp.$lte = new Date(to);
        }

        const data = await Measurement.find(q)
            .sort({ timestamp: -1 })
            .limit(Math.min(parseInt(limit, 10) || 100, 1000))
            .select('-__v');

        res.json(data);
    } catch (err) {
        console.error('Error fetching measurements:', err);
        res.status(500).json({ error: 'Server error' });
    }
});


/**
 * GET /api/measurements/latest
 * Fetch latest measurement for a device.
 * Query:
 *  - shimmerName: string (required)
 * @returns 200 Measurement | 400 { error } | 404 { error } | 500 { error }
 */
app.get('/api/measurements/latest', async (req, res) => {
    try {
        const { shimmerName } = req.query;
        if (!shimmerName) return res.status(400).json({ error: 'Query parameter shimmerName is required' });

        const latest = await Measurement.findOne({ shimmerName })
            .sort({ timestamp: -1 })
            .select('-__v');

        if (!latest) return res.status(404).json({ error: 'No measurement found' });
        res.json(latest);
    } catch (err) {
        console.error('Error fetching latest:', err);
        res.status(500).json({ error: 'Server error' });
    }
});


/**
 * GET /api/devices
 * List distinct device names present in the collection.
 * @returns 200 { devices: string[] } | 500 { error }
 */
app.get('/api/devices', async (_req, res) => {
    try {
        const names = await Measurement.distinct('shimmerName');
        res.json({ devices: names });
    } catch (err) {
        console.error('Error fetching devices:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ----------------------------------------------------------------------------
// WebSocket
// ----------------------------------------------------------------------------

/**
 * Handle new WebSocket connection.
 * @param {import('socket.io').Socket} socket - Connected client socket.
 * @returns {void}
 */
io.on('connection', (socket) => {
    console.log('Client WebSocket connected');
    socket.on('disconnect', () => console.log('Client WebSocket disconnected'));
});

// ----------------------------------------------------------------------------
// HTTP server start
// ----------------------------------------------------------------------------

const PORT = process.env.PORT || 3000;  // Use .env PORT or default 3000
server.listen(PORT, () => {
    console.log(`Shimmer IoT API at http://localhost:${PORT}`);
});

// ----------------------------------------------------------------------------
// Exports (for tests)
// ----------------------------------------------------------------------------

module.exports = { app, server, Measurement };
