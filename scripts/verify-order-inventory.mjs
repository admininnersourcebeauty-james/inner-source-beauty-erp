/**
 * Verifies inventory delta planning for order create/update.
 * Run: node scripts/verify-order-inventory.mjs
 */
import {
  aggregateAllocatedByInventoryId,
  buildInventoryDeltaPlan,
  buildStockDeductionPlan,
  validateOrderInventoryAllocation,
} from '../src/orderInventory.js'

let ok = true
function assert(label, cond) {
  if (!cond) {
    console.error(`FAIL: ${label}`)
    ok = false
  } else {
    console.log(`PASS: ${label}`)
  }
}

const line = (inventory_id, qty, allocated_qty, backorder_qty = 0) => ({
  inventory_id, qty, allocated_qty, backorder_qty, style: 'TEST',
})

assert('create deducts 12 from stock 20 scenario', (() => {
  const plan = buildStockDeductionPlan([line(5, 12, 12)])
  return plan.length === 1 && plan[0].inventory_id === '5' && plan[0].delta === 12
})())

assert('edit qty 12 -> 15 deducts only 3 more', (() => {
  const plan = buildInventoryDeltaPlan([line(5, 12, 12)], [line(5, 15, 15)])
  return plan.length === 1 && plan[0].delta === 3
})())

assert('edit qty 12 -> 10 restores 2', (() => {
  const plan = buildInventoryDeltaPlan([line(5, 12, 12)], [line(5, 10, 10)])
  return plan.length === 1 && plan[0].delta === -2
})())

assert('edit unchanged qty has zero delta', buildInventoryDeltaPlan([line(5, 12, 12)], [line(5, 12, 12)]).length === 0)

assert('cancel restores allocated qty', (() => {
  const plan = buildInventoryDeltaPlan([line(5, 12, 12)], [line(5, 12, 0)])
  return plan.length === 1 && plan[0].delta === -12
})())

assert('manual/null inventory_id excluded', aggregateAllocatedByInventoryId([line(null, 12, 12)]).size === 0)

assert('validation accepts backorder-only line', validateOrderInventoryAllocation([line(5, 12, 0, 12)]) === '')

process.exit(ok ? 0 : 1)
