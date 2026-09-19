/**
 * DB_MODE=memory (default) keeps everything in process memory via
 * lib/MemoryStore.js - no install, no external service, resets on restart.
 * DB_MODE=mongo connects to a real MongoDB (e.g. an Atlas free-tier
 * cluster) via lib/MongooseStore.js instead - persists across restarts and
 * deploys. Either way, models/routes only ever use the Model API from
 * lib/createModel.js, never Mongoose directly, so this is the only file
 * that needs to know which one is active.
 */
const mongoose = require('mongoose');

async function connectDatabase() {
  const mode = process.env.DB_MODE || 'memory';

  if (mode === 'memory') {
    console.log('[db] using in-memory data store (DB_MODE=memory) - data resets on restart');
    return;
  }

  if (mode === 'mongo') {
    if (!process.env.MONGO_URI) {
      throw new Error('DB_MODE=mongo requires MONGO_URI to be set (a MongoDB connection string - set it as an env var, never in source).');
    }
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`[db] connected to MongoDB (DB_MODE=mongo, database "${mongoose.connection.name}")`);
    return;
  }

  throw new Error(`Unsupported DB_MODE "${mode}". Use "memory" or "mongo".`);
}

module.exports = { connectDatabase };
