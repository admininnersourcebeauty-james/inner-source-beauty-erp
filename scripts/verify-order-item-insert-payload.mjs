/**
 * Verifies order_items cloud insert payloads never include id.
 * Run: node scripts/verify-order-item-insert-payload.mjs
 */
import { buildOrderItemInsertRows, sanitizeOrderItemInsertRow } from '../src/orderItems.js'

const lines = [{
  id: 'temp-should-not-be-sent',
  _clientKey: 'ui-key-123',
  inventory_id: 42,
  style: 'Test SKU',
  qty: 2,
  price: 19.99,
  discount: 1,
  line_total: 38.98,
  buying_price: 10,
  shipping_cost: 1,
  profit: 16.98,
  allocated_qty: 2,
  backorder_qty: 0,
  shipped_qty: 0,
}]

const rows = buildOrderItemInsertRows(999, lines)
let ok = true

for (const [idx, row] of rows.entries()) {
  if (Object.prototype.hasOwnProperty.call(row, 'id')) {
    console.error(`FAIL row ${idx}: id field present`, row.id)
    ok = false
  }
  if (Object.prototype.hasOwnProperty.call(row, '_clientKey')) {
    console.error(`FAIL row ${idx}: _clientKey leaked`)
    ok = false
  }
}

const manual = sanitizeOrderItemInsertRow({ ...lines[0], id: 'blocked' })
if (Object.prototype.hasOwnProperty.call(manual, 'id')) {
  console.error('FAIL sanitizeOrderItemInsertRow did not strip id')
  ok = false
}

console.log('Sample payload:', JSON.stringify(rows, null, 2))
console.log(ok ? 'PASS: insert payload has no id field' : 'FAIL: see errors above')
process.exit(ok ? 0 : 1)
