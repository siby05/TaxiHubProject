import { useEffect, useMemo, useState } from 'react';
import client from '../../api/client';
import { formatNzDate } from '../../utils/nzTime';

// A driver's business expenses for their tax return, one NZ tax year
// (1 April - 31 March) at a time - see backend/routes/expenses.js.

function nzToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());
}

const money = (n) => `$${Number(n || 0).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fyLabel = (fy) => `${fy - 1}-${String(fy).slice(2)}`;

const emptyForm = () => ({ date: nzToday(), category: '', amount: '', gstIncluded: true, supplier: '', reference: '', notes: '' });

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

export default function DriverExpenses() {
  const [fy, setFy] = useState(null); // null = current tax year (server decides)
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sort, setSort] = useState({ key: 'date', dir: -1 });

  function load(year = fy) {
    setLoadError('');
    client.get('/driver/expenses', { params: year ? { fy: year } : {} })
      .then((r) => setData(r.data))
      .catch((err) => setLoadError(err.response?.data?.error || 'Could not load expenses'));
  }

  useEffect(() => { load(fy); }, [fy]); // eslint-disable-line react-hooks/exhaustive-deps

  const categoryLabels = useMemo(
    () => Object.fromEntries((data?.categories || []).map((c) => [c.key, c.label])),
    [data],
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

  function startEdit(e) {
    setEditingId(e._id);
    setForm({
      date: e.date, category: e.category, amount: String(e.amount), gstIncluded: e.gstIncluded !== false,
      supplier: e.supplier || '', reference: e.reference || '', notes: e.notes || '',
    });
    setFormError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm());
    setFormError('');
  }

  async function save(ev) {
    ev.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      const payload = { ...form, amount: Number(form.amount) };
      if (editingId) await client.put(`/driver/expenses/${editingId}`, payload);
      else await client.post('/driver/expenses', payload);
      // Keep the date and category for quick entry of several receipts
      // from the same day; clear the rest.
      setForm((f) => ({ ...emptyForm(), date: editingId ? nzToday() : f.date, category: editingId ? '' : f.category }));
      setEditingId(null);
      load();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Could not save the expense');
    } finally {
      setSaving(false);
    }
  }

  async function remove(e) {
    if (!window.confirm(`Delete this ${money(e.amount)} ${e.categoryLabel} expense?`)) return;
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

  const sortMark = (key) => (sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '');
  const s = data?.summary;

  return (
    <div className="container">
      <h1>Expenses</h1>
      <p className="muted" style={{ marginTop: -8 }}>
        Keep your vehicle and running costs here for your tax return. Tax years run 1 April - 31 March.
        Keep your receipts too - IRD asks for business records to be kept for 7 years.
      </p>

      <div className="card" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label>Financial year</label>
          <select value={data?.financialYear || ''} onChange={(e) => setFy(Number(e.target.value))} disabled={!data}>
            {(data?.years || []).map((y) => (
              <option key={y} value={y}>
                {fyLabel(y)} (1 Apr {y - 1} - 31 Mar {y}){y === data.currentFinancialYear ? ' - current' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Category</label>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All categories</option>
            {(data?.categories || []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        <button type="button" className="btn secondary" onClick={exportCsv} disabled={!rows.length}>Download CSV</button>
      </div>

      {loadError && <p className="error-text">{loadError}</p>}
      {!data && !loadError && <p className="muted">Loading...</p>}

      {s && (
        <div className="grid cols-4" style={{ marginBottom: 16 }}>
          <div className="card stat"><div className="value">{money(s.tripIncome)}</div><div className="label">Trip income ({s.tripCount} trips)</div></div>
          <div className="card stat"><div className="value">{money(s.totalExpenses)}</div><div className="label">Expenses ({s.count})</div></div>
          <div className="card stat"><div className="value">{money(s.gstClaimable)}</div><div className="label">GST included in expenses</div></div>
          <div className="card stat"><div className="value">{money(s.netIncome)}</div><div className="label">Income less expenses</div></div>
        </div>
      )}

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <form className="card" onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h3 style={{ margin: 0 }}>{editingId ? 'Edit expense' : 'Add an expense'}</h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 140px' }}><label>Date paid</label><input type="date" value={form.date} max={nzToday()} onChange={(e) => update('date', e.target.value)} required /></div>
            <div style={{ flex: '1 1 120px' }}><label>Amount (NZD)</label><input type="number" inputMode="decimal" min="0.01" step="0.01" value={form.amount} onChange={(e) => update('amount', e.target.value)} placeholder="0.00" required /></div>
          </div>
          <div>
            <label>Category</label>
            <select value={form.category} onChange={(e) => update('category', e.target.value)} required>
              <option value="" disabled>Choose a category...</option>
              {(data?.categories || []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 'normal' }}>
            <input type="checkbox" checked={form.gstIncluded} onChange={(e) => update('gstIncluded', e.target.checked)} style={{ width: 'auto' }} />
            Amount includes GST (untick for GST-free costs, e.g. RUC bought overseas, bank fees)
          </label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 160px' }}><label>Supplier (optional)</label><input value={form.supplier} maxLength={100} onChange={(e) => update('supplier', e.target.value)} placeholder="e.g. Tyre Pro, NZTA" /></div>
            <div style={{ flex: '1 1 120px' }}><label>Receipt / invoice no. (optional)</label><input value={form.reference} maxLength={60} onChange={(e) => update('reference', e.target.value)} /></div>
          </div>
          <div><label>Notes (optional)</label><input value={form.notes} maxLength={500} onChange={(e) => update('notes', e.target.value)} placeholder="e.g. 4 x front tyres, 1,000 km RUC" /></div>
          {formError && <p className="error-text" style={{ margin: 0 }}>{formError}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" type="submit" disabled={saving}>{saving ? 'Saving...' : editingId ? 'Save changes' : 'Add expense'}</button>
            {editingId && <button className="btn secondary" type="button" onClick={cancelEdit}>Cancel</button>}
          </div>
        </form>

        {s && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>By category - {fyLabel(data.financialYear)}</h3>
            {s.byCategory.length === 0 && <p className="muted">No expenses recorded for this tax year yet.</p>}
            {s.byCategory.length > 0 && (
              <table>
                <tbody>
                  {s.byCategory.map((c) => (
                    <tr key={c.key} style={{ cursor: 'pointer' }} onClick={() => setCategoryFilter(categoryFilter === c.key ? '' : c.key)} title="Show only this category">
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
        )}
      </div>

      {data && (
        <div className="card" style={{ marginTop: 16 }}>
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
    </div>
  );
}
