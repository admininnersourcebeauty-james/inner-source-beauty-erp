export const EXPENSE_CATEGORIES = [
  'International Shipping',
  'Domestic Shipping',
  'Supplies',
  'Office Expense',
  'Other',
]

/** Legacy categories kept for validating/displaying older expense records. */
export const LEGACY_EXPENSE_CATEGORIES = [
  'Shipping',
  'Office',
  'Advertising',
  'Software',
  'Bank Fee',
  'Professional Fee',
]

export function isValidExpenseCategory(category) {
  return EXPENSE_CATEGORIES.includes(category) || LEGACY_EXPENSE_CATEGORIES.includes(category)
}

export function expenseDateKey(expense) {
  const raw = expense?.expense_date || expense?.created_at || ''
  const s = String(raw).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const dt = new Date(raw)
  if (Number.isNaN(dt.getTime())) return s.slice(0, 10)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

export function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function isExpenseInMonth(expense, monthKey = currentMonthKey()) {
  const key = expenseDateKey(expense)
  return key.slice(0, 7) === monthKey
}

export function expensesForMonth(expenses = [], monthKey = currentMonthKey()) {
  return (expenses || [])
    .filter(expense => isExpenseInMonth(expense, monthKey))
    .sort((a, b) => expenseDateKey(b).localeCompare(expenseDateKey(a)))
}

export function calcOperatingExpensesForMonth(expenses = [], monthKey = currentMonthKey()) {
  return expensesForMonth(expenses, monthKey)
    .reduce((sum, expense) => sum + Math.max(Number(expense.amount) || 0, 0), 0)
}

export function validateExpenseForm(form) {
  const amount = Number(form.amount)
  if (!form.expense_date) return 'Expense date is required.'
  if (!String(form.description || '').trim()) return 'Description is required.'
  if (!Number.isFinite(amount) || amount < 0) return 'Amount must be zero or greater.'
  if (!EXPENSE_CATEGORIES.includes(form.category) && !LEGACY_EXPENSE_CATEGORIES.includes(form.category)) {
    return 'Select a valid category.'
  }
  return ''
}

export function expenseFormPayload(form) {
  return {
    expense_date: form.expense_date,
    category: form.category,
    description: String(form.description || '').trim(),
    amount: Math.max(Number(form.amount) || 0, 0),
    note: String(form.note || '').trim(),
    updated_at: new Date().toISOString(),
  }
}
