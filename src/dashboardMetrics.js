import { normalizeOrderStatus } from './backorder.js'
import { isVoidOrder } from './invoiceVoid.js'
import { stockOnHandDisplay } from './inventoryReorder.js'
import {
  calcOperatingExpensesForMonth,
  currentMonthKey,
  expensesForMonth,
} from './expenses.js'
import {
  itemBuying,
  itemShipping,
  itemSelling,
  itemsForOrder,
} from './orderItems.js'

/** YYYY-MM for month offset from a month key (negative = earlier). */
export function shiftMonthKey(monthKey, deltaMonths = -1) {
  const [y, m] = monthKey.split('-').map(Number)
  const d = new Date(y, (m || 1) - 1 + deltaMonths, 1)
  return currentMonthKey(d)
}

export function formatMonthKeyLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number)
  if (!y || !m) return monthKey
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function soldLineBuyingAndShipping(line, inventory = []) {
  const hasLineBuying = line?.buying_price != null && line.buying_price !== ''
  const hasLineShipping = line?.shipping_cost != null && line.shipping_cost !== ''
  if (hasLineBuying || hasLineShipping) {
    return {
      buying: Math.max(Number(line.buying_price) || 0, 0),
      shipping: Math.max(Number(line.shipping_cost) || 0, 0),
    }
  }
  const inv = inventory.find(item => String(item.id) === String(line.inventory_id))
  if (inv) {
    return { buying: itemBuying(inv), shipping: itemShipping(inv) }
  }
  return {
    buying: Math.max(Number(line.buying_price) || 0, 0),
    shipping: Math.max(Number(line.shipping_cost) || 0, 0),
  }
}

/**
 * Weighted average commission per unit from received PO lines for an inventory item.
 * Commission is capitalized into inventory.buying_price at receive — not stored on order_items.
 */
export function lookupInventoryCommissionPerUnit(inventoryId, poItems = []) {
  const lines = (poItems || []).filter(item => {
    if (String(item.inventory_id) !== String(inventoryId)) return false
    return Math.max(Number(item.received_qty) || 0, 0) > 0
  })
  if (!lines.length) return { perUnit: 0, known: false }

  let totalReceived = 0
  let totalCommission = 0
  for (const line of lines) {
    const receivedQty = Math.max(Number(line.received_qty) || 0, 0)
    const commissionPerUnit = Math.max(
      Number(line.commission_per_unit_usd ?? line.commission_per_unit) || 0,
      0,
    )
    totalReceived += receivedQty
    totalCommission += receivedQty * commissionPerUnit
  }
  if (totalReceived <= 0) return { perUnit: 0, known: false }
  return { perUnit: totalCommission / totalReceived, known: true }
}

/** COGS split for sold/allocated units — uses order-line cost snapshots when present. */
export function calcSoldLineCogsBreakdown(line, inventory = [], poItems = []) {
  const soldQty = soldQtyForLine(line)
  if (soldQty <= 0) {
    return {
      productCogs: 0,
      shippingCogs: 0,
      commissionCogs: 0,
      commissionKnown: true,
      soldQty: 0,
    }
  }

  const { buying, shipping } = soldLineBuyingAndShipping(line, inventory)
  const { perUnit: commissionPerUnit, known: commissionKnown } = lookupInventoryCommissionPerUnit(
    line.inventory_id,
    poItems,
  )

  const shippingCogs = soldQty * shipping
  let commissionCogs = 0
  let productCogs = soldQty * buying

  if (commissionKnown && commissionPerUnit > 0) {
    commissionCogs = soldQty * commissionPerUnit
    productCogs = soldQty * Math.max(buying - commissionPerUnit, 0)
  }

  return {
    productCogs,
    shippingCogs,
    commissionCogs,
    commissionKnown,
    soldQty,
  }
}

/**
 * Monthly profit from sold units only — sales = invoice total; COGS from order-line unit costs.
 * Does NOT treat PO payments as expense. Inventory Value Remaining is current on-hand cost.
 */
