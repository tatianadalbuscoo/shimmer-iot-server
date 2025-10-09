// start.js
// Checks MongoDB; if reachable, starts server/server.js as a child process.
// Exits with a clear error if DB is down.


const { spawn } = require('child_process');
const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI =
    process.env.MONGODB_URI ||
    'mongodb://admin:adminpass@localhost:27017/shimmerdb?authSource=admin';

console.log('Starting Shimmer IoT Server...');

(async () => {
  try {

    // Fast connectivity check (fail quickly if DB is down)
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    console.log('MongoDB is accessible');

    // Run the real server as a child process
    const child = spawn(process.execPath, ['server/server.js'], {
      stdio: 'inherit',
      env: { ...process.env }
    });

    // Bubble up the exit code
    child.on('exit', (code) => process.exit(code ?? 0));
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    console.log('\nStart MongoDB with: npm run db:up');
    process.exit(1);
  }
})();
