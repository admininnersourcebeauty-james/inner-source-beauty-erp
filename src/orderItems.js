import { primaryTrackingValue } from './orderTrackingNumbers.js'

const STATUS_MIGRATION = {
  'Ready to Ship': 'Completed',
  'Partially Shipped': 'Partially Allocated',
  Shipped: 'Completed',
  Open: 'Completed',
  'Ready to Fulfill': 'Completed',
  'Partially Fulfilled': 'Partially Allocated',
}

function normalizeOrderStatus(status) {
  if (!status) return 'Completed'
  return STATUS_MIGRATION[status] || status
}

function calcAllocation(orderQty, physicalStock) {
  const qty = Math.max(Number(orderQty) || 0, 0)
  const available_stock = Math.max(Number(physicalStock) || 0, 0)
  const allocated_qty = Math.min(qty, available_stock)
  const backorder_qty = Math.max(qty - available_stock, 0)
  return { available_stock, allocated_qty, backorder_qty }
}

function deriveCreateStatus(allocated_qty, backorder_qty) {
  const backorder = Math.max(Number(backorder_qty) || 0, 0)
  const allocated = Math.max(Number(allocated_qty) || 0, 0)
  if (backorder <= 0) return 'Completed'
  if (allocated > 0) return 'Partially Allocated'
  return 'Back Order'
}

export const ORDER_ITEM_INSERT_FIELDS = [
  'order_id',
  'inventory_id',
  'style',
  'qty',
  'price',
  'discount',
  'line_total',
  'buying_price',
  'shipping_cost',
  'profit',
  'allocated_qty',
  'backorder_qty',
  'shipped_qty',
  'sort_order',
]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function blankOrderLine() {
  return {
    _clientKey: '',
    inventory_id: '',
    style: '',
    qty: '',
    price: '',
    discount: '0',
  }
}

export function newClientOrderLineKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Strip UI/temp fields — cloud insert must never send id or created_at. */
export function sanitizeOrderItemInsertRow(row) {
  const out = {}
  for (const key of ORDER_ITEM_INSERT_FIELDS) {
    if (row?.[key] !== undefined) out[key] = row[key]
  }
  if (import.meta.env?.DEV && row && Object.prototype.hasOwnProperty.call(row, 'id')) {
    console.warn('[order_items] stripped forbidden id from insert payload:', row.id)
  }
  return out
}

export function sanitizeOrderItemInsertRows(rows) {
  return (rows || []).map(sanitizeOrderItemInsertRow)
}

export function logOrderItemInsertPayload(label, rows) {
  const clean = sanitizeOrderItemInsertRows(rows)
  if (import.meta.env?.DEV) {
    clean.forEach((row, idx) => {
      if (Object.prototype.hasOwnProperty.call(row, 'id')) {
        console.warn(`[${label}] row ${idx} still contains id`, row.id)
      }
    })
  }
  return clean
}

export function orderItemsForOrder(orderItems, orderId) {
  return (orderItems || [])
    .filter(i => String(i.order_id) === String(orderId))
    .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
}

export function legacyLineFromOrder(order) {
  if (!order) return null
  const qty = Number(order.qty || 0)
  const price = Number(order.price || 0)
  const discount = Number(order.discount || 0)
  return {
    id: `legacy-${order.id}`,
    order_id: order.id,
    inventory_id: order.inventory_id,
    style: order.style || '',
    qty,
    price,
    discount,
    line_total: qty * price - discount,
    buying_price: Number(order.buying_price || 0),
    shipping_cost: Number(order.shipping_cost || 0),
    profit: Number(order.profit || 0),
    allocated_qty: Number(order.allocated_qty ?? qty),
    backorder_qty: Number(order.backorder_qty || 0),
    shipped_qty: Number(order.shipped_qty || 0),
    sort_order: 0,
  }
}

export function itemsForOrder(order, orderItems) {
  const rows = orderItemsForOrder(orderItems, order?.id)
  if (rows.length) return rows
  const legacy = legacyLineFromOrder(order)
  return legacy ? [legacy] : []
}

export function orderDisplayProduct(order, orderItems) {
  const lines = itemsForOrder(order, orderItems)
  if (!lines.length) return order?.style || '—'
  const first = lines[0].style || '—'
  if (lines.length === 1) return first
  return `${first} +${lines.length - 1} more`
}

export function itemBuying(item) {
  return Number(item?.buying_price ?? item?.cost ?? 0)
}

export function itemShipping(item) {
  return Number(item?.shipping_cost ?? 0)
}

