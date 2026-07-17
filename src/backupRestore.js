import JSZip from 'jszip'

export const CORE_BACKUP_TABLES = ['customers', 'inventory', 'orders', 'payments']
export const PO_BACKUP_TABLES = ['purchase_orders', 'purchase_order_items', 'purchase_order_receipts']
export const BACKUP_TABLES = [...CORE_BACKUP_TABLES, ...PO_BACKUP_TABLES]
export const BACKUP_VERSION = 2
export const APP_NAME = 'INNER SOURCE BEAUTY ERP'
export const LAST_BACKUP_KEY = 'isb_last_backup_at'

const PROFILE_SAFE_KEYS = ['id', 'email', 'role', 'created_at']
const SENSITIVE_KEY = /password|token|secret|api_key|service_role|anon_key|env/i

const TABLE_REQUIRED = {
  customers: ['id'],
  inventory: ['id'],
  orders: ['id', 'invoice_no'],
  payments: ['id'],
  purchase_orders: ['id', 'po_number'],
  purchase_order_items: ['id', 'purchase_order_id'],
  purchase_order_receipts: ['id', 'purchase_order_id', 'purchase_order_item_id'],
}

const TABLE_NUMERIC = {
  customers: [],
  inventory: ['qty', 'buying_price', 'selling_price', 'cost', 'price', 'retail', 'low_stock', 'reorder_limit', 'shipping_cost'],
  orders: ['customer_id', 'inventory_id', 'qty', 'price', 'buying_price', 'profit', 'shipping', 'discount', 'total', 'shipping_cost', 'allocated_qty', 'backorder_qty', 'shipped_qty'],
  payments: ['customer_id', 'order_id', 'amount'],
  purchase_orders: ['exchange_rate', 'shipping_cost', 'other_cost', 'total_ordered_units', 'total_product_cost', 'total_commission', 'grand_total', 'commission_amount_paid'],
  purchase_order_items: ['inventory_id', 'order_qty', 'korean_unit_cost', 'commission_percent', 'commission_per_unit', 'product_cost', 'commission_total', 'total_line_cost', 'received_qty'],
  purchase_order_receipts: ['inventory_id', 'received_qty', 'inventory_before', 'inventory_after'],
}

const TABLE_DATES = {
  customers: ['created_at'],
  inventory: ['created_at', 'expiration_date'],
  orders: ['created_at', 'due_date', 'order_date', 'fulfillment_date', 'voided_at'],
  payments: ['created_at', 'payment_date'],
  purchase_orders: ['created_at', 'order_date', 'eta', 'commission_payment_date', 'updated_at'],
  purchase_order_items: ['created_at'],
  purchase_order_receipts: ['created_at', 'received_date'],
}

export function backupZipFilename() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `INNER_SOURCE_BEAUTY_ERP_Backup_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.zip`
}

export function rowsToJson(rows) {
  return JSON.stringify(rows || [], null, 2)
}

