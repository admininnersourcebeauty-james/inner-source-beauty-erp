import React, { useEffect, useMemo, useState } from 'react'
import {
  PO_STATUSES, PO_FILTER_STATUSES, PO_CURRENCIES,
  calcLineItem, calcPoTotals, allocateLineCosts, blankPoHeader, blankPoLine,
  canCancelPo, canEditPo, canReceivePo, commissionAmountDue, commissionBalance,
  deriveCommissionPaymentStatus, formatKrw, formatUsd, formatPoMoney,
  poItemsForOrder, poMatchesFilter, poMatchesSearch, receivedProgress,
  poSummaryStats, buildPoCsvRows, isPoLocked,
  poReportSummary, middlemanCommissionReport, incomingInventoryReport,
  reportTotalsForCommission, reportTotalsForIncoming,
} from './purchaseOrders.js'

const money = n => `$${(Number(n) || 0).toFixed(2)}`
const today = () => new Date().toISOString().slice(0, 10)

function PoStatusBadge({ status }) {
  const cls = String(status || '').toLowerCase().replace(/\s+/g, '-')
  return <span className={`po-status-badge po-status-${cls}`}>{status || '—'}</span>
}

function ReceiveInventoryModal({ po, items, allocatedLines, onCancel, onConfirm, busy }) {
  const [lines, setLines] = useState(() => items.map(item => ({
    purchase_order_item_id: item.id,
    product: item.product_sku || item.product_name,
    order_qty: item.order_qty,
    received_qty: item.received_qty,
    remaining_qty: item.remaining_qty,
    receive_now: '',
    commission_percent: item.commission_percent,
    note: '',
    landed_cost: allocatedLines.find(l => String(l.id) === String(item.id))?.estimated_landed_cost || 0,
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
                  <th>Product / SKU</th>
                  <th>Ordered</th>
                  <th>Previously Received</th>
                  <th>Remaining</th>
                  <th>Receive Now</th>
                  <th>Commission %</th>
                  <th>Landed Unit</th>
                  <th>Note</th>
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
                      <input
                        type="number" min="0" max={l.remaining_qty} step="1"
                        value={l.receive_now}
                        disabled={l.remaining_qty <= 0}
                        onChange={e => {
                          const val = e.target.value
                          const next = [...lines]
                          next[idx] = { ...next[idx], receive_now: val }
                          setLines(next)
                        }}
                      />
                    </td>
                    <td>{l.commission_percent}%</td>
                    <td>{formatPoMoney(l.landed_cost, po.currency)}</td>
                    <td>
                      <input
                        value={l.note}
                        disabled={l.remaining_qty <= 0}
                        onChange={e => {
                          const next = [...lines]
                          next[idx] = { ...next[idx], note: e.target.value }
                          setLines(next)
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="po-receive-buying-prompt">
            <p><strong>Update Inventory Buying Price with this PO cost?</strong></p>
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
  const [h, setH] = useState(() => ({ ...blankPoHeader(nextPoNumber), ...header, order_date: header.order_date || today() }))
  const [rows, setRows] = useState(lines.length ? lines : [blankPoLine()])
  const totals = useMemo(() => calcPoTotals(h, rows), [h, rows])

  function updateLine(idx, patch) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  function addLine() {
    setRows(prev => [...prev, blankPoLine()])
  }

  function removeLine(idx) {
    setRows(prev => prev.filter((_, i) => i !== idx))
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

  function handleSave() {
    onSave({ header: h, lines: totals.lines })
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
          <label>Supplier<input value={h.supplier} onChange={e => setH({ ...h, supplier: e.target.value })} placeholder="incelltechbio" /></label>
          <label>Middleman Name<input value={h.middleman_name} onChange={e => setH({ ...h, middleman_name: e.target.value })} placeholder="OK LEE" /></label>
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
          const calc = calcLineItem(line)
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
                <label>Korean Unit Cost<input type="number" min="0" step="1" value={line.korean_unit_cost} onChange={e => updateLine(idx, { korean_unit_cost: e.target.value })} /></label>
                <label>Middleman Commission %<input type="number" min="0" step="0.01" value={line.commission_percent} onChange={e => updateLine(idx, { commission_percent: e.target.value })} /></label>
                <label>Commission Per Unit<span className="po-calc-value">{formatPoMoney(calc.commission_per_unit, h.currency)}</span></label>
                <label>Product Cost<span className="po-calc-value">{formatPoMoney(calc.product_cost, h.currency)}</span></label>
                <label>Commission Total<span className="po-calc-value">{formatPoMoney(calc.commission_total, h.currency)}</span></label>
                <label>Total Line Cost<span className="po-calc-value">{formatPoMoney(calc.total_line_cost, h.currency)}</span></label>
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
        <button type="button" className="soft" onClick={addLine}>+ Add Product Line</button>
      </div>
      <div className="po-totals-box">
        <p><strong>Total Ordered Units:</strong> {totals.totalOrderedUnits}</p>
        <p><strong>Total Product Cost:</strong> {formatPoMoney(totals.totalProductCost, h.currency)}</p>
        <p><strong>Total Middleman Commission:</strong> {formatPoMoney(totals.totalCommission, h.currency)}</p>
        <p><strong>Estimated Shipping Cost:</strong> {formatPoMoney(totals.shippingCost, h.currency)}</p>
        <p><strong>Other Cost:</strong> {formatPoMoney(totals.otherCost, h.currency)}</p>
        <p><strong>Grand Total ({h.currency}):</strong> {formatPoMoney(totals.grandTotal, h.currency)}</p>
        <p><strong>Exchange Rate:</strong> {totals.exchangeRate}</p>
        <p><strong>Estimated Grand Total USD:</strong> {formatUsd(totals.estimatedGrandTotalUsd)}</p>
      </div>
      <div className="po-form-actions">
        <button type="button" onClick={handleSave}>Save Purchase Order</button>
        <button type="button" className="soft" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function PurchaseOrderDetail({
  po, items, receipts, isAdmin, onBack, onEdit, onReceive, onCancel, onPrint,
  onDownloadCsv, onUpdateCommission,
}) {
  const [includeInternal, setIncludeInternal] = useState(false)
  const [commPay, setCommPay] = useState({
    commission_amount_paid: po.commission_amount_paid || '',
    commission_payment_date: po.commission_payment_date || today(),
    commission_payment_method: po.commission_payment_method || '',
    commission_payment_note: po.commission_payment_note || '',
  })
  const totals = calcPoTotals(po, items)
  const allocated = allocateLineCosts(totals.lines, totals.shippingCost, totals.otherCost)
  const locked = isPoLocked(po)

  function saveCommissionPayment() {
    onUpdateCommission(po.id, {
      ...commPay,
      commission_amount_paid: Number(commPay.commission_amount_paid) || 0,
      commission_payment_status: deriveCommissionPaymentStatus({
        ...po,
        commission_amount_paid: Number(commPay.commission_amount_paid) || 0,
      }),
    })
  }

  return (
    <div className="panel po-detail-panel">
      <div className="po-detail-actions no-print">
        <button type="button" className="soft" onClick={onBack}>Back</button>
        {isAdmin && canEditPo(po, 'Admin') && <button type="button" onClick={() => onEdit(po.id)}>Edit</button>}
        {isAdmin && canReceivePo(po, 'Admin') && <button type="button" onClick={() => onReceive(po.id)}>Receive Inventory</button>}
        {isAdmin && canCancelPo(po, 'Admin') && <button type="button" className="danger" onClick={() => onCancel(po.id)}>Cancel PO</button>}
        <button type="button" onClick={onPrint}>Print / Save PDF</button>
        <button type="button" className="soft" onClick={() => onDownloadCsv(po, allocated)}>Download CSV</button>
        {isAdmin && (
          <label className="check po-internal-toggle">
            <input type="checkbox" checked={includeInternal} onChange={e => setIncludeInternal(e.target.checked)} />
            Include Internal Cost Summary
          </label>
        )}
      </div>
      <div className="po-print-sheet invoice">
        <h1>INNER SOURCE BEAUTY</h1>
        <h2>PURCHASE ORDER</h2>
        <div className="invoice-grid">
          <p><b>PO Number:</b> {po.po_number}<br /><b>Order Date:</b> {po.order_date || '—'}<br /><b>Status:</b> <PoStatusBadge status={po.status} /></p>
          <p><b>Supplier:</b> {po.supplier || '—'}<br /><b>Middleman:</b> {po.middleman_name || '—'}<br /><b>ETA:</b> {po.eta || '—'}</p>
          <p><b>Currency:</b> {po.currency}<br /><b>Exchange Rate:</b> {po.exchange_rate}<br /><b>Notes:</b> {po.notes || '—'}</p>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product / SKU</th><th>Qty</th><th>Korean Unit Cost</th><th>Commission %</th>
                <th>Commission Amount</th><th>Product Cost</th><th>Line Total</th>
              </tr>
            </thead>
            <tbody>
              {totals.lines.map(l => (
                <tr key={l.id || l.product_sku}>
                  <td>{l.product_sku || l.product_name}</td>
                  <td>{l.order_qty}</td>
                  <td>{formatPoMoney(l.korean_unit_cost, po.currency)}</td>
                  <td>{l.commission_percent}%</td>
                  <td>{formatPoMoney(l.commission_total, po.currency)}</td>
                  <td>{formatPoMoney(l.product_cost, po.currency)}</td>
                  <td>{formatPoMoney(l.total_line_cost, po.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="po-totals-box">
          <p><strong>Product Cost:</strong> {formatPoMoney(totals.totalProductCost, po.currency)}</p>
          <p><strong>Middleman Commission:</strong> {formatPoMoney(totals.totalCommission, po.currency)}</p>
          <p><strong>Shipping:</strong> {formatPoMoney(totals.shippingCost, po.currency)}</p>
          <p><strong>Other Cost:</strong> {formatPoMoney(totals.otherCost, po.currency)}</p>
          <p><strong>Grand Total:</strong> {formatPoMoney(totals.grandTotal, po.currency)}</p>
          <p><strong>Estimated USD Total:</strong> {formatUsd(totals.estimatedGrandTotalUsd)}</p>
        </div>
        {includeInternal && isAdmin && (
          <div className="po-internal-summary">
            <h3>Internal Cost Summary</h3>
            <p>Receipt history: {receipts.length} record(s). Received progress: {receivedProgress(items)}</p>
          </div>
        )}
      </div>
      {isAdmin && !locked && (
        <div className="form-section po-commission-payment no-print">
          <h3>Commission Payment Tracking</h3>
          <p><strong>Commission Amount Due:</strong> {formatPoMoney(commissionAmountDue(po), po.currency)}</p>
          <p><strong>Commission Balance:</strong> {formatPoMoney(commissionBalance(po), po.currency)}</p>
          <p><strong>Status:</strong> {po.commission_payment_status || deriveCommissionPaymentStatus(po)}</p>
          <div className="form-grid">
            <label>Amount Paid<input type="number" min="0" value={commPay.commission_amount_paid} onChange={e => setCommPay({ ...commPay, commission_amount_paid: e.target.value })} /></label>
            <label>Payment Date<input type="date" value={commPay.commission_payment_date} onChange={e => setCommPay({ ...commPay, commission_payment_date: e.target.value })} /></label>
            <label>Payment Method<input value={commPay.commission_payment_method} onChange={e => setCommPay({ ...commPay, commission_payment_method: e.target.value })} /></label>
            <label>Note<input value={commPay.commission_payment_note} onChange={e => setCommPay({ ...commPay, commission_payment_note: e.target.value })} /></label>
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

  const filtered = useMemo(() => {
    return pos.filter(po => {
      const items = poItemsForOrder(allItems, po.id)
      return poMatchesFilter(po, filter) && poMatchesSearch(po, items, search)
    })
  }, [pos, allItems, filter, search])

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

  function downloadCsv(po, allocated) {
    const header = ['PO Number', 'Supplier', 'Middleman', 'Product / SKU', 'Brand', 'Qty', 'Korean Unit Cost', 'Middleman Commission %', 'Commission Per Unit', 'Product Cost', 'Commission Total', 'Total Line Cost', 'Shipping Allocation', 'Other Cost Allocation', 'Estimated Landed Cost', 'ETA', 'Status', 'Notes']
    const rows = buildPoCsvRows(po, allocated, allocated)
    const csv = [header, ...rows].map(cols => cols.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${po.po_number || 'PO'}_export.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  if (view === 'create') {
    const seed = draftPoSeed || null
    return (
      <PurchaseOrderForm
        header={seed?.header || blankPoHeader(nextPoNumber)}
        lines={seed?.lines || [blankPoLine()]}
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
    const items = poItemsForOrder(allItems, editPo.id)
    return (
      <PurchaseOrderForm
        header={editPo}
        lines={items}
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
          onPrint={() => window.print()}
          onDownloadCsv={downloadCsv}
          onUpdateCommission={onUpdateCommissionPayment}
        />
        {receiveId && receivePo && (
          <ReceiveInventoryModal
            po={receivePo}
            items={poItemsForOrder(allItems, receivePo.id).map(calcLineItem)}
            allocatedLines={allocateLineCosts(poItemsForOrder(allItems, receivePo.id), Number(receivePo.shipping_cost) || 0, Number(receivePo.other_cost) || 0)}
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
        {isAdmin && (
          <button type="button" onClick={() => { setEditingId(''); setView('create') }}>+ New Purchase Order</button>
        )}
      </div>
      <div className="cards po-summary-cards">
        <div className="card"><p>Open Purchase Orders</p><b>{stats.openCount}</b></div>
        <div className="card"><p>Total Ordered Amount</p><b>{formatKrw(stats.totalOrderedAmount)}</b></div>
        <div className="card"><p>Expected Commission</p><b>{formatKrw(stats.expectedCommission)}</b></div>
        <div className="card"><p>Incoming Units</p><b>{stats.incomingUnits}</b></div>
      </div>
      <div className="po-filters">
        {PO_FILTER_STATUSES.map(f => (
          <button key={f} type="button" className={`soft filter-btn${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>
      <input className="search po-search" placeholder="Search PO number, supplier, middleman, product, notes..." value={search} onChange={e => setSearch(e.target.value)} />
      <div className="table-wrap po-list-table">
        <table>
          <thead>
            <tr>
              <th>PO Number</th><th>Order Date</th><th>Supplier</th><th>Middleman</th><th>Total Units</th>
              <th>Product Cost</th><th>Commission</th><th>Shipping</th><th>Grand Total</th><th>ETA</th>
              <th>Status</th><th>Received Progress</th><th>View</th>{isAdmin && <th>Edit</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={isAdmin ? 14 : 13} className="hint">No purchase orders found.</td></tr>
            ) : filtered.map(po => {
              const items = poItemsForOrder(allItems, po.id)
              return (
                <tr key={po.id}>
                  <td><b>{po.po_number}</b></td>
                  <td>{po.order_date || '—'}</td>
                  <td>{po.supplier || '—'}</td>
                  <td>{po.middleman_name || '—'}</td>
                  <td>{po.total_ordered_units ?? '—'}</td>
                  <td>{formatPoMoney(po.total_product_cost, po.currency)}</td>
                  <td>{formatPoMoney(po.total_commission, po.currency)}</td>
                  <td>{formatPoMoney(po.shipping_cost, po.currency)}</td>
                  <td>{formatPoMoney(po.grand_total, po.currency)}</td>
                  <td>{po.eta || '—'}</td>
                  <td><PoStatusBadge status={po.status} /></td>
                  <td>{receivedProgress(items)}</td>
                  <td><button type="button" className="link-cell" onClick={() => { setDetailId(po.id); setView('detail') }}>View</button></td>
                  {isAdmin && (
                    <td>
                      {canEditPo(po, role) ? (
                        <button type="button" className="link-cell" onClick={() => { setEditingId(po.id); setView('edit') }}>Edit</button>
                      ) : '—'}
                    </td>
                  )}
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
  const summary = poReportSummary(pos)
  const commissionRows = middlemanCommissionReport(pos, items, dateFrom, dateTo)
  const incomingRows = incomingInventoryReport(pos, items)
  const commTotals = reportTotalsForCommission(commissionRows)
  const incomingTotals = reportTotalsForIncoming(incomingRows)

  return (
    <>
      <h3>Purchase Order Summary</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>PO Number</th><th>Supplier</th><th>Total Units</th><th>Product Cost</th><th>Commission</th><th>Shipping</th><th>Grand Total</th><th>Status</th></tr></thead>
          <tbody>
            {summary.map(r => (
              <tr key={r.id}>
                <td>{r.po_number}</td><td>{r.supplier}</td><td>{r.total_units}</td>
                <td>{formatPoMoney(r.product_cost, r.currency)}</td>
                <td>{formatPoMoney(r.commission, r.currency)}</td>
                <td>{formatPoMoney(r.shipping, r.currency)}</td>
                <td>{formatPoMoney(r.grand_total, r.currency)}</td>
                <td>{r.status}</td>
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
