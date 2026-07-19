export const PO_STATUSES = [
  'Draft', 'Submitted', 'In Production', 'Shipped', 'Partially Received', 'Received', 'Cancelled',
]

export const PO_FILTER_STATUSES = ['All', ...PO_STATUSES]

export const PO_CURRENCIES = ['KRW', 'USD']

export const PO_PURCHASE_TYPES = [
  { value: 'direct', label: 'Direct Purchase' },
  { value: 'middleman', label: 'Through Middleman' },
]

export const COMMISSION_PAYMENT_STATUSES = ['Unpaid', 'Partial', 'Paid']

export const PO_OPEN_STATUSES = ['Draft', 'Submitted', 'In Production', 'Shipped', 'Partially Received']

const PO_PREFIX = 'ISB-PO-'
const PO_FIRST_SEQ = 260001

export function poNumberSeq(poNumber) {
  if (!poNumber || !String(poNumber).startsWith(PO_PREFIX)) return null
  const num = parseInt(String(poNumber).slice(PO_PREFIX.length), 10)
  return Number.isFinite(num) ? num : null
}

export function nextPoNumber(purchaseOrders, explicitNo) {
  if (explicitNo) return explicitNo
  let max = null
  for (const po of purchaseOrders || []) {
    const num = poNumberSeq(po.po_number)
    if (num !== null && (max === null || num > max)) max = num
  }
  const next = (max ?? PO_FIRST_SEQ - 1) + 1
  return `${PO_PREFIX}${String(next).padStart(6, '0')}`
}

export function resolvePurchaseType(po, items) {
  if (po?.purchase_type === 'middleman' || po?.purchase_type === 'direct') return po.purchase_type
  const hasMiddlemanName = String(po?.middleman_name || '').trim().length > 0
  const list = items || []
  const hasCommission = Number(po?.total_commission) > 0
    || list.some(i => Number(i.commission_percent) > 0 || Number(i.commission_total) > 0)
  return (hasMiddlemanName || hasCommission) ? 'middleman' : 'direct'
}

export function isMiddlemanPo(po, items) {
  return resolvePurchaseType(po, items) === 'middleman'
}

export function purchaseTypeLabel(type) {
  return PO_PURCHASE_TYPES.find(t => t.value === type)?.label || 'Direct Purchase'
}

export function calcLineItem(raw, purchaseType) {
  const orderQty = Math.max(Number(raw.order_qty) || 0, 0)
  const factoryUnitCost = Math.max(Number(raw.korean_unit_cost) || 0, 0)
  const isMiddleman = purchaseType === 'middleman'
  const commissionPercent = isMiddleman ? Math.max(Number(raw.commission_percent) || 0, 0) : 0
  const receivedQty = Math.max(Number(raw.received_qty) || 0, 0)
  const commissionPerUnit = factoryUnitCost * commissionPercent / 100
  const productCost = orderQty * factoryUnitCost
  const commissionTotal = orderQty * commissionPerUnit
  const totalLineCost = productCost + commissionTotal
  const remainingQty = Math.max(orderQty - receivedQty, 0)
  return {
    ...raw,
    order_qty: orderQty,
    korean_unit_cost: factoryUnitCost,
    factory_unit_cost: factoryUnitCost,
    commission_percent: commissionPercent,
    commission_per_unit: commissionPerUnit,
    product_cost: productCost,
    commission_total: commissionTotal,
    total_line_cost: totalLineCost,
    received_qty: receivedQty,
    remaining_qty: remainingQty,
  }
}

