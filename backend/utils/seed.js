const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Driver = require('../models/Driver');

// Seeds one admin, one approved driver and one passenger so every role can
// be tested immediately without a registration flow for driver/admin
// (matches the "admin-managed driver accounts, no public driver signup" spec).
module.exports = async function seed() {
  const existing = await User.findOne({ email: 'admin@taxihub.local' });
  if (existing) return;

  const password = await bcrypt.hash('password123', 10);

  await User.create({
    name: 'Admin', email: 'admin@taxihub.local', password, role: 'admin', isActive: true, emailVerified: true,
  });

  const driverUser = await User.create({
    name: 'Demo Driver', email: 'driver@taxihub.local', password, mobile: '0210000000', role: 'driver', isActive: true, emailVerified: true,
  });
  await Driver.create({
    userId: driverUser._id,
    licenseNumber: 'NZ-DL-12345',
    vehicleType: 'Comfort',
    vehicleNumber: 'ABC123',
    ratePerKm: 1.8,
    pendingRatePerKm: null,
    status: 'approved',
    isAvailable: true,
    rating: 4.8,
    totalTrips: 0,
    totalEarnings: 0,
    // NZTA compliance demo data (Private Hire category - no security camera required).
    serviceCategory: 'private-hire',
    hasSecurityCamera: false,
    passengerEndorsementNumber: 'PEND-000001',
    passengerEndorsementExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    vehicleCofExpiry: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
    // Mon-Fri 08:00-18:00, weekends off - demo data for the availability calendar.
    availabilitySchedule: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      enabled: dayOfWeek >= 1 && dayOfWeek <= 5,
      startTime: '08:00',
      endTime: '18:00',
    })),
  });

  await User.create({
    name: 'Demo Passenger', email: 'passenger@taxihub.local', password, mobile: '0210000001', role: 'passenger', isActive: true, emailVerified: true,
  });

  console.log('[seed] demo accounts ready (password for all: "password123"):');
  console.log('  admin@taxihub.local     (admin)');
  console.log('  driver@taxihub.local    (driver, approved & available)');
  console.log('  passenger@taxihub.local (passenger)');
};
