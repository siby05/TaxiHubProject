const QRCode = require('qrcode');
const Driver = require('../models/Driver');

/**
 * Each driver's QR encodes a deep link straight to a "book this driver"
 * page on the frontend (like flagging a specific cab, not the general
 * ride-request flow that picks any available driver). Generated lazily on
 * first request and cached on the driver record.
 */
async function ensureDriverQrCode(driver) {
  if (driver.qrCodeImage) return driver;
  const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  const qrCodeUrl = `${base}/book/${driver._id}`;
  const qrCodeImage = await QRCode.toDataURL(qrCodeUrl, { width: 320, margin: 1 });
  return Driver.findByIdAndUpdate(driver._id, { qrCodeUrl, qrCodeImage });
}

module.exports = { ensureDriverQrCode };