export function calcPoTotals(header, lines) {
  const purchaseType = resolvePurchaseType(header, lines)
  const computed = (lines || []).map(l => calcLineItem(l, purchaseType))
  const totalOrderedUnits = computed.reduce((s, l) => s + l.order_qty, 0)
  const totalProductCost = computed.reduce((s, l) => s + l.product_cost, 0)
  const totalCommission = purchaseType === 'middleman'
    ? computed.reduce((s, l) => s + l.commission_total, 0)
    : 0
  const shippingCost = Math.max(Number(header.shipping_cost) || 0, 0)
  const otherCost = Math.max(Number(header.other_cost) || 0, 0)
  const grandTotal = totalProductCost + totalCommission + shippingCost + otherCost
  const totalPurchaseCost = grandTotal
  const currency = header.currency || 'KRW'
  const exchangeRate = Math.max(Number(header.exchange_rate) || 1, 0.000001)
  const estimatedGrandTotalUsd = currency === 'USD' ? grandTotal : grandTotal / exchangeRate
  return {
    lines: computed,
    purchaseType,
    totalOrderedUnits,
    totalProductCost,
    totalCommission,
    shippingCost,
    otherCost,
    grandTotal,
    totalPurchaseCost,
    estimatedGrandTotalUsd,
    currency,
    exchangeRate,
  }
}

export function allocateLineCosts(lines, shippingCost, otherCost, purchaseType = 'direct') {
  const isMiddleman = purchaseType === 'middleman'
  const computed = (lines || []).map(l => calcLineItem(l, purchaseType))
  const totalProductCost = computed.reduce((s, l) => s + l.product_cost, 0) || 1
  return computed.map(line => {
    const share = line.product_cost / totalProductCost
    const shippingAllocation = shippingCost * share
    const otherCostAllocation = otherCost * share
    const commissionPerUnit = isMiddleman ? line.commission_per_unit : 0
    const shippingPerUnit = line.order_qty > 0 ? shippingAllocation / line.order_qty : 0
    const otherPerUnit = line.order_qty > 0 ? otherCostAllocation / line.order_qty : 0
    const finalUnitCost = line.factory_unit_cost + commissionPerUnit + shippingPerUnit + otherPerUnit
    const finalLineCost = finalUnitCost * line.order_qty
    return {
      ...line,
      shipping_allocation: shippingAllocation,
      other_cost_allocation: otherCostAllocation,
      final_unit_cost: finalUnitCost,
      final_line_cost: finalLineCost,
      estimated_landed_cost: finalUnitCost,
    }
  })
}

export function validatePoSave(header, lines) {
  const purchaseType = header.purchase_type || 'direct'
  if (!String(header.supplier || '').trim()) return 'Supplier is required.'
  if (purchaseType === 'middleman' && !String(header.middleman_name || '').trim()) {
    return 'Middleman Name is required for Through Middleman purchase orders.'
  }
  if (Math.max(Number(header.shipping_cost) || 0, 0) < 0) return 'Shipping Cost cannot be negative.'
  if (Math.max(Number(header.other_cost) || 0, 0) < 0) return 'Other Cost cannot be negative.'
  const computed = calcPoTotals(header, lines)
  if (!computed.lines.length) return 'Add at least one product line.'
  for (const line of computed.lines) {
    if (line.order_qty < 0) return 'Quantity cannot be negative.'
    if (line.factory_unit_cost < 0) return 'Factory Unit Cost cannot be negative.'
    if (purchaseType === 'middleman' && line.commission_percent < 0) {
      return 'Commission Percent cannot be negative.'
    }
    if (line.order_qty <= 0) return 'Each product line must have Order Qty greater than 0.'
  }
  return ''
}

export function normalizePoSavePayload(header, lines) {
  const purchaseType = header.purchase_type || 'direct'
  const totals = calcPoTotals({ ...header, purchase_type: purchaseType }, lines)
  const normalizedLines = totals.lines.map(line => ({
    ...line,
    commission_percent: purchaseType === 'middleman' ? line.commission_percent : 0,
    commission_per_unit: purchaseType === 'middleman' ? line.commission_per_unit : 0,
    commission_total: purchaseType === 'middleman' ? line.commission_total : 0,
    total_line_cost: purchaseType === 'middleman'
      ? line.product_cost + line.commission_total
      : line.product_cost,
  }))
  return {
    header: {
      ...header,
      purchase_type: purchaseType,
      middleman_name: purchaseType === 'middleman' ? (header.middleman_name || '') : '',
      total_commission: totals.totalCommission,
      grand_total: totals.grandTotal,
    },
    lines: normalizedLines,
    totals: calcPoTotals({ ...header, purchase_type: purchaseType }, normalizedLines),
  }
}

