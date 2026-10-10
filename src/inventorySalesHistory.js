import { normalizeOrderStatus } from './backorder.js'
import { orderDateKey } from './dashboardMetrics.js'
import { isVoidOrder } from './invoiceVoid.js'
import { itemsForOrder } from './orderItems.js'

function isExcludedFromSalesHistory(order) {
  if (isVoidOrder(order)) return true
  if (normalizeOrderStatus(order?.status) === 'Cancelled') return true
  return false
}

function lineTotalForHistory(line) {
  if (line?.line_total != null && line.line_total !== '') {
    return Math.max(Number(line.line_total) || 0, 0)
  }
  const qty = Math.max(Number(line.qty) || 0, 0)
  const price = Math.max(Number(line.price) || 0, 0)
  const discount = Math.max(Number(line.discount) || 0, 0)
  return Math.max(qty * price - discount, 0)
}

/**
 * Sales lines for one inventory item from existing orders + order_items (inventory_id match).
 */
export function buildInventorySalesHistory(inventoryId, orders = [], orderItems = []) {
  const rows = []

  for (const order of orders || []) {
    if (isExcludedFromSalesHistory(order)) continue
    for (const line of itemsForOrder(order, orderItems)) {
      if (String(line.inventory_id) !== String(inventoryId)) continue
      const qtySold = Math.max(Number(line.qty) || 0, 0)
      if (qtySold <= 0) continue

      rows.push({
        orderId: order.id,
        orderDate: order.order_date || order.created_at || '',
        orderDateKey: orderDateKey(order),
        invoiceNo: order.invoice_no || '—',
        customerName: order.customer_name || '—',
        salesPerson: String(order.sales_person_name || '').trim() || '—',
        qtySold,
        unitPrice: Math.max(Number(line.price) || 0, 0),
        lineTotal: lineTotalForHistory(line),
        status: normalizeOrderStatus(order.status),
        backorderQty: Math.max(Number(line.backorder_qty) || 0, 0),
        orderItemId: line.id,
      })
    }
  }

  rows.sort((a, b) => {
    const byDate = String(b.orderDateKey).localeCompare(String(a.orderDateKey))
    if (byDate !== 0) return byDate
    return String(b.orderId).localeCompare(String(a.orderId))
  })

  const totalQtySold = rows.reduce((sum, row) => sum + row.qtySold, 0)
  return { rows, totalQtySold }
}
