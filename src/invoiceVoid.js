import { normalizeFulfillment, normalizeOrderStatus } from './backorder.js'

export const VOID_REASONS = [
  'Customer Cancelled',
  'Duplicate Invoice',
  'Pricing Error',
  'Order Entry Error',
  'Payment Issue',
  'Other',
]

export const VOID_CONFIRM_TEXT = 'VOID'

export function isVoidOrder(order) {
  return String(order?.status || '').trim().toLowerCase() === 'void'
}

export function voidRestoreQty(order) {
  const { allocated_qty, fulfilled_qty } = normalizeFulfillment(order)
  return Math.max(Number(allocated_qty) - Number(fulfilled_qty), 0)
}

export function voidPaymentStatusDisplay(paidAmount) {
  return Number(paidAmount) > 0 ? 'VOID — Payment Recorded' : 'VOID'
}

export function orderPayments(payments, order) {
  return (payments || []).filter(p =>
    String(p.order_id) === String(order?.id) || p.invoice_no === order?.invoice_no,
  )
}

export function orderPaidTotal(payments, order) {
  return orderPayments(payments, order).reduce((s, p) => s + Number(p.amount || 0), 0)
}

export function paymentCountsTowardBalance(payments, orders, payment) {
  const order = (orders || []).find(o =>
    String(o.id) === String(payment.order_id) || o.invoice_no === payment.invoice_no,
  )
  return order && !isVoidOrder(order)
}

export function calcOutstandingBalance(orders, payments) {
  const activeOrders = (orders || []).filter(o => !isVoidOrder(o))
  const sales = activeOrders.reduce((s, o) => s + Number(o.total || 0), 0)
  const paid = (payments || [])
    .filter(p => paymentCountsTowardBalance(orders, payments, p))
    .reduce((s, p) => s + Number(p.amount || 0), 0)
  return sales - paid
}

export function ordersForSalesMetrics(orders) {
  return (orders || []).filter(o => !isVoidOrder(o))
}

export function statusMatchesFilterWithVoid(order, filter) {
  if (filter === 'All') return true
  if (filter === 'Void') return isVoidOrder(order)
  if (isVoidOrder(order)) return false
  return normalizeOrderStatus(order?.status) === filter
}

export function buildVoidPayload(order, payments, { reason, note, voidedBy }) {
  const paid = orderPaidTotal(payments, order)
  const { fulfilled_qty } = normalizeFulfillment(order)
  return {
    status: 'Void',
    void_reason: reason,
    void_note: note || '',
    voided_at: new Date().toISOString(),
    voided_by: voidedBy || '',
    allocated_qty: 0,
    backorder_qty: 0,
    shipped_qty: fulfilled_qty,
    payment_status: voidPaymentStatusDisplay(paid),
  }
}

export function formatVoidDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10)
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export const ORDER_FILTER_STATUSES = [
  'Open', 'Back Order', 'Ready to Fulfill', 'Partially Fulfilled', 'Completed', 'Cancelled', 'Void',
]
