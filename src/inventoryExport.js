import { inventoryStockView } from './backorder.js'
import { inventoryReorderView } from './inventoryReorder.js'
import { downloadCsv } from './purchaseOrders.js'

export const INVENTORY_EXPORT_HEADERS = [
  'Current Style / SKU',
  'Brand',
  'Category',
  'Supplier',
  'Stock On Hand',
  'Available Qty',
  'Minimum Stock',
  'Buying Price',
  'Shipping Cost',
  'Selling Price',
  'Status',
]

function itemBuying(item) {
  return Number(item?.buying_price ?? item?.cost ?? 0)
}

function itemShipping(item) {
  return Number(item?.shipping_cost ?? 0)
}

function itemSelling(item) {
  return Number(item?.selling_price ?? item?.price ?? item?.retail ?? 0)
}

function formatExportNumber(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0'
  return String(n)
}

export function buildInventoryExportRows(inventory = []) {
  return inventory.map(item => {
    const stockOnHand = inventoryStockView(item)
    const reorder = inventoryReorderView(item)
    const available = stockOnHand.display
    return [
      item.style || '',
      item.brand || '',
      item.category || '',
      String(item.supplier || '').trim(),
      stockOnHand.display,
      available,
      reorder.minimumStock != null ? reorder.minimumStock : '',
      formatExportNumber(itemBuying(item)),
      formatExportNumber(itemShipping(item)),
      formatExportNumber(itemSelling(item)),
      reorder.status || '',
    ]
  })
}

export function inventoryExportFilename(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `inventory-export-${y}-${m}-${d}.csv`
}

export function exportInventoryCsv(inventory = []) {
  downloadCsv(
    inventoryExportFilename(),
    INVENTORY_EXPORT_HEADERS,
    buildInventoryExportRows(inventory),
  )
}
