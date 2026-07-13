export const ORDER_STATUSES = ['Open', 'Back Order', 'Ready to Ship', 'Partially Shipped', 'Shipped', 'Cancelled']

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
  const shipped_qty = order?.shipped_qty != null && order?.shipped_qty !== ''
    ? Number(order.shipped_qty)
    : (order?.status === 'Shipped' ? qty : 0)
  let allocated_qty = order?.allocated_qty != null && order?.allocated_qty !== ''
    ? Number(order.allocated_qty)
    : qty
  let backorder_qty = order?.backorder_qty != null && order?.backorder_qty !== ''
    ? Number(order.backorder_qty)
    : Math.max(qty - allocated_qty, 0)

  if (order?.status === 'Cancelled') {
    allocated_qty = Number(order.allocated_qty || 0)
    backorder_qty = Number(order.backorder_qty || 0)
  }

  return { qty, allocated_qty, backorder_qty, shipped_qty }
}

export function unshippedAllocated(order) {
  const { allocated_qty, shipped_qty } = normalizeFulfillment(order)
  return Math.max(allocated_qty - shipped_qty, 0)
}

export function isCancelledOrShipped(order) {
  const status = order?.status || ''
  return status === 'Cancelled' || status === 'Shipped'
}

export function countsForBackorder(order) {
  const status = order?.status || ''
  if (status === 'Cancelled' || status === 'Shipped') {
    return { items: 0, units: 0, value: 0 }
  }
  const { backorder_qty } = normalizeFulfillment(order)
  const units = Math.max(backorder_qty, 0)
  if (units <= 0) return { items: 0, units: 0, value: 0 }
  const value = units * Number(order.price || 0)
  return { items: 1, units, value }
}

export function backOrderedQtyForProduct(orders, inventoryId) {
  return (orders || [])
    .filter(o => String(o.inventory_id) === String(inventoryId) && !isCancelledOrShipped(o))
    .reduce((sum, o) => sum + normalizeFulfillment(o).backorder_qty, 0)
}

export function activeBackorderOrders(orders, inventoryId) {
  return (orders || [])
    .filter(o => {
      if (String(o.inventory_id) !== String(inventoryId)) return false
      if (isCancelledOrShipped(o)) return false
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
    if (isCancelledOrShipped(o)) continue
    const { backorder_qty } = normalizeFulfillment(o)
    if (backorder_qty <= 0) continue
    productIds.add(String(o.inventory_id))
    units += backorder_qty
  }
  return { items: productIds.size, units }
}

export function activeBackorderAlerts(orders, limit = 10) {
  return (orders || [])
    .filter(o => !isCancelledOrShipped(o) && normalizeFulfillment(o).backorder_qty > 0)
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
    if (isCancelledOrShipped(o)) continue
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

export function validateShipStatus(status, backorder_qty) {
  if (status === 'Shipped' && backorder_qty > 0) {
    return `This order still has ${backorder_qty} units on Back Order.`
  }
  return ''
}

export function resolveShippedQty(status, allocated_qty, shipped_qty, backorder_qty) {
  if (status === 'Shipped') return allocated_qty
  if (status === 'Partially Shipped' && backorder_qty > 0) return Math.max(Number(shipped_qty) || 0, allocated_qty)
  return Number(shipped_qty) || 0
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
      newStatus: backorder_qty - alloc === 0 ? 'Ready to Ship' : 'Back Order',
    })
    remaining -= alloc
  }
  return { plan, stockUsed: Math.max(Number(stockIncrease) - remaining, 0) }
}
