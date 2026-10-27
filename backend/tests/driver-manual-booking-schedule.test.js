const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.DB_MODE = 'memory';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-schedule-advisory-12345';

const User = require('../models/User');
const Driver = require('../models/Driver');
const Booking = require('../models/Booking');
const { nzDayAndTime, ownBookingScheduleAdvisory } = require('../utils/schedule');

test('driver self-booking schedule is informational, including an explicit day off', () => {
  const time = new Date('2035-01-15T00:00:00.000Z');
  const day = nzDayAndTime(time).date;
  const driver = {
    availabilitySchedule: [{ dayOfWeek: nzDayAndTime(time).dayOfWeek, slots: [{ startTime: '09:00', endTime: '12:00' }] }],
    dateSchedule: [{ date: day, slots: [] }],
  };
  const advice = ownBookingScheduleAdvisory(driver, time);
  assert.equal(advice.requestedOffSchedule, true);
  assert.match(advice.scheduleMessage, /can still book/i);
  assert.equal(ownBookingScheduleAdvisory(driver, null).requestedOffSchedule, false);
  assert.equal(ownBookingScheduleAdvisory({ availabilitySchedule: [], dateSchedule: [] }, time).requestedOffSchedule, false);
});

test('driver gets a quote and can create an accepted passenger booking despite an off-schedule pickup', async (t) => {
  const driverUser = await User.create({ name: 'Test Driver', email: 'driver.schedule@example.invalid', role: 'driver', isActive: true });
  const passenger = await User.create({ name: 'Test Passenger', email: 'passenger.schedule@example.invalid', mobile: '0210000000', role: 'passenger', isActive: true });
  const time = new Date('2035-01-15T00:00:00.000Z');
  const day = nzDayAndTime(time).date;
  const driver = await Driver.create({
    userId: driverUser._id, status: 'approved', ratePerKm: 2, isAvailable: false,
    acceptsOnlinePayment: true,
    availabilitySchedule: [{ dayOfWeek: nzDayAndTime(time).dayOfWeek, slots: [{ startTime: '09:00', endTime: '12:00' }] }],
    dateSchedule: [{ date: day, slots: [] }],
  });

  const app = express();
  app.use(express.json());
  app.use('/api/booking', require('../routes/booking'));
  app.use('/api/driver', require('../routes/driver'));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const token = jwt.sign({ id: driverUser._id }, process.env.JWT_SECRET);
  const common = {
    pickupLat: -39.057, pickupLng: 174.076,
    dropLat: -39.066, dropLng: 174.087,
    scheduledFor: time.toISOString(), paymentMethod: 'cash',
  };
  const post = async (path, data) => {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
    return { status: response.status, body: await response.json() };
  };

  const quote = await post('/api/booking/quote', common);
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.equal(quote.body.requestedOffSchedule, true);
  assert.match(quote.body.availabilityMessage, /outside your declared working schedule/i);
  assert.ok(quote.body.estimatedFare > 0);

  const booked = await post('/api/driver/bookings', {
    ...common, passengerId: passenger._id,
    pickupAddress: 'New Plymouth Airport', dropAddress: 'New Plymouth CBD',
  });
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  assert.equal(booked.body.requestedOffSchedule, true);
  assert.match(booked.body.scheduleMessage, /can still book/i);
  assert.equal(booked.body.booking.status, 'accepted');
  assert.equal(booked.body.booking.bookedByDriver, true);
  assert.equal(String(booked.body.booking.driverId), String(driver._id));
  const saved = await Booking.findById(booked.body.booking._id);
  assert.equal(saved.status, 'accepted');
  assert.equal(saved.bookedByDriver, true);
});
