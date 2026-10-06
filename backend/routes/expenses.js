const express = require('express');
const router = express.Router();
const Driver = require('../models/Driver');
const Expense = require('../models/Expense');
const { driverEarnings, tripCountOf } = require('../utils/earnings');
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

// Built-in categories plus the driver's own (driver.expenseCategories,
// [{key, label}] - added via POST /categories below). Custom keys are
// prefixed 'custom-' so they can never collide with a built-in one.
function categoriesFor(driver) {
  return [...EXPENSE_CATEGORIES, ...(driver.expenseCategories || []).map((c) => ({ ...c, custom: true }))];
}

// Validates and normalises a create/update body. Returns { error } or
// { value } with only the fields a driver may set.
function parseExpense(body, driver) {
  const date = String(body.date || '').trim();
  if (!isRealDate(date)) return { error: 'Enter the date the expense was paid' };
  if (date > nzToday()) return { error: 'The expense date can\'t be in the future' };
  if (!isValidExpenseCategory(body.category) && !(driver.expenseCategories || []).some((c) => c.key === body.category)) {
    return { error: 'Choose a category' };
  }
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
      repeat: REPEAT_OPTIONS.includes(body.repeat) ? body.repeat : 'none',
    },
  };
}

// Repeating expenses (e.g. weekly car wash, monthly phone plan): the
// expense the driver entered stays as the template (repeat: 'weekly' |
// 'fortnightly' | 'monthly') and a copy of it is added for each due date up to today, linked
// back via recurringFromId. A new expense entered with a past date and
// repeat ticked is filled in up to today (every missed week/fortnight/
// month gets its copy). Ticking repeat on an expense that was already
// saved only adds copies from that day on, so existing records are never
// backfilled. repeatThrough records the last date already handled, so a
// copy the driver deletes isn't added back. repeatFrom, when set, is the
// first due date of a changed interval (PUT /:id/repeat) - copies then
// count from it instead of from the date paid. Monthly repeats keep the
// start's day of the month, moved to the month's last day when it's
// shorter (31 Jan -> 28 Feb -> 31 Mar).
const REPEAT_OPTIONS = ['none', 'weekly', 'fortnightly', 'monthly'];
// Safety cap on copies added for one template in one go (a weekly expense
// backdated several years).
const MAX_COPIES_PER_RUN = 520;