export function calcMonthlyProfitSummary(
  allOrders = [],
  orderItems = [],
  inventory = [],
  poItems = [],
  monthKey = currentMonthKey(),
) {
  const orders = ordersForDashboardSales(filterOrdersForMonth(allOrders, monthKey))
  const salesRevenue = calcMonthSales(orders)

  let productCogs = 0
  let shippingCogs = 0
  let commissionCogs = 0
  let commissionIncludedInProductCost = false

  for (const order of orders) {
    for (const line of itemsForOrder(order, orderItems)) {
      const breakdown = calcSoldLineCogsBreakdown(line, inventory, poItems)
      productCogs += breakdown.productCogs
      shippingCogs += breakdown.shippingCogs
      commissionCogs += breakdown.commissionCogs
      if (!breakdown.commissionKnown) commissionIncludedInProductCost = true
    }
  }

  const totalCogs = productCogs + shippingCogs + commissionCogs
  const grossProfit = salesRevenue - totalCogs
  const grossMargin = salesRevenue > 0 ? (grossProfit / salesRevenue) * 100 : 0

  return {
    monthKey,
    salesRevenue,
    productCogs,
    shippingCogs,
    commissionCogs,
    totalCogs,
    grossProfit,
    grossMargin,
    inventoryValueRemaining: calcDashboardInventoryValue(inventory),
    commissionIncludedInProductCost,
    orderCount: orders.length,
  }
}

function legacyOrderProfit(order) {
  if (order?.profit != null && order.profit !== '') return Number(order.profit) || 0
  const qty = Number(order?.qty) || 0
  const price = Number(order?.price) || 0
  const total = Number(order?.total) || (qty * price + Number(order?.shipping || 0) - Number(order?.discount || 0))
  const unitCost = Number(order.buying_price || 0) + Number(order.shipping_cost ?? 0)
  return total - qty * unitCost
}

export function isExcludedFromDashboardSales(order) {
  if (isVoidOrder(order)) return true
  if (normalizeOrderStatus(order?.status) === 'Cancelled') return true
  return false
}

export function ordersForDashboardSales(orders = []) {
  return orders.filter(o => !isExcludedFromDashboardSales(o))
}

/** Units fulfilled from inventory — COGS/profit apply to this qty, not full order qty when partially allocated. */
export function soldQtyForLine(line) {
  const orderQty = Math.max(Number(line?.qty) || 0, 0)
  const shippedRaw = line?.shipped_qty
  if (shippedRaw != null && shippedRaw !== '') {
    return Math.min(Math.max(Number(shippedRaw) || 0, 0), orderQty)
  }
  const allocatedRaw = line?.allocated_qty
  if (allocatedRaw != null && allocatedRaw !== '') {
    return Math.min(Math.max(Number(allocatedRaw) || 0, 0), orderQty)
  }
  return orderQty
}

function soldLineUnitCost(line, inventory = []) {
  const hasLineBuying = line?.buying_price != null && line.buying_price !== ''
  const hasLineShipping = line?.shipping_cost != null && line.shipping_cost !== ''
  if (hasLineBuying || hasLineShipping) {
    return Math.max(Number(line.buying_price) || 0, 0) + Math.max(Number(line.shipping_cost) || 0, 0)
  }
  const inv = inventory.find(item => String(item.id) === String(line.inventory_id))
  if (inv) return itemBuying(inv) + itemShipping(inv)
  return Math.max(Number(line.buying_price) || 0, 0) + Math.max(Number(line.shipping_cost) || 0, 0)
}

function calcRealizedLineAmounts(line, inventory = []) {
  const orderQty = Math.max(Number(line.qty) || 0, 0)
  const soldQty = soldQtyForLine(line)
  if (soldQty <= 0) return { revenue: 0, cogs: 0, profit: 0, soldQty: 0 }

  if (
    soldQty === orderQty
    && line.profit != null && line.profit !== ''
    && line.line_total != null && line.line_total !== ''
  ) {
    const revenue = Math.max(Number(line.line_total) || 0, 0)
    const profit = Number(line.profit) || 0
    return { revenue, cogs: revenue - profit, profit, soldQty }
  }

  const price = Math.max(Number(line.price) || 0, 0)
  const discount = Math.max(Number(line.discount) || 0, 0)
  const soldShare = orderQty > 0 ? soldQty / orderQty : 0
  const revenue = Math.max(soldQty * price - discount * soldShare, 0)
  const unitCost = soldLineUnitCost(line, inventory)
  const cogs = soldQty * unitCost
  return { revenue, cogs, profit: revenue - cogs, soldQty }
}

