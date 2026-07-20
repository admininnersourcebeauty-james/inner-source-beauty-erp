export const PO_STATUSES = [
  'Draft', 'Submitted', 'In Production', 'Shipped', 'Partially Received', 'Received', 'Cancelled',
]

export const PO_FILTER_STATUSES = ['All', ...PO_STATUSES]

export const PO_CURRENCIES = ['KRW', 'USD']

export const PO_PURCHASE_TYPES = [
  { value: 'direct', label: 'Direct Purchase' },
  { value: 'middleman', label: 'Through Middleman' },
]

/** Stored DB values (see purchase_orders_purchase_type_check): 'direct' | 'middleman' */
export const PO_TYPE_DIRECT = 'direct'
export const PO_TYPE_MIDDLEMAN = 'middleman'

export const COMMISSION_PAYMENT_STATUSES = ['Unpaid', 'Partial', 'Paid']

export const COMMISSION_PAYMENT_METHODS = [
  'Wire Transfer', 'Bank Transfer', 'ACH', 'Cash', 'Check', 'Zelle', 'Venmo', 'Other',
]

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

export function isMiddlemanPurchaseType(purchaseType) {
  return String(purchaseType || '').trim().toLowerCase() === PO_TYPE_MIDDLEMAN
}

export function resolvePurchaseType(po, items) {
  const stored = String(po?.purchase_type || '').trim().toLowerCase()
  if (stored === PO_TYPE_MIDDLEMAN || stored === PO_TYPE_DIRECT) return stored
  const hasMiddlemanName = String(po?.middleman_name || '').trim().length > 0
  const list = items || []
  const hasCommission = Number(po?.total_commission) > 0
    || list.some(i => Number(i.middleman_commission_unit_krw) > 0
      || Number(i.commission_percent) > 0
      || Number(i.commission_total) > 0
      || Number(i.commission_total_usd) > 0)
  return (hasMiddlemanName || hasCommission) ? PO_TYPE_MIDDLEMAN : PO_TYPE_DIRECT
}

export function isMiddlemanPo(po, items) {
  return isMiddlemanPurchaseType(resolvePurchaseType(po, items))
}

export function purchaseTypeLabel(type) {
  return PO_PURCHASE_TYPES.find(t => t.value === type)?.label || 'Direct Purchase'
}

export function resolveExchangeRate(currency, exchangeRate) {
  if (currency === 'USD') return 1
  return Math.max(Number(exchangeRate) || 0, 0)
}

export function resolveFactoryUnitCostUsd(item, currency, exchangeRate) {
  const hasSaved = item?.factory_unit_cost_usd != null && Number(item.factory_unit_cost_usd) > 0
  if (hasSaved) return Number(item.factory_unit_cost_usd)
  const original = Math.max(Number(item?.korean_unit_cost ?? item?.factory_unit_cost_original) || 0, 0)
  return convertToUsd(original, currency || 'KRW', exchangeRate)
}

export function calcPoUsdTotalsFromItems(items, po) {
  const currency = po?.currency || 'KRW'
  const exchangeRate = resolveExchangeRate(currency, po?.exchange_rate)
  const purchaseType = resolvePurchaseType(po, items)
  let productCostUsd = 0
  let commissionUsd = 0
  for (const raw of items || []) {
    const line = calcLineItem(raw, purchaseType, currency, exchangeRate)
    productCostUsd += line.product_cost_usd
    if (isMiddlemanPurchaseType(purchaseType)) {
      commissionUsd += line.commission_total_usd
    }
  }
  return { productCostUsd, commissionUsd, purchaseType, currency, exchangeRate }
}

export function convertToUsd(amount, currency, exchangeRate) {
  const value = Number(amount) || 0
  if (currency === 'USD') return value
  const rate = resolveExchangeRate(currency, exchangeRate)
  if (rate <= 0) return 0
  return value / rate
}

