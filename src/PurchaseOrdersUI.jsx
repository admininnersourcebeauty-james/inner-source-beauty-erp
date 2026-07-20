import React, { useEffect, useMemo, useState } from 'react'
import {
  PO_STATUSES, PO_FILTER_STATUSES, PO_CURRENCIES, PO_PURCHASE_TYPES,
  calcLineItem, calcPoTotals, allocateReceiveCosts, blankPoHeader, blankPoLine,
  canCancelPo, canEditPo, canReceivePo, commissionAmountDue, commissionBalance,
  deriveCommissionPaymentStatus, formatKrw, formatPoMoney,
  poItemsForOrder, poMatchesFilter, poMatchesSearch, receivedProgress,
  poSummaryStats, buildSupplierCsvRows, buildInternalCsvRows, downloadCsv,
  resolvePurchaseType, isMiddlemanPo, purchaseTypeLabel,
  poReportSummary, middlemanCommissionReport, incomingInventoryReport,
  reportTotalsForCommission, reportTotalsForIncoming,
  internalCostSummary, poReceivesForOrder,
  factoryUnitCostLabel, factoryProductCostLabel, formatUsd,
  MIDDLEMAN_COMMISSION_UNIT_LABEL, totalUnitCostLabel, migratePoLineCommissionToKrw,
} from './purchaseOrders.js'

const today = () => new Date().toISOString().slice(0, 10)

function PoStatusBadge({ status }) {
  const cls = String(status || '').toLowerCase().replace(/\s+/g, '-')
  return <span className={`po-status-badge po-status-${cls}`}>{status || '—'}</span>
}