function calcRealizedLineCogs(line, inventory = []) {
  return calcRealizedLineAmounts(line, inventory).cogs
}

function calcRealizedLineProfit(line, inventory = []) {
  return calcRealizedLineAmounts(line, inventory).profit
}

export function calcRealizedOrderCogs(order, orderItems = [], inventory = []) {
  const lines = itemsForOrder(order, orderItems)
  if (!lines.length) {
    const soldQty = soldQtyForLine(order)
    return soldQty * soldLineUnitCost(order, inventory)
  }
  return lines.reduce((sum, line) => sum + calcRealizedLineCogs(line, inventory), 0)
}

export function calcRealizedCogsForOrders(orders = [], orderItems = [], inventory = []) {
  return orders.reduce(
    (sum, order) => sum + calcRealizedOrderCogs(order, orderItems, inventory),
    0,
  )
}

/** @deprecated Use calcRealizedOrderCogs — kept for callers expecting invoice-total COGS basis */
export function calcOrderCogs(order, orderItems = [], inventory = []) {
  return calcRealizedOrderCogs(order, orderItems, inventory)
}

/** @deprecated Use calcRealizedCogsForOrders */
export function calcCogsForOrders(orders = [], orderItems = [], inventory = []) {
  return calcRealizedCogsForOrders(orders, orderItems, inventory)
}

export function calcRealizedOrderProductRevenue(order, orderItems = [], inventory = []) {
  const lines = itemsForOrder(order, orderItems)
  if (!lines.length) {
    const soldQty = soldQtyForLine(order)
    if (soldQty <= 0) return 0
    const orderQty = Math.max(Number(order?.qty) || 0, 0)
    const price = Math.max(Number(order.price) || 0, 0)
    const discount = Math.max(Number(order.discount) || 0, 0)
    const soldShare = orderQty > 0 ? soldQty / orderQty : 0
    return Math.max(soldQty * price - discount * soldShare, 0)
  }

  let soldRevenue = 0
  let totalRevenue = 0
  for (const line of lines) {
    const amounts = calcRealizedLineAmounts(line, inventory)
    soldRevenue += amounts.revenue
    const orderQty = Math.max(Number(line.qty) || 0, 0)
    const price = Math.max(Number(line.price) || 0, 0)
    const discount = Math.max(Number(line.discount) || 0, 0)
    totalRevenue += Math.max(orderQty * price - discount, 0)
  }
  const headerDiscount = Math.max(Number(order?.discount || 0), 0)
  const discountShare = totalRevenue > 0 ? soldRevenue / totalRevenue : 1
  return Math.max(soldRevenue - headerDiscount * discountShare, 0)
}

export function calcSoldProductRevenueForOrders(orders = [], orderItems = [], inventory = []) {
  return orders.reduce(
    (sum, order) => sum + calcRealizedOrderProductRevenue(order, orderItems, inventory),
    0,
  )
}

/** Product revenue from sold/allocated units only — excludes customer shipping and tax. */
export function calcProductRevenueForOrders(orders = [], orderItems = [], inventory = []) {
  return calcSoldProductRevenueForOrders(orders, orderItems, inventory)
}

export function calcMonthSales(orders = []) {
  return orders.reduce((sum, order) => sum + Number(order.total || 0), 0)
}

