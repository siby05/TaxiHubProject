/**
 * DB_MODE=memory (default) keeps everything in process memory via
 * lib/MemoryStore.js - no install, no external service, resets on restart.
 * A real MongoDB connection can be added here later; routes/models won't
 * need to change since they only use the Model API, not Mongoose directly.
 */
function connectDatabase() {
  const mode = process.env.DB_MODE || 'memory';
  if (mode === 'memory') {
    console.log('[db] using in-memory data store (DB_MODE=memory) - data resets on restart');
    return Promise.resolve();
  }
  throw new Error(`Unsupported DB_MODE "${mode}". Only "memory" is implemented in this build.`);
}

module.exports = { connectDatabase };