export function derivePoStatus(items, currentStatus) {
  if (currentStatus === 'Cancelled') return 'Cancelled'
  const lines = (items || [])
  if (!lines.length) return currentStatus || 'Draft'
  const totalOrdered = lines.reduce((s, l) => s + Number(l.order_qty || 0), 0)
  const totalReceived = lines.reduce((s, l) => s + Number(l.received_qty || 0), 0)
  if (totalOrdered > 0 && totalReceived >= totalOrdered) return 'Received'
  if (totalReceived > 0) return 'Partially Received'
  return currentStatus || 'Draft'
}

export function isPoLocked(po) {
  return po?.status === 'Received' || po?.status === 'Cancelled'
}

export function canReceivePo(po, role) {
  return role === 'Admin' && po && !isPoLocked(po)
}

export function canEditPo(po, role) {
  return role === 'Admin' && po && ['Draft', 'Submitted', 'In Production', 'Shipped'].includes(po.status)
}

export function canCancelPo(po, role) {
  return role === 'Admin' && po && po.status !== 'Cancelled' && po.status !== 'Received'
}

export function formatKrw(n) {
  const v = Math.round(Number(n) || 0)
  return `₩${v.toLocaleString('en-US')}`
}

export function formatUsd(n) {
  return `$${(Number(n) || 0).toFixed(2)}`
}

export function formatPoMoney(amount, currency) {
  return currency === 'USD' ? formatUsd(amount) : formatKrw(amount)
}

export function commissionBalance(po) {
  if (!isMiddlemanPo(po)) return 0
  const due = Number(po?.total_commission) || 0
  const paid = Number(po?.commission_amount_paid) || 0
  return Math.max(due - paid, 0)
}

export function commissionAmountDue(po) {
  return isMiddlemanPo(po) ? Number(po?.total_commission) || 0 : 0
}

export function deriveCommissionPaymentStatus(po) {
  if (!isMiddlemanPo(po)) return 'Paid'
  const due = commissionAmountDue(po)
  const paid = Number(po?.commission_amount_paid) || 0
  if (due <= 0) return 'Paid'
  if (paid <= 0) return 'Unpaid'
  if (paid >= due - 0.001) return 'Paid'
  return 'Partial'
}

export function poItemsForOrder(purchaseOrderItems, poId) {
  return (purchaseOrderItems || []).filter(i => String(i.purchase_order_id) === String(poId))
}

export function poReceiptsForOrder(purchaseOrderReceipts, poId) {
  return (purchaseOrderReceipts || []).filter(r => String(r.purchase_order_id) === String(poId))
}

export function receivedProgress(items) {
  const ordered = (items || []).reduce((s, l) => s + Number(l.order_qty || 0), 0)
  const received = (items || []).reduce((s, l) => s + Number(l.received_qty || 0), 0)
  if (ordered <= 0) return '0%'
  return `${Math.min(100, Math.round((received / ordered) * 100))}%`
}

export function poSummaryStats(purchaseOrders, purchaseOrderItems) {
  const openPos = (purchaseOrders || []).filter(po => PO_OPEN_STATUSES.includes(po.status))
  const openPoIds = new Set(openPos.map(po => String(po.id)))
  const openItems = (purchaseOrderItems || []).filter(i => openPoIds.has(String(i.purchase_order_id)))
  return {
    openCount: openPos.length,
    totalOrderedAmount: openPos.reduce((s, po) => s + Number(po.grand_total || 0), 0),
    expectedCommission: openPos
      .filter(po => isMiddlemanPo(po, poItemsForOrder(purchaseOrderItems, po.id)))
      .reduce((s, po) => s + Number(po.total_commission || 0), 0),
    incomingUnits: openItems.reduce((s, l) => s + Math.max(Number(l.order_qty || 0) - Number(l.received_qty || 0), 0), 0),
    commissionPayable: (purchaseOrders || [])
      .filter(po => po.status !== 'Cancelled' && isMiddlemanPo(po, poItemsForOrder(purchaseOrderItems, po.id)))
      .reduce((s, po) => s + commissionBalance(po), 0),
  }
}

