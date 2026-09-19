/**
 * Single point every models/*.js file imports from, instead of reaching
 * into lib/MemoryStore.js or lib/MongooseStore.js directly - which real
 * backing store is used is decided once, here, from DB_MODE, so swapping
 * storage engines never means touching a model or route file.
 */
const { createModel } = (process.env.DB_MODE || 'memory') === 'mongo'
  ? require('./MongooseStore')
  : require('./MemoryStore');

module.exports = { createModel };
