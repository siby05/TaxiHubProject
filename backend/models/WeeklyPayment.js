const { createModel } = require('../lib/createModel');

// Records a driver's payment against a given ISO week's owed amount
// (fields: driverId, weekStart ISO string, amountPaid, note). Multiple
// partial payments for the same week are summed by utils/billing.js.
const WeeklyPayment = createModel('WeeklyPayment', {
  driverId: 'Driver',
});

module.exports = WeeklyPayment;