export function itemUnitCost(item) {
  return itemBuying(item) + itemShipping(item)
}

export function itemSelling(item) {
  return Number(item?.selling_price ?? item?.price ?? item?.retail ?? 0)
}

export function calcOrderLineAmounts(line, inventory) {
  const qty = Math.max(Number(line.qty || 0), 0)
  const price = Math.max(Number(line.price || 0), 0)
  const discount = Math.max(Number(line.discount || 0), 0)
  const lineSubtotal = qty * price
  const line_total = Math.max(lineSubtotal - discount, 0)
  const buying = inventory ? itemBuying(inventory) : Number(line.buying_price || 0)
  const inboundShipping = inventory ? itemShipping(inventory) : Number(line.shipping_cost || 0)
  const profit = line_total - qty * (buying + inboundShipping)
  return {
    qty,
    price,
    discount,
    lineSubtotal,
    line_total,
    buying_price: buying,
    shipping_cost: inboundShipping,
    profit,
  }
}

export function previewLineAllocation(line, inventory, editContext) {
  const orderQty = Math.max(Number(line.qty || 0), 0)
  const stockView = Math.max(Number(inventory?.qty ?? 0), 0)
  if (!editContext) {
    return { currentStock: stockView, orderQty, ...calcAllocation(orderQty, stockView) }
  }
  const sameProduct = String(editContext.inventory_id || '') === String(line.inventory_id || '')
  const restoreQty = sameProduct ? Math.max(Number(editContext.allocated_qty || 0), 0) : 0
  const available = sameProduct ? stockView + restoreQty : stockView
  return { currentStock: stockView, orderQty, ...calcAllocation(orderQty, available) }
}

export function mergeDuplicateInventoryLines(lines) {
  const merged = []
  const indexByInventory = new Map()
  let mergedCount = 0

  for (const line of lines) {
    const invId = String(line.inventory_id || '')
    if (!invId) {
      merged.push({ ...line })
      continue
    }
    if (indexByInventory.has(invId)) {
      const idx = indexByInventory.get(invId)
      const existing = merged[idx]
      const qty = Number(existing.qty || 0) + Number(line.qty || 0)
      merged[idx] = {
        ...existing,
        qty,
        discount: String(Number(existing.discount || 0) + Number(line.discount || 0)),
      }
      mergedCount += 1
      continue
    }
    indexByInventory.set(invId, merged.length)
    merged.push({ ...line })
  }

  return { lines: merged, mergedCount }
}

export function validateOrderLines(lines) {
  if (!lines?.length) return 'Add at least one product line.'
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.inventory_id) return `Select a product on line ${i + 1}.`
    const qty = Number(line.qty || 0)
    if (!Number.isFinite(qty) || qty <= 0) return `Enter a valid quantity on line ${i + 1}.`
    const price = Number(line.price || 0)
    if (!Number.isFinite(price) || price < 0) return `Enter a valid unit price on line ${i + 1}.`
    const discount = Number(line.discount || 0)
    if (!Number.isFinite(discount) || discount < 0) return `Enter a valid discount on line ${i + 1}.`
    if (discount > qty * price) return `Line ${i + 1} discount cannot exceed line subtotal.`
  }
  return ''
}

export function calcOrderTotals(lines, header, inventoryList) {
  const shipping = Math.max(Number(header.shipping || 0), 0)
  const headerDiscount = Math.max(Number(header.discount || 0), 0)
  const tax = Math.max(Number(header.tax || 0), 0)

  let subtotal = 0
  let lineDiscountTotal = 0
  let profit = 0
  let totalQty = 0
  let totalAllocated = 0
  let totalBackorder = 0
  const computedLines = []

  lines.forEach((line, sort_order) => {
    const inventory = (inventoryList || []).find(i => String(i.id) === String(line.inventory_id))
    const amounts = calcOrderLineAmounts(line, inventory)
    const alloc = previewLineAllocation(line, inventory, line._editContext)
    subtotal += amounts.lineSubtotal
    lineDiscountTotal += amounts.discount
    profit += amounts.profit
    totalQty += amounts.qty
    totalAllocated += alloc.allocated_qty
    totalBackorder += alloc.backorder_qty
    computedLines.push({
      ...line,
      sort_order,
      style: inventory?.style || line.style || '',
      ...amounts,
      allocated_qty: alloc.allocated_qty,
      backorder_qty: alloc.backorder_qty,
      shipped_qty: alloc.allocated_qty,
    })
  })

  const discountTotal = lineDiscountTotal + headerDiscount
  const grandTotal = subtotal - discountTotal + shipping + tax

  return {
    subtotal,
    lineDiscountTotal,
    headerDiscount,
    discountTotal,
    shipping,
    tax,
    grandTotal,
    profit: profit - headerDiscount,
    totalQty,
    totalAllocated,
    totalBackorder,
    lines: computedLines,
  }
}

