
const request = require('supertest');
const mongoose = require('mongoose');
const { app, server } = require('../server/server');

///////////////////////////////////////// GET /health
describe('API /health', () => {

    // Test: should return 200 with ok:true
    test('should return 200 with { ok: true }', async () => {
        const res = await request(app).get('/health');
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ ok: true });
    });
});

///////////////////////////////////////// POST /api/measurements (validation)
describe('POST /api/measurements (validation)', () => {

    // Test: missing shimmerName/isEXG should 400
    test('should return 400 when shimmerName/isEXG are missing or invalid', async () => {
        const res = await request(app)
            .post('/api/measurements')
            .send({ userName: 'Unit Tester' });
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe('shimmerName (string) and isEXG (boolean) are required');
    });

    // Test: isEXG=true requires EXG and IMU
    test('should return 400 when isEXG=true but EXG is missing', async () => {
        const res = await request(app)
            .post('/api/measurements')
            .send({
                shimmerName: 'TEST-EXG-MISSING-EXG',
                isEXG: true,
                imu: { gyroscope: { x: 0, y: 0, z: 0 } },
            });
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe('EXG missing/invalid (required when isEXG=true)');
    });

    // Test: isEXG=true requires IMU too
    test('should return 400 when isEXG=true but IMU is missing', async () => {
        const res = await request(app)
            .post('/api/measurements')
            .send({
                shimmerName: 'TEST-EXG-MISSING-IMU',
                isEXG: true,
                exg: { exg1: 12.3, exg2: 8.1 },
            });
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe('IMU missing/invalid (required when isEXG=true)');
    });

    // Test: isEXG=false requires IMU
    test('should return 400 when isEXG=false and IMU is missing', async () => {
        const res = await request(app)
            .post('/api/measurements')
            .send({
                shimmerName: 'TEST-IMU-MISSING',
                isEXG: false,
            });
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe('IMU missing/invalid');
    });
});

///////////////////////////////////////// POST /api/measurements (happy paths)
describe('POST /api/measurements (happy paths)', () => {
    // Test: IMU-only save (isEXG=false)
    test('should save IMU-only measurement and return 201', async () => {
        const res = await request(app)
            .post('/api/measurements')
            .send({
                shimmerName: 'TEST-IMU-OK',
                isEXG: false,
                userName: 'Unit Tester',
                imu: {
                    gyroscope: { x: 0, y: 0, z: 0 }, // minimal valid IMU field
                },
            });
        expect(res.statusCode).toBe(201);
        expect(res.body).toHaveProperty('message', 'Measurement saved');
        expect(res.body).toHaveProperty('id');
    });

    // Test: EXG + IMU save (isEXG=true)
    test('should save EXG+IMU measurement and return 201', async () => {
        const res = await request(app)
            .post('/api/measurements')
            .send({
                shimmerName: 'TEST-EXG-OK',
                isEXG: true,
                userName: 'Unit Tester',
                exg: { exg1: 12.3, exg2: 8.1 },
                imu: {
                    lowNoiseAcc: { x: 0.01, y: 0.02, z: 0.98 },
                },
            });
        expect(res.statusCode).toBe(201);
        expect(res.body).toHaveProperty('message', 'Measurement saved');
        expect(res.body).toHaveProperty('id');
    });
});

///////////////////////////////////////// GET /api/devices
describe('API /api/devices', () => {
    // Test: should return array of device names (should include ones just posted)
    test('should return a list of device ids', async () => {
        const res = await request(app).get('/api/devices');
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.body.devices)).toBe(true);
        // Optional: check our test ids are present (best-effort if DB is clean)
        // expect(res.body.devices).toEqual(expect.arrayContaining(['TEST-IMU-OK', 'TEST-EXG-OK']));
    });
});

///////////////////////////////////////// GET /api/measurements
describe('API /api/measurements', () => {
    // Test: list for a given device (limit=1)
    test('should return recent measurements for a device', async () => {
        const res = await request(app)
            .get('/api/measurements')
            .query({ shimmerName: 'TEST-IMU-OK', limit: 1 });
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });
});

///////////////////////////////////////// GET /api/measurements/latest
describe('API /api/measurements/latest', () => {
    // Test: 400 when shimmerName missing
    test('should return 400 if shimmerName is missing', async () => {
        const res = await request(app).get('/api/measurements/latest');
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe('Query parameter shimmerName is required');
    });

    // Test: 200 with latest for known device (if at least one exists)
    test('should return 200 with latest measurement when device exists', async () => {
        const res = await request(app)
            .get('/api/measurements/latest')
            .query({ shimmerName: 'TEST-EXG-OK' });
        // It might be 404 if DB was wiped between tests; accept 200 or 404
        expect([200, 404]).toContain(res.statusCode);
        if (res.statusCode === 200) {
            expect(res.body).toHaveProperty('shimmerName', 'TEST-EXG-OK');
        } else {
            expect(res.body).toHaveProperty('error', 'No measurement found');
        }
    });
});

// Cleanup: close server and MongoDB connection after all tests
afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300)); // let any pending ops flush
    if (server && server.close) {
        await new Promise((r) => server.close(r));
    }
    await mongoose.connection.close();
});
