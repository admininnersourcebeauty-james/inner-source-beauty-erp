export const TRACKING_CARRIERS = ['USPS', 'UPS', 'FedEx', 'DHL', 'Other']

export function blankTrackingRow() {
  return { carrier: 'USPS', tracking_number: '' }
}

export function normalizeCarrier(value) {
  const carrier = String(value ?? '').trim()
  if (!carrier) return ''
  if (TRACKING_CARRIERS.includes(carrier)) return carrier
  return 'Other'
}

export function sanitizeTrackingEntries(values) {
  const seen = new Set()
  const out = []
  for (const raw of values || []) {
    const tracking_number = String(raw?.tracking_number ?? raw ?? '').trim()
    if (!tracking_number) continue
    const key = tracking_number.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      carrier: normalizeCarrier(raw?.carrier),
      tracking_number,
    })
  }
  return out
}

/** @deprecated use sanitizeTrackingEntries */
export function sanitizeTrackingNumbers(values) {
  return sanitizeTrackingEntries(values).map(r => r.tracking_number)
}

export function primaryTrackingValue(values, legacyTracking = '') {
  const cleaned = sanitizeTrackingEntries(values)
  if (cleaned.length) return cleaned[0].tracking_number
  const legacy = String(legacyTracking ?? '').trim()
  return legacy
}

export function trackingEntriesForOrder(trackingRows, orderId, legacyTracking = '') {
  const rows = (trackingRows || [])
    .filter(r => String(r.order_id) === String(orderId))
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
    .map(r => ({
      carrier: normalizeCarrier(r.carrier),
      tracking_number: String(r.tracking_number || '').trim(),
    }))
    .filter(r => r.tracking_number)

  if (rows.length) return rows

  const legacy = String(legacyTracking ?? '').trim()
  return legacy ? [{ carrier: '', tracking_number: legacy }] : []
}

/** @deprecated use trackingEntriesForOrder */
export function trackingNumbersForOrder(trackingRows, orderId, legacyTracking = '') {
  return trackingEntriesForOrder(trackingRows, orderId, legacyTracking).map(r => r.tracking_number)
}

export function trackingEntriesToFormValues(trackingRows, orderId, legacyTracking = '') {
  const entries = trackingEntriesForOrder(trackingRows, orderId, legacyTracking)
  return entries.length ? entries : [blankTrackingRow()]
}

/** @deprecated use trackingEntriesToFormValues */
export function trackingNumbersToFormValues(trackingRows, orderId, legacyTracking = '') {
  return trackingEntriesToFormValues(trackingRows, orderId, legacyTracking).map(r => r.tracking_number)
}

export function buildTrackingInsertRows(orderId, values) {
  return sanitizeTrackingEntries(values).map(({ carrier, tracking_number }) => ({
    order_id: orderId,
    carrier: carrier || '',
    tracking_number,
  }))
}

export function formatTrackingScreenLine(entry) {
  const num = String(entry?.tracking_number ?? '').trim()
  if (!num) return ''
  const carrier = normalizeCarrier(entry?.carrier)
  return carrier ? `${carrier} — ${num}` : num
}

export function formatTrackingPrintLine(entry) {
  const num = String(entry?.tracking_number ?? '').trim()
  if (!num) return ''
  const carrier = normalizeCarrier(entry?.carrier)
  return carrier ? `${carrier}: ${num}` : num
}

export function shipmentStatusLabel(order, entries) {
  if ((entries || []).length) return 'Shipped'
  if (order?.fulfillment_date) return 'Shipped'
  return 'Pending'
}
