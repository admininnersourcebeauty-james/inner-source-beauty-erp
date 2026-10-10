export const ORDER_STATUSES = ['Completed', 'Back Order', 'Partially Allocated', 'Cancelled']

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
  'Ready to Ship': 'Completed',
  'Partially Shipped': 'Partially Allocated',
  Shipped: 'Completed',
  Open: 'Completed',
  'Ready to Fulfill': 'Completed',
  'Partially Fulfilled': 'Partially Allocated',
}

export function normalizeOrderStatus(status) {
  if (!status) return 'Completed'
  return STATUS_MIGRATION[status] || status
}

export function deriveAllocationStatus(allocated_qty, backorder_qty) {
  const allocated = Math.max(Number(allocated_qty) || 0, 0)
  const backorder = Math.max(Number(backorder_qty) || 0, 0)
  if (backorder <= 0) return 'Completed'
  if (allocated > 0) return 'Partially Allocated'
  return 'Back Order'
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
  return deriveAllocationStatus(allocated_qty, backorder_qty)
}

import { aggregateFulfillmentFromItems, itemsForOrder } from './orderItems.js'

export function normalizeFulfillment(order, orderItems) {
  const lineRows = orderItems ? itemsForOrder(order, orderItems) : []
  if (lineRows.length > 1 || (lineRows.length === 1 && String(lineRows[0].id || '').startsWith('legacy-') === false && orderItems?.length)) {
    const agg = aggregateFulfillmentFromItems(lineRows)
    if (String(order?.status || '').trim().toLowerCase() === 'void') {
      return { qty: agg.qty, allocated_qty: 0, backorder_qty: 0 }
    }
    return agg
  }

  const qty = Number(order?.qty || 0)
  if (String(order?.status || '').trim().toLowerCase() === 'void') {
    return { qty, allocated_qty: 0, backorder_qty: 0 }
  }
  let allocated_qty = order?.allocated_qty != null && order?.allocated_qty !== ''
    ? Number(order.allocated_qty)
    : qty
  let backorder_qty = order?.backorder_qty != null && order?.backorder_qty !== ''
    ? Number(order.backorder_qty)
    : Math.max(qty - allocated_qty, 0)

  if (normalizeOrderStatus(order?.status) === 'Cancelled') {
    allocated_qty = Number(order.allocated_qty || 0)
    backorder_qty = Number(order.backorder_qty || 0)
  }

  return { qty, allocated_qty, backorder_qty }
}

