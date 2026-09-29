const { createModel } = require('../lib/createModel');

// A driver's business expense, kept for their tax return (see
// routes/expenses.js). Fields: driverId (-> Driver), date ('YYYY-MM-DD',
// NZ date the expense was paid - a plain string so financial-year range
// filters compare the same way in memory and in MongoDB), category (a key
// from config/expenseCategories.js), amount (NZD, as paid), gstIncluded
// (whether that amount includes 15% GST), supplier, reference (receipt or
// invoice number), notes.
const Expense = createModel('Expense', {
  driverId: 'Driver',
});

module.exports = Expense;
