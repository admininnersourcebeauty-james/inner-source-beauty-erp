import React, { useState } from 'react'
import {
  EXPENSE_CATEGORIES,
  expenseDateKey,
  expenseFormPayload,
  validateExpenseForm,
} from './expenses.js'
import { formatDisplayDate } from './dateFormat.js'

const blankExpense = () => ({
  expense_date: new Date().toISOString().slice(0, 10),
  category: 'Other',
  description: '',
  amount: '',
  note: '',
})

export function ExpensesPage({ data, addRow, updateRow, deleteRow }) {
  const [f, setF] = useState(blankExpense())
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState('')
  const rows = [...(data.expenses || [])].sort((a, b) => expenseDateKey(b).localeCompare(expenseDateKey(a)))

  function loadExpense(row) {
    setEditingId(row.id)
    setError('')
    setF({
      expense_date: expenseDateKey(row),
      category: row.category || 'Other',
      description: row.description || '',
      amount: row.amount ?? '',
      note: row.note || '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setError('')
    setF(blankExpense())
  }

  async function save() {
    const validation = validateExpenseForm(f)
    if (validation) {
      setError(validation)
      return
    }
    setError('')
    const payload = expenseFormPayload(f)
    if (editingId) await updateRow('expenses', editingId, payload)
    else await addRow('expenses', payload)
    cancelEdit()
  }

  return (
    <div className="panel expenses-page">
      <h2>{editingId ? 'Edit Expense' : 'Add Expense'}</h2>
      <p className="hint">
        Record operating expenses only. Do not enter inventory or product purchases here — those belong in Purchase Orders and become COGS only when units sell.
        Do not enter inbound international shipping here if that cost is already included in inventory landed cost (buying price + shipping cost).
      </p>
      <div className="form-grid expenses-form-grid">
        <label>
          Date
          <input type="date" value={f.expense_date} onChange={e => setF({ ...f, expense_date: e.target.value })} />
        </label>
        <label>
          Category
          <select value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>
            {EXPENSE_CATEGORIES.map(category => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </label>
        <label>
          Description
          <input value={f.description} onChange={e => setF({ ...f, description: e.target.value })} placeholder="Expense description" />
        </label>
        <label>
          Amount
          <input type="number" min="0" step="0.01" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} />
        </label>
        <label className="expenses-note-field">
          Note
          <input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder="Optional note" />
        </label>
      </div>
      {error && <p className="field-error">{error}</p>}
      <div className="expenses-actions">
        <button type="button" onClick={save}>{editingId ? 'Update Expense' : 'Add Expense'}</button>
        {editingId && <button type="button" className="soft" onClick={cancelEdit}>Cancel</button>}
      </div>

      <h2>Expenses</h2>
      <div className="expenses-cards">
        {rows.map(row => (
          <article key={row.id} className={`expense-card${String(editingId) === String(row.id) ? ' sel' : ''}`}>
            <p className="expense-card-title">{row.description || '—'}</p>
            <dl className="expense-card-meta">
              <div><dt>Date</dt><dd>{formatDisplayDate(expenseDateKey(row))}</dd></div>
              <div><dt>Category</dt><dd>{row.category || '—'}</dd></div>
              <div><dt>Amount</dt><dd>${(Number(row.amount) || 0).toFixed(2)}</dd></div>
              <div><dt>Note</dt><dd>{row.note || '—'}</dd></div>
            </dl>
            <div className="expense-card-actions">
              <button type="button" className="soft" onClick={() => loadExpense(row)}>Edit</button>
              <button type="button" className="danger" onClick={() => deleteRow('expenses', row.id)}>Delete</button>
            </div>
          </article>
        ))}
        {rows.length === 0 && <p className="hint">No expenses recorded yet.</p>}
      </div>
      <div className="table-wrap expenses-table">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Category</th>
              <th>Description</th>
              <th>Amount</th>
              <th>Notes</th>
              <th>Edit</th>
              <th>Delete</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id} className={String(editingId) === String(row.id) ? 'sel' : ''}>
                <td>{formatDisplayDate(expenseDateKey(row))}</td>
                <td>{row.category || '—'}</td>
                <td>{row.description || '—'}</td>
                <td>${(Number(row.amount) || 0).toFixed(2)}</td>
                <td>{row.note || '—'}</td>
                <td className="row-actions"><button type="button" className="soft" onClick={() => loadExpense(row)}>Edit</button></td>
                <td className="row-actions"><button type="button" className="danger" onClick={() => deleteRow('expenses', row.id)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