export function factoryUnitCostLabel(currency) {
  return currency === 'USD' ? 'Factory Unit Cost (USD)' : `Factory Unit Cost (${currency || 'KRW'})`
}

export function factoryProductCostLabel(currency) {
  return currency === 'USD' ? 'Factory Product Cost (USD)' : `Factory Product Cost (${currency || 'KRW'})`
}

export const MIDDLEMAN_COMMISSION_UNIT_LABEL = 'Middleman Commission Per Unit (KRW)'

/** Load saved lines into the PO form: map legacy DB fields → middleman_commission_unit_krw only. */
export function preparePoFormLines(lines, exchangeRate = 1350) {
  const rate = Math.max(Number(exchangeRate) || 0, 0)
  return (lines || []).map(line => {
    let commissionKrw = line.middleman_commission_unit_krw
    if (commissionKrw == null || commissionKrw === '') {
      const savedUsd = Math.max(Number(line.commission_per_unit_usd ?? line.commission_per_unit) || 0, 0)
      if (savedUsd > 0 && rate > 0) {
        commissionKrw = savedUsd * rate
      } else {
        commissionKrw = ''
      }
    }
    return {
      ...line,
      middleman_commission_unit_krw: commissionKrw,
      commission_percent: 0,
    }
  })
}

export function totalUnitCostLabel(currency) {
  return currency === 'USD' ? 'Total Unit Cost (USD)' : 'Total Unit Cost (KRW)'
}

export function calcLineItem(raw, purchaseType, currency = 'KRW', exchangeRate = 1) {
  const orderQty = Math.max(Number(raw.order_qty) || 0, 0)
  const curr = currency || 'KRW'
  const rate = resolveExchangeRate(curr, exchangeRate)
  const factoryUnitKrw = Math.max(Number(raw.korean_unit_cost) || 0, 0)
  const isMiddleman = isMiddlemanPurchaseType(purchaseType)
  const commissionUnitKrw = isMiddleman ? Math.max(Number(raw.middleman_commission_unit_krw) || 0, 0) : 0
  const receivedQty = Math.max(Number(raw.received_qty) || 0, 0)
  const factoryUnitUsd = rate > 0 ? factoryUnitKrw / rate : 0
  const commissionPerUnitUsd = isMiddleman && rate > 0 ? commissionUnitKrw / rate : 0
  const commissionUnitUsdStored = commissionPerUnitUsd
  const totalUnitCostKrw = factoryUnitKrw + commissionUnitKrw
  const totalUnitCostUsd = rate > 0 ? totalUnitCostKrw / rate : 0
  const productCostOriginal = orderQty * factoryUnitKrw
  const productCostUsd = orderQty * factoryUnitUsd
  const commissionTotalKrw = orderQty * commissionUnitKrw
  const commissionTotalUsd = commissionPerUnitUsd * orderQty
  const totalLineCostUsd = totalUnitCostUsd * orderQty
  const remainingQty = Math.max(orderQty - receivedQty, 0)
  return {
    ...raw,
    order_qty: orderQty,
    korean_unit_cost: factoryUnitKrw,
    factory_unit_cost: factoryUnitKrw,
    factory_unit_cost_original: factoryUnitKrw,
    factory_unit_cost_krw: factoryUnitKrw,
    factory_unit_cost_usd: factoryUnitUsd,
    middleman_commission_unit_krw: commissionUnitKrw,
    middleman_commission_unit_usd: commissionUnitUsdStored,
    middleman_commission_total_krw: commissionTotalKrw,
    middleman_commission_total_usd: commissionTotalUsd,
    total_unit_cost_krw: totalUnitCostKrw,
    total_unit_cost_usd: totalUnitCostUsd,
    commission_percent: 0,
    commission_per_unit: commissionPerUnitUsd,
    commission_per_unit_usd: commissionPerUnitUsd,
    product_cost: productCostOriginal,
    product_cost_usd: productCostUsd,
    commission_total: commissionTotalUsd,
    commission_total_usd: commissionTotalUsd,
    total_line_cost: totalLineCostUsd,
    total_line_cost_usd: totalLineCostUsd,
    total_purchase_cost_usd: totalLineCostUsd,
    received_qty: receivedQty,
    remaining_qty: remainingQty,
  }
}