function ReceiveInventoryModal({ po, items, onCancel, onConfirm, busy }) {
  const purchaseType = resolvePurchaseType(po, items)
  const [header, setHeader] = useState({
    received_date: today(),
    shipment_number: '',
    shipping_cost: '',
    other_cost: '',
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
    return allocateReceiveCosts(active, shippingCost, otherCost, purchaseType)
  }, [lines, items, shippingCost, otherCost, purchaseType])

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
            <label>Shipping Cost (USD)<input type="number" min="0" step="0.01" value={header.shipping_cost} onChange={e => setHeader({ ...header, shipping_cost: e.target.value })} /></label>
            <label>Other Cost (USD, Optional)<input type="number" min="0" step="0.01" value={header.other_cost} onChange={e => setHeader({ ...header, other_cost: e.target.value })} /></label>
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
                  <th>Receiving Qty</th><th>Landed Unit Cost</th>
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
          <p><b>Receive Date:</b> {String(receive.received_date || '').slice(0, 10) || '—'}</p>
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
                <th>Shipping Alloc.</th><th>Other Alloc.</th><th>Landed Unit Cost</th>
              </tr>
            </thead>
            <tbody>
              {(receive.items || []).map(item => (
                <tr key={item.id || `${item.purchase_order_item_id}-${item.received_qty}`}>
                  <td>{item.product}</td>
                  <td>{item.received_qty}</td>
                  <td>{formatUsd(item.factory_unit_cost)}</td>
                  <td>{formatUsd(item.commission_per_unit)}</td>
                  <td>{formatUsd(item.shipping_allocation)}</td>
                  <td>{formatUsd(item.other_cost_allocation)}</td>
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

function PurchaseOrderForm({ header, lines, inventory, isAdmin, editing, onSave, onCancel, nextPoNumber }) {
  const initialType = resolvePurchaseType(header, lines)
  const [h, setH] = useState(() => ({
    ...blankPoHeader(nextPoNumber),
    ...header,
    purchase_type: header.purchase_type || initialType,
    order_date: header.order_date || today(),
  }))
  const [rows, setRows] = useState(() => {
    const initialLines = lines.length ? lines : [blankPoLine()]
    const rate = header.exchange_rate || '1350'
    return initialLines.map(line => migratePoLineCommissionToKrw(line, rate))
  })
  const isMiddleman = h.purchase_type === 'middleman'
  const totals = useMemo(() => calcPoTotals(h, rows), [h, rows])

  function setPurchaseType(type) {
    if (type === 'direct') {
      setH({ ...h, purchase_type: 'direct', middleman_name: '' })
      setRows(prev => prev.map(r => ({ ...r, middleman_commission_unit_krw: '' })))
    } else {
      setH({ ...h, purchase_type: 'middleman' })
    }
  }

  function updateLine(idx, patch) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  function pickInventory(idx, invId) {
    const item = inventory.find(i => String(i.id) === String(invId))
    if (!item) return
    updateLine(idx, {
      inventory_id: item.id,
      product_sku: item.style || '',
      product_name: item.style || '',
      brand: item.brand || '',
    })
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
          <label>Supplier<input value={h.supplier} onChange={e => setH({ ...h, supplier: e.target.value })} placeholder="incelltechbio" /></label>
          {isMiddleman && (
            <label>Middleman Name<input value={h.middleman_name} onChange={e => setH({ ...h, middleman_name: e.target.value })} placeholder="OK LEE" /></label>
          )}
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
      <div className="form-section">
        <h3>Product Lines</h3>
        {rows.map((line, idx) => {
          const calc = calcLineItem(line, h.purchase_type, h.currency, h.exchange_rate)
          return (
            <div key={idx} className="po-line-card">
              <div className="form-grid po-line-grid">
                <label>Product / SKU
                  <select value={line.inventory_id || ''} onChange={e => pickInventory(idx, e.target.value)}>
                    <option value="">Select or type below</option>
                    {inventory.map(i => <option key={i.id} value={i.id}>{i.style}{i.brand ? ` · ${i.brand}` : ''}</option>)}
                  </select>
                  <input value={line.product_sku} placeholder="SKU" onChange={e => updateLine(idx, { product_sku: e.target.value, product_name: e.target.value })} />
                </label>
                <label>Brand<input value={line.brand} onChange={e => updateLine(idx, { brand: e.target.value })} /></label>
                <label>Order Qty<input type="number" min="0" value={line.order_qty} onChange={e => updateLine(idx, { order_qty: e.target.value })} /></label>
                <label>{factoryUnitCostLabel(h.currency)}<input type="number" min="0" step="1" value={line.korean_unit_cost} onChange={e => updateLine(idx, { korean_unit_cost: e.target.value })} /></label>
                <label>Factory Unit Cost (USD)<span className="po-calc-value">{formatUsd(calc.factory_unit_cost_usd)}</span></label>
                {isMiddleman && (
                  <>
                    <label>{MIDDLEMAN_COMMISSION_UNIT_LABEL}<input type="number" min="0" step="1" placeholder="5000" value={line.middleman_commission_unit_krw ?? ''} onChange={e => updateLine(idx, { middleman_commission_unit_krw: e.target.value })} /></label>
                    <label>Commission Per Unit (USD)<span className="po-calc-value">{formatUsd(calc.commission_per_unit_usd)}</span></label>
                  </>
                )}
                <label>{totalUnitCostLabel(h.currency)}<span className="po-calc-value">{formatPoMoney(calc.total_unit_cost_krw || calc.total_unit_cost_usd, h.currency)}</span></label>
                <label>Total Unit Cost (USD)<span className="po-calc-value">{formatUsd(calc.total_unit_cost_usd)}</span></label>
                <label>{factoryProductCostLabel(h.currency)}<span className="po-calc-value">{formatPoMoney(calc.product_cost, h.currency)}</span></label>
                {isMiddleman && (
                  <>
                    <label>Commission Total (KRW)<span className="po-calc-value">{formatKrw(calc.middleman_commission_total_krw)}</span></label>
                    <label>Commission Total (USD)<span className="po-calc-value">{formatUsd(calc.commission_total_usd)}</span></label>
                  </>
                )}
                <label>Total Purchase Cost (USD)<span className="po-calc-value">{formatUsd(calc.total_purchase_cost_usd)}</span></label>
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
        <button type="button" className="soft" onClick={() => setRows(prev => [...prev, blankPoLine()])}>+ Add Product Line</button>
      </div>
      <div className="po-totals-box">
        <p><strong>Total Ordered Units:</strong> {totals.totalOrderedUnits}</p>
        <p><strong>Total Factory Product Cost ({h.currency}):</strong> {formatPoMoney(totals.totalProductCost, h.currency)}</p>
        {isMiddleman && <p><strong>Total Commission (KRW):</strong> {formatKrw(totals.lines.reduce((s, l) => s + (l.middleman_commission_total_krw || 0), 0))}</p>}
        {isMiddleman && <p><strong>Total Commission (USD):</strong> {formatUsd(totals.totalCommissionUsd)}</p>}
        <p><strong>Total Purchase Cost (USD):</strong> {formatUsd(totals.totalProductCostUsd + totals.totalCommissionUsd)}</p>
        <p className="hint">Shipping and other costs are entered when inventory is received, not at PO creation. All inventory costing uses converted USD values.</p>
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
        <p><b>PO Number:</b> {po.po_number}<br /><b>Order Date:</b> {po.order_date || '—'}<br /><b>Status:</b> {po.status}</p>
        <p><b>Supplier:</b> {po.supplier || '—'}<br /><b>ETA:</b> {po.eta || '—'}</p>
        <p><b>Currency:</b> {po.currency}<br /><b>Notes:</b> {po.notes || '—'}</p>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Product</th><th>SKU</th><th>Qty</th><th>Factory Unit Price</th><th>Factory Line Total</th></tr>
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
  return (
    <div className="po-print-sheet po-internal-doc invoice">
      <p className="po-internal-banner">INTERNAL USE ONLY</p>
      <h1>INNER SOURCE BEAUTY</h1>
      <h2>INTERNAL COST SHEET</h2>
      <div className="invoice-grid">
        <p><b>PO Number:</b> {po.po_number}<br /><b>Purchase Type:</b> {purchaseTypeLabel(totals.purchaseType)}<br /><b>Supplier:</b> {po.supplier || '—'}</p>
        <p>{isMiddleman && <><b>Middleman Name:</b> {po.middleman_name || '—'}<br /></>}<b>Order Date:</b> {po.order_date || '—'}<br /><b>Status:</b> {po.status}</p>
        <p><b>Currency:</b> {totals.currency}<br /><b>Exchange Rate:</b> {totals.exchangeRate}<br /><b>ETA:</b> {po.eta || '—'}</p>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Product</th><th>Qty</th>
              <th>Factory Unit Cost ({totals.currency})</th><th>Factory Unit Cost (USD)</th>
              {isMiddleman && <><th>Commission / Unit (KRW)</th><th>Commission / Unit (USD)</th><th>Commission Total (KRW)</th><th>Commission Total (USD)</th></>}
              <th>Total Unit Cost ({totals.currency})</th><th>Total Unit Cost (USD)</th>
              <th>Factory Line Total ({totals.currency})</th><th>Total Purchase Cost (USD)</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(l => (
              <tr key={l.id || l.product_sku}>
                <td>{l.product_name || l.product_sku}</td>
                <td>{l.order_qty}</td>
                <td>{formatPoMoney(l.factory_unit_cost_original ?? l.factory_unit_cost, po.currency)}</td>
                <td>{formatUsd(l.factory_unit_cost_usd)}</td>
                {isMiddleman && <><td>{formatKrw(l.middleman_commission_unit_krw)}</td><td>{formatUsd(l.commission_per_unit_usd)}</td><td>{formatKrw(l.middleman_commission_total_krw)}</td><td>{formatUsd(l.commission_total_usd)}</td></>}
                <td>{formatPoMoney(l.total_unit_cost_krw || l.total_unit_cost_usd, po.currency)}</td>
                <td>{formatUsd(l.total_unit_cost_usd)}</td>
                <td>{formatPoMoney(l.product_cost, po.currency)}</td>
                <td>{formatUsd(l.total_purchase_cost_usd)}</td>
              </tr>
            ))}
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
                  <td>{String(rec.received_date || '').slice(0, 10)}</td>
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
        <p><strong>Total Factory Cost ({totals.currency}):</strong> {formatPoMoney(totals.totalProductCost, po.currency)}</p>
        <p><strong>Total Factory Cost (USD):</strong> {formatUsd(totals.totalProductCostUsd)}</p>
        {isMiddleman && <p><strong>Total Commission (USD):</strong> {formatUsd(totals.totalCommissionUsd)}</p>}
        <p><strong>Total Shipping Cost (Received, USD):</strong> {formatUsd(totals.shippingCost)}</p>
        <p><strong>Total Other Cost (Received, USD):</strong> {formatUsd(totals.otherCost)}</p>
        <p><strong>Grand Total (USD):</strong> {formatUsd(totals.totalPurchaseCostUsd)}</p>
      </div>
    </div>
  )
}

function PurchaseOrderDetail({
  po, items, receipts, receives, isAdmin, onBack, onEdit, onReceive, onCancel, onUpdateCommission,
}) {
  const [showInternalDetails, setShowInternalDetails] = useState(false)
  const [printView, setPrintView] = useState('')
  const [historyDetail, setHistoryDetail] = useState(null)
  const purchaseType = resolvePurchaseType(po, items)
  const isMiddleman = purchaseType === 'middleman'
  const summary = internalCostSummary(po, items, receives, receipts)
  const { totals, history } = summary
  const lines = totals.lines || []
  const locked = po.status === 'Received' || po.status === 'Cancelled'
  const [commPay, setCommPay] = useState({
    commission_amount_paid: po.commission_amount_paid || '',
    commission_payment_date: po.commission_payment_date || today(),
    commission_payment_method: po.commission_payment_method || '',
    commission_payment_note: po.commission_payment_note || '',
  })

  function saveCommissionPayment() {
    onUpdateCommission(po.id, {
      ...commPay,
      commission_amount_paid: Number(commPay.commission_amount_paid) || 0,
      commission_payment_status: deriveCommissionPaymentStatus({
        ...po,
        purchase_type: purchaseType,
        commission_amount_paid: Number(commPay.commission_amount_paid) || 0,
      }, items),
    })
  }

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
          <p><b>Order Date:</b> {po.order_date || '—'} · <b>ETA:</b> {po.eta || '—'} · <b>Exchange Rate:</b> {totals.exchangeRate} · <b>Total Purchase Cost (USD):</b> {formatUsd(totals.totalPurchaseCostUsd)}</p>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th><th>SKU</th><th>Qty</th><th>Factory Unit Cost ({totals.currency})</th>
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
                      <td>{String(rec.received_date || '').slice(0, 10)}</td>
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
            <p><b>Purchase Type:</b> {purchaseTypeLabel(purchaseType)}</p>
            {isMiddleman && <p><b>Middleman Name:</b> {po.middleman_name || '—'}</p>}
            <p><b>Total Factory Cost ({totals.currency}):</b> {formatPoMoney(totals.totalProductCost, po.currency)}</p>
            <p><b>Total Factory Cost (USD):</b> {formatUsd(totals.totalProductCostUsd)}</p>
            {isMiddleman && <p><b>Total Commission (USD):</b> {formatUsd(totals.totalCommissionUsd)}</p>}
            <p><b>Total Shipping Cost (Received, USD):</b> {formatUsd(totals.shippingCost)}</p>
            <p><b>Total Other Cost (Received, USD):</b> {formatUsd(totals.otherCost)}</p>
            <p><b>Grand Total (USD):</b> {formatUsd(totals.totalPurchaseCostUsd)}</p>
          </div>
        )}
      </div>

      {historyDetail && (
        <ReceiveHistoryDetailModal receive={historyDetail} po={po} onClose={() => setHistoryDetail(null)} />
      )}

      {isAdmin && isMiddleman && !locked && (
        <div className="form-section po-commission-payment no-print">
          <h3>Commission Payment Tracking</h3>
          <p><b>Middleman Name:</b> {po.middleman_name || '—'}</p>
          <p><strong>Total Commission (USD):</strong> {formatUsd(commissionAmountDue(po, items))}</p>
          <p><strong>Amount Paid (USD):</strong> {formatUsd(Number(commPay.commission_amount_paid) || 0)}</p>
          <p><strong>Remaining Commission Balance (USD):</strong> {formatUsd(commissionBalance({ ...po, ...commPay, purchase_type: purchaseType }, items))}</p>
          <p><strong>Payment Status:</strong> {po.commission_payment_status || deriveCommissionPaymentStatus({ ...po, purchase_type: purchaseType }, items)}</p>
          <div className="form-grid">
            <label>Amount Paid<input type="number" min="0" value={commPay.commission_amount_paid} onChange={e => setCommPay({ ...commPay, commission_amount_paid: e.target.value })} /></label>
            <label>Payment Date<input type="date" value={commPay.commission_payment_date} onChange={e => setCommPay({ ...commPay, commission_payment_date: e.target.value })} /></label>
            <label>Payment Method<input value={commPay.commission_payment_method} onChange={e => setCommPay({ ...commPay, commission_payment_method: e.target.value })} /></label>
            <label>Payment Note<input value={commPay.commission_payment_note} onChange={e => setCommPay({ ...commPay, commission_payment_note: e.target.value })} /></label>
          </div>
          <button type="button" onClick={saveCommissionPayment}>Save Commission Payment</button>
        </div>
      )}
    </div>
  )
}

export function PurchaseOrdersPage({
  data, role, isAdmin, selectedPoId, clearSelection, draftPoSeed,
  clearDraftPoSeed, nextPoNumber, onSavePo, onReceivePo, onCancelPo,
  onUpdateCommissionPayment,
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

  if (view === 'create') {
    return (
      <PurchaseOrderForm
        header={draftPoSeed?.header || blankPoHeader(nextPoNumber)}
        lines={draftPoSeed?.lines || [blankPoLine()]}
        inventory={data.inventory}
        isAdmin={isAdmin}
        editing={false}
        nextPoNumber={nextPoNumber}
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
        onSave={handleSave}
        onCancel={() => { setView('detail'); setEditingId('') }}
      />
    )
  }

  if (view === 'detail' && detailPo) {
    const items = poItemsForOrder(allItems, detailPo.id)
    const receipts = allReceipts.filter(r => String(r.purchase_order_id) === String(detailPo.id))
    const receives = poReceivesForOrder(allReceives, detailPo.id)
    return (
      <>
        <PurchaseOrderDetail
          po={detailPo}
          items={items}
          receipts={receipts}
          receives={receives}
          isAdmin={isAdmin}
          onBack={() => { setView('list'); setDetailId('') }}
          onEdit={id => { setEditingId(id); setView('edit') }}
          onReceive={id => setReceiveId(id)}
          onCancel={async id => { if (confirm('Cancel this purchase order?')) await onCancelPo(id); setView('list') }}
          onUpdateCommission={onUpdateCommissionPayment}
        />
        {receiveId && receivePo && (
          <ReceiveInventoryModal
            po={receivePo}
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
                  <td>{po.order_date || '—'}</td>
                  <td>{po.supplier || '—'}</td>
                  <td>{purchaseTypeLabel(type)}</td>
                  <td>{po.total_ordered_units ?? '—'}</td>
                  <td>{formatUsd(po.total_purchase_cost_usd ?? po.grand_total)}</td>
                  <td>{po.eta || '—'}</td>
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
      <div className="table-wrap">
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
      <p><strong>Total Commission (USD):</strong> {formatUsd(commTotals.totalCommission)}</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Middleman</th><th>PO Number</th><th>Product</th><th>Qty</th><th>Commission / Unit (KRW)</th><th>Commission Total</th><th>PO Status</th><th>Payment Status</th></tr></thead>
          <tbody>
            {commissionRows.map(r => (
              <tr key={r.id}>
                <td>{r.date || '—'}</td><td>{r.middleman || '—'}</td><td>{r.po_number}</td><td>{r.product}</td>
                <td>{r.qty}</td><td>{formatKrw(r.commission_unit_krw)}</td><td>{formatUsd(r.commission_total)}</td>
                <td>{r.po_status}</td><td>{r.payment_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Incoming Inventory Report</h3>
      <p>
        <strong>Total Ordered Units:</strong> {incomingTotals.totalOrderedUnits} ·{' '}
        <strong>Total Received Units:</strong> {incomingTotals.totalReceivedUnits} ·{' '}
        <strong>Total Remaining Units:</strong> {incomingTotals.totalRemainingUnits}
      </p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Product</th><th>Ordered</th><th>Received</th><th>Remaining</th><th>ETA</th><th>Supplier</th><th>PO Number</th></tr></thead>
          <tbody>
            {incomingRows.map(r => (
              <tr key={r.id}>
                <td>{r.product}</td><td>{r.ordered}</td><td>{r.received}</td><td>{r.remaining}</td>
                <td>{r.eta || '—'}</td><td>{r.supplier}</td><td>{r.po_number}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
