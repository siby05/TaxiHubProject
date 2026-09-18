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

  // Extra test accounts (TEMPORARY - remove once real drivers/passengers
  // are on the platform): three more approved, ready-to-book drivers each
  // in a different vehicle class, and three more passengers, so the
  // vehicle-type filter and multi-driver broadcast flow can be tested
  // without hand-creating accounts through the admin UI every time.
  const fullWeekSchedule = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek, enabled: true, startTime: '00:00', endTime: '23:59',
  }));

  const testDrivers = [
    { name: 'Test Driver Economy', email: 'driver-economy@easyride.local', mobile: '+64210000010', vehicleType: 'Economy', vehicleNumber: 'ECO001', license: 'NZ-DL-20001', tsl: 'TSL-020001' },
    { name: 'Test Driver Electric', email: 'driver-electric@easyride.local', mobile: '+64210000011', vehicleType: 'Electric', vehicleNumber: 'ELC001', license: 'NZ-DL-20002', tsl: 'TSL-020002' },
    { name: 'Test Driver Premium', email: 'driver-premium@easyride.local', mobile: '+64210000012', vehicleType: 'Premium', vehicleNumber: 'PRE001', license: 'NZ-DL-20003', tsl: 'TSL-020003' },
  ];
  for (const d of testDrivers) {
    const user = await User.create({
      name: d.name, email: d.email, password, mobile: d.mobile, role: 'driver', isActive: true, emailVerified: true,
    });
    await Driver.create({
      userId: user._id,
      licenseNumber: d.license,
      tslNumber: d.tsl,
      vehicleType: d.vehicleType,
      vehicleNumber: d.vehicleNumber,
      ratePerKm: 1.8,
      pendingRatePerKm: null,
      status: 'approved',
      isAvailable: true,
      rating: 5,
      totalTrips: 0,
      totalEarnings: 0,
      feeOverride: null,
      feeLimitOverride: null,
      acceptsOnlinePayment: true,
      serviceCategory: 'private-hire',
      hasSecurityCamera: false,
      passengerEndorsementNumber: `PEND-${d.license.slice(-5)}`,
      passengerEndorsementExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      vehicleCofExpiry: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
      availabilitySchedule: fullWeekSchedule,
    });
  }

  const testPassengers = [
    { name: 'Test Passenger Two', email: 'passenger2@easyride.local', mobile: '+64210000020' },
    { name: 'Test Passenger Three', email: 'passenger3@easyride.local', mobile: '+64210000021' },
    { name: 'Test Passenger Four', email: 'passenger4@easyride.local', mobile: '+64210000022' },
  ];
  for (const p of testPassengers) {
    await User.create({
      name: p.name, email: p.email, password, mobile: p.mobile, role: 'passenger', isActive: true, emailVerified: true,
    });
  }

  console.log('[seed] demo accounts ready (password for all: "password123"):');
  console.log('  admin@easyride.local          (admin)');
  console.log('  driver@easyride.local         (driver, Comfort, approved & available)');
  console.log('  driver-economy@easyride.local (driver, Economy, approved & available)');
  console.log('  driver-electric@easyride.local(driver, Electric, approved & available)');
  console.log('  driver-premium@easyride.local (driver, Premium, approved & available)');
  console.log('  passenger@easyride.local      (passenger)');
  console.log('  passenger2@easyride.local     (passenger)');
  console.log('  passenger3@easyride.local     (passenger)');
  console.log('  passenger4@easyride.local     (passenger)');
};
