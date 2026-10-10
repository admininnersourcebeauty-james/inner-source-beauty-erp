import React, { useEffect, useMemo, useState } from 'react'
import {
  PO_STATUSES, PO_FILTER_STATUSES, PO_CURRENCIES, PO_PURCHASE_TYPES,
  calcLineItem, calcPoTotals, allocateReceiveCosts, allocateLineCosts, blankPoHeader, blankPoLine,
  buildPoLineFromInventoryItem, factoryUnitCostFromInventory, inventoryBuyingPrice, isBlankPoFormLine,
  applyInventoryDefaultsToPoLine, collectMiddlemanOptions, collectSupplierOptions, COMMISSION_TYPES,
  inventorySupplierMismatch, inventoryItemsWithSupplierMismatch, resolvePoSupplierFromInventoryItems,
  inventorySupplier, normalizeSupplierName, inventorySearchHaystack,
  blankManualBulkProductRow, isBlankManualBulkRow, validateManualBulkRows,
  buildPoLineFromManualBulkRow, isDuplicateManualPoLine, supplierItemsFromManualRows,
  canCancelPo, canEditPo, canReceivePo,
  formatKrw, formatPoMoney,
  poItemsForOrder, poMatchesFilter, poMatchesSearch, receivedProgress,
  poSummaryStats, buildSupplierCsvRows, buildInternalCsvRows, downloadCsv,
  resolvePurchaseType, isMiddlemanPo, purchaseTypeLabel,
  poReportSummary, middlemanCommissionReport, incomingInventoryReport,
  reportTotalsForCommission, reportTotalsForIncoming,
  internalCostSummary, poReceivesForOrder,
  factoryUnitCostLabel, formatUsd,
  preparePoFormLines,
  COMMISSION_PAYMENT_METHODS, poCommissionPaymentsForOrder, commissionPaymentSummary,
  blankCommissionPaymentEntry, validateCommissionPaymentEntry,
  commissionPaymentReceiptTotals, commissionPaymentsChronological, formatPrintDate,
  paymentAmountKrw, paymentAmountUsd, convertCommissionKrwToUsd,
  defaultReceiveSellingPrice, parseReceiveSellingPrice,
} from './purchaseOrders.js'
import { formatDisplayDate } from './dateFormat.js'

const today = () => new Date().toISOString().slice(0, 10)

function PoStatusBadge({ status }) {
  const cls = String(status || '').toLowerCase().replace(/\s+/g, '-')
  return <span className={`po-status-badge po-status-${cls}`}>{status || '—'}</span>
}