export function calcPoTotals(header, lines, receives) {
  const purchaseType = resolvePurchaseType(header, lines)
  const currency = header.currency || 'KRW'
  const exchangeRate = resolveExchangeRate(currency, header.exchange_rate)
  const computed = (lines || []).map(l => calcLineItem(l, purchaseType, currency, exchangeRate))
  const totalOrderedUnits = computed.reduce((s, l) => s + l.order_qty, 0)
  const totalProductCost = computed.reduce((s, l) => s + l.product_cost, 0)
  const totalProductCostUsd = computed.reduce((s, l) => s + l.product_cost_usd, 0)
  const totalCommissionUsd = isMiddlemanPurchaseType(purchaseType)
    ? computed.reduce((s, l) => s + l.commission_total_usd, 0)
    : 0
  const totalCommissionOriginal = isMiddlemanPurchaseType(purchaseType)
    ? computed.reduce((s, l) => s + (l.middleman_commission_total_krw || 0), 0)
    : 0
  const receivedShipping = sumReceiveCosts(receives).shippingCost
  const receivedOther = sumReceiveCosts(receives).otherCost
  const shippingCost = receivedShipping || Math.max(Number(header.shipping_cost) || 0, 0)
  const otherCost = receivedOther || Math.max(Number(header.other_cost) || 0, 0)
  const totalPurchaseCostUsd = totalProductCostUsd + totalCommissionUsd + shippingCost + otherCost
  const grandTotalOriginal = totalProductCost + totalCommissionOriginal + (currency === 'USD' ? shippingCost + otherCost : 0)
  const grandTotal = totalPurchaseCostUsd
  return {
    lines: computed,
    purchaseType,
    totalOrderedUnits,
    totalProductCost,
    totalProductCostUsd,
    totalCommission: totalCommissionUsd,
    totalCommissionOriginal,
    totalCommissionUsd,
    shippingCost,
    otherCost,
    grandTotal,
    grandTotalOriginal,
    totalPurchaseCost: totalPurchaseCostUsd,
    totalPurchaseCostUsd,
    estimatedGrandTotalUsd: totalPurchaseCostUsd,
    currency,
    exchangeRate,
  }
}

export function sumReceiveCosts(receives) {
  const list = receives || []
  return {
    shippingCost: list.reduce((s, r) => s + Math.max(Number(r.shipping_cost) || 0, 0), 0),
    otherCost: list.reduce((s, r) => s + Math.max(Number(r.other_cost) || 0, 0), 0),
  }
}

