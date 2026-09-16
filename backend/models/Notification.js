const { createModel } = require('../lib/MemoryStore');
const User = require('./User');

// One row per recipient (admin broadcasts are fanned out to every current
// admin at creation time, so read/unread is naturally per-user). Fields:
// userId (-> User), type, title, message, link (frontend route to open),
// read (bool).
const Notification = createModel('Notification', {
  userId: () => User.collection,
});

module.exports = Notification;
