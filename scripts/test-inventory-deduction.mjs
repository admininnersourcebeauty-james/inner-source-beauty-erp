/**
 * Traces inventory deduction logic and optional live Supabase RPC probe (20 -> 8).
 * Run: node scripts/test-inventory-deduction.mjs
 *
 * Set env for live Supabase test (optional):
 *   VITE_SUPABASE_URL=...
 *   VITE_SUPABASE_ANON_KEY=...
 *   TEST_EMAIL=...
 *   TEST_PASSWORD=...
 *   TEST_INVENTORY_ID=...   (optional — item with qty >= 20)
 */
import { readFileSync, existsSync } from 'fs'
import { calcOrderTotals } from '../src/orderItems.js'
import {
  buildStockDeductionPlan,
  enrichDeductionPlan,
  INVENTORY_ADJUST_RPC,
  INVENTORY_STOCK_COLUMN,
} from '../src/orderInventory.js'

function loadEnvFile(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m || process.env[m[1]]) continue
    process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}

loadEnvFile('.env.local')
loadEnvFile('.env')

console.log('=== 1. Allocation + deduction plan (stock 20, qty 12) ===')
const inventory = [{ id: 42, qty: 20, style: 'S-STYLE SECRET Y-ZONE SERUM (120ML)' }]
const lines = [{ inventory_id: 42, qty: 12, price: 10, discount: '0' }]
const totals = calcOrderTotals(lines, {}, inventory)
const line = totals.lines[0]
console.log({
  inventory_id: line.inventory_id,
  allocated_qty: line.allocated_qty,
  backorder_qty: line.backorder_qty,
  old_qty: inventory[0].qty,
  calculated_new_qty: inventory[0].qty - line.allocated_qty,
})
const plan = enrichDeductionPlan(totals.lines)
console.log('deduction plan:', plan)
console.log('RPC call preview:', {
  function: INVENTORY_ADJUST_RPC,
  arguments: { p_inventory_id: plan[0]?.inventory_id, p_delta: -(plan[0]?.delta || 0) },
})

console.log('\n=== 2. Inventory schema (ERP + PO receive use qty) ===')
console.log({
  stock_column: INVENTORY_STOCK_COLUMN,
  rpc_function: INVENTORY_ADJUST_RPC,
  po_receive_updates: `public.inventory.${INVENTORY_STOCK_COLUMN} via receive_purchase_order_items SECURITY DEFINER RPC`,
  order_invoice_updates: `public.inventory.${INVENTORY_STOCK_COLUMN} via ${INVENTORY_ADJUST_RPC} SECURITY DEFINER RPC`,
})

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_ANON_KEY
const email = process.env.TEST_EMAIL
const password = process.env.TEST_PASSWORD

if (!url || !key || !email || !password) {
  console.log('\n=== 3. Live Supabase RPC test SKIPPED (set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, TEST_EMAIL, TEST_PASSWORD) ===')
  process.exit(0)
}

const { createClient } = await import('@supabase/supabase-js')
const supabase = createClient(url, key)

console.log('\n=== 3. Live Supabase: sign in + direct RPC test 20 -> 8 ===')
const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({ email, password })
if (authErr) {
  console.error('Auth failed:', authErr.message)
  process.exit(1)
}

const { data: profile } = await supabase.from('profiles').select('role, email').eq('id', auth.user.id).maybeSingle()
console.log('Signed in as:', profile?.email, 'role:', profile?.role)

let testItem
const forcedId = process.env.TEST_INVENTORY_ID
if (forcedId) {
  const { data, error } = await supabase.from('inventory').select(`id, style, ${INVENTORY_STOCK_COLUMN}`).eq('id', forcedId).maybeSingle()
  if (error || !data) {
    console.error('Could not load TEST_INVENTORY_ID:', error?.message || 'not found')
    process.exit(1)
  }
  testItem = data
} else {
  const { data: items, error: listErr } = await supabase.from('inventory').select(`id, style, ${INVENTORY_STOCK_COLUMN}`).gte(INVENTORY_STOCK_COLUMN, 20).limit(1)
  if (listErr || !items?.length) {
    console.error('Could not find inventory item with qty >= 20:', listErr?.message || 'empty')
    process.exit(1)
  }
  testItem = items[0]
}

const before = Number(testItem[INVENTORY_STOCK_COLUMN] || 0)
console.log('Test item:', { id: testItem.id, style: testItem.style, qty_before: before })

if (before < 20) {
  console.log(`Setting test item qty to 20 for RPC probe (was ${before})...`)
  const setRpc = await supabase.rpc(INVENTORY_ADJUST_RPC, {
    p_inventory_id: testItem.id,
    p_delta: 20 - before,
  })
  if (setRpc.error) {
    console.error('Could not set qty to 20:', setRpc.error.message)
    process.exit(1)
  }
}

const { data: at20 } = await supabase.from('inventory').select(INVENTORY_STOCK_COLUMN).eq('id', testItem.id).maybeSingle()
const qtyAt20 = Number(at20?.[INVENTORY_STOCK_COLUMN] ?? NaN)
console.log('Qty before deduction test:', qtyAt20)

const rpcArgs = { p_inventory_id: testItem.id, p_delta: -12 }
console.log('Calling RPC:', { function: INVENTORY_ADJUST_RPC, arguments: rpcArgs })
const rpc = await supabase.rpc(INVENTORY_ADJUST_RPC, rpcArgs)
console.log('RPC response:', { data: rpc.data, error: rpc.error?.message || null })

const { data: afterRow } = await supabase.from('inventory').select(INVENTORY_STOCK_COLUMN).eq('id', testItem.id).maybeSingle()
const qtyAfter = Number(afterRow?.[INVENTORY_STOCK_COLUMN] ?? NaN)
console.log('post-RPC SELECT qty:', qtyAfter)
console.log('Expected qty:', Math.max(qtyAt20 - 12, 0))

if (rpc.error) {
  console.error('\n*** RPC FAILED ***', rpc.error.message)
  process.exit(1)
}
if (qtyAfter !== Math.max(qtyAt20 - 12, 0)) {
  console.error(`\n*** RPC qty mismatch: expected ${Math.max(qtyAt20 - 12, 0)}, got ${qtyAfter} ***`)
  process.exit(1)
}

console.log('\n*** Direct RPC test PASSED (20 -> 8 when starting at 20) ***')

// Restore original qty
const restoreDelta = before - qtyAfter
if (restoreDelta !== 0) {
  await supabase.rpc(INVENTORY_ADJUST_RPC, { p_inventory_id: testItem.id, p_delta: restoreDelta })
  const { data: restored } = await supabase.from('inventory').select(INVENTORY_STOCK_COLUMN).eq('id', testItem.id).maybeSingle()
  console.log('Restored qty to:', restored?.[INVENTORY_STOCK_COLUMN])
}
