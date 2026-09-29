const express = require('express');
const router = express.Router();
const Driver = require('../models/Driver');
const Booking = require('../models/Booking');
const Expense = require('../models/Expense');
const { auth, roleMiddleware } = require('../middleware/auth');
const { EXPENSE_CATEGORIES, isValidExpenseCategory } = require('../config/expenseCategories');

// Drivers are self-employed, so they need their vehicle and running costs
// on record for their IRD return. Expenses are grouped by NZ tax year,
// which runs 1 April - 31 March and is named by the year it ends in (the
// "2026" year is 1 April 2025 - 31 March 2026), the same way IRD names it.

const driverOnly = [auth, roleMiddleware(['driver'])];

function nzToday() {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());
}

function nzDateOf(value) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date(value));
}

function financialYearOf(dateStr) {
  const [year, month] = dateStr.split('-').map(Number);
  return month >= 4 ? year + 1 : year;
}

function financialYearRange(fy) {
  return { start: `${fy - 1}-04-01`, end: `${fy}-03-31` };
}

const round2 = (n) => Math.round(n * 100) / 100;
// GST in a GST-inclusive NZ price is 3/23 of it (15% on top of the net).
const gstPortion = (e) => (e.gstIncluded ? round2((e.amount * 3) / 23) : 0);

function isRealDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(`${str}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === str;
}

// Validates and normalises a create/update body. Returns { error } or
// { value } with only the fields a driver may set.
function parseExpense(body) {
  const date = String(body.date || '').trim();
  if (!isRealDate(date)) return { error: 'Enter the date the expense was paid' };
  if (date > nzToday()) return { error: 'The expense date can\'t be in the future' };
  if (!isValidExpenseCategory(body.category)) return { error: 'Choose a category' };
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Enter an amount greater than $0' };
  if (amount > 100000) return { error: 'Amount looks too large - check it and try again' };
  const text = (v, max) => String(v ?? '').trim().slice(0, max);
  return {
    value: {
      date,
      category: body.category,
      amount: round2(amount),
      gstIncluded: body.gstIncluded !== false,
      supplier: text(body.supplier, 100),
      reference: text(body.reference, 60),
      notes: text(body.notes, 500),
    },
  };
}

async function getDriver(req, res) {
  const driver = await Driver.findOne({ userId: req.user.id });
  if (!driver) res.status(404).json({ error: 'Driver profile not found' });
  return driver;
}

// GET /api/driver/expenses?fy=2026 - one tax year's expenses plus totals by
// category and that year's trip income, so the driver sees both sides of
// their return. Defaults to the current tax year.
router.get('/', driverOnly, async (req, res) => {
  try {
    const driver = await getDriver(req, res);
    if (!driver) return;

    const currentFy = financialYearOf(nzToday());
    const fy = Number(req.query.fy) || currentFy;
    if (fy < 2000 || fy > currentFy + 1) return res.status(400).json({ error: 'Invalid financial year' });
    const { start, end } = financialYearRange(fy);

    const [allExpenses, completedTrips] = await Promise.all([
      Expense.find({ driverId: driver._id }),
      Booking.find({ driverId: driver._id, status: 'completed' }),
    ]);

    // Every year the driver has records in, plus the current one, so the
    // year picker only offers years with something to show.
    const years = new Set([currentFy]);
    for (const e of allExpenses) years.add(financialYearOf(e.date));
    for (const t of completedTrips) years.add(financialYearOf(nzDateOf(t.completedAt || t.updatedAt || t.createdAt)));

    const expenses = allExpenses
      .filter((e) => e.date >= start && e.date <= end)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .map((e) => ({ ...e, gst: gstPortion(e) }));

    const byCategory = EXPENSE_CATEGORIES.map((c) => {
      const items = expenses.filter((e) => e.category === c.key);
      return { key: c.key, label: c.label, count: items.length, total: round2(items.reduce((s, e) => s + e.amount, 0)) };
    }).filter((c) => c.count > 0).sort((a, b) => b.total - a.total);

    const tripsInYear = completedTrips.filter((t) => {
      const d = nzDateOf(t.completedAt || t.updatedAt || t.createdAt);
      return d >= start && d <= end;
    });
    const totalExpenses = round2(expenses.reduce((s, e) => s + e.amount, 0));
    const tripIncome = round2(tripsInYear.reduce((s, t) => s + (t.actualFare || 0), 0));

    res.json({
      financialYear: fy,
      currentFinancialYear: currentFy,
      start,
      end,
      years: [...years].sort((a, b) => b - a),
      categories: EXPENSE_CATEGORIES,
      expenses,
      summary: {
        count: expenses.length,
        totalExpenses,
        gstClaimable: round2(expenses.reduce((s, e) => s + e.gst, 0)),
        byCategory,
        tripCount: tripsInYear.length,
        tripIncome,
        netIncome: round2(tripIncome - totalExpenses),
      },
    });
  } catch (err) {
    console.error(`[expenses] list failed: ${err.message}`);
    res.status(500).json({ error: 'Could not load expenses' });
  }
});

// POST /api/driver/expenses
router.post('/', driverOnly, async (req, res) => {
  try {
    const driver = await getDriver(req, res);
    if (!driver) return;
    const { error, value } = parseExpense(req.body);
    if (error) return res.status(400).json({ error });
    const expense = await Expense.create({ ...value, driverId: driver._id });
    res.status(201).json(expense);
  } catch (err) {
    console.error(`[expenses] create failed: ${err.message}`);
    res.status(500).json({ error: 'Could not save the expense' });
  }
});

async function findOwnExpense(driver, id) {
  try {
    const expense = await Expense.findById(id);
    return expense && String(expense.driverId) === String(driver._id) ? expense : null;
  } catch {
    return null; // malformed id
  }
}

// PUT /api/driver/expenses/:id
router.put('/:id', driverOnly, async (req, res) => {
  try {
    const driver = await getDriver(req, res);
    if (!driver) return;
    if (!(await findOwnExpense(driver, req.params.id))) return res.status(404).json({ error: 'Expense not found' });
    const { error, value } = parseExpense(req.body);
    if (error) return res.status(400).json({ error });
    const updated = await Expense.findByIdAndUpdate(req.params.id, value, { new: true });
    res.json(updated);
  } catch (err) {
    console.error(`[expenses] update failed: ${err.message}`);
    res.status(500).json({ error: 'Could not update the expense' });
  }
});

// DELETE /api/driver/expenses/:id
router.delete('/:id', driverOnly, async (req, res) => {
  try {
    const driver = await getDriver(req, res);
    if (!driver) return;
    if (!(await findOwnExpense(driver, req.params.id))) return res.status(404).json({ error: 'Expense not found' });
    await Expense.deleteMany({ _id: req.params.id, driverId: driver._id });
    res.json({ ok: true });
  } catch (err) {
    console.error(`[expenses] delete failed: ${err.message}`);
    res.status(500).json({ error: 'Could not delete the expense' });
  }
});

module.exports = router;