export function incomingInventoryAlerts(purchaseOrders, purchaseOrderItems, limit = 10) {
  const alerts = []
  for (const po of purchaseOrders || []) {
    if (!PO_OPEN_STATUSES.includes(po.status)) continue
    const items = poItemsForOrder(purchaseOrderItems, po.id)
    const remaining = items.reduce((s, l) => s + Math.max(Number(l.order_qty || 0) - Number(l.received_qty || 0), 0), 0)
    if (remaining <= 0) continue
    alerts.push({
      id: po.id,
      po_number: po.po_number,
      supplier: po.supplier,
      eta: po.eta,
      remaining_units: remaining,
      status: po.status,
    })
  }
  return alerts
    .sort((a, b) => String(a.eta || '').localeCompare(String(b.eta || '')))
    .slice(0, limit)
}

export function poMatchesSearch(po, items, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return true
  const typeLabel = purchaseTypeLabel(resolvePurchaseType(po, items)).toLowerCase()
  const hay = [
    po.po_number, po.supplier, po.middleman_name, po.notes, po.status, typeLabel,
    ...items.map(i => [i.product_sku, i.product_name, i.brand, i.note].join(' ')),
  ].join(' ').toLowerCase()
  return hay.includes(q)
}

export function poMatchesFilter(po, filter) {
  if (!filter || filter === 'All') return true
  return po.status === filter
}

export function blankPoLine(inventoryItem) {
  if (inventoryItem) {
    return {
      id: '',
      inventory_id: inventoryItem.id,
      product_sku: inventoryItem.style || '',
      product_name: inventoryItem.style || '',
      brand: inventoryItem.brand || '',
      order_qty: '',
      korean_unit_cost: '',
      commission_percent: '',
      received_qty: 0,
      note: '',
    }
  }
  return {
    id: '',
    inventory_id: '',
    product_sku: '',
    product_name: '',
    brand: '',
    order_qty: '',
    korean_unit_cost: '',
    commission_percent: '',
    received_qty: 0,
    note: '',
  }
}

export function blankPoHeader(poNumber) {
  return {
    po_number: poNumber || '',
    purchase_type: 'direct',
    order_date: '',
    supplier: '',
    middleman_name: '',
    currency: 'KRW',
    exchange_rate: '1350',
    shipping_cost: '',
    other_cost: '',
    eta: '',
    status: 'Draft',
    notes: '',
    commission_payment_status: 'Unpaid',
    commission_amount_paid: '',
    commission_payment_date: '',
    commission_payment_method: '',
    commission_payment_note: '',
  }
}

export function buildSupplierCsvRows(po, lines) {
  return lines.map(line => [
    po.po_number,
    po.order_date,
    po.supplier,
    line.product_name || line.product_sku,
    line.product_sku,
    line.order_qty,
    line.factory_unit_cost,
    line.product_cost,
    po.eta,
    po.notes,
  ])
}

export function buildInternalCsvRows(po, allocatedLines, totals) {
  return allocatedLines.map(line => [
    purchaseTypeLabel(totals.purchaseType),
    po.po_number,
    po.supplier,
    totals.purchaseType === 'middleman' ? po.middleman_name : '',
    line.product_name || line.product_sku,
    line.order_qty,
    line.factory_unit_cost,
    line.commission_percent,
    line.commission_per_unit,
    line.commission_total,
    line.shipping_allocation,
    line.other_cost_allocation,
    line.final_unit_cost,
    line.final_line_cost,
    totals.totalProductCost,
    totals.totalCommission,
    totals.shippingCost,
    totals.otherCost,
    totals.grandTotal,
  ])
}