export function allocateReceiveCosts(receiveLines, shippingCost, otherCost, purchaseType = 'direct') {
  const isMiddleman = isMiddlemanPurchaseType(purchaseType)
  const active = (receiveLines || []).filter(l => Number(l.receive_now) > 0)
  const lineUnitUsd = (line) => {
    const factoryUnitUsd = Math.max(Number(line.factory_unit_cost_usd ?? line.factory_unit_cost) || 0, 0)
    const commissionPerUnit = isMiddleman
      ? Math.max(Number(line.commission_per_unit_usd ?? line.commission_per_unit) || 0, 0)
      : 0
    const totalUnitUsd = Math.max(Number(line.total_unit_cost_usd) || 0, factoryUnitUsd + commissionPerUnit)
    return { factoryUnitUsd, commissionPerUnit, totalUnitUsd }
  }
  const totalReceivedValue = active.reduce(
    (s, l) => s + Number(l.receive_now) * lineUnitUsd(l).totalUnitUsd,
    0,
  ) || 1
  return active.map(line => {
    const receiveQty = Math.max(Number(line.receive_now) || 0, 0)
    const { factoryUnitUsd, commissionPerUnit, totalUnitUsd } = lineUnitUsd(line)
    const itemValue = receiveQty * totalUnitUsd
    const share = itemValue / totalReceivedValue
    const shippingAllocation = shippingCost * share
    const otherCostAllocation = otherCost * share
    const shippingPerUnit = receiveQty > 0 ? shippingAllocation / receiveQty : 0
    const otherPerUnit = receiveQty > 0 ? otherCostAllocation / receiveQty : 0
    const landedUnitCost = totalUnitUsd + shippingPerUnit + otherPerUnit
    return {
      ...line,
      receive_now: receiveQty,
      factory_unit_cost: factoryUnitUsd,
      factory_unit_cost_usd: factoryUnitUsd,
      commission_per_unit: commissionPerUnit,
      commission_per_unit_usd: commissionPerUnit,
      total_unit_cost_usd: totalUnitUsd,
      shipping_allocation: shippingAllocation,
      other_cost_allocation: otherCostAllocation,
      landed_unit_cost: landedUnitCost,
      final_unit_cost: landedUnitCost,
    }
  })
}

export function calcWeightedBuyingPrice(oldQty, oldBuyingPrice, receiveQty, landedUnitCost) {
  const oq = Math.max(Number(oldQty) || 0, 0)
  const rq = Math.max(Number(receiveQty) || 0, 0)
  const landed = Number(landedUnitCost) || 0
  if (rq <= 0) return Number(oldBuyingPrice) || 0
  if (oq <= 0) return landed
  const ob = Number(oldBuyingPrice) || 0
  return ((oq * ob) + (rq * landed)) / (oq + rq)
}

export function allocateLineCosts(lines, shippingCost, otherCost, purchaseType = 'direct', currency = 'KRW', exchangeRate = 1) {
  const isMiddleman = isMiddlemanPurchaseType(purchaseType)
  const computed = (lines || []).map(l => calcLineItem(l, purchaseType, currency, exchangeRate))
  const totalProductCostUsd = computed.reduce((s, l) => s + l.product_cost_usd, 0) || 1
  return computed.map(line => {
    const share = line.product_cost_usd / totalProductCostUsd
    const shippingAllocation = shippingCost * share
    const otherCostAllocation = otherCost * share
    const commissionPerUnit = isMiddleman ? line.commission_per_unit_usd : 0
    const shippingPerUnit = line.order_qty > 0 ? shippingAllocation / line.order_qty : 0
    const otherPerUnit = line.order_qty > 0 ? otherCostAllocation / line.order_qty : 0
    const totalUnitUsd = line.total_unit_cost_usd || (line.factory_unit_cost_usd + commissionPerUnit)
    const finalUnitCost = totalUnitUsd + shippingPerUnit + otherPerUnit
    const finalLineCost = finalUnitCost * line.order_qty
    return {
      ...line,
      shipping_allocation: shippingAllocation,
      other_cost_allocation: otherCostAllocation,
      final_unit_cost: finalUnitCost,
      final_line_cost: finalLineCost,
      landed_unit_cost: finalUnitCost,
      estimated_landed_cost: finalUnitCost,
    }
  })
}

