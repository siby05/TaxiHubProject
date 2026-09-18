const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Driver = require('../models/Driver');

// Seeds one admin, one approved driver and one passenger so every role can
// be tested immediately without a registration flow for driver/admin
// (matches the "admin-managed driver accounts, no public driver signup" spec).
module.exports = async function seed() {
  const existing = await User.findOne({ email: 'admin@easyride.local' });
  if (existing) return;

  const password = await bcrypt.hash('password123', 10);

  await User.create({
    name: 'Admin', email: 'admin@easyride.local', password, role: 'admin', isActive: true, emailVerified: true,
  });

  const driverUser = await User.create({
    name: 'Demo Driver', email: 'driver@easyride.local', password, mobile: '+64210000000', role: 'driver', isActive: true, emailVerified: true,
  });
  await Driver.create({
    userId: driverUser._id,
    licenseNumber: 'NZ-DL-12345',
    tslNumber: 'TSL-000001',
    vehicleType: 'Comfort',
    vehicleNumber: 'ABC123',
    ratePerKm: 1.8,
    pendingRatePerKm: null,
    status: 'approved',
    isAvailable: true,
    rating: 4.8,
    totalTrips: 0,
    totalEarnings: 0,
    feeOverride: null,
    feeLimitOverride: null,
    acceptsOnlinePayment: true,
    // NZTA compliance demo data (Private Hire category - no security camera required).
    serviceCategory: 'private-hire',
    hasSecurityCamera: false,
    passengerEndorsementNumber: 'PEND-000001',
    passengerEndorsementExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    vehicleCofExpiry: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
    // All days, all hours open by default so the demo always works
    // regardless of when you test it - narrow this via the Schedule page
    // to see trips actually get held back outside declared hours.
    availabilitySchedule: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      enabled: true,
      startTime: '00:00',
      endTime: '23:59',
    })),
  });

  await User.create({
    name: 'Demo Passenger', email: 'passenger@easyride.local', password, mobile: '+64210000001', role: 'passenger', isActive: true, emailVerified: true,
  });

  console.log('[seed] demo accounts ready (password for all: "password123"):');
  console.log('  admin@easyride.local     (admin)');
  console.log('  driver@easyride.local    (driver, approved & available)');
  console.log('  passenger@easyride.local (passenger)');
};
