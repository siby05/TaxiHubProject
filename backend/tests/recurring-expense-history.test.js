const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
process.env.DB_MODE = 'memory';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'recurring-expense-test-secret-123456789';
const User = require('../models/User');
const Driver = require('../models/Driver');
const Expense = require('../models/Expense');
const { recurringValuesFor } = require('../utils/recurringExpenseValues');

test('recurring values retain original, recorded copies and ungenerated earlier dates', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-21T00:00:00Z') });
  const user = await User.create({ name: 'Driver', role: 'driver', isActive: true });
  const driver = await Driver.create({ userId: user._id });
  const app = express(); app.use(express.json()); app.use('/expenses', require('../routes/expenses'));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
  const request = async (path = '', method = 'GET', body) => {
    const res = await fetch('http://127.0.0.1:' + server.address().port + '/expenses' + path, {
      method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      ...(body && { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: await res.json() };
  };
  const original = { date: '2030-01-01', category: 'phone', amount: 50, gstIncluded: true,
    supplier: 'Old supplier', reference: 'ORIGINAL-1', notes: 'Old notes', repeat: 'weekly' };
  const tpl = await Expense.create({ ...original, driverId: driver._id });
  // A previously recorded occurrence remains untouched.
  const recorded = await Expense.create({ ...original, date: '2030-01-08', repeat: 'none',
    reference: '', recurringFromId: tpl._id, driverId: driver._id });
  for (const amount of [60, 70]) {
    const changed = await request('/' + tpl._id, 'PUT', { ...original, amount, category: 'fuel', supplier: 'New supplier', notes: 'New notes', gstIncluded: false });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal(changed.body.amount, amount);
  }
  assert.equal((await Expense.findById(tpl._id)).amount, 50);
  assert.equal((await Expense.findById(recorded._id)).amount, 50);
  const before = await request();
  assert.equal(before.status, 200, JSON.stringify(before.body));
  const oldCopy = before.body.expenses.find(e => e.date === '2030-01-15');
  assert.equal(oldCopy.amount, 50);
  assert.equal(oldCopy.category, 'phone');
  assert.equal(oldCopy.gstIncluded, true);
  assert.equal(before.body.repeating[0].amount, 70);
  assert.equal(before.body.repeating[0].supplier, 'New supplier');
  assert.equal((await request('/' + tpl._id, 'PUT', { ...original, date: '2030-01-02' })).status, 400);
  assert.equal((await request('/' + tpl._id, 'PUT', { ...original, reference: 'CHANGED' })).status, 400);
  t.mock.timers.setTime(Date.parse('2030-01-29T00:00:00Z'));
  const after = await request();
  for (const date of ['2030-01-22', '2030-01-29']) {
    const e = after.body.expenses.find(e => e.date === date);
    assert.equal(e.amount, 70); assert.equal(e.category, 'fuel');
    assert.equal(e.gstIncluded, false); assert.equal(e.notes, 'New notes');
  }
  const count = after.body.expenses.length;
  assert.equal((await request()).body.expenses.length, count);
  // Editing one generated receipt does not alter the recurring values.
  assert.equal((await request('/' + recorded._id, 'PUT', { ...original, date: recorded.date, reference: '', amount: 45 })).status, 200);
  assert.equal((await Expense.findById(recorded._id)).repeat, 'none');
  assert.equal((await request()).body.repeating[0].amount, 70);

  // Changing interval or stopping must settle previously ungenerated history.
  for (const repeat of ['monthly', 'none']) {
    const older = await Expense.create({ ...original, driverId: driver._id, reference: '', repeatValueVersions: [{ effectiveFrom: '2030-01-21', amount: 80, category: 'fuel', supplier: 'New', gstIncluded: false, notes: '' }] });
    const changed = await request('/' + older._id + '/repeat', 'PUT', { repeat, nextDate: '2030-02-01' });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    const copies = await Expense.find({ recurringFromId: older._id });
    assert.equal(copies.find(e => e.date === '2030-01-15').amount, 50);
    assert.equal(copies.find(e => e.date === '2030-01-22').amount, 80);
  }
});

test('effective dates include the boundary and last same-day update wins', () => {
  const tpl = { amount: 50, category: 'phone', repeatValueVersions: [
    { effectiveFrom: '2030-01-21', amount: 60 },
    { effectiveFrom: '2030-01-21', amount: 70 },
    { effectiveFrom: '2030-02-01', amount: 80 },
  ] };
  assert.equal(recurringValuesFor(tpl, '2030-01-20').amount, 50);
  assert.equal(recurringValuesFor(tpl, '2030-01-21').amount, 70);
  assert.equal(recurringValuesFor(tpl, '2030-02-01').amount, 80);
  assert.equal(recurringValuesFor(tpl, '2030-02-01').category, 'phone');
});
