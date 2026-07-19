import React, { useEffect, useMemo, useState } from 'react'
import {
  PO_STATUSES, PO_FILTER_STATUSES, PO_CURRENCIES, PO_PURCHASE_TYPES,
  calcLineItem, calcPoTotals, allocateLineCosts, blankPoHeader, blankPoLine,
  canCancelPo, canEditPo, canReceivePo, commissionAmountDue, commissionBalance,
  deriveCommissionPaymentStatus, formatKrw, formatUsd, formatPoMoney,
  poItemsForOrder, poMatchesFilter, poMatchesSearch, receivedProgress,
  poSummaryStats, buildSupplierCsvRows, buildInternalCsvRows, downloadCsv,
  resolvePurchaseType, isMiddlemanPo, purchaseTypeLabel,
  poReportSummary, middlemanCommissionReport, incomingInventoryReport,
  reportTotalsForCommission, reportTotalsForIncoming,
} from './purchaseOrders.js'

const today = () => new Date().toISOString().slice(0, 10)

function PoStatusBadge({ status }) {
  const cls = String(status || '').toLowerCase().replace(/\s+/g, '-')
  return <span className={`po-status-badge po-status-${cls}`}>{status || '—'}</span>
}

function ReceiveInventoryModal({ po, items, allocatedLines, onCancel, onConfirm, busy }) {
  const purchaseType = resolvePurchaseType(po, items)
  const isMiddleman = purchaseType === 'middleman'
  const [lines, setLines] = useState(() => items.map(item => ({
    purchase_order_item_id: item.id,
    product: item.product_sku || item.product_name,
    order_qty: item.order_qty,
    received_qty: item.received_qty,
    remaining_qty: item.remaining_qty,
    receive_now: '',
    note: '',
    final_unit_cost: allocatedLines.find(l => String(l.id) === String(item.id))?.final_unit_cost || 0,
  })))
  const [updateBuyingPrice, setUpdateBuyingPrice] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!updateBuyingPrice) return
    const payload = lines
      .filter(l => Number(l.receive_now) > 0)
      .map(l => ({
        purchase_order_item_id: l.purchase_order_item_id,
        receive_now: Number(l.receive_now),
        note: l.note,
      }))
    if (!payload.length) return
    await onConfirm({ lines: payload, updateBuyingPrice: updateBuyingPrice === 'yes' })
  }

  return (
    <div className="restore-dialog-overlay po-receive-overlay" onClick={onCancel}>
      <div className="restore-dialog po-receive-dialog" onClick={e => e.stopPropagation()}>
        <h2>Receive Inventory — {po.po_number}</h2>
        <form onSubmit={handleSubmit}>
          <div className="table-wrap po-receive-table">
            <table>
              <thead>
                <tr>
                  <th>Product / SKU</th><th>Ordered</th><th>Previously Received</th><th>Remaining</th>
                  <th>Receive Now</th><th>Final Unit Cost</th><th>Note</th>
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
                        }} />
                    </td>
                    <td>{formatPoMoney(l.final_unit_cost, po.currency)}{isMiddleman ? '' : ''}</td>
                    <td>
                      <input value={l.note} disabled={l.remaining_qty <= 0}
                        onChange={e => {
                          const next = [...lines]
                          next[idx] = { ...next[idx], note: e.target.value }
                          setLines(next)
                        }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="po-receive-buying-prompt">
            <p><strong>Update Inventory Buying Price with this PO cost?</strong></p>
            <p className="hint">Final Unit Cost includes factory cost{isMiddleman ? ', middleman commission,' : ''} shipping, and other cost allocations.</p>
            <label><input type="radio" name="updateBuying" value="yes" checked={updateBuyingPrice === 'yes'} onChange={() => setUpdateBuyingPrice('yes')} /> Yes</label>
            <label><input type="radio" name="updateBuying" value="no" checked={updateBuyingPrice === 'no'} onChange={() => setUpdateBuyingPrice('no')} /> No</label>
          </div>
          <div className="restore-dialog-actions">
            <button type="submit" disabled={busy || !updateBuyingPrice}>Confirm Receive</button>
            <button type="button" className="soft" onClick={onCancel} disabled={busy}>Cancel</button>
          </div>
        </form>
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
  const [rows, setRows] = useState(lines.length ? lines : [blankPoLine()])
  const isMiddleman = h.purchase_type === 'middleman'
  const totals = useMemo(() => calcPoTotals(h, rows), [h, rows])

  function setPurchaseType(type) {
    if (type === 'direct') {
      setH({ ...h, purchase_type: 'direct', middleman_name: '' })
      setRows(prev => prev.map(r => ({ ...r, commission_percent: '' })))
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
            <select value={h.currency} onChange={e => setH({ ...h, currency: e.target.value })}>
              {PO_CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label>Exchange Rate<input type="number" min="0" step="0.01" value={h.exchange_rate} onChange={e => setH({ ...h, exchange_rate: e.target.value })} /></label>
          <label>Estimated Shipping Cost<input type="number" min="0" step="1" value={h.shipping_cost} onChange={e => setH({ ...h, shipping_cost: e.target.value })} /></label>
          <label>Other Cost<input type="number" min="0" step="1" value={h.other_cost} onChange={e => setH({ ...h, other_cost: e.target.value })} /></label>
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
          const calc = calcLineItem(line, h.purchase_type)
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
                <label>Factory Unit Cost<input type="number" min="0" step="1" value={line.korean_unit_cost} onChange={e => updateLine(idx, { korean_unit_cost: e.target.value })} /></label>
                {isMiddleman && (
                  <>
                    <label>Middleman Commission %<input type="number" min="0" step="0.01" value={line.commission_percent} onChange={e => updateLine(idx, { commission_percent: e.target.value })} /></label>
                    <label>Commission Per Unit<span className="po-calc-value">{formatPoMoney(calc.commission_per_unit, h.currency)}</span></label>
                    <label>Commission Total<span className="po-calc-value">{formatPoMoney(calc.commission_total, h.currency)}</span></label>
                  </>
                )}
                <label>Factory Product Cost<span className="po-calc-value">{formatPoMoney(calc.product_cost, h.currency)}</span></label>
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
        <p><strong>Total Factory Product Cost:</strong> {formatPoMoney(totals.totalProductCost, h.currency)}</p>
        {isMiddleman && <p><strong>Total Middleman Commission:</strong> {formatPoMoney(totals.totalCommission, h.currency)}</p>}
        <p><strong>Estimated Shipping Cost:</strong> {formatPoMoney(totals.shippingCost, h.currency)}</p>
        <p><strong>Other Cost:</strong> {formatPoMoney(totals.otherCost, h.currency)}</p>
        <p><strong>Total Purchase Cost ({h.currency}):</strong> {formatPoMoney(totals.totalPurchaseCost, h.currency)}</p>
        <p><strong>Estimated Grand Total USD:</strong> {formatUsd(totals.estimatedGrandTotalUsd)}</p>
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

function InternalCostSheetDoc({ po, allocated, totals }) {
  const isMiddleman = totals.purchaseType === 'middleman'
  return (
    <div className="po-print-sheet po-internal-doc invoice">
      <p className="po-internal-banner">INTERNAL USE ONLY</p>
      <h1>INNER SOURCE BEAUTY</h1>
      <h2>INTERNAL COST SHEET</h2>
      <div className="invoice-grid">
        <p><b>PO Number:</b> {po.po_number}<br /><b>Purchase Type:</b> {purchaseTypeLabel(totals.purchaseType)}<br /><b>Supplier:</b> {po.supplier || '—'}</p>
        <p>{isMiddleman && <><b>Middleman Name:</b> {po.middleman_name || '—'}<br /></>}<b>Order Date:</b> {po.order_date || '—'}<br /><b>Status:</b> {po.status}</p>
        <p><b>ETA:</b> {po.eta || '—'}<br /><b>Notes:</b> {po.notes || '—'}</p>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Product</th><th>Qty</th><th>Factory Unit Cost</th>
              {isMiddleman && <><th>Commission %</th><th>Commission Per Unit</th><th>Commission Total</th></>}
              <th>Shipping Allocation</th><th>Other Cost Allocation</th><th>Final Unit Cost</th><th>Final Line Cost</th>
            </tr>
          </thead>
          <tbody>
            {allocated.map(l => (
              <tr key={l.id || l.product_sku}>
                <td>{l.product_name || l.product_sku}</td>
                <td>{l.order_qty}</td>
                <td>{formatPoMoney(l.factory_unit_cost, po.currency)}</td>
                {isMiddleman && <><td>{l.commission_percent}%</td><td>{formatPoMoney(l.commission_per_unit, po.currency)}</td><td>{formatPoMoney(l.commission_total, po.currency)}</td></>}
                <td>{formatPoMoney(l.shipping_allocation, po.currency)}</td>
                <td>{formatPoMoney(l.other_cost_allocation, po.currency)}</td>
                <td>{formatPoMoney(l.final_unit_cost, po.currency)}</td>
                <td>{formatPoMoney(l.final_line_cost, po.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="po-totals-box">
        <p><strong>Total Factory Cost:</strong> {formatPoMoney(totals.totalProductCost, po.currency)}</p>
        {isMiddleman && <p><strong>Total Commission:</strong> {formatPoMoney(totals.totalCommission, po.currency)}</p>}
        <p><strong>Shipping Cost:</strong> {formatPoMoney(totals.shippingCost, po.currency)}</p>
        <p><strong>Other Cost:</strong> {formatPoMoney(totals.otherCost, po.currency)}</p>
        <p><strong>Grand Total:</strong> {formatPoMoney(totals.grandTotal, po.currency)}</p>
      </div>
    </div>
  )
}

function PurchaseOrderDetail({
  po, items, receipts, isAdmin, onBack, onEdit, onReceive, onCancel, onUpdateCommission,
}) {
  const [showInternalDetails, setShowInternalDetails] = useState(false)
  const [printView, setPrintView] = useState('')
  const purchaseType = resolvePurchaseType(po, items)
  const isMiddleman = purchaseType === 'middleman'
  const totals = calcPoTotals(po, items)
  const allocated = allocateLineCosts(totals.lines, totals.shippingCost, totals.otherCost, purchaseType)
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
      }),
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
      ['Purchase Type', 'PO Number', 'Supplier', 'Middleman', 'Product', 'Qty', 'Factory Unit Cost', 'Commission %', 'Commission Per Unit', 'Commission Total', 'Shipping Allocation', 'Other Cost Allocation', 'Final Unit Cost', 'Final Line Cost', 'Total Factory Cost', 'Total Commission', 'Shipping Cost', 'Other Cost', 'Grand Total'],
      buildInternalCsvRows(po, allocated, totals),
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
        <InternalCostSheetDoc po={po} allocated={allocated} totals={totals} />
      )}

      <div className={`po-detail-main${printView ? ' screen-only-hidden' : ''}`}>
        <div className="po-detail-summary">
          <h2>{po.po_number}</h2>
          <p><b>Supplier:</b> {po.supplier || '—'} · <b>Purchase Type:</b> {purchaseTypeLabel(purchaseType)} · <b>Status:</b> <PoStatusBadge status={po.status} /></p>
          <p><b>Order Date:</b> {po.order_date || '—'} · <b>ETA:</b> {po.eta || '—'} · <b>Total Purchase Cost:</b> {formatPoMoney(totals.totalPurchaseCost, po.currency)}</p>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th><th>SKU</th><th>Qty</th><th>Factory Unit Cost</th><th>Final Unit Cost</th>
                <th>Line Total</th><th>Received Qty</th><th>Remaining Qty</th>
              </tr>
            </thead>
            <tbody>
              {allocated.map(l => (
                <tr key={l.id || l.product_sku}>
                  <td>{l.product_name || l.product_sku}</td>
                  <td>{l.product_sku || '—'}</td>
                  <td>{l.order_qty}</td>
                  <td>{formatPoMoney(l.factory_unit_cost, po.currency)}</td>
                  <td>{formatPoMoney(l.final_unit_cost, po.currency)}</td>
                  <td>{formatPoMoney(l.final_line_cost, po.currency)}</td>
                  <td>{l.received_qty}</td>
                  <td>{l.remaining_qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button type="button" className="soft po-toggle-internal" onClick={() => setShowInternalDetails(v => !v)}>
          {showInternalDetails ? 'Hide Internal Cost Details' : 'Show Internal Cost Details'}
        </button>

        {showInternalDetails && (
          <div className="po-internal-details">
            <p><b>Purchase Type:</b> {purchaseTypeLabel(purchaseType)}</p>
            {isMiddleman && <p><b>Middleman Name:</b> {po.middleman_name || '—'}</p>}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    {isMiddleman && <><th>Commission %</th><th>Commission Per Unit</th><th>Commission Total</th></>}
                    <th>Shipping Allocation</th><th>Other Cost Allocation</th><th>Final Landed Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {allocated.map(l => (
                    <tr key={`internal-${l.id || l.product_sku}`}>
                      <td>{l.product_name || l.product_sku}</td>
                      {isMiddleman && <><td>{l.commission_percent}%</td><td>{formatPoMoney(l.commission_per_unit, po.currency)}</td><td>{formatPoMoney(l.commission_total, po.currency)}</td></>}
                      <td>{formatPoMoney(l.shipping_allocation, po.currency)}</td>
                      <td>{formatPoMoney(l.other_cost_allocation, po.currency)}</td>
                      <td>{formatPoMoney(l.final_unit_cost, po.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">Receipt history: {receipts.length} record(s). Received progress: {receivedProgress(items)}</p>
          </div>
        )}
      </div>

      {isAdmin && isMiddleman && !locked && (
        <div className="form-section po-commission-payment no-print">
          <h3>Commission Payment Tracking</h3>
          <p><b>Middleman Name:</b> {po.middleman_name || '—'}</p>
          <p><strong>Total Commission:</strong> {formatPoMoney(commissionAmountDue(po), po.currency)}</p>
          <p><strong>Amount Paid:</strong> {formatPoMoney(Number(commPay.commission_amount_paid) || 0, po.currency)}</p>
          <p><strong>Remaining Commission Balance:</strong> {formatPoMoney(commissionBalance({ ...po, ...commPay, purchase_type: purchaseType }), po.currency)}</p>
          <p><strong>Payment Status:</strong> {po.commission_payment_status || deriveCommissionPaymentStatus({ ...po, purchase_type: purchaseType })}</p>
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
    return (
      <>
        <PurchaseOrderDetail
          po={detailPo}
          items={items}
          receipts={receipts}
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
            items={poItemsForOrder(allItems, receivePo.id).map(l => calcLineItem(l, resolvePurchaseType(receivePo, poItemsForOrder(allItems, receivePo.id))))}
            allocatedLines={allocateLineCosts(
              poItemsForOrder(allItems, receivePo.id),
              Number(receivePo.shipping_cost) || 0,
              Number(receivePo.other_cost) || 0,
              resolvePurchaseType(receivePo, poItemsForOrder(allItems, receivePo.id)),
            )}
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
        <div className="card"><p>Total Purchase Cost (Open)</p><b>{formatKrw(stats.totalOrderedAmount)}</b></div>
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
                  <td>{formatPoMoney(po.grand_total, po.currency)}</td>
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
                <td>{formatPoMoney(r.total_purchase_cost, r.currency)}</td><td>{r.status}</td>
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
      <p><strong>Total Commission:</strong> {formatKrw(commTotals.totalCommission)}</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Middleman</th><th>PO Number</th><th>Product</th><th>Qty</th><th>Commission %</th><th>Commission Total</th><th>PO Status</th><th>Payment Status</th></tr></thead>
          <tbody>
            {commissionRows.map(r => (
              <tr key={r.id}>
                <td>{r.date || '—'}</td><td>{r.middleman || '—'}</td><td>{r.po_number}</td><td>{r.product}</td>
                <td>{r.qty}</td><td>{r.commission_percent}%</td><td>{formatKrw(r.commission_total)}</td>
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
