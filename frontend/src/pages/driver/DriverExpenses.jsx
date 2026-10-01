import { useEffect, useMemo, useState } from 'react';
import client from '../../api/client';
import { formatNzDate } from '../../utils/nzTime';

// A driver's business expenses for their tax return, one NZ tax year
// (1 April - 31 March) at a time - see backend/routes/expenses.js.
// Layout: entry form first (the thing drivers do most), then the list,
// then the year's summary and report at the bottom.

function nzToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());
}

const money = (n) => `$${Number(n || 0).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fyLabel = (fy) => `${fy - 1}-${String(fy).slice(2)}`;
const monthLabel = (ym) => new Date(`${ym}-15T12:00:00`).toLocaleDateString('en-NZ', { month: 'short', year: 'numeric' });

const emptyForm = () => ({ date: nzToday(), category: '', amount: '', gstIncluded: true, supplier: '', reference: '', notes: '', repeat: 'none' });

const REPEAT_LABELS = { weekly: 'every week', fortnightly: 'every fortnight', monthly: 'every month' };
const REPEAT_CHOICES = [['weekly', 'Every week'], ['fortnightly', 'Every fortnight'], ['monthly', 'Every month']];

// Value of the category <select> option that opens the "new category" box.
const NEW_CATEGORY = '__new__';

const SORTS = {
  date: (a, b) => a.date.localeCompare(b.date),
  category: (a, b) => a.categoryLabel.localeCompare(b.categoryLabel),
  amount: (a, b) => a.amount - b.amount,
  supplier: (a, b) => (a.supplier || '').localeCompare(b.supplier || ''),
};

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default function DriverExpenses() {
  const [fy, setFy] = useState(null); // null = current tax year (server decides)
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [editingCopy, setEditingCopy] = useState(false); // editing a copy added by a repeating expense
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [newCategory, setNewCategory] = useState(null); // null = box closed
  const [addingCategory, setAddingCategory] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sort, setSort] = useState({ key: 'date', dir: -1 });

  function load(year = fy) {
    setLoadError('');
    return client.get('/driver/expenses', { params: year ? { fy: year } : {} })
      .then((r) => setData(r.data))
      .catch((err) => setLoadError(err.response?.data?.error || 'Could not load expenses'));
  }

  useEffect(() => { load(fy); }, [fy]); // eslint-disable-line react-hooks/exhaustive-deps

  const categories = data?.categories || [];
  const customCategories = categories.filter((c) => c.custom);

  const categoryLabels = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.key, c.label])),
    [categories],
  );

  const rows = useMemo(() => {
    if (!data) return [];
    return data.expenses
      .map((e) => ({ ...e, categoryLabel: categoryLabels[e.category] || e.category }))
      .filter((e) => !categoryFilter || e.category === categoryFilter)
      .sort((a, b) => SORTS[sort.key](a, b) * sort.dir);
  }, [data, categoryLabels, categoryFilter, sort]);

  const filteredTotal = rows.reduce((s, e) => s + e.amount, 0);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function chooseCategory(value) {
    if (value === NEW_CATEGORY) {
      setNewCategory('');
      return;
    }
    setNewCategory(null);
    update('category', value);
  }

  async function addCategory() {
    const label = (newCategory || '').trim();
    if (!label) return;
    setFormError('');
    setAddingCategory(true);
    try {
      const { data: category } = await client.post('/driver/expenses/categories', { label });
      await load();
      update('category', category.key);
      setNewCategory(null);
    } catch (err) {
      setFormError(err.response?.data?.error || 'Could not add the category');
    } finally {
      setAddingCategory(false);
    }
  }

  async function removeCategory(c) {
    if (!window.confirm(`Remove the "${c.label}" category?`)) return;
    setFormError('');
    try {
      await client.delete(`/driver/expenses/categories/${encodeURIComponent(c.key)}`);
      if (form.category === c.key) update('category', '');
      if (categoryFilter === c.key) setCategoryFilter('');
      load();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Could not remove the category');
    }
  }

  function startEdit(e) {
    setEditingId(e._id);
    setEditingCopy(!!e.recurringFromId);
    setNewCategory(null);
    setForm({
      date: e.date, category: e.category, amount: String(e.amount), gstIncluded: e.gstIncluded !== false,
      supplier: e.supplier || '', reference: e.reference || '', notes: e.notes || '', repeat: e.repeat || 'none',
    });
    setFormError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingCopy(false);
    setNewCategory(null);
    setForm(emptyForm());
    setFormError('');
  }

  async function save(ev) {
    ev.preventDefault();
    setFormError('');
    if (!form.category) {
      setFormError('Choose a category');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, amount: Number(form.amount) };
      if (editingId) await client.put(`/driver/expenses/${editingId}`, payload);
      else await client.post('/driver/expenses', payload);
      // Keep the date and category for quick entry of several receipts
      // from the same day; clear the rest.
      setForm((f) => ({ ...emptyForm(), date: editingId ? nzToday() : f.date, category: editingId ? '' : f.category }));
      setEditingId(null);
      setEditingCopy(false);
      load();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Could not save the expense');
    } finally {
      setSaving(false);
    }
  }

  async function remove(e) {
    const msg = REPEAT_LABELS[e.repeat]
      ? `Delete this ${money(e.amount)} ${e.categoryLabel} expense? It repeats ${REPEAT_LABELS[e.repeat]} - deleting it stops the repeat (copies already added stay).`
      : `Delete this ${money(e.amount)} ${e.categoryLabel} expense?`;
    if (!window.confirm(msg)) return;
    try {
      await client.delete(`/driver/expenses/${e._id}`);
      if (editingId === e._id) cancelEdit();
      load();
    } catch (err) {
      setLoadError(err.response?.data?.error || 'Could not delete the expense');
    }
  }

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'date' || key === 'amount' ? -1 : 1 }));
  }

  function exportCsv() {
    const header = ['Date', 'Category', 'Supplier', 'Reference', 'Amount (NZD)', 'Includes GST', 'GST portion', 'Notes'];
    const lines = rows.map((e) => [e.date, e.categoryLabel, e.supplier, e.reference, e.amount.toFixed(2), e.gstIncluded ? 'Yes' : 'No', e.gst.toFixed(2), e.notes]);
    const csv = [header, ...lines].map((r) => r.map(csvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `expenses-${fyLabel(data.financialYear)}${categoryFilter ? `-${categoryFilter}` : ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Opens a plain, printable income & expenses report for the tax year
  // (the browser's print dialog can also save it as a PDF).
  function printReport() {
    const sm = data.summary;
    const row = (cells, bold) => `<tr>${cells.map((c, i) => `<td${i ? ' class="n"' : ''}>${bold ? `<b>${c}</b>` : c}</td>`).join('')}</tr>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Income & expenses ${fyLabel(data.financialYear)}</title>
<style>body{font-family:system-ui,sans-serif;margin:32px;color:#111}h1{margin:0 0 4px}h2{margin:28px 0 8px;font-size:1.1rem}
table{border-collapse:collapse;width:100%}td,th{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left}.n{text-align:right}
.muted{color:#666}</style></head><body>
<h1>Income &amp; expenses report</h1>
<div class="muted">Tax year ${fyLabel(data.financialYear)} (1 Apr ${data.financialYear - 1} - 31 Mar ${data.financialYear}) &middot; generated ${escapeHtml(formatNzDate(new Date()))}</div>
<h2>Summary</h2><table>
${row([`Trip income (${sm.tripCount} trips)`, money(sm.tripIncome)])}
${row([`Expenses (${sm.count})`, money(sm.totalExpenses)])}
${row(['GST included in expenses', money(sm.gstClaimable)])}
${row(['Income less expenses', money(sm.netIncome)], true)}
</table>
<h2>Expenses by category</h2><table>
${sm.byCategory.map((c) => row([escapeHtml(c.label), c.count, money(c.total)])).join('') || '<tr><td class="muted">No expenses recorded.</td></tr>'}
${row(['Total', '', money(sm.totalExpenses)], true)}
</table>
<h2>By month</h2><table><tr><th>Month</th><th class="n">Trips</th><th class="n">Income</th><th class="n">Expenses</th><th class="n">Net</th></tr>
${sm.byMonth.map((m) => row([monthLabel(m.month), m.tripCount, money(m.income), money(m.expenses), money(m.net)])).join('')}
${row(['Total', sm.tripCount, money(sm.tripIncome), money(sm.totalExpenses), money(sm.netIncome)], true)}
</table>
<h2>All expenses</h2><table><tr><th>Date</th><th>Category</th><th>Supplier</th><th>Ref</th><th class="n">Amount</th><th class="n">GST</th></tr>
${data.expenses.slice().sort((a, b) => a.date.localeCompare(b.date)).map((e) => row([e.date, escapeHtml(categoryLabels[e.category] || e.category), escapeHtml(e.supplier), escapeHtml(e.reference), money(e.amount), money(e.gst)])).join('')}
</table>
<script>window.onload=()=>window.print()</script></body></html>`;
    const w = window.open('', '_blank');
    if (!w) {
      setLoadError('Allow pop-ups for this site to open the report');
      return;
    }
    w.document.write(html);
    w.document.close();
  }

  const sortMark = (key) => (sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '');
  const s = data?.summary;
  const monthsWithActivity = s ? s.byMonth.filter((m) => m.tripCount || m.expenses) : [];

  return (
    <div className="container">
      <h1>Expenses</h1>
      <p className="muted" style={{ marginTop: -8 }}>
        Keep your vehicle and running costs here for your tax return. Tax years run 1 April - 31 March.
        Keep your receipts too - IRD asks for business records to be kept for 7 years.
      </p>

      {/* 1. Entry */}
      <form className="card" onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>{editingId ? 'Edit expense' : 'Add an expense'}</h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 140px' }}><label>Date paid</label><input type="date" value={form.date} max={nzToday()} onChange={(e) => update('date', e.target.value)} required /></div>
          <div style={{ flex: '1 1 120px' }}><label>Amount (NZD)</label><input type="number" inputMode="decimal" min="0.01" step="0.01" value={form.amount} onChange={(e) => update('amount', e.target.value)} placeholder="0.00" required /></div>
          <div style={{ flex: '2 1 220px' }}>
            <label>Category</label>
            <select value={newCategory !== null ? NEW_CATEGORY : form.category} onChange={(e) => chooseCategory(e.target.value)}>
              <option value="" disabled>Choose a category...</option>
              {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              <option value={NEW_CATEGORY}>+ Add a new category...</option>
            </select>
          </div>
        </div>
        {newCategory !== null && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 220px' }}>
              <label>New category name</label>
              <input
                value={newCategory}
                maxLength={40}
                autoFocus
                placeholder="e.g. Car seats, Uniform"
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } }}
              />
            </div>
            <button type="button" className="btn" onClick={addCategory} disabled={addingCategory || !newCategory.trim()}>{addingCategory ? 'Adding...' : 'Add category'}</button>
            <button type="button" className="btn secondary" onClick={() => setNewCategory(null)}>Cancel</button>
          </div>
        )}
        {customCategories.length > 0 && (
          <div className="muted" style={{ fontSize: '0.85rem', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            Your categories:
            {customCategories.map((c) => (
              <span key={c.key} style={{ border: '1px solid currentColor', borderRadius: 12, padding: '1px 4px 1px 10px' }}>
                {c.label}
                <button type="button" onClick={() => removeCategory(c)} title="Remove this category" aria-label={`Remove ${c.label}`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: '0 4px', width: 'auto' }}>×</button>
              </span>
            ))}
          </div>
        )}
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 'normal' }}>
          <input type="checkbox" checked={form.gstIncluded} onChange={(e) => update('gstIncluded', e.target.checked)} style={{ width: 'auto' }} />
          Amount includes GST (untick for GST-free costs, e.g. RUC bought overseas, bank fees)
        </label>
        {editingCopy ? (
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            ↻ Added automatically by a repeating expense. Changes here apply to this one only - edit the original to change or stop the repeat.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 'normal' }}>
              <input type="checkbox" checked={form.repeat !== 'none'} style={{ width: 'auto' }}
                onChange={(e) => update('repeat', e.target.checked ? 'monthly' : 'none')} />
              Repeat this expense (e.g. phone plan, insurance, weekly car wash)
            </label>
            {form.repeat !== 'none' && (
              <div style={{ paddingLeft: 26, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {REPEAT_CHOICES.map(([r, label]) => (
                    <label key={r} style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 'normal' }}>
                      <input type="radio" name="repeat" value={r} checked={form.repeat === r} style={{ width: 'auto' }}
                        onChange={() => update('repeat', r)} />
                      {label}
                    </label>
                  ))}
                </div>
                <span className="muted" style={{ fontSize: '0.85rem' }}>
                  Added again automatically {REPEAT_LABELS[form.repeat]} on the same {form.repeat !== 'monthly' ? 'day of the week' : 'day of the month (or the last day if the month is shorter)'} as
                  the date paid. {editingId
                    ? 'For an expense already saved, copies are added from today on only.'
                    : 'If the date paid is in the past, every missed one up to today is filled in too.'} Untick to stop repeating.
                </span>
              </div>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 160px' }}><label>Supplier (optional)</label><input value={form.supplier} maxLength={100} onChange={(e) => update('supplier', e.target.value)} placeholder="e.g. Tyre Pro, NZTA" /></div>
          <div style={{ flex: '1 1 120px' }}><label>Receipt / invoice no. (optional)</label><input value={form.reference} maxLength={60} onChange={(e) => update('reference', e.target.value)} /></div>
          <div style={{ flex: '2 1 220px' }}><label>Notes (optional)</label><input value={form.notes} maxLength={500} onChange={(e) => update('notes', e.target.value)} placeholder="e.g. 4 x front tyres, 1,000 km RUC" /></div>
        </div>
        {formError && <p className="error-text" style={{ margin: 0 }}>{formError}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" type="submit" disabled={saving || !data}>{saving ? 'Saving...' : editingId ? 'Save changes' : 'Add expense'}</button>
          {editingId && <button className="btn secondary" type="button" onClick={cancelEdit}>Cancel</button>}
        </div>
      </form>

      {loadError && <p className="error-text">{loadError}</p>}
      {!data && !loadError && <p className="muted">Loading...</p>}

      {/* 2. List */}
      {data && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
            <div>
              <label>Financial year</label>
              <select value={data.financialYear} onChange={(e) => setFy(Number(e.target.value))}>
                {data.years.map((y) => (
                  <option key={y} value={y}>
                    {fyLabel(y)} (1 Apr {y - 1} - 31 Mar {y}){y === data.currentFinancialYear ? ' - current' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Show category</label>
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="">All categories</option>
                {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>{categoryFilter ? categoryLabels[categoryFilter] : 'All expenses'} - {fyLabel(data.financialYear)}</h3>
            <strong>{money(filteredTotal)}</strong>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('date')}>Date{sortMark('date')}</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('category')}>Category{sortMark('category')}</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('supplier')}>Supplier{sortMark('supplier')}</th>
                  <th style={{ cursor: 'pointer', textAlign: 'right' }} onClick={() => toggleSort('amount')}>Amount{sortMark('amount')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e._id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatNzDate(`${e.date}T12:00:00`)}</td>
                    <td>
                      {e.categoryLabel}
                      {REPEAT_LABELS[e.repeat] && <div style={{ fontSize: '0.8rem', color: 'var(--primary)' }}>↻ Repeats {REPEAT_LABELS[e.repeat]}</div>}
                      {e.recurringFromId && <div className="muted" style={{ fontSize: '0.8rem' }}>↻ Added automatically</div>}
                      {e.notes && <div className="muted" style={{ fontSize: '0.8rem' }}>{e.notes}</div>}
                    </td>
                    <td>
                      {e.supplier}
                      {e.reference && <div className="muted" style={{ fontSize: '0.8rem' }}>#{e.reference}</div>}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {money(e.amount)}
                      <div className="muted" style={{ fontSize: '0.75rem' }}>{e.gstIncluded ? `incl. ${money(e.gst)} GST` : 'no GST'}</div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button type="button" className="btn secondary" style={{ padding: '4px 10px' }} onClick={() => startEdit(e)}>Edit</button>{' '}
                      <button type="button" className="btn danger" style={{ padding: '4px 10px' }} onClick={() => remove(e)}>Delete</button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={5} className="muted">No expenses {categoryFilter ? 'in this category ' : ''}for this tax year.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. Summary & report */}
      {s && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, margin: '8px 0 12px' }}>
            <h2 style={{ margin: 0 }}>Summary - {fyLabel(data.financialYear)}</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn secondary" onClick={exportCsv} disabled={!rows.length}>Download CSV</button>
              <button type="button" className="btn" onClick={printReport}>Print / save report</button>
            </div>
          </div>

          <div className="grid cols-4" style={{ marginBottom: 16 }}>
            <div className="card stat"><div className="value">{money(s.tripIncome)}</div><div className="label">Income ({s.tripCount} trips)</div></div>
            <div className="card stat"><div className="value">{money(s.totalExpenses)}</div><div className="label">Expenses ({s.count})</div></div>
            <div className="card stat"><div className="value">{money(s.gstClaimable)}</div><div className="label">GST included in expenses</div></div>
            <div className="card stat"><div className="value">{money(s.netIncome)}</div><div className="label">Income less expenses</div></div>
          </div>

          <div className="grid cols-2" style={{ alignItems: 'start' }}>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Expenses by category</h3>
              {s.byCategory.length === 0 && <p className="muted">No expenses recorded for this tax year yet.</p>}
              {s.byCategory.length > 0 && (
                <table>
                  <tbody>
                    {s.byCategory.map((c) => (
                      <tr key={c.key} style={{ cursor: 'pointer' }} onClick={() => setCategoryFilter(categoryFilter === c.key ? '' : c.key)} title="Show only this category in the list">
                        <td>{c.label}{categoryFilter === c.key ? ' ✓' : ''}</td>
                        <td className="muted">{c.count}</td>
                        <td style={{ textAlign: 'right' }}>{money(c.total)}</td>
                      </tr>
                    ))}
                    <tr><td><strong>Total</strong></td><td /><td style={{ textAlign: 'right' }}><strong>{money(s.totalExpenses)}</strong></td></tr>
                  </tbody>
                </table>
              )}
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>Income &amp; expenses by month</h3>
              {monthsWithActivity.length === 0 && <p className="muted">Nothing recorded for this tax year yet.</p>}
              {monthsWithActivity.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th style={{ textAlign: 'right' }}>Income</th>
                        <th style={{ textAlign: 'right' }}>Expenses</th>
                        <th style={{ textAlign: 'right' }}>Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthsWithActivity.map((m) => (
                        <tr key={m.month}>
                          <td style={{ whiteSpace: 'nowrap' }}>{monthLabel(m.month)}</td>
                          <td style={{ textAlign: 'right' }}>{money(m.income)}</td>
                          <td style={{ textAlign: 'right' }}>{money(m.expenses)}</td>
                          <td style={{ textAlign: 'right' }}>{money(m.net)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td><strong>Total</strong></td>
                        <td style={{ textAlign: 'right' }}><strong>{money(s.tripIncome)}</strong></td>
                        <td style={{ textAlign: 'right' }}><strong>{money(s.totalExpenses)}</strong></td>
                        <td style={{ textAlign: 'right' }}><strong>{money(s.netIncome)}</strong></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
