const Notification = require('../models/Notification');
const User = require('../models/User');
const { runInBackground } = require('./background');

let ioRef = null;
function setIo(io) {
  ioRef = io;
}

async function createAndEmit(userId, payload) {
  const notification = await Notification.create({ userId, read: false, ...payload });
  if (ioRef) ioRef.to(String(userId)).emit('notification:new', notification);
  return notification;
}

// Both notifiers below are fire-and-forget: they queue the work (see
// utils/background.js) and return straight away, so a route never waits
// on - or fails because of - an in-app notification.

// Notifies a single user (driver, passenger, or a specific admin).
function notifyUser(userId, payload) {
  runInBackground(`notify ${payload?.type || 'user'}`, () => createAndEmit(userId, payload));
}

// Fans out to every current admin - covers "notify admin of driver
// requests / complaints / driver actions" without needing a broadcast
// concept in the data model.
function notifyAdmins(payload) {
  runInBackground(`notify admins ${payload?.type || ''}`.trim(), async () => {
    const admins = await User.find({ role: 'admin' });
    await Promise.all(admins.map((a) => createAndEmit(a._id, payload)));
  });
}

module.exports = { setIo, notifyUser, notifyAdmins };
