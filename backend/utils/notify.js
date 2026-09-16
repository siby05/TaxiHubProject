const Notification = require('../models/Notification');
const User = require('../models/User');

let ioRef = null;
function setIo(io) {
  ioRef = io;
}

async function createAndEmit(userId, payload) {
  const notification = await Notification.create({ userId, read: false, ...payload });
  if (ioRef) ioRef.to(String(userId)).emit('notification:new', notification);
  return notification;
}

// Notifies a single user (driver, passenger, or a specific admin).
async function notifyUser(userId, payload) {
  return createAndEmit(userId, payload);
}

// Fans out to every current admin - covers "notify admin of driver
// requests / complaints / driver actions" without needing a broadcast
// concept in the data model.
async function notifyAdmins(payload) {
  const admins = await User.find({ role: 'admin' });
  return Promise.all(admins.map((a) => createAndEmit(a._id, payload)));
}

module.exports = { setIo, notifyUser, notifyAdmins };
