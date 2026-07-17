export const ORDER_STATUSES = ['Open', 'Back Order', 'Ready to Fulfill', 'Partially Fulfilled', 'Completed', 'Cancelled']

export const FULFILLMENT_METHODS = [
  'UPS Next Day',
  'UPS 2nd Day',
  'UPS 3 Day',
  'UPS Ground',
  'USPS Ground',
  'USPS Priority',
  'Company Delivery',
  'Customer Pickup',
]

export const STATUS_MIGRATION = {
  'Ready to Ship': 'Ready to Fulfill',
  'Partially Shipped': 'Partially Fulfilled',
  Shipped: 'Completed',
}

export function normalizeOrderStatus(status) {
  if (!status) return 'Open'
  return STATUS_MIGRATION[status] || status
}

export function isCarrierMethod(method) {
  const m = String(method || '')
  return m.startsWith('UPS ') || m.startsWith('USPS ')
}

export function isCompanyDelivery(method) {
  return method === 'Company Delivery'
}

export function isCustomerPickup(method) {
  return method === 'Customer Pickup'
}

export function isValidDbDate(value) {
  if (value == null || String(value).trim() === '') return false
  const s = String(value).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

export function inventoryStockView(item) {
  const raw = Number(item?.qty ?? 0)
  return { raw, display: Math.max(raw, 0), isNegative: raw < 0 }
}

export function calcAllocation(orderQty, physicalStock) {
  const qty = Math.max(Number(orderQty) || 0, 0)
  const available_stock = Math.max(Number(physicalStock) || 0, 0)
  const allocated_qty = Math.min(qty, available_stock)
  const backorder_qty = Math.max(qty - available_stock, 0)
  return { available_stock, allocated_qty, backorder_qty }
}

export function deriveCreateStatus(allocated_qty, backorder_qty) {
  if (backorder_qty > 0) return 'Back Order'
  return 'Open'
}

export function normalizeFulfillment(order) {
  const qty = Number(order?.qty || 0)
  if (String(order?.status || '').trim().toLowerCase() === 'void') {
    const shipped_qty = Number(order?.shipped_qty || 0)
    return { qty, allocated_qty: 0, backorder_qty: 0, shipped_qty, fulfilled_qty: shipped_qty }
  }
  const status = normalizeOrderStatus(order?.status)
  const shipped_qty = order?.shipped_qty != null && order?.shipped_qty !== ''
    ? Number(order.shipped_qty)
    : (status === 'Completed' ? qty : 0)
  let allocated_qty = order?.allocated_qty != null && order?.allocated_qty !== ''
    ? Number(order.allocated_qty)
    : qty
  let backorder_qty = order?.backorder_qty != null && order?.backorder_qty !== ''
    ? Number(order.backorder_qty)
    : Math.max(qty - allocated_qty, 0)

  if (status === 'Cancelled') {
    allocated_qty = Number(order.allocated_qty || 0)
    backorder_qty = Number(order.backorder_qty || 0)
  }

  return { qty, allocated_qty, backorder_qty, shipped_qty, fulfilled_qty: shipped_qty }
}

export function unshippedAllocated(order) {
  const { allocated_qty, shipped_qty } = normalizeFulfillment(order)
  return Math.max(allocated_qty - shipped_qty, 0)
}

export function isCancelledOrCompleted(order) {
  if (String(order?.status || '').trim().toLowerCase() === 'void') return true
  const status = normalizeOrderStatus(order?.status)
  return status === 'Cancelled' || status === 'Completed'
}

export function statusMatchesFilter(order, filter) {
  if (filter === 'All') return true
  return normalizeOrderStatus(order?.status) === filter
}

export function countOrdersByStatus(orders, status) {
  return (orders || []).filter(o => normalizeOrderStatus(o.status) === status).length
}

export function fulfillmentHandledBy(order) {
  const method = order?.shipping_method || ''
  if (isCarrierMethod(method)) return order?.tracking || '—'
  if (isCompanyDelivery(method)) return order?.delivered_by || '—'
  if (isCustomerPickup(method)) return order?.picked_up_by || '—'
  return order?.tracking || order?.delivered_by || order?.picked_up_by || '—'
}

export function readyToFulfillOrders(orders) {
  return (orders || []).filter(o => normalizeOrderStatus(o.status) === 'Ready to Fulfill')
}

export function awaitingPickupCount(orders) {
  return readyToFulfillOrders(orders).filter(o => isCustomerPickup(o.shipping_method)).length
}

export function companyDeliveryCount(orders) {
  return readyToFulfillOrders(orders).filter(o => isCompanyDelivery(o.shipping_method)).length
}

export function readyToFulfillAlerts(orders, limit = 10) {
  return readyToFulfillOrders(orders).slice(0, limit)
}

export function backOrderedQtyForProduct(orders, inventoryId) {
  return (orders || [])
    .filter(o => String(o.inventory_id) === String(inventoryId) && !isCancelledOrCompleted(o))
    .reduce((sum, o) => sum + normalizeFulfillment(o).backorder_qty, 0)
}

export function activeBackorderOrders(orders, inventoryId) {
  return (orders || [])
    .filter(o => {
      if (String(o.inventory_id) !== String(inventoryId)) return false
      if (isCancelledOrCompleted(o)) return false
      return normalizeFulfillment(o).backorder_qty > 0
    })
    .sort((a, b) => {
      const da = String(a.order_date || a.created_at || '')
      const db = String(b.order_date || b.created_at || '')
      if (da !== db) return da.localeCompare(db)
      return String(a.created_at || '').localeCompare(String(b.created_at || ''))
    })
}

export function backOrderDashboardStats(orders) {
  const productIds = new Set()
  let units = 0
  for (const o of orders || []) {
    if (isCancelledOrCompleted(o)) continue
    const { backorder_qty } = normalizeFulfillment(o)
    if (backorder_qty <= 0) continue
    productIds.add(String(o.inventory_id))
    units += backorder_qty
  }
  return { items: productIds.size, units }
}

export function activeBackorderAlerts(orders, limit = 10) {
  return (orders || [])
    .filter(o => !isCancelledOrCompleted(o) && normalizeFulfillment(o).backorder_qty > 0)
    .sort((a, b) => {
      const da = String(a.order_date || a.created_at || '')
      const db = String(b.order_date || b.created_at || '')
      if (da !== db) return da.localeCompare(db)
      return String(a.created_at || '').localeCompare(String(b.created_at || ''))
    })
    .slice(0, limit)
}

export function backOrderReports(orders) {
  const byCustomer = {}
  const byProduct = {}
  let totalUnits = 0
  let totalValue = 0

  for (const o of orders || []) {
    if (isCancelledOrCompleted(o)) continue
    const { backorder_qty } = normalizeFulfillment(o)
    if (backorder_qty <= 0) continue
    const value = backorder_qty * Number(o.price || 0)
    totalUnits += backorder_qty
    totalValue += value

    const ck = o.customer_name || 'Unknown'
    if (!byCustomer[ck]) byCustomer[ck] = { customer: ck, units: 0, value: 0, orders: 0 }
    byCustomer[ck].units += backorder_qty
    byCustomer[ck].value += value
    byCustomer[ck].orders += 1

    const pk = o.style || 'Unknown'
    if (!byProduct[pk]) byProduct[pk] = { product: pk, units: 0, value: 0, orders: 0 }
    byProduct[pk].units += backorder_qty
    byProduct[pk].value += value
    byProduct[pk].orders += 1
  }

  return {
    totalUnits,
    totalValue,
    byCustomer: Object.values(byCustomer).sort((a, b) => b.units - a.units),
    byProduct: Object.values(byProduct).sort((a, b) => b.units - a.units),
  }
}

export function validateFulfillmentStatus(status, backorder_qty) {
  const normalized = normalizeOrderStatus(status)
  if (normalized === 'Completed' && backorder_qty > 0) {
    return `This order still has ${backorder_qty} units on Back Order.`
  }
  return ''
}

export function resolveFulfilledQty(status, allocated_qty, fulfilled_qty, backorder_qty) {
  const normalized = normalizeOrderStatus(status)
  if (normalized === 'Completed') return allocated_qty
  if (normalized === 'Partially Fulfilled' && backorder_qty > 0) {
    return Math.max(Number(fulfilled_qty) || 0, allocated_qty)
  }
  return Number(fulfilled_qty) || 0
}

export function validateCompleteFulfillment(order, form) {
  const method = form.shipping_method || order?.shipping_method || ''
  const { allocated_qty, backorder_qty } = normalizeFulfillment(order)

  if (backorder_qty > 0) {
    return { error: `This order still has ${backorder_qty} units on Back Order.` }
  }
  if (allocated_qty <= 0) {
    return { error: 'No allocated quantity to fulfill.' }
  }
  if (!method) {
    return { error: 'Select a Fulfillment Method before completing.' }
  }

  if (isCarrierMethod(method)) {
    if (!String(form.tracking || '').trim()) return { error: 'Tracking Number is required for carrier fulfillment.' }
    if (!isValidDbDate(form.fulfillment_date)) return { error: 'Fulfillment Date is required for carrier fulfillment.' }
  } else if (isCompanyDelivery(method)) {
    if (!isValidDbDate(form.fulfillment_date)) return { error: 'Delivery Date is required.' }
    if (!String(form.delivered_by || '').trim()) return { error: 'Delivered By is required.' }
  } else if (isCustomerPickup(method)) {
    if (!isValidDbDate(form.fulfillment_date)) return { error: 'Pickup Date is required.' }
    if (!String(form.picked_up_by || '').trim()) return { error: 'Picked Up By is required.' }
  }

  return { error: '' }
}

export function buildAllocationPlan(orders, stockIncrease) {
  let remaining = Math.max(Number(stockIncrease) || 0, 0)
  const plan = []
  for (const order of orders) {
    if (remaining <= 0) break
    const { backorder_qty, allocated_qty } = normalizeFulfillment(order)
    const alloc = Math.min(backorder_qty, remaining)
    if (alloc <= 0) continue
    plan.push({
      order,
      orderId: order.id,
      invoice_no: order.invoice_no,
      customer_name: order.customer_name,
      previouslyBackOrdered: backorder_qty,
      allocatedNow: alloc,
      remainingBackOrder: backorder_qty - alloc,
      newAllocated: allocated_qty + alloc,
      newStatus: backorder_qty - alloc === 0 ? 'Ready to Fulfill' : 'Back Order',
    })
    remaining -= alloc
  }
  return { plan, stockUsed: Math.max(Number(stockIncrease) - remaining, 0) }
}

export function formatFulfillmentDate(order) {
  const d = order?.fulfillment_date
  if (!d) return '—'
  return String(d).slice(0, 10)
}
