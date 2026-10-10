/** Inventory stock changes for order / invoice lines — always keyed by inventory_id. */

/** Matches Supabase migration: public.adjust_inventory_qty(bigint, numeric) */
export const INVENTORY_ADJUST_RPC = 'adjust_inventory_qty'

/** Column updated by adjust_inventory_qty and receive_purchase_order_items */
export const INVENTORY_STOCK_COLUMN = 'qty'

export function parseInventoryIdForRpc(inventoryId) {
  if (inventoryId == null || inventoryId === '') {
    return { ok: false, error: 'inventory_id is null or empty' }
  }
  const raw = String(inventoryId).trim()
  if (!raw) return { ok: false, error: 'inventory_id is empty' }
  const num = Number(raw)
  if (!Number.isFinite(num)) {
    return { ok: false, error: `inventory_id is not a valid bigint id: ${inventoryId}` }
  }
  return { ok: true, id: num }
}

export function aggregateAllocatedByInventoryId(lines) {
  const totals = new Map()
  for (const line of lines || []) {
    const inventoryId = line?.inventory_id
    const allocated = Math.max(Number(line?.allocated_qty ?? 0), 0)
    if (!inventoryId || allocated <= 0) continue
    const key = String(inventoryId)
    totals.set(key, (totals.get(key) || 0) + allocated)
  }
  return totals
}

export function buildInventoryDeltaPlan(oldLines, newLines) {
  const oldTotals = aggregateAllocatedByInventoryId(oldLines)
  const newTotals = aggregateAllocatedByInventoryId(newLines)
  const keys = new Set([...oldTotals.keys(), ...newTotals.keys()])
  const plan = []
  for (const inventory_id of keys) {
    const delta = (newTotals.get(inventory_id) || 0) - (oldTotals.get(inventory_id) || 0)
    if (delta !== 0) plan.push({ inventory_id, delta })
  }
  return plan
}

export function buildStockDeductionPlan(lines) {
  return buildInventoryDeltaPlan([], lines)
}

/** Attach order line metadata used by inventory delta planning. */
export function enrichDeductionPlan(lines) {
  const plan = buildStockDeductionPlan(lines)
  return plan.map(step => {
    const matching = (lines || []).filter(l => String(l.inventory_id) === String(step.inventory_id))
    return {
      ...step,
      order_item_ids: matching.map(l => l.id).filter(Boolean),
      order_item_id: matching[0]?.id || null,
      allocated_qty: matching.reduce((s, l) => s + Math.max(Number(l.allocated_qty || 0), 0), 0),
    }
  })
}

export function validateOrderInventoryAllocation(lines) {
  for (let i = 0; i < (lines || []).length; i += 1) {
    const line = lines[i]
    if (!line?.inventory_id) continue
    const qty = Math.max(Number(line.qty || 0), 0)
    if (qty <= 0) continue
    const allocated = Math.max(Number(line.allocated_qty || 0), 0)
    const backorder = Math.max(Number(line.backorder_qty || 0), 0)
    if (Math.abs(allocated + backorder - qty) > 0.0001) {
      return `Allocation mismatch on line ${i + 1} (${line.style || 'product'}).`
    }
  }
  return ''
}

export function allocationDeductionError(lines) {
  for (let i = 0; i < (lines || []).length; i += 1) {
    const line = lines[i]
    if (!line?.inventory_id) continue
    const qty = Math.max(Number(line.qty || 0), 0)
    if (qty <= 0) continue
    const allocated = Math.max(Number(line.allocated_qty || 0), 0)
    const backorder = Math.max(Number(line.backorder_qty || 0), 0)
    if (allocated <= 0 && backorder <= 0) {
      return `No inventory allocated for line ${i + 1} (${line.style || 'product'}). Check stock on hand and product link.`
    }
  }
  return ''
}