export function orderDateKey(order) {
  const raw = order?.order_date || order?.created_at || ''
  const s = String(raw).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const dt = new Date(raw)
  if (Number.isNaN(dt.getTime())) return s.slice(0, 10)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

export function filterOrdersForMonth(orders = [], monthKey = currentMonthKey()) {
  return orders.filter(order => orderDateKey(order).slice(0, 7) === monthKey)
}

export function poDateKey(po) {
  const raw = po?.order_date || po?.created_at || ''
  const s = String(raw).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const dt = new Date(raw)
  if (Number.isNaN(dt.getTime())) return s.slice(0, 10)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

export function filterPurchaseOrdersForMonth(purchaseOrders = [], monthKey = currentMonthKey()) {
  return (purchaseOrders || []).filter(po => {
    if (String(po?.status || '').trim() === 'Cancelled') return false
    return poDateKey(po).slice(0, 7) === monthKey
  })
}

/** Cash/purchase spending from POs dated in the month — separate from COGS on sold units. */
export function calcMonthPurchaseSpending(purchaseOrders = [], monthKey = currentMonthKey()) {
  const pos = filterPurchaseOrdersForMonth(purchaseOrders, monthKey)
  let inventoryPurchases = 0
  let purchaseShipping = 0
  let otherPoCosts = 0

  for (const po of pos) {
    const productUsd = Number(po.total_product_cost_usd)
    const productFallback = Number(po.total_product_cost) || 0
    inventoryPurchases += Math.max(
      Number.isFinite(productUsd) && productUsd > 0 ? productUsd : productFallback,
      0,
    )
    purchaseShipping += Math.max(Number(po.shipping_cost) || 0, 0)
    otherPoCosts += Math.max(Number(po.other_cost) || 0, 0)
      + Math.max(Number(po.total_commission) || 0, 0)
  }

  return {
    inventoryPurchases,
    purchaseShipping,
    otherPoCosts,
    totalPurchaseSpending: inventoryPurchases + purchaseShipping + otherPoCosts,
    poCount: pos.length,
  }
}

export function calcMonthFinancialSummary(
  orders = [],
  orderItems = [],
  inventory = [],
  expenses = [],
  monthKey = currentMonthKey(),
) {
  const sales = calcMonthSales(orders)
  const productRevenue = calcSoldProductRevenueForOrders(orders, orderItems, inventory)
  const cogs = calcRealizedCogsForOrders(orders, orderItems, inventory)
  const grossProfit = productRevenue - cogs
  const grossMargin = productRevenue > 0 ? (grossProfit / productRevenue) * 100 : 0
  const expensesTotal = calcOperatingExpensesForMonth(expenses, monthKey)
  const netProfit = grossProfit - expensesTotal
  const netMargin = productRevenue > 0 ? (netProfit / productRevenue) * 100 : 0
  const monthExpenses = expensesForMonth(expenses, monthKey)
  return {
    sales,
    productRevenue,
    cogs,
    grossProfit,
    grossMargin,
    expenses: expensesTotal,
    operatingExpenses: expensesTotal,
    netProfit,
    netMargin,
    monthExpenses,
  }
}

export function formatNetMarginPercent(netMargin) {
  if (!Number.isFinite(netMargin)) return '—'
  return `${netMargin.toFixed(1)}%`
}

export function formatGrossMarginPercent(grossMargin) {
  if (!Number.isFinite(grossMargin)) return '—'
  return `${grossMargin.toFixed(1)}%`
}

export function calcRealizedOrderProfit(order, orderItems, inventory = []) {
  return calcRealizedOrderProductRevenue(order, orderItems, inventory)
    - calcRealizedOrderCogs(order, orderItems, inventory)
}

export function calcRealizedProfitForOrders(orders = [], orderItems = [], inventory = []) {
  return orders.reduce(
    (sum, order) => sum + calcRealizedOrderProfit(order, orderItems, inventory),
    0,
  )
}

export function calcDashboardInventoryValue(inventory = []) {
  return inventory.reduce((sum, item) => {
    const stock = stockOnHandDisplay(item)
    return sum + stock * itemBuying(item)
  }, 0)
}

export function calcDashboardInventoryPotentialProfit(inventory = []) {
  return inventory.reduce((sum, item) => {
    const stock = stockOnHandDisplay(item)
    if (stock <= 0) return sum

    const buying = itemBuying(item)
    const shipping = itemShipping(item)
    const selling = itemSelling(item)
    if (buying <= 0 || selling <= 0) return sum

    return sum + (selling - buying - shipping) * stock
  }, 0)
}

/** Unrealized upside on inventory still on hand — not realized sales profit. */
export function calcDashboardExpectedProfit(inventory = []) {
  return calcDashboardInventoryPotentialProfit(inventory)
}