function addDaysTo(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// The nth repeat after `anchor` ('YYYY-MM-DD').
function nthRepeat(anchor, repeat, n) {
  if (repeat === 'weekly') return addDaysTo(anchor, 7 * n);
  if (repeat === 'fortnightly') return addDaysTo(anchor, 14 * n);
  const [y, m, d] = anchor.split('-').map(Number);
  const monthIndex = m - 1 + n;
  const year = y + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

const isRepeating = (e) => !!e.repeat && e.repeat !== 'none' && REPEAT_OPTIONS.includes(e.repeat);

// Due dates of a repeating expense, in order: from repeatFrom (inclusive)
// after an interval change, otherwise every interval after the date paid.
function* dueDates(tpl) {
  const start = tpl.repeatFrom || tpl.date;
  for (let n = tpl.repeatFrom ? 0 : 1; ; n += 1) yield nthRepeat(start, tpl.repeat, n);
}

function handledThrough(tpl) {
  return tpl.repeatThrough && tpl.repeatThrough > tpl.date ? tpl.repeatThrough : tpl.date;
}

// The first due date not yet handled - when the next copy will be added.
function nextDueDate(tpl) {
  const through = handledThrough(tpl);
  for (const date of dueDates(tpl)) if (date > through) return date;
  return null;
}

// Adds any copies of the driver's repeating expenses that have come due.
// Run before every list, so nothing needs a background job.
async function addDueRepeats(driverId, expenses) {
  const today = nzToday();
  for (const tpl of expenses.filter(isRepeating)) {
    const through = handledThrough(tpl);
    if (through >= today) continue;
    const existing = new Set(expenses.filter((e) => String(e.recurringFromId) === String(tpl._id)).map((e) => e.date));
    existing.add(tpl.date);
    let copies = 0;
    for (const date of dueDates(tpl)) {
      if (date > today || copies >= MAX_COPIES_PER_RUN) break;
      if (date <= through || existing.has(date)) continue;
      await Expense.create({
        driverId,
        date,
        category: tpl.category,
        amount: tpl.amount,
        gstIncluded: tpl.gstIncluded,
        supplier: tpl.supplier,
        reference: '',
        notes: tpl.notes,
        repeat: 'none',
        recurringFromId: tpl._id,
      });
      copies += 1;
    }
    await Expense.findByIdAndUpdate(tpl._id, { repeatThrough: today });
  }
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

    await addDueRepeats(driver._id, await Expense.find({ driverId: driver._id }));
    const [allExpenses, completedTrips] = await Promise.all([
      Expense.find({ driverId: driver._id }),
      // Includes earnings archived from deleted trips (utils/earnings.js).
      driverEarnings(driver._id),
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

    const categories = categoriesFor(driver);
    const byCategory = categories.map((c) => {
      const items = expenses.filter((e) => e.category === c.key);
      return { key: c.key, label: c.label, count: items.length, total: round2(items.reduce((s, e) => s + e.amount, 0)) };
    }).filter((c) => c.count > 0).sort((a, b) => b.total - a.total);

    const tripsInYear = completedTrips.filter((t) => {
      const d = nzDateOf(t.completedAt || t.updatedAt || t.createdAt);
      return d >= start && d <= end;
    });
    const totalExpenses = round2(expenses.reduce((s, e) => s + e.amount, 0));
    const tripIncome = round2(tripsInYear.reduce((s, t) => s + (t.actualFare || 0), 0));

    // Month-by-month income and expenses, April first, for the report.
    const byMonth = Array.from({ length: 12 }, (_, i) => {
      const m = ((i + 3) % 12) + 1;
      const month = `${m >= 4 ? fy - 1 : fy}-${String(m).padStart(2, '0')}`;
      const monthExpenses = expenses.filter((e) => e.date.startsWith(month));
      const monthTrips = tripsInYear.filter((t) => nzDateOf(t.completedAt || t.updatedAt || t.createdAt).startsWith(month));
      const income = round2(monthTrips.reduce((s, t) => s + (t.actualFare || 0), 0));
      const spent = round2(monthExpenses.reduce((s, e) => s + e.amount, 0));
      return { month, tripCount: tripCountOf(monthTrips), income, expenses: spent, net: round2(income - spent) };
    });

    // Every active repeating expense, whatever tax year it started in, for
    // the Repeating tab - with how many copies it has added so far and
    // when the next one is due.
    const repeating = allExpenses.filter(isRepeating).map((tpl) => {
      const copies = allExpenses.filter((e) => String(e.recurringFromId) === String(tpl._id));
      return {
        ...tpl,
        copyCount: copies.length,
        lastCopyDate: copies.reduce((max, e) => (e.date > max ? e.date : max), '') || null,
        nextDate: nextDueDate(tpl),
      };
    }).sort((a, b) => (a.nextDate || '').localeCompare(b.nextDate || ''));

    res.json({
      repeating,
      financialYear: fy,
      currentFinancialYear: currentFy,
      start,
      end,
      years: [...years].sort((a, b) => b - a),
      categories,
      expenses,
      summary: {
        count: expenses.length,
        totalExpenses,
        gstClaimable: round2(expenses.reduce((s, e) => s + e.gst, 0)),
        byCategory,
        byMonth,
        tripCount: tripCountOf(tripsInYear),
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
    const { error, value } = parseExpense(req.body, driver);
    if (error) return res.status(400).json({ error });
    // repeatThrough null = fill in from the date paid up to today on the
    // next list load (see addDueRepeats).
    const expense = await Expense.create({ ...value, driverId: driver._id, repeatThrough: null });
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

// POST /api/driver/expenses/categories { label } - adds a category of the
// driver's own. Returns the new {key, label}; re-adding an existing label
// just returns that category.
router.post('/categories', driverOnly, async (req, res) => {
  try {
    const driver = await getDriver(req, res);
    if (!driver) return;
    const label = String(req.body.label || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!label) return res.status(400).json({ error: 'Enter a name for the category' });
    const existing = categoriesFor(driver).find((c) => c.label.toLowerCase() === label.toLowerCase());
    if (existing) return res.json({ key: existing.key, label: existing.label });
    const own = driver.expenseCategories || [];
    if (own.length >= 30) return res.status(400).json({ error: 'You can have up to 30 categories of your own' });
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'category';
    let key = `custom-${slug}`;
    for (let n = 2; own.some((c) => c.key === key); n += 1) key = `custom-${slug}-${n}`;
    const category = { key, label };
    await Driver.findByIdAndUpdate(driver._id, { expenseCategories: [...own, category] });
    res.status(201).json(category);
  } catch (err) {
    console.error(`[expenses] add category failed: ${err.message}`);
    res.status(500).json({ error: 'Could not add the category' });
  }
});

// DELETE /api/driver/expenses/categories/:key - removes one of the driver's
// own categories, only while no expense uses it.
router.delete('/categories/:key', driverOnly, async (req, res) => {
  try {
    const driver = await getDriver(req, res);
    if (!driver) return;
    const own = driver.expenseCategories || [];
    if (!own.some((c) => c.key === req.params.key)) return res.status(404).json({ error: 'Category not found' });
    const inUse = await Expense.findOne({ driverId: driver._id, category: req.params.key });
    if (inUse) return res.status(400).json({ error: 'This category has expenses - move or delete them first' });
    await Driver.findByIdAndUpdate(driver._id, { expenseCategories: own.filter((c) => c.key !== req.params.key) });
    res.json({ ok: true });
  } catch (err) {
    console.error(`[expenses] delete category failed: ${err.message}`);
    res.status(500).json({ error: 'Could not delete the category' });
  }
});

// PUT /api/driver/expenses/:id/repeat { repeat, nextDate } - stops a
// repeating expense (repeat: 'none') or changes its interval. nextDate
// ('YYYY-MM-DD', today or later) is when the first copy at the new interval
// is due; copies then follow every interval from it. Nothing is added or
// removed for dates already past - copies already added are kept.
router.put('/:id/repeat', driverOnly, async (req, res) => {
  try {
    const driver = await getDriver(req, res);
    if (!driver) return;
    const current = await findOwnExpense(driver, req.params.id);
    if (!current) return res.status(404).json({ error: 'Expense not found' });
    if (current.recurringFromId) return res.status(400).json({ error: 'Change the repeat on the original expense, not a copy' });
    const { repeat } = req.body;
    if (!REPEAT_OPTIONS.includes(repeat)) return res.status(400).json({ error: 'Choose how often it repeats' });

    if (repeat === 'none') {
      const updated = await Expense.findByIdAndUpdate(current._id, { repeat: 'none', repeatThrough: null, repeatFrom: null }, { new: true });
      return res.json(updated);
    }

    const today = nzToday();
    const nextDate = String(req.body.nextDate || '');
    if (!isRealDate(nextDate)) return res.status(400).json({ error: 'Choose the date the next payment is due' });
    if (nextDate < today) return res.status(400).json({ error: 'The next payment date can\'t be in the past' });
    if (nextDate > addDaysTo(today, 366)) return res.status(400).json({ error: 'The next payment date must be within a year' });

    const updated = await Expense.findByIdAndUpdate(current._id, {
      repeat,
      repeatFrom: nextDate,
      // Everything before nextDate counts as handled, so the first copy at
      // the new interval lands on nextDate itself.
      repeatThrough: addDaysTo(nextDate, -1),
    }, { new: true });
    res.json(updated);
  } catch (err) {
    console.error(`[expenses] change repeat failed: ${err.message}`);
    res.status(500).json({ error: 'Could not change the repeat' });
  }
});

// PUT /api/driver/expenses/:id
router.put('/:id', driverOnly, async (req, res) => {
  try {
    const driver = await getDriver(req, res);
    if (!driver) return;
    const current = await findOwnExpense(driver, req.params.id);
    if (!current) return res.status(404).json({ error: 'Expense not found' });
    const { error, value } = parseExpense(req.body, driver);
    if (error) return res.status(400).json({ error });
    // A copy added by a repeating expense can't start repeating itself -
    // that's set on the original. Changing how or from when an expense
    // repeats restarts it from today: copies already added are kept, and
    // nothing is added for past dates.
    // An expense that already repeats keeps its interval here - stopping
    // or changing it is PUT /:id/repeat (the Repeating tab).
    if (current.recurringFromId) value.repeat = 'none';
    if (isRepeating(current)) value.repeat = current.repeat;
    if (value.repeat !== (current.repeat || 'none') || (value.date !== current.date && !current.repeatFrom)) {
      value.repeatThrough = value.repeat !== 'none' ? nzToday() : null;
      value.repeatFrom = null;
    }
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
