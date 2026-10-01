const { createModel } = require('../lib/createModel');

// A driver's business expense, kept for their tax return (see
// routes/expenses.js). Fields: driverId (-> Driver), date ('YYYY-MM-DD',
// NZ date the expense was paid - a plain string so financial-year range
// filters compare the same way in memory and in MongoDB), category (a key
// from config/expenseCategories.js), amount (NZD, as paid), gstIncluded
// (whether that amount includes 15% GST), supplier, reference (receipt or
// invoice number), notes, repeat ('none' | 'weekly' | 'fortnightly' | 'monthly'),
// repeatThrough (last date a repeating expense's copies were added up to),
// recurringFromId (-> Expense; set on a copy added by a repeating expense).
// See addDueRepeats() in routes/expenses.js.
const Expense = createModel('Expense', {
  driverId: 'Driver',
  recurringFromId: 'Expense',
});

module.exports = Expense;