export function validatePoSave(header, lines) {
  const purchaseType = header.purchase_type || 'direct'
  const currency = header.currency || 'KRW'
  if (!String(header.supplier || '').trim()) return 'Supplier is required.'
  if (isMiddlemanPurchaseType(purchaseType) && !String(header.middleman_name || '').trim()) {
    return 'Middleman Name is required for Through Middleman purchase orders.'
  }
  if (currency !== 'USD' && resolveExchangeRate(currency, header.exchange_rate) <= 0) {
    return 'Exchange Rate must be greater than 0.'
  }
  const computed = calcPoTotals(header, lines)
  if (!computed.lines.length) return 'Add at least one product line.'
  for (const line of computed.lines) {
    if (line.order_qty < 0) return 'Quantity cannot be negative.'
    if (line.factory_unit_cost_original < 0) return 'Factory Unit Cost cannot be negative.'
    if (isMiddlemanPurchaseType(purchaseType) && line.middleman_commission_unit_krw < 0) {
      return 'Middleman Commission Per Unit cannot be negative.'
    }
    if (line.order_qty <= 0) return 'Each product line must have Order Qty greater than 0.'
  }
  return ''
}

export function validateReceiveExchangeRate(po) {
  const currency = po?.currency || 'KRW'
  if (currency === 'USD') return ''
  if (resolveExchangeRate(currency, po?.exchange_rate) <= 0) {
    return 'Exchange Rate must be greater than 0. Edit the purchase order and set a valid exchange rate before receiving inventory.'
  }
  return ''
}