export function deriveOrderStatusFromLines(lines, requestedStatus) {
  const normalized = normalizeOrderStatus(requestedStatus || 'Completed')
  if (normalized === 'Cancelled' || normalized === 'Void') return normalized

  const totalAllocated = lines.reduce((s, l) => s + Number(l.allocated_qty || 0), 0)
  const totalBackorder = lines.reduce((s, l) => s + Number(l.backorder_qty || 0), 0)
  return deriveCreateStatus(totalAllocated, totalBackorder)
}

export function trimOrderMemo(value) {
  return String(value ?? '').trim()
}

export function orderInternalNote(order) {
  const internal = trimOrderMemo(order?.internal_note)
  if (internal) return internal
  return trimOrderMemo(order?.note)
}

export function orderCustomerNote(order) {
  return trimOrderMemo(order?.customer_note)
}

export function orderHasMemo(order) {
  return !!(orderInternalNote(order) || orderCustomerNote(order))
}

export function buildOrderHeaderFromLines(header, totals, lines, inventoryList) {
  const firstLine = lines[0] || {}
  const firstInventory = inventoryList.find(i => String(i.id) === String(firstLine.inventory_id))
  const status = deriveOrderStatusFromLines(lines, header.status)

  return {
    customer_id: header.customer_id || null,
    inventory_id: firstLine.inventory_id || null,
    customer_name: header.customer_name || '',
    style: lines.length <= 1
      ? (firstLine.style || firstInventory?.style || '')
      : `${firstLine.style || firstInventory?.style || 'Product'} +${lines.length - 1} more`,
    qty: totals.totalQty,
    price: Number(firstLine.price || 0),
    buying_price: Number(firstLine.buying_price || 0),
    shipping_cost: Number(firstLine.shipping_cost || 0),
    profit: totals.profit,
    shipping: totals.shipping,
    discount: totals.headerDiscount,
    tax: totals.tax,
    total: totals.grandTotal,
    shipping_method: header.shipping_method || '',
    allocated_qty: totals.totalAllocated,
    backorder_qty: totals.totalBackorder,
    shipped_qty: totals.totalAllocated,
    invoice_no: header.invoice_no || '',
    status,
    payment_status: header.payment_status || 'Unpaid',
    internal_note: trimOrderMemo(header.internal_note),
    customer_note: trimOrderMemo(header.customer_note),
    note: trimOrderMemo(header.internal_note),
    due_date: header.due_date || null,
    tracking: primaryTrackingValue(header.tracking_entries, header.tracking),
    order_date: header.order_date || null,
    fulfillment_date: header.fulfillment_date || null,
    delivered_by: header.delivered_by || '',
    picked_up_by: header.picked_up_by || '',
    fulfillment_note: header.fulfillment_note || '',
    signature_name: header.signature_name || '',
    sales_person_id: header.sales_person_id || null,
    sales_person_name: header.sales_person_name || '',
  }
}

function buildOrderItemRowFields(orderId, line, idx) {
  return {
    order_id: orderId,
    inventory_id: line.inventory_id || null,
    style: line.style || '',
    qty: line.qty,
    price: line.price,
    discount: line.discount,
    line_total: line.line_total,
    buying_price: line.buying_price,
    shipping_cost: line.shipping_cost,
    profit: line.profit,
    allocated_qty: line.allocated_qty,
    backorder_qty: line.backorder_qty,
    shipped_qty: line.allocated_qty ?? line.shipped_qty ?? 0,
    sort_order: line.sort_order ?? idx,
  }
}

export function isPersistedOrderItemId(id) {
  if (id == null || id === '') return false
  if (String(id).startsWith('legacy-')) return false
  if (String(id).startsWith('tmp-')) return false
  if (UUID_RE.test(String(id))) return true
  return Number.isFinite(Number(id))
}

/** Supabase insert — whitelist fields only; id/created_at omitted for DB defaults. */
export function buildOrderItemInsertRows(orderId, lines) {
  return sanitizeOrderItemInsertRows(
    (lines || []).map((line, idx) => buildOrderItemRowFields(orderId, line, idx)),
  )
}