export function buildPoCsvRows(po, items, allocatedLines) {
  return buildInternalCsvRows(po, allocatedLines, calcPoTotals(po, items))
}

export function poReportSummary(purchaseOrders, purchaseOrderItems) {
  return (purchaseOrders || []).map(po => {
    const items = poItemsForOrder(purchaseOrderItems, po.id)
    const type = resolvePurchaseType(po, items)
    return {
      id: po.id,
      po_number: po.po_number,
      supplier: po.supplier,
      purchase_type: purchaseTypeLabel(type),
      total_units: Number(po.total_ordered_units) || 0,
      product_cost: Number(po.total_product_cost) || 0,
      commission: type === 'middleman' ? Number(po.total_commission) || 0 : 0,
      shipping: Number(po.shipping_cost) || 0,
      grand_total: Number(po.grand_total) || 0,
      total_purchase_cost: Number(po.grand_total) || 0,
      status: po.status,
      currency: po.currency,
    }
  })
}

export function middlemanCommissionReport(purchaseOrders, purchaseOrderItems, dateFrom, dateTo) {
  const rows = []
  for (const po of purchaseOrders || []) {
    const items = poItemsForOrder(purchaseOrderItems, po.id)
    if (!isMiddlemanPo(po, items)) continue
    if (dateFrom && String(po.order_date || '') < dateFrom) continue
    if (dateTo && String(po.order_date || '') > dateTo) continue
    const purchaseType = resolvePurchaseType(po, items)
    for (const line of items.map(l => calcLineItem(l, purchaseType))) {
      rows.push({
        id: `${po.id}-${line.id}`,
        date: po.order_date,
        middleman: po.middleman_name,
        po_number: po.po_number,
        product: line.product_sku || line.product_name,
        qty: line.order_qty,
        commission_percent: line.commission_percent,
        commission_total: line.commission_total,
        po_status: po.status,
        payment_status: po.commission_payment_status || deriveCommissionPaymentStatus(po),
      })
    }
  }
  return rows
}

export function incomingInventoryReport(purchaseOrders, purchaseOrderItems) {
  const rows = []
  for (const po of purchaseOrders || []) {
    if (po.status === 'Cancelled' || po.status === 'Received') continue
    const items = poItemsForOrder(purchaseOrderItems, po.id)
    for (const line of items) {
      const remaining = Math.max(Number(line.order_qty || 0) - Number(line.received_qty || 0), 0)
      if (remaining <= 0) continue
      rows.push({
        id: `${po.id}-${line.id}`,
        product: line.product_sku || line.product_name,
        ordered: line.order_qty,
        received: line.received_qty,
        remaining,
        eta: po.eta,
        supplier: po.supplier,
        po_number: po.po_number,
      })
    }
  }
  return rows
}

export function reportTotalsForCommission(rows) {
  return {
    totalCommission: rows.reduce((s, r) => s + Number(r.commission_total || 0), 0),
  }
}

export function reportTotalsForIncoming(rows) {
  return {
    totalOrderedUnits: rows.reduce((s, r) => s + Number(r.ordered || 0), 0),
    totalReceivedUnits: rows.reduce((s, r) => s + Number(r.received || 0), 0),
    totalRemainingUnits: rows.reduce((s, r) => s + Number(r.remaining || 0), 0),
  }
}

export function buildPoFromReorderItems(reorderItems, poNumber) {
  const header = blankPoHeader(poNumber)
  const lines = reorderItems.map(item => ({
    ...blankPoLine({ id: item.id, style: item.style, brand: item.brand }),
    order_qty: item.needToOrder,
  }))
  return { header, lines }
}

export function newPoId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `po-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function downloadCsv(filename, header, rows) {
  const csv = [header, ...rows].map(cols => cols.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