export function normalizePoSavePayload(header, lines, existingPo) {
  const purchaseType = header.purchase_type || 'direct'
  const currency = header.currency || 'KRW'
  const accumulatedShipping = Number(existingPo?.shipping_cost) || 0
  const accumulatedOther = Number(existingPo?.other_cost) || 0
  const totals = calcPoTotals(
    {
      ...header,
      purchase_type: purchaseType,
      exchange_rate: currency === 'USD' ? 1 : header.exchange_rate,
      shipping_cost: accumulatedShipping,
      other_cost: accumulatedOther,
    },
    lines,
    existingPo?.receives,
  )
  const normalizedLines = totals.lines.map(line => ({
    ...line,
    middleman_commission_unit_krw: isMiddlemanPurchaseType(purchaseType) ? line.middleman_commission_unit_krw : 0,
    middleman_commission_unit_usd: isMiddlemanPurchaseType(purchaseType) ? line.middleman_commission_unit_usd : 0,
    middleman_commission_total_krw: isMiddlemanPurchaseType(purchaseType) ? line.middleman_commission_total_krw : 0,
    middleman_commission_total_usd: isMiddlemanPurchaseType(purchaseType) ? line.middleman_commission_total_usd : 0,
    total_unit_cost_krw: isMiddlemanPurchaseType(purchaseType) ? line.total_unit_cost_krw : line.factory_unit_cost_original,
    total_unit_cost_usd: line.total_unit_cost_usd,
    commission_percent: 0,
    commission_per_unit: isMiddlemanPurchaseType(purchaseType) ? line.commission_per_unit_usd : 0,
    commission_per_unit_usd: isMiddlemanPurchaseType(purchaseType) ? line.commission_per_unit_usd : 0,
    commission_total: isMiddlemanPurchaseType(purchaseType) ? line.commission_total_usd : 0,
    commission_total_usd: isMiddlemanPurchaseType(purchaseType) ? line.commission_total_usd : 0,
    total_line_cost: line.total_line_cost_usd,
    total_line_cost_usd: line.total_line_cost_usd,
  }))
  const grandTotalUsd = totals.totalProductCostUsd + totals.totalCommissionUsd + accumulatedShipping + accumulatedOther
  return {
    header: {
      ...header,
      purchase_type: purchaseType,
      middleman_name: isMiddlemanPurchaseType(purchaseType) ? (header.middleman_name || '') : '',
      exchange_rate: currency === 'USD' ? 1 : resolveExchangeRate(currency, header.exchange_rate),
      shipping_cost: accumulatedShipping,
      other_cost: accumulatedOther,
      total_product_cost: totals.totalProductCost,
      total_commission: totals.totalCommissionUsd,
      total_product_cost_usd: totals.totalProductCostUsd,
      total_purchase_cost_usd: grandTotalUsd,
      grand_total: grandTotalUsd,
    },
    lines: normalizedLines,
    totals: {
      ...totals,
      shippingCost: accumulatedShipping,
      otherCost: accumulatedOther,
      grandTotal: grandTotalUsd,
      totalPurchaseCost: grandTotalUsd,
      totalPurchaseCostUsd: grandTotalUsd,
    },
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

export function poCommissionPaymentsForOrder(payments, poId) {
  return (payments || [])
    .filter(p => String(p.purchase_order_id) === String(poId))
    .sort((a, b) => {
      const dateCmp = String(b.payment_date || '').localeCompare(String(a.payment_date || ''))
      if (dateCmp !== 0) return dateCmp
      return String(b.created_at || '').localeCompare(String(a.created_at || ''))
    })
}

export function totalCommissionPaid(payments, po) {
  const list = payments || []
  if (list.length) {
    return list.reduce((s, p) => s + Math.max(Number(p.amount) || 0, 0), 0)
  }
  return Number(po?.commission_amount_paid) || 0
}

export function commissionPaymentsChronological(payments) {
  return [...(payments || [])].sort((a, b) => {
    const dateCmp = String(a.payment_date || '').localeCompare(String(b.payment_date || ''))
    if (dateCmp !== 0) return dateCmp
    return String(a.created_at || '').localeCompare(String(b.created_at || ''))
  })
}

export function commissionPaymentReceiptTotals(po, items, payments, paymentId) {
  const due = commissionAmountDue(po, items)
  const chronological = commissionPaymentsChronological(payments)
  const idx = chronological.findIndex(p => String(p.id) === String(paymentId))
  if (idx < 0) return null
  const paidAfter = chronological
    .slice(0, idx + 1)
    .reduce((s, p) => s + Math.max(Number(p.amount) || 0, 0), 0)
  const balance = Math.max(due - paidAfter, 0)
  let status = 'Unpaid'
  if (due <= 0) status = 'Paid'
  else if (paidAfter <= 0) status = 'Unpaid'
  else if (balance <= 0.001) status = 'Paid'
  else status = 'Partial'
  return { due, paidAfter, balance, status }
}

export function formatPrintDate(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function commissionPaymentSummary(po, items, payments) {
  if (!isMiddlemanPo(po, items)) {
    return { due: 0, paid: 0, balance: 0, status: 'Paid' }
  }
  const due = commissionAmountDue(po, items)
  const paid = totalCommissionPaid(payments, po)
  const balance = Math.max(due - paid, 0)
  let status = 'Unpaid'
  if (due <= 0) status = 'Paid'
  else if (paid <= 0) status = 'Unpaid'
  else if (balance <= 0.001) status = 'Paid'
  else status = 'Partial'
  return { due, paid, balance, status }
}

export function commissionBalance(po, items, payments) {
  return commissionPaymentSummary(po, items, payments).balance
}

export function commissionAmountDue(po, items) {
  if (!isMiddlemanPo(po, items)) return 0
  if (items?.length) {
    const currency = po?.currency || 'KRW'
    const rate = resolveExchangeRate(currency, po?.exchange_rate)
    return items.reduce((s, raw) => {
      const line = calcLineItem(raw, 'middleman', currency, rate)
      return s + line.commission_total_usd
    }, 0)
  }
  return Number(po?.total_commission) || 0
}

export function deriveCommissionPaymentStatus(po, items, payments) {
  return commissionPaymentSummary(po, items, payments).status
}

export function blankCommissionPaymentEntry() {
  return {
    amount: '',
    payment_date: '',
    payment_method: 'Wire Transfer',
    reference_number: '',
    notes: '',
  }
}

export function validateCommissionPaymentEntry(entry) {
  const amount = Number(entry?.amount) || 0
  if (amount <= 0) return 'Amount Paid must be greater than 0.'
  if (!String(entry?.payment_date || '').trim()) return 'Payment Date is required.'
  if (!String(entry?.payment_method || '').trim()) return 'Payment Method is required.'
  return ''
}

export function poItemsForOrder(purchaseOrderItems, poId) {
  return (purchaseOrderItems || []).filter(i => String(i.purchase_order_id) === String(poId))
}

export function poReceiptsForOrder(purchaseOrderReceipts, poId) {
  return (purchaseOrderReceipts || []).filter(r => String(r.purchase_order_id) === String(poId))
}

export function poReceivesForOrder(purchaseOrderReceives, poId) {
  return (purchaseOrderReceives || [])
    .filter(r => String(r.purchase_order_id) === String(poId))
    .sort((a, b) => String(a.received_date || a.created_at || '').localeCompare(String(b.received_date || b.created_at || '')))
}

export function nextReceiveNumber(receives, poNumber) {
  const list = receives || []
  let max = 0
  for (const r of list) {
    const match = String(r.receive_number || '').match(/-R(\d+)$/i)
    if (match) max = Math.max(max, parseInt(match[1], 10))
  }
  return `${poNumber || 'PO'}-R${String(max + 1).padStart(2, '0')}`
}

export function validateReceive(header, lines, items, po) {
  const exchangeError = validateReceiveExchangeRate(po)
  if (exchangeError) return exchangeError
  const payload = (lines || []).filter(l => Number(l.receive_now) > 0)
  if (!payload.length) return 'At least one item must be received.'
  if (Math.max(Number(header.shipping_cost) || 0, 0) < 0) return 'Shipping Cost cannot be negative.'
  if (Math.max(Number(header.other_cost) || 0, 0) < 0) return 'Other Cost cannot be negative.'
  for (const row of payload) {
    const item = (items || []).find(i => String(i.id) === String(row.purchase_order_item_id))
    if (!item) return 'PO line item not found.'
    const receiveNow = Number(row.receive_now)
    if (receiveNow < 0) return 'Receiving quantity cannot be negative.'
    if (receiveNow > item.remaining_qty) {
      return `Cannot receive ${receiveNow} when only ${item.remaining_qty} remaining for ${item.product_sku || item.product_name}.`
    }
  }
  return ''
}

export function receiveHistoryRows(receives, receipts, items) {
  const receiveList = receives || []
  if (receiveList.length) {
    return receiveList.map(rec => {
      const recReceipts = (receipts || []).filter(r => String(r.receive_id) === String(rec.id))
      const receivedQty = recReceipts.reduce((s, r) => s + Number(r.received_qty || 0), 0)
      return {
        ...rec,
        received_qty: receivedQty,
        receipts: recReceipts,
        items: recReceipts.map(r => {
          const line = (items || []).find(i => String(i.id) === String(r.purchase_order_item_id))
          return {
            ...r,
            product: line?.product_sku || line?.product_name || r.product_sku || '—',
          }
        }),
      }
    })
  }
  const legacy = (receipts || []).filter(r => !r.receive_id)
  if (!legacy.length) return []
  const groups = new Map()
  for (const r of legacy) {
    const key = `${String(r.received_date || '').slice(0, 19)}|${r.received_by || ''}`
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        receive_number: 'Legacy',
        received_date: r.received_date,
        shipment_number: '',
        shipping_cost: 0,
        other_cost: 0,
        other_cost_description: '',
        notes: r.note || '',
        received_by: r.received_by || '',
        receipts: [],
        legacy: true,
      })
    }
    groups.get(key).receipts.push(r)
  }
  return [...groups.values()].map(g => ({
    ...g,
    received_qty: g.receipts.reduce((s, r) => s + Number(r.received_qty || 0), 0),
    items: g.receipts.map(r => {
      const line = (items || []).find(i => String(i.id) === String(r.purchase_order_item_id))
      return { ...r, product: line?.product_sku || line?.product_name || '—' }
    }),
  }))
}