/** localStorage rows — client-generated ids for offline mode only. */
export function buildOrderItemLocalRows(orderId, lines, newId) {
  return (lines || []).map((line, idx) => ({
    id: isPersistedOrderItemId(line.id) ? line.id : newId(),
    ...buildOrderItemRowFields(orderId, line, idx),
    created_at: line.created_at || new Date().toISOString(),
  }))
}

/** @deprecated Use buildOrderItemInsertRows or buildOrderItemLocalRows */
export function buildOrderItemRows(orderId, lines, newId) {
  return buildOrderItemLocalRows(orderId, lines, newId)
}

export function aggregateFulfillmentFromItems(items) {
  const rows = items || []
  const qty = rows.reduce((s, l) => s + Number(l.qty || 0), 0)
  const allocated_qty = rows.reduce((s, l) => s + Number(l.allocated_qty || 0), 0)
  const backorder_qty = rows.reduce((s, l) => s + Number(l.backorder_qty || 0), 0)
  return { qty, allocated_qty, backorder_qty }
}

export function lineRestoreQty(line) {
  return Math.max(Number(line.allocated_qty || 0), 0)
}

export function orderRestorePlan(order, orderItems) {
  return itemsForOrder(order, orderItems)
    .filter(l => l.inventory_id && lineRestoreQty(l) > 0)
    .map(l => ({ inventory_id: l.inventory_id, qty: lineRestoreQty(l) }))
}

export function activeBackorderEntries(orders, orderItems, inventoryId) {
  const entries = []
  for (const order of orders || []) {
    if (String(order?.status || '').trim().toLowerCase() === 'void') continue
    const status = normalizeOrderStatus(order?.status)
    if (status === 'Cancelled' || status === 'Completed') continue
    for (const line of itemsForOrder(order, orderItems)) {
      if (String(line.inventory_id) !== String(inventoryId)) continue
      const backorder_qty = Number(line.backorder_qty || 0)
      if (backorder_qty <= 0) continue
      entries.push({
        order,
        line,
        orderItemId: line.id,
        invoice_no: order.invoice_no,
        customer_name: order.customer_name,
        backorder_qty,
        allocated_qty: Number(line.allocated_qty || 0),
      })
    }
  }
  return entries.sort((a, b) => {
    const da = String(a.order.order_date || a.order.created_at || '')
    const db = String(b.order.order_date || b.order.created_at || '')
    if (da !== db) return da.localeCompare(db)
    return String(a.order.created_at || '').localeCompare(String(b.order.created_at || ''))
  })
}

export function buildLineAllocationPlan(entries, stockIncrease) {
  let remaining = Math.max(Number(stockIncrease) || 0, 0)
  const plan = []
  for (const entry of entries) {
    if (remaining <= 0) break
    const alloc = Math.min(entry.backorder_qty, remaining)
    if (alloc <= 0) continue
    plan.push({
      ...entry,
      previouslyBackOrdered: entry.backorder_qty,
      allocatedNow: alloc,
      remainingBackOrder: entry.backorder_qty - alloc,
      newAllocated: entry.allocated_qty + alloc,
      newStatus: deriveCreateStatus(entry.allocated_qty + alloc, entry.backorder_qty - alloc),
    })
    remaining -= alloc
  }
  return { plan, stockUsed: Math.max(Number(stockIncrease) - remaining, 0) }
}

export function reaggregateOrderHeader(order, items) {
  const agg = aggregateFulfillmentFromItems(items)
  const profit = items.reduce((s, l) => s + Number(l.profit || 0), 0)
  const subtotal = items.reduce((s, l) => s + Number(l.qty || 0) * Number(l.price || 0), 0)
  const lineDiscount = items.reduce((s, l) => s + Number(l.discount || 0), 0)
  const headerDiscount = Number(order.discount || 0)
  const shipping = Number(order.shipping || 0)
  const tax = Number(order.tax || 0)
  const total = subtotal - lineDiscount - headerDiscount + shipping + tax
  const first = items[0] || {}
  return {
    style: items.length <= 1 ? (first.style || order.style) : orderDisplayProduct(order, items),
    qty: agg.qty,
    inventory_id: first.inventory_id || order.inventory_id,
    price: Number(first.price || order.price || 0),
    profit,
    total,
    allocated_qty: agg.allocated_qty,
    backorder_qty: agg.backorder_qty,
    shipped_qty: agg.allocated_qty,
    status: deriveOrderStatusFromLines(items, order.status),
  }
}
