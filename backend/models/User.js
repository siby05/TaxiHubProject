const { createModel } = require('../lib/MemoryStore');

// Fields: name, email, password (bcrypt hash), mobile, address, role
// ('passenger' | 'driver' | 'admin'), isActive, emailVerified, createdAt.
const User = createModel('User');

module.exports = User;