export function internalCostSummary(po, items, receives, receipts) {
  const purchaseType = resolvePurchaseType(po, items)
  const totals = calcPoTotals(po, items, receives)
  const history = receiveHistoryRows(receives, receipts, items)
  const receivedLines = (receipts || []).map(r => {
    const line = (items || []).find(i => String(i.id) === String(r.purchase_order_item_id))
    return {
      ...r,
      product: line?.product_sku || line?.product_name || '—',
      order_qty: line?.order_qty,
    }
  })
  return {
    purchaseType,
    totals,
    history,
    receivedLines,
    grandTotal: totals.grandTotal,
  }
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
    totalOrderedAmount: openPos.reduce((s, po) => s + Number(po.total_purchase_cost_usd ?? po.grand_total) || 0, 0),
    incomingUnits: openItems.reduce((s, l) => s + Math.max(Number(l.order_qty || 0) - Number(l.received_qty || 0), 0), 0),
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
      middleman_commission_unit_krw: '',
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
    middleman_commission_unit_krw: '',
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
    line.factory_unit_cost_original ?? line.factory_unit_cost,
    line.product_cost,
    po.eta,
    po.notes,
  ])
}

export function buildInternalCsvRows(po, summary) {
  const { totals, history, receivedLines } = summary
  const rows = []
  for (const rec of history) {
    for (const item of rec.items || []) {
      rows.push([
        purchaseTypeLabel(totals.purchaseType),
        po.po_number,
        rec.receive_number,
        rec.received_date,
        rec.shipment_number,
        item.product,
        item.received_qty,
        item.factory_unit_cost,
        item.commission_per_unit,
        item.shipping_allocation,
        item.other_cost_allocation,
        item.landed_unit_cost,
        rec.shipping_cost,
        rec.other_cost,
        rec.other_cost_description,
      ])
    }
  }
  if (!rows.length && receivedLines.length) {
    for (const item of receivedLines) {
      rows.push([
        purchaseTypeLabel(totals.purchaseType),
        po.po_number,
        'Legacy',
        item.received_date,
        '',
        item.product,
        item.received_qty,
        item.factory_unit_cost || item.korean_unit_cost,
        item.commission_per_unit,
        item.shipping_allocation,
        item.other_cost_allocation,
        item.landed_unit_cost,
        '',
        '',
        '',
      ])
    }
  }
  if (!rows.length) {
    rows.push([
      purchaseTypeLabel(totals.purchaseType),
      po.po_number,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      totals.shippingCost,
      totals.otherCost,
      '',
    ])
  }
  rows.push([
    'TOTALS', po.po_number, '', '', '', '', '', '', '', '', '', '',
    totals.totalProductCost,
    totals.totalProductCostUsd,
    totals.exchangeRate,
    totals.totalCommissionUsd,
    totals.shippingCost,
    totals.otherCost,
    totals.totalPurchaseCostUsd,
  ])
  return rows
}

export function buildPoCsvRows(po, items, receives, receipts) {
  return buildInternalCsvRows(po, internalCostSummary(po, items, receives, receipts))
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
      commission: isMiddlemanPurchaseType(type) ? Number(po.total_commission) || 0 : 0,
      shipping: Number(po.shipping_cost) || 0,
      grand_total: Number(po.grand_total) || 0,
      total_purchase_cost: Number(po.total_purchase_cost_usd ?? po.grand_total) || 0,
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
    for (const line of items.map(l => calcLineItem(l, purchaseType, po.currency, po.exchange_rate))) {
      rows.push({
        id: `${po.id}-${line.id}`,
        date: po.order_date,
        middleman: po.middleman_name,
        po_number: po.po_number,
        product: line.product_sku || line.product_name,
        qty: line.order_qty,
        commission_unit_krw: line.middleman_commission_unit_krw,
        commission_total: line.commission_total_usd,
        po_status: po.status,
        payment_status: po.commission_payment_status || deriveCommissionPaymentStatus(po, items, null),
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