function ReceiveInventoryModal({ po, items, inventory, onCancel, onConfirm, busy }) {
  const purchaseType = resolvePurchaseType(po, items)
  const poTotals = useMemo(() => calcPoTotals(po, items), [po, items])
  const usesPoLevelCosts = poTotals.shippingCost > 0 || poTotals.otherCost > 0
  const [header, setHeader] = useState({
    received_date: today(),
    shipment_number: '',
    shipping_cost: usesPoLevelCosts ? '' : (po.shipping_cost ?? ''),
    other_cost: usesPoLevelCosts ? '' : (po.other_cost ?? ''),
    other_cost_description: '',
    notes: '',
  })
  const [lines, setLines] = useState(() => items.map(item => ({
    purchase_order_item_id: item.id,
    product: item.product_sku || item.product_name,
    order_qty: item.order_qty,
    received_qty: item.received_qty,
    remaining_qty: item.remaining_qty,
    receive_now: '',
    selling_price: defaultReceiveSellingPrice(item, inventory),
    note: '',
  })))
  const [error, setError] = useState('')

  const shippingCost = Math.max(Number(header.shipping_cost) || 0, 0)
  const otherCost = Math.max(Number(header.other_cost) || 0, 0)
  const allocated = useMemo(() => {
    const active = lines.filter(l => Number(l.receive_now) > 0).map(l => {
      const item = items.find(i => String(i.id) === String(l.purchase_order_item_id))
      return { ...item, receive_now: Number(l.receive_now) }
    })
    return allocateReceiveCosts(active, shippingCost, otherCost, purchaseType, po, items)
  }, [lines, items, shippingCost, otherCost, purchaseType, po])

  function receiveAllRemaining() {
    setLines(prev => prev.map(l => ({
      ...l,
      receive_now: l.remaining_qty > 0 ? String(l.remaining_qty) : '',
    })))
  }

  function landedForLine(lineId) {
    return allocated.find(a => String(a.id) === String(lineId))?.landed_unit_cost || 0
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    const payload = lines
      .filter(l => Number(l.receive_now) > 0)
      .map(l => ({
        purchase_order_item_id: l.purchase_order_item_id,
        receive_now: Number(l.receive_now),
        selling_price: l.selling_price,
        note: l.note,
      }))
    if (!payload.length) {
      setError('At least one item must be received.')
      return
    }
    for (const row of payload) {
      const item = items.find(i => String(i.id) === String(row.purchase_order_item_id))
      if (row.receive_now < 0) { setError('Receiving quantity cannot be negative.'); return }
      if (row.receive_now > item.remaining_qty) {
        setError(`Cannot receive ${row.receive_now} when only ${item.remaining_qty} remaining for ${item.product_sku || item.product_name}.`)
        return
      }
      const sellingPrice = parseReceiveSellingPrice(row.selling_price)
      if (Number.isNaN(sellingPrice)) {
        setError('Selling Price (USD) must be 0 or greater.')
        return
      }
    }
    await onConfirm({
      ...header,
      shipping_cost: shippingCost,
      other_cost: otherCost,
      lines: payload,
    })
  }

  return (
    <div className="restore-dialog-overlay po-receive-overlay" onClick={onCancel}>
      <div className="restore-dialog po-receive-dialog" onClick={e => e.stopPropagation()}>
        <h2>Receive Inventory — {po.po_number}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-grid po-receive-header-grid">
            <label>Receive Date<input type="date" value={header.received_date} onChange={e => setHeader({ ...header, received_date: e.target.value })} /></label>
            <label>Shipment Number (Optional)<input value={header.shipment_number} onChange={e => setHeader({ ...header, shipment_number: e.target.value })} /></label>
            {usesPoLevelCosts ? (
              <>
                <label>Total Shipping Cost (USD)<span className="po-calc-value">{formatUsd(poTotals.shippingCost)}</span></label>
                <label>Total Other Cost (USD)<span className="po-calc-value">{formatUsd(poTotals.otherCost)}</span></label>
                <p className="hint po-receive-cost-hint">Landed unit cost uses PO shipping/other spread across all ordered units.</p>
              </>
            ) : (
              <>
                <label>Shipping Cost (USD)<input type="number" min="0" step="0.01" value={header.shipping_cost} onChange={e => setHeader({ ...header, shipping_cost: e.target.value })} /></label>
                <label>Other Cost (USD, Optional)<input type="number" min="0" step="0.01" value={header.other_cost} onChange={e => setHeader({ ...header, other_cost: e.target.value })} /></label>
              </>
            )}
            <label>Other Cost Description (Optional)<input value={header.other_cost_description} onChange={e => setHeader({ ...header, other_cost_description: e.target.value })} /></label>
            <label className="po-notes-field">Notes (Optional)<textarea rows={2} value={header.notes} onChange={e => setHeader({ ...header, notes: e.target.value })} /></label>
          </div>
          <div className="po-receive-actions-row">
            <button type="button" className="soft" onClick={receiveAllRemaining}>Receive All Remaining</button>
          </div>
          <div className="table-wrap po-receive-table">
            <table>
              <thead>
                <tr>
                  <th>Product</th><th>Ordered Qty</th><th>Previously Received</th><th>Remaining Qty</th>
                  <th>Receiving Qty</th><th>Selling Price (USD)</th><th>Landed Unit Cost</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={l.purchase_order_item_id}>
                    <td>{l.product}</td>
                    <td>{l.order_qty}</td>
                    <td>{l.received_qty}</td>
                    <td>{l.remaining_qty}</td>
                    <td>
                      <input type="number" min="0" max={l.remaining_qty} step="1" value={l.receive_now}
                        disabled={l.remaining_qty <= 0}
                        onChange={e => {
                          const next = [...lines]
                          next[idx] = { ...next[idx], receive_now: e.target.value }
                          setLines(next)
                          setError('')
                        }} />
                    </td>
                    <td>
                      <input type="number" min="0" step="0.01" value={l.selling_price}
                        disabled={l.remaining_qty <= 0}
                        placeholder="0.00"
                        onChange={e => {
                          const next = [...lines]
                          next[idx] = { ...next[idx], selling_price: e.target.value }
                          setLines(next)
                          setError('')
                        }} />
                    </td>
                    <td>{Number(l.receive_now) > 0 ? formatUsd(landedForLine(l.purchase_order_item_id)) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <p className="hint po-receive-error">{error}</p>}
          <p className="hint">Shipping and other costs are allocated across the quantities received in this shipment only. Buying price updates automatically using weighted average cost.</p>
          <div className="restore-dialog-actions">
            <button type="submit" disabled={busy}>Confirm Receive</button>
            <button type="button" className="soft" onClick={onCancel} disabled={busy}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ReceiveHistoryDetailModal({ receive, po, onClose }) {
  return (
    <div className="restore-dialog-overlay po-receive-overlay" onClick={onClose}>
      <div className="restore-dialog po-receive-dialog" onClick={e => e.stopPropagation()}>
        <h2>{receive.receive_number} — {po.po_number}</h2>
        <div className="po-receive-detail-meta">
          <p><b>Receive Date:</b> {formatDisplayDate(receive.received_date)}</p>
          <p><b>Shipment Number:</b> {receive.shipment_number || '—'}</p>
          <p><b>Shipping Cost (USD):</b> {formatUsd(receive.shipping_cost)}</p>
          <p><b>Other Cost (USD):</b> {formatUsd(receive.other_cost)}</p>
          <p><b>Other Cost Description:</b> {receive.other_cost_description || '—'}</p>
          <p><b>Received By:</b> {receive.received_by || '—'}</p>
          <p><b>Notes:</b> {receive.notes || '—'}</p>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th><th>Received Qty</th><th>Factory Unit Cost</th><th>Commission / Unit</th>
                <th>Inventory Buying Price (USD)</th>
              </tr>
            </thead>
            <tbody>
              {(receive.items || []).map(item => (
                <tr key={item.id || `${item.purchase_order_item_id}-${item.received_qty}`}>
                  <td>{item.product}</td>
                  <td>{item.received_qty}</td>
                  <td>{formatUsd(item.factory_unit_cost)}</td>
                  <td>{formatUsd(item.commission_per_unit)}</td>
                  <td>{formatUsd(item.landed_unit_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="restore-dialog-actions">
          <button type="button" className="soft" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function SupplierMismatchDialog({ productLabel, mismatchedProducts, onCancel, onConfirm }) {
  const multi = (mismatchedProducts?.length || 0) > 1
  return (
    <div className="restore-dialog-overlay po-supplier-warning-overlay" onClick={onCancel}>
      <div className="restore-dialog po-supplier-warning-dialog" onClick={e => e.stopPropagation()}>
        <p className="restore-dialog-text">
          {multi ? (
            <>One or more selected products belong to another supplier.<br />Do you still want to add them?</>
          ) : (
            <>This product belongs to another supplier.<br />Do you still want to add it?</>
          )}
        </p>
        {productLabel && <p className="hint po-supplier-warning-product"><strong>{productLabel}</strong></p>}
        {mismatchedProducts?.length > 1 && (
          <ul className="po-supplier-warning-list">
            {mismatchedProducts.map(item => (
              <li key={item.id}>{item.style || '—'}{inventorySupplier(item) ? ` (${inventorySupplier(item)})` : ''}</li>
            ))}
          </ul>
        )}
        <div className="restore-dialog-actions">
          <button type="button" className="soft" onClick={onCancel}>Cancel</button>
          <button type="button" onClick={onConfirm}>Add Anyway</button>
        </div>
      </div>
    </div>
  )
}

function AddMultipleProductsModal({
  inventory = [],
  inventoryLoadError = '',
  inventoryLoading = false,
  existingInventoryIds,
  existingPoLines = [],
  currency,
  exchangeRate,
  middlemanOptions = [],
  supplierOptions = [],
  onAdd,
  onCancel,
}) {
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [manualRows, setManualRows] = useState(() => [blankManualBulkProductRow()])
  const [manualErrors, setManualErrors] = useState({})
  const [formError, setFormError] = useState('')

  const sortedInventory = useMemo(() => {
    const seen = new Set()
    const unique = []
    for (const item of inventory || []) {
      const id = String(item.id)
      if (seen.has(id)) continue
      seen.add(id)
      unique.push(item)
    }
    return unique.sort((a, b) => String(a.style || '').localeCompare(String(b.style || ''), undefined, { sensitivity: 'base' }))
  }, [inventory])

  const filteredInventory = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sortedInventory
    return sortedInventory.filter(item => inventorySearchHaystack(item).includes(q))
  }, [sortedInventory, search])

  const addedSet = useMemo(() => new Set((existingInventoryIds || []).map(String)), [existingInventoryIds])

  const selectableVisible = useMemo(
    () => filteredInventory.filter(item => !addedSet.has(String(item.id))),
    [filteredInventory, addedSet],
  )

  const allVisibleSelected = selectableVisible.length > 0
    && selectableVisible.every(item => selectedIds.has(String(item.id)))

  const completedManualCount = useMemo(
    () => manualRows.filter(row => !isBlankManualBulkRow(row)).length,
    [manualRows],
  )

  function toggleProduct(id) {
    const key = String(id)
    if (addedSet.has(key)) return
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function selectAllVisible() {
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (const item of selectableVisible) next.add(String(item.id))
      return next
    })
  }

  function deselectAllVisible() {
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (const item of selectableVisible) next.delete(String(item.id))
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  function updateManualRow(key, patch) {
    setManualRows(prev => prev.map(row => (row._key === key ? { ...row, ...patch } : row)))
    setManualErrors(prev => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
    setFormError('')
  }

  function addManualRow() {
    setManualRows(prev => [...prev, blankManualBulkProductRow()])
  }

  function removeManualRow(key) {
    setManualRows(prev => {
      const next = prev.filter(row => row._key !== key)
      return next.length ? next : [blankManualBulkProductRow()]
    })
    setManualErrors(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function manualCommissionValueLabel(type) {
    if (type === 'percentage') return 'Commission Value (%)'
    if (type === 'fixed_per_unit') return currency === 'USD' ? 'Commission ($/unit)' : 'Commission (per unit)'
    if (type === 'fixed_total') return currency === 'USD' ? 'Commission ($ total)' : 'Commission (total)'
    return 'Commission Value'
  }

  function handleAdd() {
    setFormError('')
    const inventoryItems = sortedInventory.filter(item => selectedIds.has(String(item.id)))
    const validation = validateManualBulkRows(manualRows)
    if (!validation.ok) {
      setManualErrors(validation.errorsByKey)
      return
    }
    const completedManualRows = manualRows.filter(row => !isBlankManualBulkRow(row))
    if (!inventoryItems.length && !completedManualRows.length) {
      setFormError('Select inventory products or complete at least one manual product row.')
      return
    }
    const duplicateManual = completedManualRows.find(row => {
      const candidate = buildPoLineFromManualBulkRow(row, currency, exchangeRate)
      return isDuplicateManualPoLine(existingPoLines, candidate)
        || completedManualRows.filter(r => r !== row).some(other => {
          const a = buildPoLineFromManualBulkRow(row, currency, exchangeRate)
          const b = buildPoLineFromManualBulkRow(other, currency, exchangeRate)
          return String(a.product_name).trim() === String(b.product_name).trim()
            && String(a.product_sku).trim() === String(b.product_sku).trim()
        })
    })
    if (duplicateManual) {
      setFormError('Duplicate manual product: Product Name and Style / SKU must be unique among manual lines.')
      return
    }
    onAdd({ inventoryItems, manualRows: completedManualRows })
  }

  const inventoryEmptyMessage = inventoryLoadError
    ? null
    : inventoryLoading
      ? null
      : search.trim()
        ? 'No inventory products match your search.'
        : sortedInventory.length
          ? null
          : 'No inventory products found. You can still add manual products below.'

  return (
    <div className="restore-dialog-overlay po-bulk-add-overlay" onClick={onCancel}>
      <div className="restore-dialog po-bulk-add-dialog" onClick={e => e.stopPropagation()}>
        <div className="po-bulk-add-scroll">
          <h2>Add Multiple Products</h2>
          <div className="po-bulk-add-toolbar">
            <input
              className="po-bulk-add-search"
              type="search"
              placeholder="Search by product name, style, SKU, brand, or supplier"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div className="po-bulk-add-toolbar-actions">
              <label className="po-bulk-select-all">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={!selectableVisible.length || inventoryLoading || !!inventoryLoadError}
                  onChange={e => (e.target.checked ? selectAllVisible() : deselectAllVisible())}
                />
                Select All Visible
              </label>
              <button type="button" className="soft" onClick={clearSelection} disabled={!selectedIds.size}>Clear Selection</button>
              <span className="po-bulk-selected-count">{selectedIds.size} inventory selected · {completedManualCount} manual</span>
            </div>
          </div>
          {inventoryLoading && <p className="hint po-bulk-status">Loading inventory products…</p>}
          {inventoryLoadError && (
            <p className="field-error po-bulk-inventory-error" role="alert">
              Inventory load failed: {inventoryLoadError}
            </p>
          )}
          {!inventoryLoading && !inventoryLoadError && sortedInventory.length > 0 && (
            <p className="hint po-bulk-inventory-count">{sortedInventory.length} inventory product{sortedInventory.length === 1 ? '' : 's'} available</p>
          )}
          <div className="po-bulk-add-list-wrap">
            <div className="table-wrap po-bulk-add-table">
              <table>
                <thead>
                  <tr>
                    <th aria-label="Select" />
                    <th>Product Name</th>
                    <th>Style / SKU</th>
                    <th>Brand</th>
                    <th>Supplier</th>
                    <th>Current Inventory Qty</th>
                    <th>Factory Unit Cost</th>
                    <th>Inventory Buying Price</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInventory.map(item => {
                    const id = String(item.id)
                    const alreadyAdded = addedSet.has(id)
                    const factoryCost = factoryUnitCostFromInventory(item, currency, exchangeRate)
                    const buyingUsd = inventoryBuyingPrice(item)
                    return (
                      <tr key={id} className={alreadyAdded ? 'po-bulk-row-added' : ''}>
                        <td>
                          {alreadyAdded ? (
                            <span className="po-bulk-already-added">Already Added</span>
                          ) : (
                            <input
                              type="checkbox"
                              checked={selectedIds.has(id)}
                              disabled={inventoryLoading || !!inventoryLoadError}
                              onChange={() => toggleProduct(id)}
                            />
                          )}
                        </td>
                        <td>{item.style || '—'}</td>
                        <td>{item.style || '—'}</td>
                        <td>{item.brand || '—'}</td>
                        <td>{inventorySupplier(item) || '—'}</td>
                        <td>{Number(item.qty ?? 0)}</td>
                        <td>{factoryCost !== '' ? formatPoMoney(factoryCost, currency) : '—'}</td>
                        <td>{buyingUsd > 0 ? formatUsd(buyingUsd) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="po-bulk-add-cards">
              {filteredInventory.map(item => {
                const id = String(item.id)
                const alreadyAdded = addedSet.has(id)
                const factoryCost = factoryUnitCostFromInventory(item, currency, exchangeRate)
                const buyingUsd = inventoryBuyingPrice(item)
                return (
                  <div key={id} className={`po-bulk-add-card${alreadyAdded ? ' po-bulk-card-added' : ''}${selectedIds.has(id) ? ' po-bulk-card-selected' : ''}`}>
                    {alreadyAdded ? (
                      <span className="po-bulk-already-added">Already Added</span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(id)}
                        disabled={inventoryLoading || !!inventoryLoadError}
                        onChange={() => toggleProduct(id)}
                      />
                    )}
                    <div className="po-bulk-card-body" onClick={() => !alreadyAdded && !inventoryLoading && !inventoryLoadError && toggleProduct(id)} role={alreadyAdded ? undefined : 'button'} tabIndex={alreadyAdded ? undefined : 0} onKeyDown={e => { if (!alreadyAdded && !inventoryLoading && !inventoryLoadError && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleProduct(id) } }}>
                      <strong>{item.style || '—'}</strong>
                      <span>{item.brand || '—'}</span>
                      <span>Supplier: {inventorySupplier(item) || '—'}</span>
                      <span>Qty: {Number(item.qty ?? 0)}</span>
                      <span>Factory: {factoryCost !== '' ? formatPoMoney(factoryCost, currency) : '—'}</span>
                      <span>Buying: {buyingUsd > 0 ? formatUsd(buyingUsd) : '—'}</span>
                    </div>
                  </div>
                )
              })}
            </div>
            {inventoryEmptyMessage && (
              <p className="hint po-bulk-empty">{inventoryEmptyMessage}</p>
            )}
          </div>

          <div className="po-bulk-section-divider" />

          <div className="po-bulk-manual-section">
            <h3>Add New Manual Products</h3>
            <p className="hint">Manual products are added directly to this PO and are not saved to Inventory.</p>
            {manualRows.map(row => {
              const rowErrors = manualErrors[row._key] || {}
              return (
                <div key={row._key} className="po-bulk-manual-row">
                  <div className="form-grid po-bulk-manual-grid">
                    <label>Product Name *
                      <input
                        value={row.product_name}
                        onChange={e => updateManualRow(row._key, { product_name: e.target.value })}
                      />
                      {rowErrors.product_name && <span className="field-error">{rowErrors.product_name}</span>}
                    </label>
                    <label>Style / SKU
                      <input
                        value={row.product_sku}
                        onChange={e => updateManualRow(row._key, { product_sku: e.target.value })}
                      />
                    </label>
                    <label>Brand
                      <input
                        value={row.brand}
                        onChange={e => updateManualRow(row._key, { brand: e.target.value })}
                      />
                    </label>
                    <label>Supplier
                      <input
                        list="po-bulk-supplier-options"
                        value={row.supplier}
                        placeholder="Optional"
                        onChange={e => updateManualRow(row._key, { supplier: e.target.value })}
                      />
                    </label>
                    <label>Order Qty *
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={row.order_qty}
                        onChange={e => updateManualRow(row._key, { order_qty: e.target.value })}
                      />
                      {rowErrors.order_qty && <span className="field-error">{rowErrors.order_qty}</span>}
                    </label>
                    <label>{factoryUnitCostLabel(currency)} *
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={row.korean_unit_cost}
                        onChange={e => updateManualRow(row._key, { korean_unit_cost: e.target.value })}
                      />
                      {rowErrors.korean_unit_cost && <span className="field-error">{rowErrors.korean_unit_cost}</span>}
                    </label>
                    <label>Middle Man
                      <input
                        list="po-bulk-middleman-options"
                        value={row.middleman_name}
                        placeholder="Optional"
                        onChange={e => updateManualRow(row._key, { middleman_name: e.target.value })}
                      />
                      {rowErrors.middleman_name && <span className="field-error">{rowErrors.middleman_name}</span>}
                    </label>
                    <label>Commission Type
                      <select
                        value={row.commission_type || ''}
                        onChange={e => updateManualRow(row._key, { commission_type: e.target.value })}
                      >
                        <option value="">None</option>
                        {COMMISSION_TYPES.filter(t => t.value).map(t => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>{manualCommissionValueLabel(row.commission_type)}
                      <input
                        type="number"
                        min="0"
                        step={row.commission_type === 'percentage' ? '0.01' : '1'}
                        value={row.commission_value ?? ''}
                        disabled={!row.commission_type}
                        onChange={e => updateManualRow(row._key, { commission_value: e.target.value })}
                      />
                      {rowErrors.commission_value && <span className="field-error">{rowErrors.commission_value}</span>}
                    </label>
                    <label className="po-bulk-manual-note">Note
                      <input
                        value={row.note || ''}
                        onChange={e => updateManualRow(row._key, { note: e.target.value })}
                      />
                    </label>
                    <div className="po-bulk-manual-remove">
                      <button type="button" className="danger soft" onClick={() => removeManualRow(row._key)}>Remove Row</button>
                    </div>
                  </div>
                </div>
              )
            })}
            <button type="button" className="soft po-bulk-add-manual-btn" onClick={addManualRow}>+ Add Another Manual Product</button>
          </div>
          <datalist id="po-bulk-middleman-options">
            {middlemanOptions.map(name => <option key={name} value={name} />)}
          </datalist>
          <datalist id="po-bulk-supplier-options">
            {supplierOptions.map(name => <option key={name} value={name} />)}
          </datalist>
          {formError && <p className="field-error po-bulk-form-error" role="alert">{formError}</p>}
        </div>
        <div className="restore-dialog-actions po-bulk-add-actions">
          <button type="button" onClick={handleAdd}>Add Products</button>
          <button type="button" className="soft" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function PurchaseOrderForm({ header, lines, inventory, isAdmin, editing, onSave, onCancel, nextPoNumber, middlemanOptions = [], supplierOptions = [], inventoryLoadError = '', inventoryLoading = false }) {
  const initialType = resolvePurchaseType(header, lines)
  const [h, setH] = useState(() => ({
    ...blankPoHeader(nextPoNumber),
    ...header,
    purchase_type: header.purchase_type || initialType,
    order_date: header.order_date || today(),
  }))
  const [rows, setRows] = useState(() => preparePoFormLines(
    lines.length ? lines : [blankPoLine()],
    header.exchange_rate || '1350',
  ))
  const [bulkModalOpen, setBulkModalOpen] = useState(false)
  const [bulkNotice, setBulkNotice] = useState('')
  const [supplierConfirm, setSupplierConfirm] = useState(null)
  const isMiddleman = h.purchase_type === 'middleman'
  const shippingCost = Math.max(Number(h.shipping_cost) || 0, 0)
  const otherCost = Math.max(Number(h.other_cost) || 0, 0)
  const totals = useMemo(() => calcPoTotals(
    { ...h, shipping_cost: shippingCost, other_cost: otherCost },
    rows,
  ), [h, rows, shippingCost, otherCost])
  const allocatedLines = useMemo(() => allocateLineCosts(
    rows,
    shippingCost,
    otherCost,
    h.purchase_type,
    h.currency,
    h.exchange_rate,
  ), [rows, shippingCost, otherCost, h.purchase_type, h.currency, h.exchange_rate])

  function setPurchaseType(type) {
    if (type === 'direct') {
      setH({ ...h, purchase_type: 'direct', middleman_name: '' })
      setRows(prev => prev.map(r => ({
        ...r,
        middleman_name: '',
        commission_type: '',
        commission_value: '',
        middleman_commission_unit_krw: '',
        commission_percent: 0,
      })))
    } else {
      setH({ ...h, purchase_type: 'middleman' })
    }
  }

  function updateLine(idx, patch) {
    setRows(prev => {
      const next = prev.map((r, i) => (i === idx ? { ...r, ...patch } : r))
      syncPurchaseTypeFromLines(next)
      return next
    })
  }

  function commissionValueLabel(type) {
    if (type === 'percentage') return 'Commission Value (%)'
    if (type === 'fixed_per_unit') return h.currency === 'USD' ? 'Commission Value ($/unit)' : 'Commission Value (per unit)'
    if (type === 'fixed_total') return h.currency === 'USD' ? 'Commission Value ($ total)' : 'Commission Value (total)'
    return 'Commission Value'
  }

  function applyInventoryPick(idx, item) {
    const nextLine = applyInventoryDefaultsToPoLine(item, {
      inventory_id: item.id,
      product_sku: item.style || '',
      product_name: item.style || '',
      brand: item.brand || '',
    }, h.currency, h.exchange_rate)
    updateLine(idx, nextLine)
    setH(prev => {
      const itemSupplier = inventorySupplier(item)
      if (!normalizeSupplierName(prev.supplier) && itemSupplier) {
        return { ...prev, supplier: itemSupplier }
      }
      return prev
    })
  }

  function pickInventory(idx, invId) {
    if (!invId) return
    const item = inventory.find(i => String(i.id) === String(invId))
    if (!item) return
    if (inventorySupplierMismatch(h.supplier, item)) {
      setSupplierConfirm({
        type: 'single',
        idx,
        item,
        productLabel: item.style || '—',
      })
      return
    }
    applyInventoryPick(idx, item)
  }

  function confirmSupplierMismatch() {
    if (!supplierConfirm) return
    if (supplierConfirm.type === 'single') {
      applyInventoryPick(supplierConfirm.idx, supplierConfirm.item)
    } else if (supplierConfirm.type === 'bulk') {
      addMultipleProducts(supplierConfirm.payload, true)
    }
    setSupplierConfirm(null)
  }

  function requestAddMultipleProducts(payload) {
    const inventoryItems = payload?.inventoryItems || []
    const manualRows = payload?.manualRows || []
    const mismatched = inventoryItemsWithSupplierMismatch(h.supplier, inventoryItems)
    if (mismatched.length && normalizeSupplierName(h.supplier)) {
      setSupplierConfirm({
        type: 'bulk',
        payload: { inventoryItems, manualRows },
        mismatchedProducts: mismatched,
        productLabel: mismatched.length === 1 ? (mismatched[0].style || '—') : '',
      })
      return
    }
    addMultipleProducts({ inventoryItems, manualRows }, true)
  }

  function syncPurchaseTypeFromLines(nextRows) {
    setH(prev => {
      const resolved = resolvePurchaseType(prev, nextRows)
      return resolved !== prev.purchase_type ? { ...prev, purchase_type: resolved } : prev
    })
  }

  const existingInventoryIds = useMemo(
    () => rows.map(r => r.inventory_id).filter(Boolean),
    [rows],
  )

  function addMultipleProducts({ inventoryItems = [], manualRows = [] }, skipSupplierCheck = false) {
    if (!skipSupplierCheck) {
      requestAddMultipleProducts({ inventoryItems, manualRows })
      return
    }
    const existingIds = new Set(existingInventoryIds.map(String))
    const existingManualLines = rows.filter(r => !r.inventory_id)
    const toAdd = []
    const addedInventoryItems = []
    let skippedInventory = 0
    let skippedManual = 0

    for (const item of inventoryItems || []) {
      const id = String(item.id)
      if (existingIds.has(id)) {
        skippedInventory += 1
        continue
      }
      existingIds.add(id)
      addedInventoryItems.push(item)
      toAdd.push(buildPoLineFromInventoryItem(item, h.currency, h.exchange_rate))
    }

    for (const row of manualRows || []) {
      const line = buildPoLineFromManualBulkRow(row, h.currency, h.exchange_rate)
      if (isDuplicateManualPoLine([...existingManualLines, ...toAdd], line)) {
        skippedManual += 1
        continue
      }
      toAdd.push(line)
    }

    if (toAdd.length) {
      setRows(prev => {
        const kept = prev.filter(r => !isBlankPoFormLine(r))
        const next = [...kept, ...toAdd]
        syncPurchaseTypeFromLines(next)
        return next
      })
      setH(prev => {
        const supplierSources = [
          ...addedInventoryItems,
          ...supplierItemsFromManualRows(manualRows),
        ]
        const nextSupplier = resolvePoSupplierFromInventoryItems(supplierSources, prev.supplier)
        if (nextSupplier && !normalizeSupplierName(prev.supplier)) {
          return { ...prev, supplier: nextSupplier }
        }
        return prev
      })
    }

    const parts = []
    const inventoryAdded = toAdd.filter(l => l.inventory_id).length
    const manualAdded = toAdd.filter(l => !l.inventory_id).length
    if (inventoryAdded) parts.push(`${inventoryAdded} inventory`)
    if (manualAdded) parts.push(`${manualAdded} manual`)
    const addedMsg = parts.length ? `${parts.join(' + ')} product${toAdd.length === 1 ? '' : 's'} added` : 'No products added'
    const skipParts = []
    if (skippedInventory) skipParts.push(`${skippedInventory} inventory duplicate${skippedInventory === 1 ? '' : 's'}`)
    if (skippedManual) skipParts.push(`${skippedManual} manual duplicate${skippedManual === 1 ? '' : 's'}`)
    const skipMsg = skipParts.length ? skipParts.join(', ') + ' skipped' : ''
    setBulkNotice(skipMsg ? `${addedMsg}. ${skipMsg}.` : addedMsg)
    if (toAdd.length) setBulkModalOpen(false)
  }

  function removeLine(idx) {
    setRows(prev => prev.filter((_, i) => i !== idx))
  }

  function setCurrency(currency) {
    setH({
      ...h,
      currency,
      exchange_rate: currency === 'USD' ? '1' : (h.exchange_rate || '1350'),
    })
  }

  function handleSave() {
    onSave({ header: h, lines: rows })
  }

  if (!isAdmin) {
    return <div className="panel"><p className="hint">Only administrators can create or edit purchase orders.</p></div>
  }

  return (
    <div className="panel po-form-panel">
      <div className="po-form-head">
        <h2>{editing ? 'Edit Purchase Order' : 'Create Purchase Order'}</h2>
        <button type="button" className="soft" onClick={onCancel}>Back to List</button>
      </div>
      <div className="form-section">
        <h3>Header</h3>
        <div className="form-grid po-header-grid">
          <label>PO Number<input value={h.po_number} readOnly /></label>
          <label>Order Date<input type="date" value={h.order_date || today()} onChange={e => setH({ ...h, order_date: e.target.value })} /></label>
          <label>Purchase Type
            <select value={h.purchase_type || 'direct'} onChange={e => setPurchaseType(e.target.value)}>
              {PO_PURCHASE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label>Supplier
            <input
              list="po-supplier-options"
              value={h.supplier}
              onChange={e => setH({ ...h, supplier: e.target.value })}
              placeholder="incelltechbio"
            />
          </label>
          <datalist id="po-supplier-options">
            {supplierOptions.map(name => <option key={name} value={name} />)}
          </datalist>
          <label>Currency
            <select value={h.currency} onChange={e => setCurrency(e.target.value)}>
              {PO_CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label>Exchange Rate
            <input type="number" min="0" step="0.01" value={h.currency === 'USD' ? '1' : h.exchange_rate}
              readOnly={h.currency === 'USD'}
              onChange={e => setH({ ...h, exchange_rate: e.target.value })} />
          </label>
          <label>ETA<input type="date" value={h.eta || ''} onChange={e => setH({ ...h, eta: e.target.value })} /></label>
          <label>Status
            <select value={h.status} onChange={e => setH({ ...h, status: e.target.value })}>
              {PO_STATUSES.filter(s => s !== 'Partially Received' && s !== 'Received').map(s => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="po-notes-field">Notes<textarea rows={2} value={h.notes} onChange={e => setH({ ...h, notes: e.target.value })} /></label>
        </div>
      </div>
      <div className="form-section po-product-lines-section">
        <div className="po-product-lines-head">
          <h3>Product Lines</h3>
          <div className="po-line-actions-row">
            <button type="button" className="soft" onClick={() => setRows(prev => [...prev, blankPoLine()])}>+ Add Product Line</button>
            <button type="button" className="soft" onClick={() => { setBulkNotice(''); setBulkModalOpen(true) }}>+ Add Multiple Products</button>
          </div>
        </div>
        {bulkNotice && <p className="hint po-bulk-notice">{bulkNotice}</p>}
        <datalist id="po-middleman-options">
          {middlemanOptions.map(name => <option key={name} value={name} />)}
        </datalist>
        {rows.map((line, idx) => {
          const calc = calcLineItem(line, h.purchase_type, h.currency, h.exchange_rate)
          const allocated = allocatedLines[idx] || calc
          const factoryCostKrwLabel = h.currency === 'KRW' ? 'Factory Product Cost (KRW)' : `Factory Product Cost (${h.currency})`
          return (
            <div key={idx} className="po-line-card">
              <div className="form-grid po-line-grid po-line-row">
                <label>Product / SKU
                  <select value={line.inventory_id || ''} onChange={e => pickInventory(idx, e.target.value)}>
                    <option value="">Select product</option>
                    {inventory.map(i => <option key={i.id} value={i.id}>{i.style}</option>)}
                  </select>
                </label>
                <label>Order Qty<input type="number" min="0" value={line.order_qty} onChange={e => updateLine(idx, { order_qty: e.target.value })} /></label>
                <label>{factoryUnitCostLabel(h.currency)}<input type="number" min="0" step="1" value={line.korean_unit_cost} onChange={e => updateLine(idx, { korean_unit_cost: e.target.value })} /></label>
              </div>
              <div className="form-grid po-line-grid po-line-row">
                <label>Style / SKU
                  <input
                    value={line.product_sku || ''}
                    placeholder="Enter style or SKU"
                    onChange={e => updateLine(idx, { product_sku: e.target.value, product_name: e.target.value })}
                  />
                </label>
                <label>Converted Unit Cost (USD)<span className="po-calc-value">{formatUsd(calc.factory_unit_cost_usd)}</span></label>
                <label>Total Unit Cost (KRW)<span className="po-calc-value">{formatKrw(calc.total_unit_cost_krw)}</span></label>
                <label>Total Unit Cost (USD)<span className="po-calc-value">{formatUsd(calc.total_unit_cost_usd)}</span></label>
              </div>
              <div className="form-grid po-line-grid po-line-row po-line-commission-row">
                <label>Middle Man
                  <input
                    list="po-middleman-options"
                    value={line.middleman_name || ''}
                    placeholder="Select or type name"
                    onChange={e => updateLine(idx, { middleman_name: e.target.value })}
                  />
                </label>
                <label>Commission Type
                  <select
                    value={line.commission_type || ''}
                    onChange={e => updateLine(idx, { commission_type: e.target.value })}
                  >
                    <option value="">None</option>
                    {COMMISSION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </label>
                <label>{commissionValueLabel(line.commission_type)}
                  <input
                    type="number"
                    min="0"
                    step={line.commission_type === 'percentage' ? '0.01' : '1'}
                    value={line.commission_value ?? ''}
                    disabled={!line.commission_type}
                    onChange={e => updateLine(idx, { commission_value: e.target.value })}
                  />
                </label>
                <label>Commission Total (KRW)<span className="po-calc-value">{formatKrw(calc.middleman_commission_total_krw)}</span></label>
                <label>Commission Total (USD)<span className="po-calc-value">{formatUsd(calc.commission_total_usd)}</span></label>
              </div>
              <div className="form-grid po-line-grid po-line-row po-line-meta-row">
                <label>{factoryCostKrwLabel}<span className="po-calc-value">{formatPoMoney(calc.product_cost, h.currency)}</span></label>
                <label>Factory Product Cost (USD)<span className="po-calc-value">{formatUsd(calc.product_cost_usd)}</span></label>
                <label>Inventory Buying Price (USD)<span className="po-calc-value">{formatUsd(allocated.final_unit_cost ?? allocated.landed_unit_cost ?? 0)}</span></label>
                <label>Received Qty<span className="po-calc-value">{calc.received_qty}</span></label>
                <label>Remaining Qty<span className="po-calc-value">{calc.remaining_qty}</span></label>
                <label>Note<input value={line.note || ''} onChange={e => updateLine(idx, { note: e.target.value })} /></label>
                <div className="po-line-actions">
                  <button type="button" className="danger soft" onClick={() => removeLine(idx)} disabled={rows.length <= 1}>Remove</button>
                </div>
              </div>
            </div>
          )
        })}
        <div className="form-grid po-line-grid po-cost-fields">
          <label>Total Shipping Cost (USD)
            <input type="number" min="0" step="0.01" value={h.shipping_cost ?? ''} onChange={e => setH({ ...h, shipping_cost: e.target.value })} />
          </label>
          <label>Total Other Cost (USD)
            <input type="number" min="0" step="0.01" value={h.other_cost ?? ''} onChange={e => setH({ ...h, other_cost: e.target.value })} />
          </label>
        </div>
      </div>
      {bulkModalOpen && (
        <AddMultipleProductsModal
          inventory={inventory}
          inventoryLoadError={inventoryLoadError}
          inventoryLoading={inventoryLoading}
          existingInventoryIds={existingInventoryIds}
          existingPoLines={rows}
          currency={h.currency}
          exchangeRate={h.exchange_rate}
          middlemanOptions={middlemanOptions}
          supplierOptions={supplierOptions}
          onAdd={requestAddMultipleProducts}
          onCancel={() => setBulkModalOpen(false)}
        />
      )}
      {supplierConfirm && (
        <SupplierMismatchDialog
          productLabel={supplierConfirm.productLabel}
          mismatchedProducts={supplierConfirm.mismatchedProducts}
          onCancel={() => setSupplierConfirm(null)}
          onConfirm={confirmSupplierMismatch}
        />
      )}
      <div className="po-totals-box">
        <h3 className="po-summary-title">Purchase Order Summary</h3>
        <p><strong>Total Ordered Units:</strong> {totals.totalOrderedUnits}</p>
        <p><strong>Total Factory Product Cost (KRW):</strong> {h.currency === 'KRW' ? formatKrw(totals.totalProductCost) : '—'}</p>
        <p><strong>Total Factory Product Cost (USD):</strong> {formatUsd(totals.totalProductCostUsd)}</p>
        {isMiddleman && totals.totalCommissionOriginal > 0 && (
          <p><strong>Total Commission (KRW):</strong> {formatKrw(totals.totalCommissionOriginal)}</p>
        )}
        {isMiddleman && (
          <p><strong>Total Commission (USD):</strong> {formatUsd(totals.totalCommissionUsd)}</p>
        )}
        <p><strong>Total Shipping Cost (USD):</strong> {formatUsd(totals.shippingCost)}</p>
        <p><strong>Total Other Cost (USD):</strong> {formatUsd(totals.otherCost)}</p>
        <p><strong>Grand Total Purchase Cost (USD):</strong> {formatUsd(totals.totalPurchaseCostUsd)}</p>
      </div>
      <div className="po-form-actions">
        <button type="button" onClick={handleSave}>Save Purchase Order</button>
        <button type="button" className="soft" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function SupplierPurchaseOrderDoc({ po, lines, totals }) {
  const factoryTotal = totals.totalProductCost
  return (
    <div className="po-print-sheet po-supplier-doc invoice">
      <h1>INNER SOURCE BEAUTY</h1>
      <h2>SUPPLIER PURCHASE ORDER</h2>
      <div className="invoice-grid">
        <p><b>PO Number:</b> {po.po_number}<br /><b>Order Date:</b> {formatDisplayDate(po.order_date)}<br /><b>Status:</b> {po.status}</p>
        <p><b>Supplier:</b> {po.supplier || '—'}<br /><b>ETA:</b> {formatDisplayDate(po.eta)}</p>
        <p><b>Currency:</b> {po.currency}<br /><b>Notes:</b> {po.notes || '—'}</p>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Product</th><th>Style / SKU</th><th>Qty</th><th>Factory Unit Price</th><th>Factory Line Total</th></tr>
          </thead>
          <tbody>
            {lines.map(l => (
              <tr key={l.id || l.product_sku}>
                <td>{l.product_name || l.product_sku}</td>
                <td>{l.product_sku || '—'}</td>
                <td>{l.order_qty}</td>
                <td>{formatPoMoney(l.factory_unit_cost, po.currency)}</td>
                <td>{formatPoMoney(l.product_cost, po.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="po-totals-box">
        <p><strong>Factory Product Total:</strong> {formatPoMoney(factoryTotal, po.currency)}</p>
      </div>
      <p className="hint">Shipping instructions and delivery terms per supplier agreement.</p>
    </div>
  )
}

function InternalCostSheetDoc({ po, summary }) {
  const { totals, history } = summary
  const isMiddleman = totals.purchaseType === 'middleman'
  const lines = totals.lines || []
  const allocatedLines = allocateLineCosts(
    lines,
    totals.shippingCost,
    totals.otherCost,
    totals.purchaseType,
    totals.currency,
    totals.exchangeRate,
  )
  return (
    <div className="po-print-sheet po-internal-doc invoice">
      <p className="po-internal-banner">INTERNAL USE ONLY</p>
      <h1>INNER SOURCE BEAUTY</h1>
      <h2>INTERNAL COST SHEET</h2>
      <div className="invoice-grid">
        <p><b>PO Number:</b> {po.po_number}<br /><b>Purchase Type:</b> {purchaseTypeLabel(totals.purchaseType)}<br /><b>Supplier:</b> {po.supplier || '—'}</p>
        <p>{isMiddleman && <><b>Middleman Name:</b> {po.middleman_name || '—'}<br /></>}<b>Order Date:</b> {formatDisplayDate(po.order_date)}<br /><b>Status:</b> {po.status}</p>
        <p><b>Currency:</b> {totals.currency}<br /><b>Exchange Rate:</b> {totals.exchangeRate}<br /><b>ETA:</b> {formatDisplayDate(po.eta)}</p>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Product</th><th>Style / SKU</th><th>Qty</th>
              <th>Factory Unit Cost ({totals.currency})</th><th>Factory Unit Cost (USD)</th>
              {isMiddleman && <><th>Commission / Unit (KRW)</th><th>Commission / Unit (USD)</th><th>Commission Total (KRW)</th><th>Commission Total (USD)</th></>}
              <th>Total Unit Cost ({totals.currency})</th><th>Total Unit Cost (USD)</th>
              <th>Factory Product Cost ({totals.currency})</th>
              <th>Factory Product Cost (USD)</th>
              <th>Inventory Buying Price (USD)</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => {
              const allocated = allocatedLines[idx] || l
              return (
              <tr key={l.id || l.product_sku}>
                <td>{l.product_name || l.product_sku}</td>
                <td>{l.product_sku || '—'}</td>
                <td>{l.order_qty}</td>
                <td>{formatPoMoney(l.factory_unit_cost_original ?? l.factory_unit_cost, po.currency)}</td>
                <td>{formatUsd(l.factory_unit_cost_usd)}</td>
                {isMiddleman && <><td>{formatKrw(l.middleman_commission_unit_krw)}</td><td>{formatUsd(l.commission_per_unit_usd)}</td><td>{formatKrw(l.middleman_commission_total_krw)}</td><td>{formatUsd(l.commission_total_usd)}</td></>}
                <td>{formatPoMoney(l.total_unit_cost_krw || l.total_unit_cost_usd, po.currency)}</td>
                <td>{formatUsd(l.total_unit_cost_usd)}</td>
                <td>{formatPoMoney(l.product_cost, po.currency)}</td>
                <td>{formatUsd(l.product_cost_usd)}</td>
                <td>{formatUsd(allocated.final_unit_cost ?? allocated.landed_unit_cost ?? 0)}</td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <h3>Receive History</h3>
      {history.length === 0 ? (
        <p className="hint">No inventory received yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Receive #</th><th>Date</th><th>Shipment #</th><th>Received Qty</th>
                <th>Shipping Cost</th><th>Other Cost</th><th>Other Cost Description</th><th>Received By</th>
              </tr>
            </thead>
            <tbody>
              {history.map(rec => (
                <tr key={rec.id}>
                  <td>{rec.receive_number}</td>
                  <td>{formatDisplayDate(rec.received_date)}</td>
                  <td>{rec.shipment_number || '—'}</td>
                  <td>{rec.received_qty}</td>
                  <td>{formatUsd(rec.shipping_cost)}</td>
                  <td>{formatUsd(rec.other_cost)}</td>
                  <td>{rec.other_cost_description || '—'}</td>
                  <td>{rec.received_by || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {history.map(rec => (
        <div key={`detail-${rec.id}`} className="po-receive-print-block">
          <h4>{rec.receive_number} — Line Details</h4>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Product</th><th>Qty</th><th>Landed Unit Cost</th></tr>
              </thead>
              <tbody>
                {(rec.items || []).map(item => (
                  <tr key={item.id || item.product}>
                    <td>{item.product}</td>
                    <td>{item.received_qty}</td>
                    <td>{formatUsd(item.landed_unit_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <div className="po-totals-box">
        <h3 className="po-summary-title">Purchase Order Summary</h3>
        <p><strong>Total Ordered Units:</strong> {totals.totalOrderedUnits ?? lines.reduce((s, l) => s + Number(l.order_qty || 0), 0)}</p>
        <p><strong>Total Factory Product Cost (KRW):</strong> {totals.currency === 'KRW' ? formatKrw(totals.totalProductCost) : '—'}</p>
        <p><strong>Total Factory Product Cost (USD):</strong> {formatUsd(totals.totalProductCostUsd)}</p>
        {isMiddleman && <p><strong>Total Middleman Commission (KRW):</strong> {formatKrw(lines.reduce((s, l) => s + (l.middleman_commission_total_krw || 0), 0))}</p>}
        {isMiddleman && <p><strong>Total Middleman Commission (USD):</strong> {formatUsd(totals.totalCommissionUsd)}</p>}
        <p><strong>Total Shipping Cost (USD):</strong> {formatUsd(totals.shippingCost)}</p>
        <p><strong>Total Other Cost (USD):</strong> {formatUsd(totals.otherCost)}</p>
        <p><strong>Total Purchase Cost (USD):</strong> {formatUsd(totals.totalPurchaseCostUsd)}</p>
      </div>
    </div>
  )
}

function CommissionPaymentReceiptDoc({ po, items, payment, payments }) {
  const totals = commissionPaymentReceiptTotals(po, items, payments, payment.id)
  if (!totals) return null
  return (
    <div className="po-print-sheet po-commission-print-sheet po-commission-receipt-doc invoice">
      <h1>INNER SOURCE BEAUTY</h1>
      <h2>COMMISSION PAYMENT RECEIPT</h2>
      <div className="invoice-grid po-commission-print-meta">
        <p><b>PO Number:</b> {po.po_number || '—'}<br /><b>Supplier:</b> {po.supplier || '—'}</p>
        <p><b>Middleman Name:</b> {po.middleman_name || '—'}<br /><b>Printed Date:</b> {formatPrintDate(new Date())}</p>
      </div>
      <div className="po-commission-print-details">
        <p><b>Total Commission Due (KRW):</b> {formatKrw(totals.dueKrw)}</p>
        <p><b>Payment Amount (KRW):</b> {formatKrw(paymentAmountKrw(payment, po))}</p>
        <p><b>Payment Date:</b> {formatDisplayDate(payment.payment_date)}</p>
        <p><b>Payment Method:</b> {payment.payment_method || '—'}</p>
        <p><b>Reference Number:</b> {payment.reference_number || '—'}</p>
        <p><b>Notes:</b> {payment.notes || '—'}</p>
        <p><b>Total Paid (KRW):</b> {formatKrw(totals.paidAfterKrw)}</p>
        <p><b>Remaining Balance (KRW):</b> {formatKrw(totals.balanceKrw)}</p>
        <p><b>Payment Status:</b> {totals.status}</p>
      </div>
    </div>
  )
}

function CommissionPaymentHistoryDoc({ po, items, payments }) {
  const summary = commissionPaymentSummary(po, items, payments)
  const chronological = commissionPaymentsChronological(payments)
  return (
    <div className="po-print-sheet po-commission-print-sheet po-commission-history-doc invoice">
      <h1>INNER SOURCE BEAUTY</h1>
      <h2>COMMISSION PAYMENT HISTORY</h2>
      <div className="invoice-grid po-commission-print-meta">
        <p><b>PO Number:</b> {po.po_number || '—'}<br /><b>Supplier:</b> {po.supplier || '—'}</p>
        <p><b>Middleman Name:</b> {po.middleman_name || '—'}<br /><b>Printed Date:</b> {formatPrintDate(new Date())}</p>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Payment Date</th><th>Amount (KRW)</th><th>Payment Method</th><th>Reference Number</th><th>Notes</th><th>Created By</th>
            </tr>
          </thead>
          <tbody>
            {chronological.map(payment => (
              <tr key={payment.id}>
                <td>{formatDisplayDate(payment.payment_date)}</td>
                <td>{formatKrw(paymentAmountKrw(payment, po))}</td>
                <td>{payment.payment_method || '—'}</td>
                <td>{payment.reference_number || '—'}</td>
                <td>{payment.notes || '—'}</td>
                <td>{payment.created_by || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="po-totals-box">
        <p><strong>Total Commission Due (KRW):</strong> {formatKrw(summary.dueKrw)}</p>
        <p><strong>Total Paid (KRW):</strong> {formatKrw(summary.paidKrw)}</p>
        <p><strong>Remaining Balance (KRW):</strong> {formatKrw(summary.balanceKrw)}</p>
        <p><strong>Payment Status:</strong> {summary.status}</p>
      </div>
    </div>
  )
}

function CommissionPaymentStatusBadge({ status }) {
  const cls = String(status || 'unpaid').toLowerCase()
  return <span className={`po-commission-status po-commission-status-${cls}`}>{status || 'Unpaid'}</span>
}

function CommissionPaymentPanel({
  po, items, payments, isAdmin, canEdit, onAddPayment, onDeletePayment,
}) {
  const [entry, setEntry] = useState(() => ({ ...blankCommissionPaymentEntry(), payment_date: today() }))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [printView, setPrintView] = useState('')
  const [printPaymentId, setPrintPaymentId] = useState('')
  const summary = useMemo(() => commissionPaymentSummary(po, items, payments), [po, items, payments])
  const convertedEntryUsd = useMemo(
    () => convertCommissionKrwToUsd(Number(entry.amount_krw) || 0, po),
    [entry.amount_krw, po],
  )
  const printPayment = payments.find(p => String(p.id) === String(printPaymentId))

  function triggerCommissionPrint(view, paymentId = '') {
    const bodyClass = view === 'receipt' ? 'po-print-commission-receipt' : 'po-print-commission-history'
    setPrintView(view)
    setPrintPaymentId(paymentId)
    document.body.classList.add(bodyClass)
    setTimeout(() => {
      window.print()
      document.body.classList.remove(bodyClass)
      setPrintView('')
      setPrintPaymentId('')
    }, 50)
  }

  function handlePrintReceipt(paymentId) {
    if (!paymentId) return
    triggerCommissionPrint('receipt', paymentId)
  }

  function handlePrintHistory() {
    if (!payments.length) return
    triggerCommissionPrint('history')
  }

  function handlePrintLatestReceipt() {
    if (!payments.length) return
    handlePrintReceipt(payments[0].id)
  }

  async function handleAddPayment(e) {
    e.preventDefault()
    setError('')
    const validationError = validateCommissionPaymentEntry(entry)
    if (validationError) { setError(validationError); return }
    setBusy(true)
    const err = await onAddPayment(po.id, entry)
    setBusy(false)
    if (err) { setError(err); return }
    setEntry({ ...blankCommissionPaymentEntry(), payment_date: today() })
  }

  async function handleDeletePayment(paymentId) {
    if (!confirm('Delete this commission payment record?')) return
    setBusy(true)
    const err = await onDeletePayment(paymentId)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <>
      {printView === 'receipt' && printPayment && (
        <CommissionPaymentReceiptDoc po={po} items={items} payment={printPayment} payments={payments} />
      )}
      {printView === 'history' && (
        <CommissionPaymentHistoryDoc po={po} items={items} payments={payments} />
      )}

      <div className={`form-section po-commission-panel po-commission-screen${printView ? ' screen-only-hidden' : ''}`}>
      <div className="po-commission-head">
        <h3>Commission Payment</h3>
        <p className="hint">Middleman: <b>{po.middleman_name || '—'}</b></p>
        <div className="po-commission-print-actions no-print">
          <button type="button" className="soft" disabled={!payments.length} onClick={handlePrintLatestReceipt}>
            Print Payment Receipt
          </button>
          <button type="button" className="soft" disabled={!payments.length} onClick={handlePrintHistory}>
            Print Payment History
          </button>
        </div>
      </div>

      <div className="po-commission-section">
        <h4>Commission Summary</h4>
        <div className="cards po-commission-summary-cards">
          <div className="card"><p>Total Commission Due (KRW)</p><b>{formatKrw(summary.dueKrw)}</b></div>
          <div className="card"><p>Converted Commission Due (USD)</p><b>{formatUsd(summary.dueUsd)}</b></div>
          <div className="card"><p>Total Paid (KRW)</p><b>{formatKrw(summary.paidKrw)}</b></div>
          <div className="card"><p>Converted Total Paid (USD)</p><b>{formatUsd(summary.paidUsd)}</b></div>
          <div className="card"><p>Remaining Balance (KRW)</p><b>{formatKrw(summary.balanceKrw)}</b></div>
          <div className="card"><p>Converted Remaining Balance (USD)</p><b>{formatUsd(summary.balanceUsd)}</b></div>
          <div className="card"><p>Payment Status</p><b><CommissionPaymentStatusBadge status={summary.status} /></b></div>
        </div>
      </div>

      {isAdmin && canEdit && (
        <div className="po-commission-section">
          <h4>Add Payment</h4>
          <form className="po-commission-add-form" onSubmit={handleAddPayment}>
            <div className="form-grid po-commission-add-grid">
              <label>Amount Paid (KRW)
                <input type="number" min="0" step="1" value={entry.amount_krw}
                  onChange={e => setEntry({ ...entry, amount_krw: e.target.value })} />
              </label>
              <label>Converted Amount Paid (USD)
                <input type="text" readOnly value={formatUsd(convertedEntryUsd)} className="po-readonly-field" />
              </label>
              <label>Payment Date
                <input type="date" value={entry.payment_date}
                  onChange={e => setEntry({ ...entry, payment_date: e.target.value })} />
              </label>
              <label>Payment Method
                <select value={entry.payment_method} onChange={e => setEntry({ ...entry, payment_method: e.target.value })}>
                  {COMMISSION_PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
                </select>
              </label>
              <label>Reference Number
                <input value={entry.reference_number} onChange={e => setEntry({ ...entry, reference_number: e.target.value })} />
              </label>
              <label className="po-notes-field">Notes
                <textarea rows={2} value={entry.notes} onChange={e => setEntry({ ...entry, notes: e.target.value })} />
              </label>
            </div>
            {error && <p className="hint po-receive-error">{error}</p>}
            <button type="submit" disabled={busy}>Add Payment</button>
          </form>
        </div>
      )}

      <div className="po-commission-section">
        <h4>Payment History</h4>
        {payments.length === 0 ? (
          <p className="hint">No commission payments recorded yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Amount (KRW)</th><th>Converted Amount (USD)</th><th>Method</th><th>Reference</th><th>Notes</th><th>Created By</th>
                  <th className="no-print"></th>
                  {isAdmin && canEdit && <th className="no-print"></th>}
                </tr>
              </thead>
              <tbody>
                {payments.map(payment => (
                  <tr key={payment.id}>
                    <td>{formatDisplayDate(payment.payment_date)}</td>
                    <td>{formatKrw(paymentAmountKrw(payment, po))}</td>
                    <td>{formatUsd(paymentAmountUsd(payment, po))}</td>
                    <td>{payment.payment_method || '—'}</td>
                    <td>{payment.reference_number || '—'}</td>
                    <td>{payment.notes || '—'}</td>
                    <td>{payment.created_by || '—'}</td>
                    <td className="no-print">
                      <button type="button" className="soft link-cell" onClick={() => handlePrintReceipt(payment.id)}>
                        Print
                      </button>
                    </td>
                    {isAdmin && canEdit && (
                      <td className="no-print">
                        <button type="button" className="danger soft link-cell" disabled={busy}
                          onClick={() => handleDeletePayment(payment.id)}>Delete</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    </>
  )
}

function PurchaseOrderDetail({
  po, items, receipts, receives, commissionPayments, isAdmin, onBack, onEdit, onReceive, onCancel,
  onAddCommissionPayment, onDeleteCommissionPayment,
}) {
  const [showInternalDetails, setShowInternalDetails] = useState(false)
  const [printView, setPrintView] = useState('')
  const [historyDetail, setHistoryDetail] = useState(null)
  const purchaseType = resolvePurchaseType(po, items)
  const isMiddleman = purchaseType === 'middleman'
  const summary = internalCostSummary(po, items, receives, receipts)
  const { totals, history } = summary
  const lines = totals.lines || []
  const canEditCommissionPayments = isAdmin && po.status !== 'Cancelled'

  function exportSupplierCsv() {
    downloadCsv(
      `${po.po_number || 'PO'}_supplier.csv`,
      ['PO Number', 'Order Date', 'Supplier', 'Product', 'SKU', 'Qty', 'Factory Unit Price', 'Factory Line Total', 'ETA', 'Notes'],
      buildSupplierCsvRows(po, totals.lines),
    )
  }

  function exportInternalCsv() {
    downloadCsv(
      `${po.po_number || 'PO'}_internal.csv`,
      ['Purchase Type', 'PO Number', 'Receive #', 'Receive Date', 'Shipment #', 'Product', 'Received Qty', 'Factory Unit Cost', 'Commission Per Unit', 'Shipping Allocation', 'Other Allocation', 'Landed Unit Cost', 'Receive Shipping', 'Receive Other', 'Other Cost Description', 'Total Factory', 'Total Commission', 'Total Shipping', 'Total Other', 'Grand Total'],
      buildInternalCsvRows(po, summary),
    )
  }

  function handlePrint(view) {
    setPrintView(view)
    setTimeout(() => { window.print(); setPrintView('') }, 50)
  }

  return (
    <div className="panel po-detail-panel">
      <div className="po-detail-actions no-print">
        <button type="button" className="soft" onClick={onBack}>Back</button>
        {isAdmin && canEditPo(po, 'Admin') && <button type="button" onClick={() => onEdit(po.id)}>Edit</button>}
        {isAdmin && canReceivePo(po, 'Admin') && <button type="button" onClick={() => onReceive(po.id)}>Receive Inventory</button>}
        {isAdmin && canCancelPo(po, 'Admin') && <button type="button" className="danger" onClick={() => onCancel(po.id)}>Cancel PO</button>}
        <button type="button" onClick={() => handlePrint('supplier')}>Print Supplier PO</button>
        <button type="button" className="soft" onClick={exportSupplierCsv}>Export Supplier PO CSV</button>
        <button type="button" onClick={() => handlePrint('internal')}>Print Internal Cost Sheet</button>
        <button type="button" className="soft" onClick={exportInternalCsv}>Export Internal Cost CSV</button>
      </div>

      {printView === 'supplier' && (
        <SupplierPurchaseOrderDoc po={po} lines={totals.lines} totals={totals} />
      )}
      {printView === 'internal' && (
        <InternalCostSheetDoc po={po} summary={summary} />
      )}

      <div className={`po-detail-main${printView ? ' screen-only-hidden' : ''}`}>
        <div className="po-detail-summary">
          <h2>{po.po_number}</h2>
          <p><b>Supplier:</b> {po.supplier || '—'} · <b>Purchase Type:</b> {purchaseTypeLabel(purchaseType)} · <b>Status:</b> <PoStatusBadge status={po.status} /></p>
          <p><b>Order Date:</b> {formatDisplayDate(po.order_date)} · <b>ETA:</b> {formatDisplayDate(po.eta)} · <b>Exchange Rate:</b> {totals.exchangeRate} · <b>Total Purchase Cost (USD):</b> {formatUsd(totals.totalPurchaseCostUsd)}</p>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th><th>Style / SKU</th><th>Qty</th><th>Factory Unit Cost ({totals.currency})</th>
                <th>Factory Line Total</th><th>Received Qty</th><th>Remaining Qty</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l => (
                <tr key={l.id || l.product_sku}>
                  <td>{l.product_name || l.product_sku}</td>
                  <td>{l.product_sku || '—'}</td>
                  <td>{l.order_qty}</td>
                  <td>{formatPoMoney(l.factory_unit_cost_original ?? l.factory_unit_cost, po.currency)}</td>
                  <td>{formatPoMoney(l.product_cost, po.currency)}</td>
                  <td>{l.received_qty}</td>
                  <td>{l.remaining_qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="form-section po-receive-history">
          <h3>Receive History</h3>
          {history.length === 0 ? (
            <p className="hint">No inventory received yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Receive #</th><th>Receive Date</th><th>Received Qty</th><th>Shipping Cost</th>
                    <th>Other Cost</th><th>Other Cost Description</th><th>Received By</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(rec => (
                    <tr key={rec.id}>
                      <td><b>{rec.receive_number}</b></td>
                      <td>{formatDisplayDate(rec.received_date)}</td>
                      <td>{rec.received_qty}</td>
                      <td>{formatUsd(rec.shipping_cost)}</td>
                      <td>{formatUsd(rec.other_cost)}</td>
                      <td>{rec.other_cost_description || '—'}</td>
                      <td>{rec.received_by || '—'}</td>
                      <td><button type="button" className="link-cell" onClick={() => setHistoryDetail(rec)}>View Details</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint">Received progress: {receivedProgress(items)}</p>
        </div>

        <button type="button" className="soft po-toggle-internal" onClick={() => setShowInternalDetails(v => !v)}>
          {showInternalDetails ? 'Hide Internal Cost Details' : 'Show Internal Cost Details'}
        </button>

        {showInternalDetails && (
          <div className="po-internal-details">
            <h3 className="po-summary-title">Purchase Order Summary</h3>
            <p><b>Purchase Type:</b> {purchaseTypeLabel(purchaseType)}</p>
            {isMiddleman && <p><b>Middleman Name:</b> {po.middleman_name || '—'}</p>}
            <p><b>Total Ordered Units:</b> {totals.totalOrderedUnits}</p>
            <p><b>Total Factory Product Cost (KRW):</b> {totals.currency === 'KRW' ? formatKrw(totals.totalProductCost) : '—'}</p>
            <p><b>Total Factory Product Cost (USD):</b> {formatUsd(totals.totalProductCostUsd)}</p>
            {isMiddleman && totals.totalCommissionOriginal > 0 && (
              <p><b>Total Commission (KRW):</b> {formatKrw(totals.totalCommissionOriginal)}</p>
            )}
            {isMiddleman && <p><b>Total Commission (USD):</b> {formatUsd(totals.totalCommissionUsd)}</p>}
            <p><b>Total Shipping Cost (USD):</b> {formatUsd(totals.shippingCost)}</p>
            <p><b>Total Other Cost (USD):</b> {formatUsd(totals.otherCost)}</p>
            <p><b>Grand Total Purchase Cost (USD):</b> {formatUsd(totals.totalPurchaseCostUsd)}</p>
          </div>
        )}
      </div>

      {historyDetail && (
        <ReceiveHistoryDetailModal receive={historyDetail} po={po} onClose={() => setHistoryDetail(null)} />
      )}

      {isMiddleman && (
        <CommissionPaymentPanel
          po={po}
          items={items}
          payments={commissionPayments}
          isAdmin={isAdmin}
          canEdit={canEditCommissionPayments}
          onAddPayment={onAddCommissionPayment}
          onDeletePayment={onDeleteCommissionPayment}
        />
      )}
    </div>
  )
}

export function PurchaseOrdersPage({
  data, role, isAdmin, selectedPoId, clearSelection, draftPoSeed,
  clearDraftPoSeed, nextPoNumber, onSavePo, onReceivePo, onCancelPo,
  onAddCommissionPayment, onDeleteCommissionPayment,
  inventoryLoadError = '', dataLoading = false,
}) {
  const [view, setView] = useState('list')
  const [filter, setFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState('')
  const [detailId, setDetailId] = useState('')
  const [receiveId, setReceiveId] = useState('')
  const [busy, setBusy] = useState(false)

  const pos = data.purchase_orders || []
  const allItems = data.purchase_order_items || []
  const allReceipts = data.purchase_order_receipts || []
  const allReceives = data.purchase_order_receives || []
  const allCommissionPayments = data.purchase_order_commission_payments || []
  const stats = poSummaryStats(pos, allItems)

  useEffect(() => {
    if (selectedPoId) {
      setDetailId(selectedPoId)
      setView('detail')
      clearSelection?.()
    }
  }, [selectedPoId])

  useEffect(() => {
    if (draftPoSeed) {
      setView('create')
      clearDraftPoSeed?.()
    }
  }, [draftPoSeed])

  const filtered = useMemo(() => pos.filter(po => {
    const items = poItemsForOrder(allItems, po.id)
    return poMatchesFilter(po, filter) && poMatchesSearch(po, items, search)
  }), [pos, allItems, filter, search])

  const detailPo = pos.find(p => String(p.id) === String(detailId))
  const editPo = pos.find(p => String(p.id) === String(editingId))
  const receivePo = pos.find(p => String(p.id) === String(receiveId))

  async function handleSave({ header, lines }) {
    setBusy(true)
    const err = await onSavePo({ id: editingId || '', header, lines })
    setBusy(false)
    if (!err) { setView('list'); setEditingId('') }
  }

  async function handleReceive(payload) {
    setBusy(true)
    const err = await onReceivePo(receiveId, payload)
    setBusy(false)
    if (!err) { setReceiveId(''); setView('detail') }
  }

  const middlemanOptions = useMemo(
    () => collectMiddlemanOptions(pos, data.inventory || []),
    [pos, data.inventory],
  )
  const supplierOptions = useMemo(
    () => collectSupplierOptions(pos, data.inventory || []),
    [pos, data.inventory],
  )

  if (view === 'create') {
    return (
      <PurchaseOrderForm
        header={draftPoSeed?.header || blankPoHeader(nextPoNumber)}
        lines={draftPoSeed?.lines || [blankPoLine()]}
        inventory={data.inventory}
        isAdmin={isAdmin}
        editing={false}
        nextPoNumber={nextPoNumber}
        middlemanOptions={middlemanOptions}
        supplierOptions={supplierOptions}
        inventoryLoadError={inventoryLoadError}
        inventoryLoading={dataLoading}
        onSave={handleSave}
        onCancel={() => { setView('list'); clearDraftPoSeed?.() }}
      />
    )
  }

  if (view === 'edit' && editPo) {
    return (
      <PurchaseOrderForm
        header={editPo}
        lines={poItemsForOrder(allItems, editPo.id)}
        inventory={data.inventory}
        isAdmin={isAdmin}
        editing
        nextPoNumber={editPo.po_number}
        middlemanOptions={middlemanOptions}
        supplierOptions={supplierOptions}
        inventoryLoadError={inventoryLoadError}
        inventoryLoading={dataLoading}
        onSave={handleSave}
        onCancel={() => { setView('detail'); setEditingId('') }}
      />
    )
  }

  if (view === 'detail' && detailPo) {
    const items = poItemsForOrder(allItems, detailPo.id)
    const receipts = allReceipts.filter(r => String(r.purchase_order_id) === String(detailPo.id))
    const receives = poReceivesForOrder(allReceives, detailPo.id)
    const commissionPayments = poCommissionPaymentsForOrder(allCommissionPayments, detailPo.id)
    return (
      <>
        <PurchaseOrderDetail
          po={detailPo}
          items={items}
          receipts={receipts}
          receives={receives}
          commissionPayments={commissionPayments}
          isAdmin={isAdmin}
          onBack={() => { setView('list'); setDetailId('') }}
          onEdit={id => { setEditingId(id); setView('edit') }}
          onReceive={id => setReceiveId(id)}
          onCancel={async id => { if (confirm('Cancel this purchase order?')) await onCancelPo(id); setView('list') }}
          onAddCommissionPayment={onAddCommissionPayment}
          onDeleteCommissionPayment={onDeleteCommissionPayment}
        />
        {receiveId && receivePo && (
          <ReceiveInventoryModal
            po={receivePo}
            inventory={data.inventory || []}
            items={poItemsForOrder(allItems, receivePo.id).map(l => calcLineItem(
              l,
              resolvePurchaseType(receivePo, poItemsForOrder(allItems, receivePo.id)),
              receivePo.currency,
              receivePo.exchange_rate,
            ))}
            onCancel={() => setReceiveId('')}
            onConfirm={handleReceive}
            busy={busy}
          />
        )}
      </>
    )
  }

  return (
    <div className="panel po-list-panel">
      <div className="po-list-head">
        <h2>Purchase Orders</h2>
        {isAdmin && <button type="button" onClick={() => { setEditingId(''); setView('create') }}>+ New Purchase Order</button>}
      </div>
      <div className="cards po-summary-cards">
        <div className="card"><p>Open Purchase Orders</p><b>{stats.openCount}</b></div>
        <div className="card"><p>Total Purchase Cost (Open, USD)</p><b>{formatUsd(stats.totalOrderedAmount)}</b></div>
        <div className="card"><p>Incoming Units</p><b>{stats.incomingUnits}</b></div>
      </div>
      <div className="po-filters">
        {PO_FILTER_STATUSES.map(f => (
          <button key={f} type="button" className={`soft filter-btn${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>
      <input className="search po-search" placeholder="Search PO number, supplier, product, notes..." value={search} onChange={e => setSearch(e.target.value)} />
      <div className="table-wrap po-list-table">
        <table>
          <thead>
            <tr>
              <th>PO Number</th><th>Order Date</th><th>Supplier</th><th>Purchase Type</th><th>Total Units</th>
              <th>Total Purchase Cost</th><th>ETA</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="hint">No purchase orders found.</td></tr>
            ) : filtered.map(po => {
              const items = poItemsForOrder(allItems, po.id)
              const type = resolvePurchaseType(po, items)
              return (
                <tr key={po.id}>
                  <td><b>{po.po_number}</b></td>
                  <td>{formatDisplayDate(po.order_date)}</td>
                  <td>{po.supplier || '—'}</td>
                  <td>{purchaseTypeLabel(type)}</td>
                  <td>{po.total_ordered_units ?? '—'}</td>
                  <td>{formatUsd(po.total_purchase_cost_usd ?? po.grand_total)}</td>
                  <td>{formatDisplayDate(po.eta)}</td>
                  <td><PoStatusBadge status={po.status} /></td>
                  <td className="po-actions-cell">
                    <button type="button" className="link-cell" onClick={() => { setDetailId(po.id); setView('detail') }}>View</button>
                    {isAdmin && canEditPo(po, role) && (
                      <button type="button" className="link-cell" onClick={() => { setEditingId(po.id); setView('edit') }}>Edit</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PoSummaryMobileCards({ rows, purchaseOrders }) {
  const orderDateById = Object.fromEntries((purchaseOrders || []).map(po => [po.id, po.order_date]))
  return (
    <div className="po-summary-report-cards">
      {rows.map(r => (
        <article key={r.id} className="po-summary-report-card">
          <dl className="report-card-meta">
            <div className="report-card-row"><dt>PO Number</dt><dd>{r.po_number || '—'}</dd></div>
            <div className="report-card-row"><dt>Supplier</dt><dd>{r.supplier || '—'}</dd></div>
            <div className="report-card-row"><dt>Purchase Type</dt><dd>{r.purchase_type || '—'}</dd></div>
            <div className="report-card-row"><dt>Order Date</dt><dd>{formatDisplayDate(orderDateById[r.id])}</dd></div>
            <div className="report-card-row"><dt>Status</dt><dd>{r.status || '—'}</dd></div>
          </dl>
        </article>
      ))}
    </div>
  )
}

function CommissionReportMobileCards({ rows }) {
  return (
    <div className="commission-report-cards">
      {rows.map(r => (
        <article key={r.id} className="commission-report-card">
          <p className="commission-report-date">{formatDisplayDate(r.date)}</p>
          <dl className="report-card-meta">
            <div className="report-card-row"><dt>Middleman</dt><dd>{r.middleman || '—'}</dd></div>
            <div className="report-card-row"><dt>PO Number</dt><dd>{r.po_number || '—'}</dd></div>
            <div className="report-card-row"><dt>Product</dt><dd>{r.product || '—'}</dd></div>
            <div className="report-card-row"><dt>Qty</dt><dd>{r.qty}</dd></div>
            <div className="report-card-row"><dt>Commission</dt><dd>{formatUsd(r.commission_total)}</dd></div>
            <div className="report-card-row"><dt>PO Status</dt><dd>{r.po_status || '—'}</dd></div>
            <div className="report-card-row"><dt>Payment Status</dt><dd>{r.payment_status || '—'}</dd></div>
          </dl>
        </article>
      ))}
    </div>
  )
}

function IncomingInventoryMobileCards({ rows }) {
  return (
    <div className="incoming-inventory-cards">
      {rows.map(r => (
        <article key={r.id} className="incoming-inventory-card">
          <p className="incoming-inventory-product">{r.product || '—'}</p>
          <dl className="report-card-meta">
            <div className="report-card-row"><dt>Ordered</dt><dd>{r.ordered}</dd></div>
            <div className="report-card-row"><dt>Received</dt><dd>{r.received}</dd></div>
            <div className="report-card-row"><dt>Remaining</dt><dd>{r.remaining}</dd></div>
            <div className="report-card-row"><dt>ETA</dt><dd>{formatDisplayDate(r.eta)}</dd></div>
            <div className="report-card-row"><dt>Supplier</dt><dd>{r.supplier || '—'}</dd></div>
            <div className="report-card-row"><dt>PO Number</dt><dd>{r.po_number || '—'}</dd></div>
          </dl>
        </article>
      ))}
    </div>
  )
}

export function PurchaseOrderReports({ data, dateFrom, dateTo, onDateFromChange, onDateToChange }) {
  const pos = data.purchase_orders || []
  const items = data.purchase_order_items || []
  const summary = poReportSummary(pos, items)
  const commissionRows = middlemanCommissionReport(pos, items, dateFrom, dateTo)
  const incomingRows = incomingInventoryReport(pos, items)
  const commTotals = reportTotalsForCommission(commissionRows)
  const incomingTotals = reportTotalsForIncoming(incomingRows)

  return (
    <>
      <h3>Purchase Order Summary</h3>
      <PoSummaryMobileCards rows={summary} purchaseOrders={pos} />
      <div className="table-wrap po-summary-report-table">
        <table>
          <thead><tr><th>PO Number</th><th>Supplier</th><th>Purchase Type</th><th>Total Units</th><th>Total Purchase Cost</th><th>Status</th></tr></thead>
          <tbody>
            {summary.map(r => (
              <tr key={r.id}>
                <td>{r.po_number}</td><td>{r.supplier}</td><td>{r.purchase_type}</td><td>{r.total_units}</td>
                <td>{formatUsd(r.total_purchase_cost)}</td><td>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Middleman Commission Report</h3>
      <div className="form-grid po-report-dates">
        <label>From<input type="date" value={dateFrom} onChange={e => onDateFromChange(e.target.value)} /></label>
        <label>To<input type="date" value={dateTo} onChange={e => onDateToChange(e.target.value)} /></label>
      </div>
      <p className="commission-report-total"><strong>Total Commission (USD):</strong> {formatUsd(commTotals.totalCommission)}</p>
      <CommissionReportMobileCards rows={commissionRows} />
      <div className="table-wrap commission-report-table">
        <table>
          <thead><tr><th>Date</th><th>Middleman</th><th>PO Number</th><th>Product</th><th>Qty</th><th>Commission / Unit (KRW)</th><th>Commission Total</th><th>PO Status</th><th>Payment Status</th></tr></thead>
          <tbody>
            {commissionRows.map(r => (
              <tr key={r.id}>
                <td>{formatDisplayDate(r.date)}</td><td>{r.middleman || '—'}</td><td>{r.po_number}</td><td>{r.product}</td>
                <td>{r.qty}</td><td>{formatKrw(r.commission_unit_krw)}</td><td>{formatUsd(r.commission_total)}</td>
                <td>{r.po_status}</td><td>{r.payment_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Incoming Inventory Report</h3>
      <p className="incoming-inventory-totals">
        <strong>Total Ordered Units:</strong> {incomingTotals.totalOrderedUnits} ·{' '}
        <strong>Total Received Units:</strong> {incomingTotals.totalReceivedUnits} ·{' '}
        <strong>Total Remaining Units:</strong> {incomingTotals.totalRemainingUnits}
      </p>
      <IncomingInventoryMobileCards rows={incomingRows} />
      <div className="table-wrap incoming-inventory-report-table">
        <table>
          <thead><tr><th>Product</th><th>Ordered</th><th>Received</th><th>Remaining</th><th>ETA</th><th>Supplier</th><th>PO Number</th></tr></thead>
          <tbody>
            {incomingRows.map(r => (
              <tr key={r.id}>
                <td>{r.product}</td><td>{r.ordered}</td><td>{r.received}</td><td>{r.remaining}</td>
                <td>{formatDisplayDate(r.eta)}</td><td>{r.supplier}</td><td>{r.po_number}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