export function parseJsonTable(text, label) {
  let parsed
  try {
    parsed = JSON.parse(String(text || '[]'))
  } catch {
    throw new Error(`Invalid JSON in ${label}.`)
  }
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array.`)
  return parsed
}

export function sanitizeProfiles(rows) {
  return (rows || []).map(row => {
    const out = {}
    for (const k of PROFILE_SAFE_KEYS) {
      if (row[k] != null && row[k] !== '' && !SENSITIVE_KEY.test(k)) out[k] = row[k]
    }
    return out
  })
}

export function buildManifest({ exportedBy, rowCounts }) {
  return {
    app_name: APP_NAME,
    backup_version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    exported_by: exportedBy || '',
    tables: [...BACKUP_TABLES],
    row_counts: rowCounts,
  }
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export function downloadJson(filename, rows) {
  const blob = new Blob([rowsToJson(rows)], { type: 'application/json;charset=utf-8' })
  downloadBlob(blob, filename)
}

export async function createFullBackupZip({ data, profiles, exportedBy, onProgress }) {
  onProgress?.('Preparing backup...')
  const rowCounts = {}
  const zip = new JSZip()
  for (const table of BACKUP_TABLES) {
    onProgress?.(`Exporting ${table}...`)
    const rows = data[table] || []
    rowCounts[table] = rows.length
    zip.file(`${table}.json`, rowsToJson(rows))
  }
  const safeProfiles = sanitizeProfiles(profiles)
  zip.file('profiles_reference_only.json', rowsToJson(safeProfiles))
  const manifest = buildManifest({ exportedBy, rowCounts })
  zip.file('backup_manifest.json', JSON.stringify(manifest, null, 2))
  onProgress?.('Creating ZIP...')
  const blob = await zip.generateAsync({ type: 'blob' })
  onProgress?.('Backup completed successfully.')
  return { blob, manifest, filename: backupZipFilename() }
}

export function saveLastBackupTime() {
  try { localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString()) } catch { /* ignore */ }
}

export function getLastBackupTime() {
  try { return localStorage.getItem(LAST_BACKUP_KEY) || '' } catch { return '' }
}

function isValidDateValue(v) {
  if (v == null || v === '') return true
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return true
  const d = new Date(s)
  return !Number.isNaN(d.getTime())
}

function isValidNumberValue(v) {
  if (v == null || v === '') return true
  return Number.isFinite(Number(v))
}

function isValidId(v) {
  if (v == null || String(v).trim() === '') return false
  return Number.isFinite(Number(v)) || String(v).trim().length > 0
}

export function validateRestoreRows(parsed, existingData = {}) {
  const errors = []
  const customerIds = new Set([
    ...(parsed.customers || []).map(r => String(r.id)),
    ...(existingData.customers || []).map(r => String(r.id)),
  ])
  const inventoryIds = new Set([
    ...(parsed.inventory || []).map(r => String(r.id)),
    ...(existingData.inventory || []).map(r => String(r.id)),
  ])
  const orderIds = new Set([
    ...(parsed.orders || []).map(r => String(r.id)),
    ...(existingData.orders || []).map(r => String(r.id)),
  ])
  const poIds = new Set([
    ...(parsed.purchase_orders || []).map(r => String(r.id)),
    ...(existingData.purchase_orders || []).map(r => String(r.id)),
  ])
  const poItemIds = new Set([
    ...(parsed.purchase_order_items || []).map(r => String(r.id)),
    ...(existingData.purchase_order_items || []).map(r => String(r.id)),
  ])

  const tablesToValidate = BACKUP_TABLES.filter(t => Array.isArray(parsed[t]))

  for (const table of tablesToValidate) {
    const rows = parsed[table] || []
    const required = TABLE_REQUIRED[table] || ['id']
    const numeric = TABLE_NUMERIC[table] || []
    const dates = TABLE_DATES[table] || []

    rows.forEach((row, idx) => {
      const rowNum = idx + 1
      for (const col of required) {
        if (row[col] == null || String(row[col]).trim() === '') {
          errors.push({ table, rowNum, reason: `Missing required field "${col}".` })
        }
      }
      if (!isValidId(row.id)) {
        errors.push({ table, rowNum, reason: 'Invalid or missing ID.' })
      }
      for (const col of numeric) {
        if (!isValidNumberValue(row[col])) {
          errors.push({ table, rowNum, reason: `Invalid numeric value in "${col}": ${row[col]}` })
        }
      }
      for (const col of dates) {
        if (!isValidDateValue(row[col])) {
          errors.push({ table, rowNum, reason: `Invalid date value in "${col}": ${row[col]}` })
        }
      }
      if (table === 'orders') {
        if (row.invoice_no != null && String(row.invoice_no).length > 200) {
          errors.push({ table, rowNum, reason: 'Invoice number is too long.' })
        }
        if (row.customer_id && String(row.customer_id).trim() && !customerIds.has(String(row.customer_id))) {
          errors.push({ table, rowNum, reason: `customer_id ${row.customer_id} not found in backup or current data.` })
        }
        if (row.inventory_id && String(row.inventory_id).trim() && !inventoryIds.has(String(row.inventory_id))) {
          errors.push({ table, rowNum, reason: `inventory_id ${row.inventory_id} not found in backup or current data.` })
        }
      }
      if (table === 'payments') {
        if (row.customer_id && String(row.customer_id).trim() && !customerIds.has(String(row.customer_id))) {
          errors.push({ table, rowNum, reason: `customer_id ${row.customer_id} not found in backup or current data.` })
        }
        if (row.order_id && String(row.order_id).trim() && !orderIds.has(String(row.order_id))) {
          errors.push({ table, rowNum, reason: `order_id ${row.order_id} not found in backup or current data.` })
        }
      }
      if (table === 'purchase_order_items') {
        if (row.purchase_order_id && !poIds.has(String(row.purchase_order_id))) {
          errors.push({ table, rowNum, reason: `purchase_order_id ${row.purchase_order_id} not found.` })
        }
        if (row.inventory_id && String(row.inventory_id).trim() && !inventoryIds.has(String(row.inventory_id))) {
          errors.push({ table, rowNum, reason: `inventory_id ${row.inventory_id} not found.` })
        }
      }
      if (table === 'purchase_order_receipts') {
        if (row.purchase_order_id && !poIds.has(String(row.purchase_order_id))) {
          errors.push({ table, rowNum, reason: `purchase_order_id ${row.purchase_order_id} not found.` })
        }
        if (row.purchase_order_item_id && !poItemIds.has(String(row.purchase_order_item_id))) {
          errors.push({ table, rowNum, reason: `purchase_order_item_id ${row.purchase_order_item_id} not found.` })
        }
      }
    })
  }
  return errors
}

export async function readBackupZip(file) {
  if (!file) throw new Error('No file selected.')
  const zip = await JSZip.loadAsync(file)
  const manifestFile = zip.file('backup_manifest.json')
  if (!manifestFile) throw new Error('Missing backup_manifest.json in ZIP.')
  const manifest = JSON.parse(await manifestFile.async('string'))
  if (manifest.backup_version !== BACKUP_VERSION && manifest.backup_version !== 1) {
    throw new Error(`Unsupported backup version: ${manifest.backup_version}`)
  }
  for (const table of CORE_BACKUP_TABLES) {
    if (!zip.file(`${table}.json`)) throw new Error(`Missing required file: ${table}.json`)
  }
  const parsed = { manifest }
  for (const table of CORE_BACKUP_TABLES) {
    const text = await zip.file(`${table}.json`).async('string')
    parsed[table] = parseJsonTable(text, `${table}.json`)
  }
  for (const table of PO_BACKUP_TABLES) {
    const file = zip.file(`${table}.json`)
    if (file) {
      const text = await file.async('string')
      parsed[table] = parseJsonTable(text, `${table}.json`)
    } else {
      parsed[table] = []
    }
  }
  return parsed
}

function coerceRow(row) {
  const out = { ...row }
  for (const k of Object.keys(out)) {
    if (out[k] === '') out[k] = null
  }
  return out
}

export async function executeRestore({ parsed, mode, existingData, persistTable, onProgress }) {
  const validationErrors = validateRestoreRows(parsed, existingData)
  if (validationErrors.length) {
    return { ok: false, errors: validationErrors, stats: { inserted: 0, updated: 0, failed: 0 } }
  }

  const stats = { inserted: 0, updated: 0, failed: 0 }
  const rowErrors = []
  const safeUpsert = mode === 'upsert'
  const tablesToRestore = BACKUP_TABLES.filter(t => Array.isArray(parsed[t]))

  for (const table of tablesToRestore) {
    onProgress?.(`Restoring ${table}...`)
    const rows = (parsed[table] || []).map(coerceRow)
    const existingIds = new Set((existingData[table] || []).map(r => String(r.id)))

    for (const row of rows) {
      const id = String(row.id)
      const exists = existingIds.has(id)
      if (!safeUpsert && exists) continue
      try {
        const result = await persistTable(table, row, { exists, mode: safeUpsert ? 'upsert' : 'insert_missing' })
        if (result === 'updated') stats.updated++
        else if (result === 'inserted') stats.inserted++
        else if (result === 'skipped') { /* no-op */ }
        else stats.inserted++
        if (!exists) existingIds.add(id)
      } catch (err) {
        stats.failed++
        rowErrors.push({ table, rowNum: id, reason: err.message || String(err) })
      }
    }
  }

  onProgress?.('Restore complete.')
  if (rowErrors.length) {
    return { ok: false, errors: rowErrors, stats }
  }
  return { ok: true, errors: [], stats }
}
