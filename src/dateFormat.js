/** Customer-facing US short date: M/D/YY (e.g. 8/4/26). Storage stays ISO. */
const DISPLAY_DATE_FIELDS = new Set([
  'payment_date',
  'order_date',
  'due_date',
  'fulfillment_date',
  'eta',
  'created_at',
  'received_date',
  'invoice_date',
  'due_date_display',
  'date',
])

export function isDisplayDateField(field) {
  return DISPLAY_DATE_FIELDS.has(field)
}

function fromIsoParts(y, m, d) {
  const year = Number(y)
  const month = Number(m)
  const day = Number(d)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '—'
  if (month < 1 || month > 12 || day < 1 || day > 31) return '—'
  return `${month}/${day}/${String(year).slice(-2)}`
}

export function formatDisplayDate(value) {
  if (value == null || value === '') return '—'

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '—'
    return `${value.getMonth() + 1}/${value.getDate()}/${String(value.getFullYear()).slice(-2)}`
  }

  const s = String(value).trim()
  if (!s) return '—'

  const isoDate = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoDate) return fromIsoParts(isoDate[1], isoDate[2], isoDate[3])

  const isoPrefix = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/)
  if (isoPrefix) return fromIsoParts(isoPrefix[1], isoPrefix[2], isoPrefix[3])

  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return '—'
  return `${dt.getMonth() + 1}/${dt.getDate()}/${String(dt.getFullYear()).slice(-2)}`
}

export function formatPrintDate(value = new Date()) {
  return formatDisplayDate(value)
}