export function unshippedAllocated(order, orderItems) {
  const { allocated_qty } = normalizeFulfillment(order, orderItems)
  return Math.max(Number(allocated_qty) || 0, 0)
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

export function partiallyAllocatedOrders(orders, orderItems = []) {
  return (orders || []).filter(o => {
    if (String(o?.status || '').trim().toLowerCase() === 'void') return false
    if (normalizeOrderStatus(o.status) === 'Cancelled') return false
    if (normalizeOrderStatus(o.status) === 'Partially Allocated') return true
    const { backorder_qty, allocated_qty } = normalizeFulfillment(o, orderItems)
    return backorder_qty > 0 && allocated_qty > 0
  })
}

export function partiallyAllocatedAlerts(orders, orderItems = [], limit = 10) {
  return partiallyAllocatedOrders(orders, orderItems).slice(0, limit)
}

export function awaitingPickupCount(orders, orderItems = []) {
  return partiallyAllocatedOrders(orders, orderItems).filter(o => isCustomerPickup(o.shipping_method)).length
}

export function companyDeliveryCount(orders, orderItems = []) {
  return partiallyAllocatedOrders(orders, orderItems).filter(o => isCompanyDelivery(o.shipping_method)).length
}

export function backOrderedQtyForProduct(orders, inventoryId, orderItems = []) {
  let sum = 0
  for (const o of orders || []) {
    if (isCancelledOrCompleted(o)) continue
    const lines = itemsForOrder(o, orderItems).filter(l => String(l.inventory_id) === String(inventoryId))
    if (lines.length) {
      sum += lines.reduce((s, l) => s + Number(l.backorder_qty || 0), 0)
    } else if (String(o.inventory_id) === String(inventoryId)) {
      sum += normalizeFulfillment(o).backorder_qty
    }
  }
  return sum
}

export function activeBackorderOrders(orders, inventoryId, orderItems = []) {
  const seen = new Set()
  const matched = []
  for (const o of orders || []) {
    if (isCancelledOrCompleted(o)) continue
    const lines = itemsForOrder(o, orderItems).filter(l => String(l.inventory_id) === String(inventoryId))
    const backorder = lines.length
      ? lines.some(l => Number(l.backorder_qty || 0) > 0)
      : String(o.inventory_id) === String(inventoryId) && normalizeFulfillment(o).backorder_qty > 0
    if (!backorder) continue
    if (seen.has(String(o.id))) continue
    seen.add(String(o.id))
    matched.push(o)
  }
  return matched.sort((a, b) => {
    const da = String(a.order_date || a.created_at || '')
    const db = String(b.order_date || b.created_at || '')
    if (da !== db) return da.localeCompare(db)
    return String(a.created_at || '').localeCompare(String(b.created_at || ''))
  })
}

export function backOrderDashboardStats(orders, orderItems = []) {
  const productIds = new Set()
  let units = 0
  for (const o of orders || []) {
    if (isCancelledOrCompleted(o)) continue
    for (const line of itemsForOrder(o, orderItems)) {
      const backorder_qty = Number(line.backorder_qty || 0)
      if (backorder_qty <= 0) continue
      productIds.add(String(line.inventory_id))
      units += backorder_qty
    }
    if (!itemsForOrder(o, orderItems).length) {
      const { backorder_qty } = normalizeFulfillment(o)
      if (backorder_qty <= 0) continue
      productIds.add(String(o.inventory_id))
      units += backorder_qty
    }
  }
  return { items: productIds.size, units }
}

export function activeBackorderAlerts(orders, orderItems = [], limit = 10) {
  return (orders || [])
    .filter(o => {
      if (isCancelledOrCompleted(o)) return false
      const lines = itemsForOrder(o, orderItems)
      if (lines.length) return lines.some(l => Number(l.backorder_qty || 0) > 0)
      return normalizeFulfillment(o).backorder_qty > 0
    })
    .sort((a, b) => {
      const da = String(a.order_date || a.created_at || '')
      const db = String(b.order_date || b.created_at || '')
      if (da !== db) return da.localeCompare(db)
      return String(a.created_at || '').localeCompare(String(b.created_at || ''))
    })
    .slice(0, limit)
}

export function backOrderReports(orders, orderItems = []) {
  const byCustomer = {}
  const byProduct = {}
  let totalUnits = 0
  let totalValue = 0
  const countedOrders = new Set()

  for (const o of orders || []) {
    if (isCancelledOrCompleted(o)) continue
    const lines = itemsForOrder(o, orderItems)
    if (lines.length) {
      let orderHasBackorder = false
      for (const line of lines) {
        const backorder_qty = Number(line.backorder_qty || 0)
        if (backorder_qty <= 0) continue
        orderHasBackorder = true
        const value = backorder_qty * Number(line.price || 0)
        totalUnits += backorder_qty
        totalValue += value
        const pk = line.style || 'Unknown'
        if (!byProduct[pk]) byProduct[pk] = { product: pk, units: 0, value: 0, orders: 0 }
        byProduct[pk].units += backorder_qty
        byProduct[pk].value += value
        byProduct[pk].orders += 1
      }
      if (orderHasBackorder) {
        const ck = o.customer_name || 'Unknown'
        if (!byCustomer[ck]) byCustomer[ck] = { customer: ck, units: 0, value: 0, orders: 0 }
        byCustomer[ck].units += lines.reduce((s, l) => s + Number(l.backorder_qty || 0), 0)
        byCustomer[ck].value += lines.reduce((s, l) => s + Number(l.backorder_qty || 0) * Number(l.price || 0), 0)
        byCustomer[ck].orders += 1
      }
      continue
    }

    const { backorder_qty } = normalizeFulfillment(o)
    if (backorder_qty <= 0) continue
    if (countedOrders.has(String(o.id))) continue
    countedOrders.add(String(o.id))
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
  return ''
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
      newStatus: deriveAllocationStatus(allocated_qty + alloc, backorder_qty - alloc),
    })
    remaining -= alloc
  }
  return { plan, stockUsed: Math.max(Number(stockIncrease) - remaining, 0) }
}

import { formatDisplayDate } from './dateFormat.js'

export function formatFulfillmentDate(order) {
  return formatDisplayDate(order?.fulfillment_date)
}
