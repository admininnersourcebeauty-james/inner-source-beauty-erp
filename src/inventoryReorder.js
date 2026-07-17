/** Minimum stock / reorder helpers — reads reorder_limit (falls back to low_stock). */

export function itemMinimumStock(item) {
  const raw = item?.reorder_limit ?? item?.low_stock
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function itemMinimumStockOrDefault(item, defaultVal = 5) {
  const m = itemMinimumStock(item)
  return m != null ? m : defaultVal
}

export function stockOnHandDisplay(item) {
  return Math.max(Number(item?.qty) || 0, 0)
}

export function calcNeedToOrder(stockOnHand, minimumStock) {
  const min = Number(minimumStock)
  if (!Number.isFinite(min) || min <= 0) return 0
  return Math.max(min - Number(stockOnHand || 0), 0)
}

export function lowStockStatus(stockOnHand, minimumStock) {
  const stock = Number(stockOnHand) || 0
  const min = minimumStock == null || minimumStock === '' ? null : Number(minimumStock)
  if (min == null || !Number.isFinite(min) || min <= 0) {
    return stock <= 0 ? 'Reorder Recommended' : 'Monitor'
  }
  if (stock < min) return 'Reorder Recommended'
  if (stock === min) return 'At Minimum'
  return 'Monitor'
}

export function lowStockStatusClass(status) {
  if (status === 'Reorder Recommended') return 'stock-status-reorder'
  if (status === 'At Minimum') return 'stock-status-minimum'
  return 'stock-status-monitor'
}

export function isLowStockAlertItem(item) {
  const stockOnHand = stockOnHandDisplay(item)
  const min = itemMinimumStock(item)
  if (min == null) return stockOnHand <= 0
  if (min <= 0) return stockOnHand <= 0
  return stockOnHand <= min
}

export function inventoryReorderView(item) {
  const stockOnHand = stockOnHandDisplay(item)
  const minimumStock = itemMinimumStock(item)
  const needToOrder = calcNeedToOrder(stockOnHand, minimumStock ?? 0)
  const status = lowStockStatus(stockOnHand, minimumStock)
  return {
    stockOnHand,
    minimumStock,
    minimumStockDisplay: minimumStock != null ? minimumStock : '—',
    needToOrder,
    status,
    statusClass: lowStockStatusClass(status),
  }
}

export function buildLowStockAlerts(inventory, limit = 10) {
  return inventory
    .filter(isLowStockAlertItem)
    .map(item => {
      const view = inventoryReorderView(item)
      const label = [item.style, item.brand].filter(Boolean).join(' ')
      return {
        id: item.id,
        item,
        label: label || '—',
        style: item.style || '—',
        brand: item.brand || '—',
        buyingPrice: Number(item.buying_price ?? item.cost ?? 0) || 0,
        ...view,
      }
    })
    .sort((a, b) => a.stockOnHand - b.stockOnHand)
    .slice(0, limit)
}

export function lowStockSummary(inventory) {
  const alerts = inventory.filter(isLowStockAlertItem)
  let unitsToReorder = 0
  for (const item of inventory) {
    const view = inventoryReorderView(item)
    if (view.needToOrder > 0) unitsToReorder += view.needToOrder
  }
  return { itemCount: alerts.length, unitsToReorder }
}

export function reorderListItems(inventory) {
  return inventory
    .map(item => {
      const view = inventoryReorderView(item)
      if (view.needToOrder <= 0) return null
      return {
        id: item.id,
        style: item.style || '—',
        brand: item.brand || '—',
        stockOnHand: view.stockOnHand,
        minimumStock: view.minimumStock ?? 0,
        needToOrder: view.needToOrder,
        buyingPrice: Number(item.buying_price ?? item.cost ?? 0) || 0,
        estimatedCost: view.needToOrder * (Number(item.buying_price ?? item.cost ?? 0) || 0),
        notes: '',
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.style.localeCompare(b.style))
}

export function minimumStockPayload(formValue) {
  const n = Number(formValue)
  const val = Number.isFinite(n) ? Math.max(n, 0) : 0
  return { reorder_limit: val, low_stock: val }
}
