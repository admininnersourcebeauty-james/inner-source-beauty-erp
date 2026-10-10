import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase, hasSupabaseConfig } from './supabaseClient.js'
import {
  BACKUP_TABLES, createFullBackupZip, downloadJson, readBackupZip,
  saveLastBackupTime, getLastBackupTime, validateRestoreRows, executeRestore,
} from './backupRestore.js'
import {
  ORDER_STATUSES, FULFILLMENT_METHODS, calcAllocation, deriveCreateStatus, normalizeFulfillment, unshippedAllocated,
  backOrderedQtyForProduct, activeBackorderOrders, backOrderDashboardStats, activeBackorderAlerts,
  backOrderReports,
  isValidDbDate, inventoryStockView, normalizeOrderStatus, statusMatchesFilter, countOrdersByStatus,
  fulfillmentHandledBy, partiallyAllocatedAlerts, partiallyAllocatedOrders,
  awaitingPickupCount, companyDeliveryCount,
  isCarrierMethod, isCompanyDelivery, isCustomerPickup, formatFulfillmentDate,
} from './backorder.js'
import {
  buildLowStockAlerts, inventoryReorderView, itemMinimumStockOrDefault,
  lowStockSummary, minimumStockPayload, reorderListItems,
} from './inventoryReorder.js'
import {
  VOID_REASONS, VOID_CONFIRM_TEXT, buildVoidPayload, calcOutstandingBalance, formatVoidDate,
  isVoidOrder, orderPaidTotal, ordersForSalesMetrics, paymentCountsTowardBalance,
  statusMatchesFilterWithVoid, voidRestoreQty, ORDER_FILTER_STATUSES,
} from './invoiceVoid.js'
import { formatDisplayDate, isDisplayDateField } from './dateFormat.js'
import { COMPANY_LOGO_SRC } from './companyLogo.js'
import {
  nextPoNumber, calcPoTotals, derivePoStatus, newPoId, buildPoFromReorderItems,
  poSummaryStats, incomingInventoryAlerts, allocateReceiveCosts, calcLineItem,
  deriveCommissionPaymentStatus, normalizePoSavePayload, validatePoSave, validateReceive,
  poCommissionPaymentsForOrder, commissionPaymentSummary, validateCommissionPaymentEntry,
  resolvePurchaseType, isMiddlemanPo, isMiddlemanPurchaseType, purchaseTypeLabel, calcWeightedBuyingPrice, calcWeightedAverage, nextReceiveNumber,
  resolveExchangeRate,
  calcPoUsdTotalsFromItems,
  resolvePoLineInventoryId, findInventoryBySku, normalizePoSku, buildInventoryRowFromPoLine,
  defaultReceiveSellingPrice, parseReceiveSellingPrice, applyReceiveSellingPriceToInventory,
  collectMiddlemanOptions, COMMISSION_TYPES, validateInventoryCommissionDefaults,
  collectSupplierOptions,
} from './purchaseOrders.js'
import { PurchaseOrdersPage, PurchaseOrderReports } from './PurchaseOrdersUI.jsx'
import {
  blankOrderLine, itemsForOrder, orderDisplayProduct, itemSelling as orderItemSelling,
  calcOrderTotals, mergeDuplicateInventoryLines, validateOrderLines, buildOrderHeaderFromLines,
  buildOrderItemInsertRows, buildOrderItemLocalRows, previewLineAllocation, orderRestorePlan, activeBackorderEntries,
  buildLineAllocationPlan, reaggregateOrderHeader, orderItemsForOrder, deriveOrderStatusFromLines,
  isPersistedOrderItemId, logOrderItemInsertPayload, newClientOrderLineKey,
  orderInternalNote, orderCustomerNote, orderHasMemo,
} from './orderItems.js'
import {
  PROFILE_NAME_FIELDS, staffSalesPersonLabel, salesStaffOptions,
  resolveSalesPersonFields, orderSalesPersonDisplay, staffProfileFromSession,
  PAGE_ACCESS, profileStatus, canAccessPage,
} from './staffProfiles.js'
import {
  blankTrackingRow,
  buildTrackingInsertRows,
  formatTrackingPrintLine,
  formatTrackingScreenLine,
  primaryTrackingValue,
  sanitizeTrackingEntries,
  shipmentStatusLabel,
  trackingEntriesForOrder,
  trackingEntriesToFormValues,
  TRACKING_CARRIERS,
} from './orderTrackingNumbers.js'
import {
  allocationDeductionError,
  buildInventoryDeltaPlan,
  enrichDeductionPlan,
  INVENTORY_ADJUST_RPC,
  INVENTORY_STOCK_COLUMN,
  parseInventoryIdForRpc,
  validateOrderInventoryAllocation,
} from './orderInventory.js'
import { VoiceOrderPanel } from './VoiceOrderUI.jsx'
import { exportInventoryCsv } from './inventoryExport.js'
import { buildInventorySalesHistory } from './inventorySalesHistory.js'
import { ExpensesPage } from './ExpensesUI.jsx'
import { expenseDateKey, currentMonthKey } from './expenses.js'
import {
  calcDashboardExpectedProfit,
  calcDashboardInventoryValue,
  calcMonthFinancialSummary,
  calcMonthPurchaseSpending,
  calcMonthlyProfitSummary,
  calcRealizedProfitForOrders,
  filterOrdersForMonth,
  formatGrossMarginPercent,
  formatMonthKeyLabel,
  formatNetMarginPercent,
  ordersForDashboardSales,
  shiftMonthKey,
} from './dashboardMetrics.js'
import { StaffManagement } from './StaffManagement.jsx'
import './style.css'

const CORE_TABLES = ['customers', 'inventory', 'orders', 'order_items', 'order_tracking_numbers', 'payments']
const PO_TABLES = ['purchase_orders', 'purchase_order_items', 'purchase_order_receipts', 'purchase_order_receives', 'purchase_order_commission_payments']
const EXPENSE_TABLES = ['expenses']
const TABLES = [...CORE_TABLES, ...PO_TABLES, ...EXPENSE_TABLES]
const EMPTY = {
  customers: [], inventory: [], orders: [], order_items: [], order_tracking_numbers: [], payments: [],
  purchase_orders: [], purchase_order_items: [], purchase_order_receipts: [], purchase_order_receives: [],
  purchase_order_commission_payments: [], expenses: [],
}
const PAYMENT_METHODS = ['Zelle', 'Venmo', 'Cash', 'Credit Card', 'Check', 'ACH/Wire']
const TERMS = ['COD', 'NET 15', 'NET 30', 'NET 45', 'NET 60']
const STATUSES = ['Active', 'Hold', 'VIP']
const ROLES = ['Admin', 'Staff', 'Warehouse']

const money = n => `$${(Number(n) || 0).toFixed(2)}`
const itemBuying = item => Number(item?.buying_price ?? item?.cost ?? 0)
const itemShipping = item => Number(item?.shipping_cost ?? 0)
const itemUnitCost = item => itemBuying(item) + itemShipping(item)
const itemSelling = item => Number(item?.selling_price ?? item?.price ?? item?.retail ?? 0)
const calcMargin = (buying, selling, shipping = 0) => {
  const b = Number(buying) || 0, s = Number(selling) || 0, sh = Number(shipping) || 0
  if (s <= 0) return null
  return ((s - b - sh) / s) * 100
}
const calcProfit = (buying, selling, shipping = 0) => Number(selling) - Number(buying) - Number(shipping)
const formatMargin = (buying, selling, shipping = 0) => {
  const m = calcMargin(buying, selling, shipping)
  return m === null ? 'Not Set' : `${m.toFixed(1)}%`
}
const formatInventoryProfit = (buying, selling, shipping = 0) => {
  const s = Number(selling) || 0
  if (s <= 0) return 'Not Set'
  return money(calcProfit(buying, selling, shipping))
}
const formatInventoryMargin = (buying, selling, shipping = 0) => {
  const s = Number(selling) || 0
  if (s <= 0) return 'Not Set'
  return formatMargin(buying, selling, shipping)
}
const formatSellingDisplay = selling => {
  const s = Number(selling) || 0
  return s > 0 ? money(s) : '—'
}
const localDateKey = d => {
  if (!d) return ''
  const s = String(d).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return s.slice(0, 10)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
const dateOnly = d => localDateKey(d)
const today = () => localDateKey(new Date())
const formatLocalShortDate = (d = new Date()) => d.toLocaleDateString('en-US', {
  month: 'short', day: 'numeric', year: 'numeric',
})
const toDbDate = value => {
  if (!value) return today()
  const s = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return today()
  return localDateKey(d)
}
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36)
const isToday = d => {
  if (!d) return false
  return localDateKey(d) === today()
}
const isThisMonth = d => {
  if (!d) return false
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return false
  const now = new Date()
  return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth()
}
const isOrderDateToday = order => {
  const key = localDateKey(order?.order_date)
  if (!key) return false
  return key === today()
}
const isOrderDateThisMonth = order => {
  const key = localDateKey(order?.order_date)
  if (!key) return false
  return key.slice(0, 7) === today().slice(0, 7)
}
const calcDueDate = (terms, fromDate) => {
  const base = fromDate ? new Date(fromDate) : new Date()
  const map = { 'NET 15': 15, 'NET 30': 30, 'NET 45': 45, 'NET 60': 60 }
  const days = map[terms] || 0
  if (days === 0) return dateOnly(base)
  base.setDate(base.getDate() + days)
  return dateOnly(base)
}
const ISB_INVOICE_PREFIX = 'ISB-'
const ISB_INVOICE_FIRST = 250001

function isbInvoiceNumber(invoiceNo) {
  if (!invoiceNo || !String(invoiceNo).startsWith(ISB_INVOICE_PREFIX)) return null
  const num = parseInt(String(invoiceNo).slice(ISB_INVOICE_PREFIX.length), 10)
  return Number.isFinite(num) ? num : null
}

function nextInvoiceNo(orders, explicitNo) {
  if (explicitNo) return explicitNo
  let max = null
  for (const o of orders || []) {
    const num = isbInvoiceNumber(o.invoice_no)
    if (num !== null && (max === null || num > max)) max = num
  }
  const next = (max ?? ISB_INVOICE_FIRST - 1) + 1
  return `${ISB_INVOICE_PREFIX}${String(next).padStart(6, '0')}`
}
function addressLines(address) {
  return String(address || '').split(/\n/).map(l => l.trim()).filter(Boolean)
}
const stockLevel = qty => {
  const q = Number(qty) || 0
  if (q >= 25) return { cls: 'stock-green', label: q }
  if (q >= 10) return { cls: 'stock-yellow', label: q }
  if (q >= 5) return { cls: 'stock-orange', label: q }
  return { cls: 'stock-red', label: `${q} LOW STOCK` }
}

function useLocalData() {
  const [data, setData] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('isb_data_v2')) || {}
      return { ...EMPTY, ...raw, order_items: raw.order_items || [], order_tracking_numbers: raw.order_tracking_numbers || [], purchase_orders: raw.purchase_orders || [], purchase_order_items: raw.purchase_order_items || [], purchase_order_receipts: raw.purchase_order_receipts || [], purchase_order_receives: raw.purchase_order_receives || [], purchase_order_commission_payments: raw.purchase_order_commission_payments || [], expenses: raw.expenses || [] }
    } catch { return EMPTY }
  })
  useEffect(() => localStorage.setItem('isb_data_v2', JSON.stringify(data)), [data])
  return [data, setData]
}

function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState({ role: 'Admin' })
  const [authMode, setAuthMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authMsg, setAuthMsg] = useState('')
  const [page, setPage] = useState('Dashboard')
  const [cloudData, setCloudData] = useState(EMPTY)
  const [localData, setLocalData] = useLocalData()
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [dataLoadErrors, setDataLoadErrors] = useState({})
  const [globalSearch, setGlobalSearch] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [selectedRecord, setSelectedRecord] = useState({ page: '', id: '', focusFulfillment: false })
  const voidingRef = useRef(false)
  const receivingRef = useRef(false)
  const [draftPoSeed, setDraftPoSeed] = useState(null)
  const [staffUsers, setStaffUsers] = useState([])

  const data = hasSupabaseConfig && session ? cloudData : localData
  const role = profile.role || 'Admin'
  const allowedPages = PAGE_ACCESS[role] || PAGE_ACCESS.Admin

  useEffect(() => {
    if (!hasSupabaseConfig) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (hasSupabaseConfig && session) {
      loadCloudData()
      loadProfile()
    }
  }, [session])

  useEffect(() => {
    if (!allowedPages.includes(page)) setPage(allowedPages[0])
  }, [role, page, allowedPages])

  useEffect(() => {
    if (!menuOpen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  useEffect(() => {
    reloadStaffUsers()
  }, [session, profile.email, profile.role, profile.id, profile.full_name])

  async function reloadStaffUsers() {
    if (!session) {
      setStaffUsers([])
      return
    }
    try {
      let rows = []
      if (hasSupabaseConfig && session) {
        const { data: profileRows, error } = await supabase.from('profiles').select(PROFILE_NAME_FIELDS)
        if (error) throw error
        rows = profileRows || []
      } else {
        rows = [staffProfileFromSession(profile, session)]
      }
      setStaffUsers(rows || [])
    } catch {
      setStaffUsers([staffProfileFromSession(profile, session)])
    }
  }

  async function saveProfileFullName(userId, fullName) {
    return saveStaffProfile(userId, { full_name: fullName })
  }

  async function touchLastLogin(userId) {
    if (!hasSupabaseConfig || !userId) return
    if (String(userId) === String(session?.user?.id)) {
      await supabase.rpc('touch_my_last_login')
    }
  }

  async function ensureActiveProfile(userId) {
    if (!hasSupabaseConfig || !userId) return false
    const { data: row } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (row && profileStatus(row) === 'inactive') {
      await supabase.auth.signOut()
      setSession(null)
      setProfile({ role: 'Admin' })
      setAuthMsg('This account is inactive. Contact an administrator.')
      return true
    }
    if (row) setProfile(row)
    return false
  }

  async function saveStaffProfile(userId, { full_name, role, status, active }) {
    if (!userId) return { error: 'Missing user id.' }
    const patch = {}
    if (full_name !== undefined) patch.full_name = String(full_name || '').trim()
    if (role !== undefined) patch.role = role
    if (status !== undefined) {
      patch.status = status === 'inactive' ? 'inactive' : 'active'
      patch.active = patch.status === 'active'
    } else if (active !== undefined) {
      patch.active = !!active
      patch.status = active ? 'active' : 'inactive'
    }
    const isSelf = String(userId) === String(profile.id || session?.user?.id)
    const isAdmin = (profile.role || 'Admin') === 'Admin'
    const onlyFullName = full_name !== undefined
      && role === undefined && status === undefined && active === undefined

    if (hasSupabaseConfig && session) {
      if (isSelf && onlyFullName) {
        const { error } = await supabase.rpc('update_my_full_name', { p_full_name: patch.full_name })
        if (error) return { error: error.message }
      } else if (isAdmin) {
        const { error } = await supabase.from('profiles').update(patch).eq('id', userId)
        if (error) return { error: error.message }
      } else {
        return { error: 'Permission denied.' }
      }
    }
    if (String(userId) === String(profile.id || session?.user?.id)) {
      setProfile(prev => ({ ...prev, ...patch }))
    }
    await reloadStaffUsers()
    return { error: '' }
  }

  async function loadProfile() {
    if (!session?.user?.id) return
    const { data: row } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
    if (row && profileStatus(row) === 'inactive') {
      await supabase.auth.signOut()
      setSession(null)
      setProfile({ role: 'Admin' })
      setAuthMsg('This account is inactive. Contact an administrator.')
      return
    }
    if (row) setProfile(row)
    else setProfile({ role: 'Admin', email: session.user.email, status: 'active', active: true })
  }

  async function loadCloudData() {
    setLoading(true); setNotice('')
    const next = { ...EMPTY }
    const errors = {}
    for (const t of TABLES) {
      const { data: rows, error } = await supabase.from(t).select('*').order('created_at', { ascending: false })
      if (error) {
        console.error(`[loadCloudData] ${t} query failed:`, error)
        if (PO_TABLES.includes(t) || EXPENSE_TABLES.includes(t) || t === 'order_items' || t === 'order_tracking_numbers') next[t] = []
        else {
          errors[t] = error.message || `Failed to load ${t}.`
          setNotice(error.message)
        }
      } else {
        next[t] = rows || []
      }
    }
    setDataLoadErrors(errors)
    setCloudData(next); setLoading(false)
  }

  async function authAction(e) {
    e.preventDefault(); setAuthMsg('')
    if (!email || !password) return setAuthMsg('Email and password required')
    if (!hasSupabaseConfig) { setSession({ user: { email } }); setProfile({ role: 'Admin', email }); return }
    if (authMode === 'signup') {
      const res = await supabase.auth.signUp({ email, password })
      if (res.error) setAuthMsg(res.error.message)
      else setAuthMsg('Account created. Check email if confirmation is enabled.')
      return
    }
    const res = await supabase.auth.signInWithPassword({ email, password })
    if (res.error) return setAuthMsg(res.error.message)
    const userId = res.data.user?.id
    if (userId) {
      const blocked = await ensureActiveProfile(userId)
      if (blocked) return
      await touchLastLogin(userId)
      await loadProfile()
    }
    setAuthMsg('')
  }

  async function logout() {
    if (hasSupabaseConfig) await supabase.auth.signOut()
    setSession(null); setProfile({ role: 'Admin' })
  }

  async function addRow(table, row) {
    setNotice('')
    if (hasSupabaseConfig && session) {
      const { error } = await supabase.from(table).insert(row)
      if (error) return setNotice(error.message)
      await loadCloudData()
    } else {
      setLocalData(p => ({ ...p, [table]: [{ id: uid(), created_at: new Date().toISOString(), ...row }, ...p[table]] }))
    }
  }

  async function saveOrderTrackingNumbers(orderId, values) {
    const rows = buildTrackingInsertRows(orderId, values)
    const primary = primaryTrackingValue(values)
    if (hasSupabaseConfig && session) {
      const { error: delErr } = await supabase.from('order_tracking_numbers').delete().eq('order_id', orderId)
      if (delErr) return { error: delErr.message }
      if (rows.length) {
        const { error: insErr } = await supabase.from('order_tracking_numbers').insert(rows)
        if (insErr) return { error: insErr.message }
      }
      const { error: syncErr } = await supabase.from('orders').update({ tracking: primary }).eq('id', orderId)
      if (syncErr) return { error: syncErr.message }
    } else {
      setLocalData(p => ({
        ...p,
        order_tracking_numbers: [
          ...(p.order_tracking_numbers || []).filter(r => String(r.order_id) !== String(orderId)),
          ...rows.map(r => ({
            id: uid(),
            ...r,
            created_at: new Date().toISOString(),
          })),
        ],
        orders: p.orders.map(o => String(o.id) === String(orderId) ? { ...o, tracking: primary } : o),
      }))
    }
    return { error: '' }
  }

  async function updateRow(table, id, row) {
    setNotice('')
    if (hasSupabaseConfig && session) {
      const { error } = await supabase.from(table).update(row).eq('id', id)
      if (error) return setNotice(error.message)
      await loadCloudData()
    } else {
      setLocalData(p => ({ ...p, [table]: p[table].map(x => String(x.id) === String(id) ? { ...x, ...row } : x) }))
    }
  }

  async function deleteRow(table, id) {
    if (!confirm('Delete this item?')) return
    if (hasSupabaseConfig && session) {
      const { error } = await supabase.from(table).delete().eq('id', id)
      if (error) return setNotice(error.message)
      await loadCloudData()
    } else {
      setLocalData(p => ({ ...p, [table]: p[table].filter(x => String(x.id) !== String(id)) }))
    }
  }

  async function insertOrderRow(payload) {
    if (hasSupabaseConfig && session) {
      const { data: rows, error } = await supabase.from('orders').insert(payload).select('id')
      if (error) return { ok: false, error: error.message }
      return { ok: true, id: rows?.[0]?.id }
    }
    const id = uid()
    setLocalData(p => ({
      ...p,
      orders: [{ id, created_at: new Date().toISOString(), ...payload }, ...p.orders],
    }))
    return { ok: true, id }
  }

  async function insertOrderItemsCloud(rows) {
    const payloads = logOrderItemInsertPayload('order_items insert', rows)
    const { error } = await supabase.from('order_items').insert(payloads)
    return error
  }

  async function deleteOrderRowSilent(id) {
    if (!id) return { ok: false, error: 'Missing order id.' }
    if (hasSupabaseConfig && session) {
      const { error } = await supabase.from('orders').delete().eq('id', id)
      if (error) return { ok: false, error: error.message }
      return { ok: true }
    }
    setLocalData(p => ({ ...p, orders: p.orders.filter(o => String(o.id) !== String(id)) }))
    return { ok: true }
  }

  async function setInventoryQtyAbsolute(inventoryId, qty) {
    const safeQty = Math.max(Number(qty) || 0, 0)
    if (hasSupabaseConfig && session) {
      const { error } = await supabase.from('inventory').update({ qty: safeQty }).eq('id', inventoryId)
      if (error) return { ok: false, error: error.message }
      return { ok: true }
    }
    setLocalData(p => ({
      ...p,
      inventory: p.inventory.map(i => String(i.id) === String(inventoryId) ? { ...i, qty: safeQty } : i),
    }))
    return { ok: true }
  }

  async function adjustInventoryQty(inventoryId, delta) {
    const change = Number(delta)
    const parsed = parseInventoryIdForRpc(inventoryId)

    if (!parsed.ok) {
      return { ok: false, error: parsed.error }
    }
    if (change === 0 || !Number.isFinite(change)) {
      return { ok: true }
    }

    if (hasSupabaseConfig && session) {
      const rpcArgs = { p_inventory_id: parsed.id, p_delta: change }
      const { data: beforeRow, error: beforeErr } = await supabase
        .from('inventory')
        .select(`id, ${INVENTORY_STOCK_COLUMN}`)
        .eq('id', parsed.id)
        .maybeSingle()
      if (beforeErr) return { ok: false, error: `Inventory read failed before RPC: ${beforeErr.message}` }
      if (!beforeRow) return { ok: false, error: `Inventory item ${parsed.id} not found before RPC.` }

      const { data: rpcData, error: rpcErr } = await supabase.rpc(INVENTORY_ADJUST_RPC, rpcArgs)

      if (rpcErr) {
        const msg = rpcErr.message || 'Unknown Supabase RPC error'
        return { ok: false, error: `Inventory deduction failed (${INVENTORY_ADJUST_RPC}): ${msg}` }
      }

      const { data: afterRow, error: afterErr } = await supabase
        .from('inventory')
        .select(`id, ${INVENTORY_STOCK_COLUMN}`)
        .eq('id', parsed.id)
        .maybeSingle()
      const qtyAfter = Number(afterRow?.[INVENTORY_STOCK_COLUMN] ?? NaN)

      if (afterErr) {
        return { ok: false, error: `Inventory verification failed after RPC: ${afterErr.message}` }
      }
      if (!afterRow) {
        return { ok: false, error: `Inventory item ${parsed.id} not found after RPC.` }
      }

      const qtyBefore = Number(beforeRow[INVENTORY_STOCK_COLUMN] ?? rpcData?.qty_before ?? 0)
      const expectedAfter = Math.max(qtyBefore + change, 0)
      if (!Number.isFinite(qtyAfter) || Math.abs(qtyAfter - expectedAfter) > 0.0001) {
        return { ok: false, error: `Inventory ${INVENTORY_STOCK_COLUMN} mismatch after RPC: expected ${expectedAfter}, got ${qtyAfter}.` }
      }

      return { ok: true, data: { qty_before: qtyBefore, qty_after: qtyAfter, delta: change, rpc: rpcData } }
    }

    setLocalData(p => {
      const inv = p.inventory.find(i => String(i.id) === String(parsed.id))
      const oldQty = Number(inv?.[INVENTORY_STOCK_COLUMN] || 0)
      const next = Math.max(oldQty + change, 0)
      return {
        ...p,
        inventory: p.inventory.map(i => String(i.id) === String(parsed.id)
          ? { ...i, [INVENTORY_STOCK_COLUMN]: next }
          : i),
      }
    })
    return { ok: true }
  }

  async function applyInventoryStockDeltaPlan(plan) {
    for (const step of plan || []) {
      const requestedDelta = -Number(step.delta || 0)
      const result = await adjustInventoryQty(step.inventory_id, requestedDelta)
      if (result?.ok === false) return { error: result.error || 'Inventory update failed.' }
    }
    return { error: '' }
  }

  async function rollbackCreatedOrder(orderId) {
    if (hasSupabaseConfig && session) {
      await supabase.from('order_items').delete().eq('order_id', orderId)
    } else {
      setLocalData(p => ({
        ...p,
        order_items: p.order_items.filter(i => String(i.order_id) !== String(orderId)),
        order_tracking_numbers: (p.order_tracking_numbers || []).filter(i => String(i.order_id) !== String(orderId)),
      }))
    }
    const rollback = await deleteOrderRowSilent(orderId)
    if (hasSupabaseConfig && session) await loadCloudData()
    return rollback
  }

  async function deleteOrder(id) {
    const order = data.orders.find(o => String(o.id) === String(id))
    if (!order) return false

    const relatedPayments = data.payments.filter(p =>
      String(p.order_id) === String(id) || (order.invoice_no && p.invoice_no === order.invoice_no)
    )

    if (!confirm(`Delete invoice ${order.invoice_no || '—'}?`)) return false

    if (relatedPayments.length > 0) {
      const paidTotal = relatedPayments.reduce((s, p) => s + Number(p.amount || 0), 0)
      const deletePaymentsToo = confirm(
        `This invoice has ${relatedPayments.length} payment record(s) totaling ${money(paidTotal)}.\n\nDelete those payment records as well?\n\nOK = delete invoice and payments\nCancel = abort deletion`
      )
      if (!deletePaymentsToo) return false
    }

    setNotice('')
    const restorePlan = orderRestorePlan(order, data.order_items)

    if (hasSupabaseConfig && session) {
      for (const step of restorePlan) {
        await adjustInventoryQty(step.inventory_id, step.qty)
      }
      for (const p of relatedPayments) {
        const { error } = await supabase.from('payments').delete().eq('id', p.id)
        if (error) return setNotice(error.message), false
      }
      await supabase.from('order_items').delete().eq('order_id', id)
      const { error } = await supabase.from('orders').delete().eq('id', id)
      if (error) return setNotice(error.message), false
      await loadCloudData()
    } else {
      const paymentIds = new Set(relatedPayments.map(p => String(p.id)))
      setLocalData(p => {
        let inventory = [...p.inventory]
        for (const step of restorePlan) {
          inventory = inventory.map(i => String(i.id) === String(step.inventory_id)
            ? { ...i, qty: Math.max(Number(i.qty || 0) + step.qty, 0) }
            : i)
        }
        return {
          ...p,
          inventory,
          payments: p.payments.filter(x => !paymentIds.has(String(x.id))),
          order_items: p.order_items.filter(x => String(x.order_id) !== String(id)),
          order_tracking_numbers: (p.order_tracking_numbers || []).filter(x => String(x.order_id) !== String(id)),
          orders: p.orders.filter(x => String(x.id) !== String(id)),
        }
      })
    }

    return true
  }

  async function voidInvoice(orderId, { reason, note }) {
    if (voidingRef.current) return { error: 'Void already in progress.' }
    if (role !== 'Admin') return { error: 'Only administrators can void invoices.' }

    const order = data.orders.find(o => String(o.id) === String(orderId))
    if (!order) return { error: 'Invoice not found.' }
    if (isVoidOrder(order)) return { error: 'This invoice is already voided.' }
    if (!reason) return { error: 'Void reason is required.' }

    const restorePlan = orderRestorePlan(order, data.order_items)
    const voidedBy = session?.user?.email || profile.email || role || 'Admin'
    const payload = buildVoidPayload(order, data.payments, { reason, note, voidedBy })
    const orderLines = itemsForOrder(order, data.order_items)
    const voidedItems = orderLines.map(line => ({
      ...line,
      allocated_qty: 0,
      backorder_qty: 0,
    }))

    voidingRef.current = true
    setNotice('')
    try {
      if (hasSupabaseConfig && session) {
        const rollback = []
        for (const step of restorePlan) {
          const result = await adjustInventoryQty(step.inventory_id, step.qty)
          if (result?.ok === false) {
            for (const rb of rollback.reverse()) {
              await adjustInventoryQty(rb.inventory_id, -rb.qty)
            }
            setNotice(result.error)
            return { error: result.error }
          }
          rollback.push({ inventory_id: step.inventory_id, qty: step.qty })
        }
        for (const line of voidedItems) {
          if (String(line.id || '').startsWith('legacy-')) continue
          await supabase.from('order_items').update({
            allocated_qty: 0,
            backorder_qty: 0,
          }).eq('id', line.id)
        }
        const { error: orderErr } = await supabase.from('orders').update(payload).eq('id', orderId)
        if (orderErr) {
          for (const rb of rollback.reverse()) {
            await adjustInventoryQty(rb.inventory_id, -rb.qty)
          }
          setNotice(orderErr.message)
          return { error: orderErr.message }
        }
        await loadCloudData()
      } else {
        setLocalData(p => {
          const existing = p.orders.find(o => String(o.id) === String(orderId))
          if (existing && isVoidOrder(existing)) return p
          let inventory = [...p.inventory]
          for (const step of restorePlan) {
            inventory = inventory.map(i => String(i.id) === String(step.inventory_id)
              ? { ...i, qty: Math.max(Number(i.qty || 0) + step.qty, 0) }
              : i)
          }
          return {
            ...p,
            inventory,
            order_items: p.order_items.map(item => String(item.order_id) === String(orderId)
              ? { ...item, allocated_qty: 0, backorder_qty: 0 }
              : item),
            orders: p.orders.map(o => String(o.id) === String(orderId) ? { ...o, ...payload } : o),
          }
        })
      }
      return { error: '' }
    } finally {
      voidingRef.current = false
    }
  }

  function buildPoRow(id, header, totals, isNew) {
    const createdBy = session?.user?.email || profile.email || role || 'Admin'
    return {
      id,
      po_number: header.po_number || nextPoNumber(data.purchase_orders),
      purchase_type: totals.purchaseType || header.purchase_type || 'direct',
      order_date: toDbDate(header.order_date || today()),
      supplier: header.supplier || '',
      middleman_name: isMiddlemanPurchaseType(totals.purchaseType) ? (header.middleman_name || '') : '',
      currency: header.currency || 'KRW',
      exchange_rate: totals.exchangeRate,
      shipping_cost: totals.shippingCost,
      other_cost: totals.otherCost,
      eta: header.eta || null,
      status: header.status || 'Draft',
      notes: header.notes || '',
      total_ordered_units: totals.totalOrderedUnits,
      total_product_cost: totals.totalProductCost,
      total_product_cost_usd: totals.totalProductCostUsd,
      total_commission: totals.totalCommissionUsd,
      total_purchase_cost_usd: totals.totalPurchaseCostUsd,
      grand_total: totals.grandTotal,
      commission_payment_status: isMiddlemanPurchaseType(totals.purchaseType)
        ? (header.commission_payment_status || deriveCommissionPaymentStatus({ ...header, total_commission: totals.totalCommissionUsd }))
        : 'Paid',
      commission_amount_paid: isMiddlemanPurchaseType(totals.purchaseType) ? Number(header.commission_amount_paid) || 0 : 0,
      commission_payment_date: isMiddlemanPurchaseType(totals.purchaseType) ? header.commission_payment_date || null : null,
      commission_payment_method: isMiddlemanPurchaseType(totals.purchaseType) ? header.commission_payment_method || '' : '',
      commission_payment_note: isMiddlemanPurchaseType(totals.purchaseType) ? header.commission_payment_note || '' : '',
      created_by: isNew ? createdBy : (header.created_by || createdBy),
      updated_at: new Date().toISOString(),
      ...(isNew ? { created_at: new Date().toISOString() } : {}),
    }
  }

  function buildPoItemRows(poId, lines, purchaseType, inventoryList = []) {
    return lines.map(line => ({
      id: line.id || newPoId(),
      purchase_order_id: poId,
      inventory_id: resolvePoLineInventoryId(line, inventoryList),
      product_sku: line.product_sku || line.product_name || '',
      product_name: line.product_name || line.product_sku || '',
      brand: line.brand || '',
      order_qty: line.order_qty,
      korean_unit_cost: line.factory_unit_cost_original ?? line.korean_unit_cost,
      factory_unit_cost_usd: line.factory_unit_cost_usd,
      product_cost: line.product_cost,
      product_cost_usd: line.product_cost_usd,
      middleman_commission_unit_krw: line.middleman_commission_unit_krw,
      middleman_commission_unit_usd: line.middleman_commission_unit_usd,
      middleman_commission_total_krw: line.middleman_commission_total_krw,
      middleman_commission_total_usd: line.middleman_commission_total_usd,
      middleman_name: line.middleman_name || '',
      commission_type: line.commission_type || '',
      commission_value: line.commission_value ?? 0,
      total_unit_cost_krw: line.total_unit_cost_krw,
      total_unit_cost_usd: line.total_unit_cost_usd,
      commission_percent: 0,
      commission_per_unit: line.commission_per_unit_usd ?? line.commission_per_unit,
      commission_per_unit_usd: line.commission_per_unit_usd ?? line.commission_per_unit,
      commission_total: line.commission_total_usd ?? line.commission_total,
      commission_total_usd: line.commission_total_usd ?? line.commission_total,
      total_line_cost: line.total_line_cost_usd ?? line.total_line_cost,
      received_qty: line.received_qty || 0,
      note: line.note || '',
      created_at: line.created_at || new Date().toISOString(),
    }))
  }

  async function savePurchaseOrder({ id, header, lines }) {
    if (role !== 'Admin') { setNotice('Only administrators can save purchase orders.'); return 'denied' }
    const existing = id ? data.purchase_orders.find(p => String(p.id) === String(id)) : null
    if (existing && !['Draft', 'Submitted', 'In Production', 'Shipped'].includes(existing.status)) {
      setNotice('This purchase order cannot be edited.'); return 'locked'
    }
    const validationError = validatePoSave(header, lines)
    if (validationError) { setNotice(validationError); return validationError }
    const normalized = normalizePoSavePayload(header, lines, existing)
    const totals = normalized.totals
    const poId = id || newPoId()
    const poRow = buildPoRow(poId, { ...normalized.header, po_number: header.po_number || nextPoNumber(data.purchase_orders) }, totals, !id)
    poRow.status = derivePoStatus(normalized.lines, header.status || existing?.status || 'Draft')
    const itemRows = buildPoItemRows(poId, normalized.lines, totals.purchaseType, data.inventory)
    setNotice('')
    if (hasSupabaseConfig && session) {
      if (id) {
        const { error } = await supabase.from('purchase_orders').update(poRow).eq('id', poId)
        if (error) { setNotice(error.message); return error.message }
        await supabase.from('purchase_order_items').delete().eq('purchase_order_id', poId)
      } else {
        const { error } = await supabase.from('purchase_orders').insert(poRow)
        if (error) { setNotice(error.message); return error.message }
      }
      const { error: itemsErr } = await supabase.from('purchase_order_items').insert(itemRows)
      if (itemsErr) { setNotice(itemsErr.message); return itemsErr.message }
      await loadCloudData()
    } else {
      setLocalData(p => {
        const pos = id
          ? p.purchase_orders.map(x => String(x.id) === String(poId) ? { ...x, ...poRow } : x)
          : [{ ...poRow }, ...p.purchase_orders]
        const keptItems = p.purchase_order_items.filter(i => String(i.purchase_order_id) !== String(poId))
        return {
          ...p,
          purchase_orders: pos,
          purchase_order_items: [...itemRows, ...keptItems],
        }
      })
    }
    return ''
  }

  async function receivePurchaseOrder(poId, receiveHeader) {
    if (receivingRef.current) return 'Receive already in progress.'
    if (role !== 'Admin') return 'Only administrators can receive inventory.'
    const po = data.purchase_orders.find(p => String(p.id) === String(poId))
    if (!po) return 'Purchase order not found.'
    if (po.status === 'Cancelled') return 'Cannot receive a cancelled purchase order.'
    if (po.status === 'Received') return 'Purchase order is already fully received.'

    const purchaseType = resolvePurchaseType(po, data.purchase_order_items.filter(i => String(i.purchase_order_id) === String(poId)))
    const poItems = data.purchase_order_items
      .filter(i => String(i.purchase_order_id) === String(poId))
      .map(l => calcLineItem(l, purchaseType, po.currency, po.exchange_rate))
    const lines = receiveHeader.lines || []
    const shippingCost = Math.max(Number(receiveHeader.shipping_cost) || 0, 0)
    const otherCost = Math.max(Number(receiveHeader.other_cost) || 0, 0)
    const poHeaderShipping = Math.max(Number(po.shipping_cost) || 0, 0)
    const poHeaderOther = Math.max(Number(po.other_cost) || 0, 0)
    const usesPoLevelCosts = poHeaderShipping > 0 || poHeaderOther > 0
    const rpcShippingCost = usesPoLevelCosts ? 0 : shippingCost
    const rpcOtherCost = usesPoLevelCosts ? 0 : otherCost
    const validationError = validateReceive(
      { shipping_cost: rpcShippingCost, other_cost: rpcOtherCost },
      lines,
      poItems,
      po,
    )
    if (validationError) {
      setNotice(validationError)
      return validationError
    }

    const payload = lines.filter(l => Number(l.receive_now) > 0)
    const allocated = allocateReceiveCosts(
      payload.map(row => {
        const item = poItems.find(i => String(i.id) === String(row.purchase_order_item_id))
        return { ...item, receive_now: Number(row.receive_now) }
      }),
      rpcShippingCost,
      rpcOtherCost,
      purchaseType,
      po,
      poItems,
    )
    const receivedBy = session?.user?.email || profile.email || 'Admin'
    const receivedDate = receiveHeader.received_date
      ? new Date(`${receiveHeader.received_date}T12:00:00`).toISOString()
      : new Date().toISOString()

    receivingRef.current = true
    setNotice('')
    try {
      if (hasSupabaseConfig && session) {
        const rpcLines = payload.map(l => ({
          purchase_order_item_id: l.purchase_order_item_id,
          receive_now: Number(l.receive_now),
          selling_price: parseReceiveSellingPrice(l.selling_price),
          note: l.note || '',
        }))
        const { error } = await supabase.rpc('receive_purchase_order_items', {
          p_po_id: poId,
          p_lines: rpcLines,
          p_received_by: receivedBy,
          p_received_date: receivedDate,
          p_shipment_number: receiveHeader.shipment_number || '',
          p_shipping_cost: rpcShippingCost,
          p_other_cost: rpcOtherCost,
          p_other_cost_description: receiveHeader.other_cost_description || '',
          p_notes: receiveHeader.notes || '',
        })
        if (error) {
          setNotice(error.message)
          return error.message
        }
        await loadCloudData()
        return ''
      }

      const existingReceives = data.purchase_order_receives.filter(r => String(r.purchase_order_id) === String(poId))
      const receiveId = newPoId()
      const receiveNumber = nextReceiveNumber(existingReceives, po.po_number)
      const receiveRow = {
        id: receiveId,
        purchase_order_id: poId,
        receive_number: receiveNumber,
        received_date: receivedDate,
        shipment_number: receiveHeader.shipment_number || '',
        shipping_cost: rpcShippingCost,
        other_cost: rpcOtherCost,
        other_cost_description: receiveHeader.other_cost_description || '',
        notes: receiveHeader.notes || '',
        received_by: receivedBy,
        created_at: new Date().toISOString(),
      }
      const receiptRows = []
      const itemUpdates = new Map()
      const lineInventoryLinks = new Map()
      const newInventoryRows = []
      const inventoryState = new Map(data.inventory.map(inv => [String(inv.id), { ...inv }]))
      const pendingInventoryBySku = new Map()

      function resolveInventoryForLine(item, alloc, sellingPriceInput) {
        const sku = normalizePoSku(item.product_sku || item.product_name)
        if (!sku) return { error: 'Product SKU is required to receive inventory.' }

        let invId = item.inventory_id ? String(item.inventory_id) : ''
        let inv = invId ? inventoryState.get(invId) : null

        if (!inv) {
          inv = findInventoryBySku([...inventoryState.values(), ...newInventoryRows], sku)
          if (inv) invId = String(inv.id)
        }

        if (!inv) {
          invId = pendingInventoryBySku.get(sku)
          if (invId) inv = inventoryState.get(invId) || newInventoryRows.find(r => String(r.id) === invId)
        }

        if (!inv) {
          invId = uid()
          pendingInventoryBySku.set(sku, invId)
          const parsedSelling = parseReceiveSellingPrice(sellingPriceInput)
          inv = {
            id: invId,
            created_at: new Date().toISOString(),
            ...buildInventoryRowFromPoLine(item, po, {
              landedUnitCost: alloc.landed_unit_cost,
              inventoryBuyingPerUnit: alloc.inventory_buying_per_unit,
              shippingPerUnit: alloc.shipping_per_unit,
              qty: 0,
              sellingPrice: parsedSelling > 0 ? parsedSelling : 0,
            }),
          }
          newInventoryRows.push(inv)
          inventoryState.set(invId, inv)
        }

        return { inv, invId, sku }
      }

      for (const alloc of allocated) {
        const item = poItems.find(i => String(i.id) === String(alloc.id))
        if (!item) return 'PO line item not found.'
        const payloadRow = payload.find(p => String(p.purchase_order_item_id) === String(item.id))
        const resolved = resolveInventoryForLine(item, alloc, payloadRow?.selling_price)
        if (resolved.error) return resolved.error

        const { inv, invId } = resolved
        const receiveNow = Number(alloc.receive_now)
        const before = Number(inv.qty || 0)
        const after = before + receiveNow
        const oldBuying = itemBuying(inv)
        const oldShipping = itemShipping(inv)
        const newBuying = calcWeightedAverage(
          before,
          oldBuying,
          receiveNow,
          alloc.inventory_buying_per_unit ?? alloc.landed_unit_cost,
        )
        const newShipping = calcWeightedAverage(
          before,
          oldShipping,
          receiveNow,
          alloc.shipping_per_unit ?? 0,
        )

        let nextInv = {
          ...inv,
          qty: after,
          buying_price: newBuying,
          shipping_cost: newShipping,
          cost: newBuying,
        }
        nextInv = applyReceiveSellingPriceToInventory(nextInv, payloadRow?.selling_price)
        inventoryState.set(String(invId), nextInv)

        const newReceived = item.received_qty + receiveNow
        itemUpdates.set(String(item.id), newReceived)
        lineInventoryLinks.set(String(item.id), invId)

        receiptRows.push({
          id: newPoId(),
          purchase_order_id: poId,
          purchase_order_item_id: item.id,
          inventory_id: invId,
          receive_id: receiveId,
          received_qty: receiveNow,
          received_date: receivedDate,
          received_by: receivedBy,
          note: alloc.note || '',
          inventory_before: before,
          inventory_after: after,
          factory_unit_cost: alloc.factory_unit_cost,
          commission_per_unit: alloc.commission_per_unit,
          shipping_allocation: alloc.shipping_allocation,
          other_cost_allocation: alloc.other_cost_allocation,
          landed_unit_cost: alloc.landed_unit_cost,
          buying_price_before: oldBuying,
          buying_price_after: newBuying,
          created_at: new Date().toISOString(),
        })
      }

      if (receiptRows.length !== allocated.length) {
        return 'Receive failed: inventory receipts were not created for all received lines.'
      }

      const updatedItems = poItems.map(item => {
        const nr = itemUpdates.get(String(item.id))
        const linkedInventoryId = lineInventoryLinks.get(String(item.id))
        if (nr == null && !linkedInventoryId) return item
        return {
          ...item,
          ...(nr != null ? { received_qty: nr } : {}),
          ...(linkedInventoryId ? { inventory_id: linkedInventoryId } : {}),
        }
      })
      const newStatus = derivePoStatus(updatedItems, po.status)
      const newShipping = usesPoLevelCosts ? poHeaderShipping : poHeaderShipping + rpcShippingCost
      const newOther = usesPoLevelCosts ? poHeaderOther : poHeaderOther + rpcOtherCost
      const allPoItems = data.purchase_order_items.filter(i => String(i.purchase_order_id) === String(poId))
      const { productCostUsd, commissionUsd } = calcPoUsdTotalsFromItems(allPoItems, po)
      const newGrand = productCostUsd + commissionUsd + newShipping + newOther

      setLocalData(p => ({
        ...p,
        purchase_orders: p.purchase_orders.map(x => String(x.id) === String(poId) ? {
          ...x,
          status: newStatus,
          shipping_cost: newShipping,
          other_cost: newOther,
          total_product_cost_usd: productCostUsd,
          total_purchase_cost_usd: newGrand,
          grand_total: newGrand,
          updated_at: new Date().toISOString(),
        } : x),
        purchase_order_items: p.purchase_order_items.map(i => {
          const nr = itemUpdates.get(String(i.id))
          const linkedInventoryId = lineInventoryLinks.get(String(i.id))
          if (nr == null && !linkedInventoryId) return i
          return {
            ...i,
            ...(nr != null ? { received_qty: nr } : {}),
            ...(linkedInventoryId ? { inventory_id: linkedInventoryId } : {}),
          }
        }),
        purchase_order_receives: [receiveRow, ...p.purchase_order_receives],
        purchase_order_receipts: [...receiptRows, ...p.purchase_order_receipts],
        inventory: [
          ...newInventoryRows,
          ...p.inventory.map(inv => inventoryState.get(String(inv.id)) || inv),
        ],
      }))
      return ''
    } finally {
      receivingRef.current = false
    }
  }

  async function cancelPurchaseOrder(poId) {
    if (role !== 'Admin') { setNotice('Only administrators can cancel purchase orders.'); return 'denied' }
    const po = data.purchase_orders.find(p => String(p.id) === String(poId))
    if (!po) return 'not found'
    if (po.status === 'Cancelled') return 'already cancelled'
    if (po.status === 'Received') return 'Cannot cancel a fully received PO.'
    if (hasSupabaseConfig && session) {
      const { error } = await supabase.from('purchase_orders').update({ status: 'Cancelled', updated_at: new Date().toISOString() }).eq('id', poId)
      if (error) { setNotice(error.message); return error.message }
      await loadCloudData()
    } else {
      setLocalData(p => ({
        ...p,
        purchase_orders: p.purchase_orders.map(x => String(x.id) === String(poId) ? { ...x, status: 'Cancelled', updated_at: new Date().toISOString() } : x),
      }))
    }
    return ''
  }

  async function syncPoCommissionHeader(poId) {
    const po = data.purchase_orders.find(p => String(p.id) === String(poId))
    if (!po) return
    const items = data.purchase_order_items.filter(i => String(i.purchase_order_id) === String(poId))
    const payments = poCommissionPaymentsForOrder(data.purchase_order_commission_payments, poId)
    const summary = commissionPaymentSummary(po, items, payments)
    const row = {
      commission_amount_paid: summary.paidKrw,
      commission_payment_status: summary.status,
      updated_at: new Date().toISOString(),
    }
    if (hasSupabaseConfig && session) {
      const { error } = await supabase.from('purchase_orders').update(row).eq('id', poId)
      if (error) { setNotice(error.message); return error.message }
      await loadCloudData()
    } else {
      setLocalData(p => ({
        ...p,
        purchase_orders: p.purchase_orders.map(x => String(x.id) === String(poId) ? { ...x, ...row } : x),
      }))
    }
    return ''
  }

  async function addPoCommissionPayment(poId, entry) {
    if (role !== 'Admin') return 'Only administrators can record commission payments.'
    const po = data.purchase_orders.find(p => String(p.id) === String(poId))
    if (!po) return 'Purchase order not found.'
    if (po.status === 'Cancelled') return 'Cannot add payments to a cancelled purchase order.'
    const validationError = validateCommissionPaymentEntry(entry)
    if (validationError) { setNotice(validationError); return validationError }

    const rate = resolveExchangeRate(po.currency || 'KRW', po.exchange_rate)
    const amountKrw = Number(entry.amount_krw) || 0
    const paymentRow = {
      id: newPoId(),
      purchase_order_id: poId,
      amount_krw: amountKrw,
      amount: rate > 0 ? amountKrw / rate : 0,
      payment_date: toDbDate(entry.payment_date),
      payment_method: entry.payment_method || '',
      reference_number: entry.reference_number || '',
      notes: entry.notes || '',
      created_by: session?.user?.email || profile.email || role || 'Admin',
      created_at: new Date().toISOString(),
    }

    if (hasSupabaseConfig && session) {
      const { error } = await supabase.from('purchase_order_commission_payments').insert(paymentRow)
      if (error) { setNotice(error.message); return error.message }
      await loadCloudData()
      return syncPoCommissionHeader(poId)
    }

    setLocalData(p => {
      const items = p.purchase_order_items.filter(i => String(i.purchase_order_id) === String(poId))
      const nextPayments = [paymentRow, ...(p.purchase_order_commission_payments || [])]
      const summary = commissionPaymentSummary(po, items, nextPayments)
      return {
        ...p,
        purchase_order_commission_payments: nextPayments,
        purchase_orders: p.purchase_orders.map(x => String(x.id) === String(poId) ? {
          ...x,
          commission_amount_paid: summary.paidKrw,
          commission_payment_status: summary.status,
          updated_at: new Date().toISOString(),
        } : x),
      }
    })
    return ''
  }

  async function deletePoCommissionPayment(paymentId) {
    if (role !== 'Admin') return 'Only administrators can delete commission payments.'
    const payment = (data.purchase_order_commission_payments || []).find(p => String(p.id) === String(paymentId))
    if (!payment) return 'Payment record not found.'
    const poId = payment.purchase_order_id

    if (hasSupabaseConfig && session) {
      const { error } = await supabase.from('purchase_order_commission_payments').delete().eq('id', paymentId)
      if (error) { setNotice(error.message); return error.message }
      await loadCloudData()
      return syncPoCommissionHeader(poId)
    }

    setLocalData(p => {
      const po = p.purchase_orders.find(x => String(x.id) === String(poId))
      const items = p.purchase_order_items.filter(i => String(i.purchase_order_id) === String(poId))
      const nextPayments = (p.purchase_order_commission_payments || []).filter(x => String(x.id) !== String(paymentId))
      const summary = commissionPaymentSummary(po, items, nextPayments)
      return {
        ...p,
        purchase_order_commission_payments: nextPayments,
        purchase_orders: p.purchase_orders.map(x => String(x.id) === String(poId) ? {
          ...x,
          commission_amount_paid: summary.paidKrw,
          commission_payment_status: summary.status,
          updated_at: new Date().toISOString(),
        } : x),
      }
    })
    return ''
  }

  function createPoFromReorder(reorderItems) {
    const seed = buildPoFromReorderItems(reorderItems, nextPoNumber(data.purchase_orders))
    setDraftPoSeed(seed)
    setPage('Purchase Orders')
    setMenuOpen(false)
  }

  async function createOrder(f) {
    if (!f.customer_id) return { error: 'Select a customer.' }

    const { lines: mergedLines, mergedCount } = mergeDuplicateInventoryLines(f.lines || [])
    const lineError = validateOrderLines(mergedLines)
    if (lineError) return { error: lineError }

    const customer = data.customers.find(c => String(c.id) === String(f.customer_id))
    const orderDate = toDbDate(f.order_date || today())
    const dueDate = toDbDate(f.due_date || calcDueDate(customer?.payment_terms, orderDate))
    if (!isValidDbDate(orderDate)) return { error: 'Invalid order date. Use the date picker.' }
    if (!isValidDbDate(dueDate)) return { error: 'Invalid due date. Use the date picker.' }

    const shipping = Number(f.shipping || 0)
    const discount = Number(f.discount || 0)
    const tax = Number(f.tax || 0)
    if (!Number.isFinite(shipping) || shipping < 0) return { error: 'Enter a valid shipping charge.' }
    if (!Number.isFinite(discount) || discount < 0) return { error: 'Enter a valid invoice discount.' }
    if (!Number.isFinite(tax) || tax < 0) return { error: 'Enter a valid tax amount.' }

    const totals = calcOrderTotals(mergedLines, f, data.inventory)
    const allocErr = validateOrderInventoryAllocation(totals.lines)
    if (allocErr) return { error: allocErr }
    const deductBlock = allocationDeductionError(totals.lines)
    if (deductBlock) return { error: deductBlock }
    const salesPerson = resolveSalesPersonFields(f.sales_person_id, staffUsers)
    const headerInput = {
      ...f,
      ...salesPerson,
      customer_name: customer?.company || customer?.name || f.customer_name || '',
      order_date: orderDate,
      due_date: dueDate,
      invoice_no: nextInvoiceNo(data.orders, f.invoice_no),
      payment_status: 'Unpaid',
    }
    const payload = buildOrderHeaderFromLines(headerInput, totals, totals.lines, data.inventory)

    setNotice('')
    const inserted = await insertOrderRow(payload)
    if (!inserted.ok) {
      setNotice(inserted.error)
      return { error: inserted.error }
    }

    const orderId = inserted.id
    let itemRows = []

    if (hasSupabaseConfig && session) {
      itemRows = buildOrderItemInsertRows(orderId, totals.lines)
      const itemsErr = await insertOrderItemsCloud(itemRows)
      if (itemsErr) {
        await deleteOrderRowSilent(orderId)
        await loadCloudData()
        setNotice(itemsErr.message)
        return { error: itemsErr.message }
      }
    } else {
      itemRows = buildOrderItemLocalRows(orderId, totals.lines, uid)
      setLocalData(p => ({
        ...p,
        order_items: [...itemRows, ...p.order_items],
      }))
    }

    const deductionPlan = enrichDeductionPlan(totals.lines)
    const stockResult = await applyInventoryStockDeltaPlan(deductionPlan)
    if (stockResult.error) {
      const rollback = await rollbackCreatedOrder(orderId)
      const msg = rollback.ok
        ? `Inventory update failed: ${stockResult.error}. The order was rolled back.`
        : `Inventory update failed and rollback may be incomplete: ${stockResult.error}. Check orders and inventory.`
      setNotice(msg)
      return { error: msg }
    }

    const trackResult = await saveOrderTrackingNumbers(orderId, f.tracking_entries)
    if (trackResult.error) {
      for (const step of deductionPlan) {
        await adjustInventoryQty(step.inventory_id, Number(step.delta || 0))
      }
      const rollback = await rollbackCreatedOrder(orderId)
      const msg = rollback.ok
        ? `Tracking save failed: ${trackResult.error}. The order was rolled back.`
        : `Tracking save failed and rollback may be incomplete: ${trackResult.error}. Check orders and tracking.`
      setNotice(msg)
      return { error: msg }
    }

    if (hasSupabaseConfig && session) await loadCloudData()
    return { error: '', mergedCount }
  }

  async function repairNegativeInventory() {
    const negative = data.inventory.filter(i => Number(i.qty) < 0)
    if (!negative.length) {
      return { repaired: [], message: 'No negative inventory quantities found.' }
    }
    const repaired = []
    for (const item of negative) {
      repaired.push({
        id: item.id,
        style: item.style || '—',
        brand: item.brand || '',
        previousQty: Number(item.qty),
      })
      const result = await setInventoryQtyAbsolute(item.id, 0)
      if (!result.ok) {
        return {
          repaired,
          message: `Repair stopped: ${result.error}`,
          error: result.error,
        }
      }
    }
    if (hasSupabaseConfig && session) await loadCloudData()
    return {
      repaired,
      message: `Repaired ${repaired.length} inventory item(s).`,
    }
  }

  function orderPaidTotal(order) {
    return data.payments
      .filter(p => String(p.order_id) === String(order.id) || p.invoice_no === order.invoice_no)
      .reduce((s, p) => s + Number(p.amount || 0), 0)
  }

  async function updateOrder(orderId, f, original) {
    const existing = data.orders.find(o => String(o.id) === String(orderId))
    if (!existing) return { error: 'Order not found.' }
    if (isVoidOrder(existing)) return { error: 'Voided invoices cannot be edited.' }

    const { lines: mergedLines, mergedCount } = mergeDuplicateInventoryLines(f.lines || [])
    const lineError = validateOrderLines(mergedLines)
    if (lineError) return { error: lineError }

    const customer = data.customers.find(c => String(c.id) === String(f.customer_id))
    const priorLines = itemsForOrder(existing, data.order_items)
    const editSnapshots = original?.lines || priorLines.map(line => ({
      id: line.id,
      inventory_id: line.inventory_id,
      allocated_qty: line.allocated_qty,
    }))

    const linesWithContext = mergedLines.map(line => {
      const snap = editSnapshots.find(s =>
        (line.id && String(s.id) === String(line.id))
        || String(s.inventory_id || '') === String(line.inventory_id || ''),
      )
      return { ...line, _editContext: snap }
    })

    const totals = calcOrderTotals(linesWithContext, f, data.inventory)
    const allocErr = validateOrderInventoryAllocation(totals.lines)
    if (allocErr) return { error: allocErr }
    const paid = orderPaidTotal(existing)
    if (totals.grandTotal < paid - 0.001) {
      return { error: 'Invoice total cannot be less than the amount already paid.' }
    }

    let status = normalizeOrderStatus(f.status || existing.status || 'Completed')

    if (status === 'Cancelled') {
      totals.lines = totals.lines.map(line => ({
        ...line,
        allocated_qty: 0,
        backorder_qty: 0,
        shipped_qty: 0,
      }))
      totals.totalAllocated = 0
      totals.totalBackorder = 0
    } else {
      status = deriveOrderStatusFromLines(totals.lines, status)
    }

    const payment_status = paid <= 0 ? 'Unpaid' : paid >= totals.grandTotal ? 'Paid' : 'Partial'
    const salesPerson = resolveSalesPersonFields(f.sales_person_id, staffUsers)
    const headerInput = {
      ...f,
      ...salesPerson,
      customer_name: customer?.company || customer?.name || f.customer_name || existing.customer_name || '',
      invoice_no: existing.invoice_no,
      payment_status,
      status,
    }
    const payload = buildOrderHeaderFromLines(headerInput, totals, totals.lines, data.inventory)
    payload.due_date = toDbDate(f.due_date || existing.due_date)
    payload.order_date = toDbDate(f.order_date || existing.order_date || existing.created_at)
    payload.fulfillment_date = f.fulfillment_date ? toDbDate(f.fulfillment_date) : (existing.fulfillment_date || null)
    payload.delivered_by = f.delivered_by || ''
    payload.picked_up_by = f.picked_up_by || ''
    payload.fulfillment_note = f.fulfillment_note || ''
    payload.signature_name = f.signature_name || ''

    await updateRow('orders', orderId, payload)

    if (hasSupabaseConfig && session) {
      const existingItems = orderItemsForOrder(data.order_items, orderId)
      const keptIds = new Set()

      for (let idx = 0; idx < totals.lines.length; idx += 1) {
        const line = totals.lines[idx]
        const row = buildOrderItemInsertRows(orderId, [line])[0]
        if (isPersistedOrderItemId(line.id)) {
          keptIds.add(String(line.id))
          const { error: lineErr } = await supabase.from('order_items').update(row).eq('id', line.id)
          if (lineErr) {
            setNotice(lineErr.message)
            return { error: lineErr.message }
          }
        } else {
          const insertErr = await insertOrderItemsCloud([row])
          if (insertErr) {
            setNotice(insertErr.message)
            return { error: insertErr.message }
          }
        }
      }

      for (const item of existingItems) {
        if (isPersistedOrderItemId(item.id) && !keptIds.has(String(item.id))) {
          const { error: delErr } = await supabase.from('order_items').delete().eq('id', item.id)
          if (delErr) {
            setNotice(delErr.message)
            return { error: delErr.message }
          }
        }
      }
    } else {
      const itemRows = buildOrderItemLocalRows(orderId, totals.lines, uid)
      setLocalData(p => ({
        ...p,
        order_items: [...itemRows, ...p.order_items.filter(i => String(i.order_id) !== String(orderId))],
      }))
    }

    const deltaPlan = buildInventoryDeltaPlan(priorLines, totals.lines)
    const stockResult = await applyInventoryStockDeltaPlan(deltaPlan)
    if (stockResult.error) {
      setNotice(stockResult.error)
      return { error: stockResult.error }
    }

    const trackResult = await saveOrderTrackingNumbers(orderId, f.tracking_entries)
    if (trackResult.error) {
      await applyInventoryStockDeltaPlan(deltaPlan.map(step => ({
        inventory_id: step.inventory_id,
        delta: -Number(step.delta || 0),
      })))
      setNotice(trackResult.error)
      return { error: trackResult.error }
    }

    if (hasSupabaseConfig && session) await loadCloudData()
    return { error: '', mergedCount }
  }

  async function allocateBackOrdersForProduct(inventoryId, stockIncrease, savedQty) {
    const entries = activeBackorderEntries(data.orders, data.order_items, inventoryId)
    const { plan, stockUsed } = buildLineAllocationPlan(entries, stockIncrease)
    if (!plan.length) return []

    for (const step of plan) {
      if (String(step.orderItemId || '').startsWith('legacy-')) {
        await updateRow('orders', step.order.id, {
          allocated_qty: step.newAllocated,
          backorder_qty: step.remainingBackOrder,
          status: step.newStatus,
        })
        continue
      }

      await updateRow('order_items', step.orderItemId, {
        allocated_qty: step.newAllocated,
        backorder_qty: step.remainingBackOrder,
      })

      const orderItems = orderItemsForOrder(data.order_items, step.order.id).map(item =>
        String(item.id) === String(step.orderItemId)
          ? { ...item, allocated_qty: step.newAllocated, backorder_qty: step.remainingBackOrder }
          : item,
      )
      const headerPatch = reaggregateOrderHeader(step.order, orderItems)
      headerPatch.status = deriveOrderStatusFromLines(orderItems, step.order.status)
      await updateRow('orders', step.order.id, headerPatch)
    }

    const finalQty = Math.max(Number(savedQty) - stockUsed, 0)
    await updateRow('inventory', inventoryId, { qty: finalQty })
    return plan
  }

  async function recordPayment(f) {
    return recordMultiPayment({
      customer_id: f.customer_id,
      payment_date: f.payment_date,
      method: f.method,
      reference_no: f.reference_no,
      note: f.note,
      allocations: [{ order_id: f.order_id, invoice_no: f.invoice_no, amount: Number(f.amount || 0) }],
    })
  }

  async function recordMultiPayment({ customer_id, payment_date, method, reference_no, note, allocations }) {
    const items = (allocations || []).filter(a => Number(a.amount) > 0)
    if (!items.length) return { error: 'Apply at least one payment amount.' }

    setNotice('')

    if (hasSupabaseConfig && session) {
      for (const a of items) {
        const order = data.orders.find(o => String(o.id) === String(a.order_id))
        const { error } = await supabase.from('payments').insert({
          customer_id: customer_id || order?.customer_id || null,
          order_id: a.order_id || null,
          invoice_no: a.invoice_no || order?.invoice_no || '',
          payment_date: payment_date || today(),
          amount: Number(a.amount),
          method: method || 'Zelle',
          reference_no: reference_no || '',
          note: note || '',
        })
        if (error) {
          setNotice(error.message)
          return { error: error.message }
        }
      }
      for (const a of items) {
        const order = data.orders.find(o => String(o.id) === String(a.order_id))
        if (!order) continue
        const paid = orderPaidTotal(order) + Number(a.amount)
        const total = Number(order.total || 0)
        const status = paid <= 0 ? 'Unpaid' : paid >= total - 0.001 ? 'Paid' : 'Partial'
        const { error } = await supabase.from('orders').update({ payment_status: status }).eq('id', order.id)
        if (error) {
          setNotice(error.message)
          return { error: error.message }
        }
      }
      await loadCloudData()
    } else {
      setLocalData(p => {
        let payments = [...p.payments]
        const orders = p.orders.map(o => {
          const itemsForOrder = items.filter(a => String(a.order_id) === String(o.id))
          if (!itemsForOrder.length) return o
          for (const a of itemsForOrder) {
            payments.unshift({
              id: uid(),
              created_at: new Date().toISOString(),
              customer_id: customer_id || o.customer_id || null,
              order_id: a.order_id,
              invoice_no: a.invoice_no || o.invoice_no || '',
              payment_date: payment_date || today(),
              amount: Number(a.amount),
              method: method || 'Zelle',
              reference_no: reference_no || '',
              note: note || '',
            })
          }
          const paid = payments
            .filter(pay => String(pay.order_id) === String(o.id) || pay.invoice_no === o.invoice_no)
            .reduce((s, pay) => s + Number(pay.amount || 0), 0)
          const total = Number(o.total || 0)
          const status = paid <= 0 ? 'Unpaid' : paid >= total - 0.001 ? 'Paid' : 'Partial'
          return { ...o, payment_status: status }
        })
        return { ...p, payments, orders }
      })
    }

    return { error: '' }
  }

  async function fetchProfilesForBackup() {
    if (hasSupabaseConfig && session) {
      const { data: rows, error } = await supabase.from('profiles').select(PROFILE_NAME_FIELDS)
      if (error) throw new Error(error.message)
      return rows || []
    }
    return [staffProfileFromSession(profile, session)]
  }

  async function restoreBackupData(parsed, mode, onProgress) {
    let localState = null

    const result = await executeRestore({
      parsed,
      mode,
      existingData: data,
      onProgress,
      persistTable: async (table, row, { exists, mode: rowMode }) => {
        if (hasSupabaseConfig && session) {
          if (rowMode === 'insert_missing' && exists) return 'skipped'
          const { error } = await supabase.from(table).upsert(row, { onConflict: 'id' })
          if (error) throw new Error(error.message)
          return exists ? 'updated' : 'inserted'
        }
        if (!localState) {
          localState = {
            customers: [...(data.customers || [])],
            inventory: [...(data.inventory || [])],
            orders: [...(data.orders || [])],
            order_items: [...(data.order_items || [])],
            payments: [...(data.payments || [])],
            purchase_orders: [...(data.purchase_orders || [])],
            purchase_order_items: [...(data.purchase_order_items || [])],
            purchase_order_receipts: [...(data.purchase_order_receipts || [])],
            purchase_order_receives: [...(data.purchase_order_receives || [])],
            purchase_order_commission_payments: [...(data.purchase_order_commission_payments || [])],
          }
        }
        if (rowMode === 'insert_missing' && exists) return 'skipped'
        if (!localState[table]) localState[table] = []
        const idx = localState[table].findIndex(x => String(x.id) === String(row.id))
        if (idx >= 0) {
          localState[table][idx] = { ...localState[table][idx], ...row }
          return 'updated'
        }
        localState[table].push(row)
        return 'inserted'
      },
    })

    const hadChanges = (result.stats?.inserted || 0) + (result.stats?.updated || 0) > 0

    if (result.ok || hadChanges) {
      if (hasSupabaseConfig && session) {
        await loadCloudData()
      } else if (localState) {
        setLocalData(p => ({ ...p, ...localState }))
      }
    }

    return result
  }

  const stats = useMemo(() => calcStats(data), [data])
  const searchResults = useMemo(() => globalSearch ? runGlobalSearch(data, globalSearch) : null, [data, globalSearch])

  function navigateTo(result) {
    setGlobalSearch('')
    if (result.type === 'customer' && canAccessPage(role, 'Customers')) { setPage('Customers') }
    else if (result.type === 'product' && canAccessPage(role, 'Inventory')) { setPage('Inventory') }
    else if (result.type === 'invoice' && canAccessPage(role, 'Invoice')) { openRecord('Invoice', result.id) }
    setMenuOpen(false)
  }

  function openRecord(targetPage, id, options = {}) {
    if (!canAccessPage(role, targetPage)) return
    setSelectedRecord({
      page: targetPage,
      id: String(id),
      focusFulfillment: !!options.focusFulfillment,
    })
    setPage(targetPage)
    setMenuOpen(false)
  }

  function clearSelectedRecord() {
    setSelectedRecord({ page: '', id: '', focusFulfillment: false })
  }

  if (!session) return (
    <Login authMode={authMode} setAuthMode={setAuthMode} email={email} setEmail={setEmail}
      password={password} setPassword={setPassword} authAction={authAction} authMsg={authMsg} />
  )

  return (
    <div className={`app${menuOpen ? ' nav-open' : ''}`}>
      <button
        type="button"
        className="menu-toggle no-print"
        aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(!menuOpen)}
      >
        ☰
      </button>
      {menuOpen && (
        <button
          type="button"
          className="nav-overlay no-print"
          aria-label="Close navigation menu"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside className={menuOpen ? 'open' : ''}>
        <div className="brand">
          <img src="/images/isb-logo.png" alt="Inner Source Beauty" className="brand-logo" />
        </div>
        <div className="role-badge">{role}</div>
        {allowedPages.map(x => (
          <button key={x} className={page === x ? 'active' : ''} onClick={() => { setPage(x); setMenuOpen(false) }}>{x}</button>
        ))}
        <button className="logout" onClick={() => { setMenuOpen(false); logout() }}>Logout</button>
      </aside>
      <main className={page === 'Customers' ? 'main-customers' : page === 'Inventory' ? 'main-inventory' : page === 'Payments' ? 'main-payments' : page === 'Reports' ? 'main-reports' : page === 'Dashboard' ? 'main-dashboard' : ''}>
        <header className={[page === 'Dashboard' && 'header-dashboard', page === 'Customers' && 'header-customers', page === 'Inventory' && 'header-inventory', page === 'Payments' && 'header-payments', page === 'Reports' && 'header-reports'].filter(Boolean).join(' ') || undefined}>
          {page === 'Dashboard' ? (
            <div className="dashboard-page-header">
              <h1 className="dashboard-page-title">Dashboard</h1>
              <p className="dashboard-page-subtitle">Today&apos;s Overview</p>
            </div>
          ) : (
            <h1>{page}</h1>
          )}
          <div className="header-right">
            {page === 'Dashboard' && (
              <div className="dashboard-page-date">{formatLocalShortDate()}</div>
            )}
            <input className="global-search" placeholder="Search customers, orders..."
              value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} />
            <HeaderUserMenu role={role} email={session.user?.email || profile.email} onLogout={logout} />
          </div>
        </header>
        {searchResults && globalSearch && (
          <div className="search-results panel">
            {searchResults.length === 0 ? <p>No results.</p> : searchResults.slice(0, 12).map((r, i) => (
              <button key={i} className="search-hit" onClick={() => navigateTo(r)}>
                <span className={`tag tag-${r.type}`}>{r.type}</span> {r.label}
              </button>
            ))}
          </div>
        )}
        {notice && <div className="notice" onClick={() => setNotice('')}>{notice}</div>}
        {loading && <div className="panel">Loading...</div>}
        {page === 'Dashboard' && <Dashboard data={data} stats={stats} onNavigate={openRecord} onCreatePoFromReorder={role === 'Admin' ? createPoFromReorder : null} />}
        {page === 'Customers' && <Customers data={data} addRow={addRow} updateRow={updateRow} deleteRow={deleteRow} onNavigate={openRecord}
          selectedCustomerId={selectedRecord.page === 'Customers' ? selectedRecord.id : ''} clearSelection={clearSelectedRecord} />}
        {page === 'Inventory' && <Inventory data={data} addRow={addRow} updateRow={updateRow} deleteRow={deleteRow}
          allocateBackOrders={allocateBackOrdersForProduct}
          inventoryLoadError={dataLoadErrors.inventory || ''} dataLoading={loading} onNavigate={openRecord} />}
        {page === 'Purchase Orders' && (
          <PurchaseOrdersPage
            data={data}
            role={role}
            isAdmin={role === 'Admin'}
            selectedPoId={selectedRecord.page === 'Purchase Orders' ? selectedRecord.id : ''}
            clearSelection={clearSelectedRecord}
            draftPoSeed={draftPoSeed}
            clearDraftPoSeed={() => setDraftPoSeed(null)}
            nextPoNumber={nextPoNumber(data.purchase_orders)}
            onSavePo={savePurchaseOrder}
            onReceivePo={receivePurchaseOrder}
            onCancelPo={cancelPurchaseOrder}
            onAddCommissionPayment={addPoCommissionPayment}
            onDeleteCommissionPayment={deletePoCommissionPayment}
            inventoryLoadError={dataLoadErrors.inventory || ''}
            dataLoading={loading}
          />
        )}
        {page === 'Orders' && <Orders data={data} staffUsers={staffUsers} createOrder={createOrder} updateOrder={updateOrder}           deleteOrder={deleteOrder}
          readOnly={role === 'Warehouse'}
          selectedOrderId={selectedRecord.page === 'Orders' ? selectedRecord.id : ''}
          focusFulfillment={selectedRecord.page === 'Orders' && selectedRecord.focusFulfillment}
          clearSelection={clearSelectedRecord}
          currentUserId={profile.id || session?.user?.id}
          onNavigate={openRecord} />}
        {page === 'Invoice' && <Invoice data={data} staffUsers={staffUsers} updateRow={updateRow} saveOrderTrackingNumbers={saveOrderTrackingNumbers} reloadData={loadCloudData} voidInvoice={voidInvoice} role={role} profile={profile}
          selectedOrderId={selectedRecord.page === 'Invoice' ? selectedRecord.id : ''} clearSelection={clearSelectedRecord} />}
        {page === 'Payments' && <Payments data={data} recordMultiPayment={recordMultiPayment} deleteRow={deleteRow} onNavigate={openRecord}
          selectedPaymentId={selectedRecord.page === 'Payments' ? selectedRecord.id : ''} clearSelection={clearSelectedRecord} />}
        {page === 'Expenses' && <ExpensesPage data={data} addRow={addRow} updateRow={updateRow} deleteRow={deleteRow} />}
        {page === 'Reports' && <Reports data={data} staffUsers={staffUsers} stats={stats} poStats={poSummaryStats(data.purchase_orders, data.purchase_order_items)} />}
        {page === 'Settings' && <Settings data={data} reload={loadCloudData} profile={profile} setProfile={setProfile} session={session}
          fetchProfilesForBackup={fetchProfilesForBackup} restoreBackupData={restoreBackupData} setLocalData={setLocalData}
          repairNegativeInventory={repairNegativeInventory} saveStaffProfile={saveStaffProfile}
          reloadStaffUsers={reloadStaffUsers} currentUserId={profile.id || session?.user?.id} />}
      </main>
    </div>
  )
}

function Login(p) {
  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={p.authAction}>
        <div className="logo">ISB</div>
        <h1>INNER SOURCE<br />BEAUTY ERP v2</h1>
        <p>Supabase Cloud Login</p>
        <input placeholder="Email" value={p.email} onChange={e => p.setEmail(e.target.value)} />
        <input placeholder="Password" type="password" value={p.password} onChange={e => p.setPassword(e.target.value)} />
        <div><button>{p.authMode === 'signin' ? 'Login' : 'Create Account'}</button>
          <button type="button" className="soft" onClick={() => p.setAuthMode(p.authMode === 'signin' ? 'signup' : 'signin')}>
            {p.authMode === 'signin' ? 'Create Account' : 'Back to Login'}
          </button></div>
        {p.authMsg && <div className="msg">{p.authMsg}</div>}
      </form>
    </div>
  )
}

function calcStats(data) {
  const activeOrders = ordersForSalesMetrics(data.orders)
  const sales = activeOrders.reduce((s, o) => s + Number(o.total || 0), 0)
  const paid = data.payments
    .filter(p => paymentCountsTowardBalance(data.orders, data.payments, p))
    .reduce((s, p) => s + Number(p.amount || 0), 0)
  const todaySales = activeOrders.filter(o => isToday(o.created_at)).reduce((s, o) => s + Number(o.total || 0), 0)
  const monthlySales = activeOrders.filter(o => isThisMonth(o.created_at)).reduce((s, o) => s + Number(o.total || 0), 0)
  const inventoryValue = calcDashboardInventoryValue(data.inventory)
  const inventoryExpectedProfit = calcDashboardExpectedProfit(data.inventory)
  const ordersToday = activeOrders.filter(o => isToday(o.created_at)).length
  const lowStock = data.inventory.filter(i => Number(i.qty || 0) < 5).length
  const salesByDay = buildSalesGraph(data.orders)
  const balance = calcOutstandingBalance(data.orders, data.payments)
  return { sales, paid, balance, stock: data.inventory.reduce((s, i) => s + Number(i.qty || 0), 0),
    orders: data.orders.length, customers: data.customers.length, todaySales, monthlySales,
    inventoryValue, expectedProfit: inventoryExpectedProfit, ordersToday, lowStock, salesByDay }
}

function buildSalesGraph(orders) {
  const days = []
  const base = new Date()
  base.setHours(0, 0, 0, 0)
  for (let i = 29; i >= 0; i--) {
    const d = new Date(base)
    d.setDate(base.getDate() - i)
    const key = localDateKey(d)
    const total = orders
      .filter(o => !isVoidOrder(o) && localDateKey(o.created_at) === key)
      .reduce((s, o) => s + Number(o.total || 0), 0)
    days.push({ date: key, label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), total })
  }
  const max = Math.max(...days.map(d => d.total), 1)
  return days.map(d => ({ ...d, pct: Math.max((d.total / max) * 100, 2) }))
}

function avgMonthlySales(style, orders) {
  const relevant = orders.filter(o => o.style === style)
  if (!relevant.length) return 0
  const totalQty = relevant.reduce((s, o) => s + Number(o.qty || 0), 0)
  const dates = relevant.map(o => new Date(o.created_at)).sort((a, b) => a - b)
  const months = Math.max(1, ((dates[dates.length - 1] - dates[0]) / (1000 * 60 * 60 * 24 * 30)) || 1)
  return totalQty / months
}

function reorderInfo(item, orders) {
  const avg = avgMonthlySales(item.style, orders)
  const qty = Number(item.qty || 0)
  if (avg <= 0) return null
  if (qty < avg) return { avg: avg.toFixed(0), recommended: true }
  return { avg: avg.toFixed(0), recommended: false }
}

function customerStats(c, data) {
  const allOrders = data.orders.filter(o => String(o.customer_id) === String(c.id) || o.customer_name === (c.company || c.name))
  const activeOrders = allOrders.filter(o => !isVoidOrder(o))
  const payments = data.payments.filter(p => String(p.customer_id) === String(c.id) || allOrders.some(o => o.invoice_no === p.invoice_no))
  const sales = activeOrders.reduce((s, o) => s + Number(o.total || 0), 0)
  const paid = payments
    .filter(p => paymentCountsTowardBalance(data.orders, data.payments, p))
    .reduce((s, p) => s + Number(p.amount || 0), 0)
  const last = allOrders[0]
    ? formatDisplayDate(allOrders[0].order_date || allOrders[0].created_at)
    : ''
  const avgOrder = activeOrders.length ? sales / activeOrders.length : 0
  return { orders: allOrders, payments, sales, paid, balance: sales - paid, lastOrder: last, avgOrder }
}

function runGlobalSearch(data, q) {
  const s = q.toLowerCase(), results = []
  data.customers.forEach(c => {
    const hay = [c.name, c.company, c.phone, c.email].join(' ').toLowerCase()
    if (hay.includes(s)) results.push({ type: 'customer', label: `${c.company || c.name} · ${c.phone || c.email || ''}`, id: c.id })
  })
  data.inventory.forEach(i => {
    const hay = [i.style, i.brand, i.category].join(' ').toLowerCase()
    if (hay.includes(s)) results.push({ type: 'product', label: `${i.style}${i.brand ? ` · ${i.brand}` : ''} · Stock ${i.qty}`, id: i.id })
  })
  data.orders.forEach(o => {
    const hay = [
      o.invoice_no, o.customer_name, o.style,
      orderInternalNote(o), orderCustomerNote(o),
    ].join(' ').toLowerCase()
    if (hay.includes(s)) results.push({ type: 'invoice', label: `${o.invoice_no} · ${o.customer_name} · ${money(o.total)}`, id: o.id })
  })
  return results
}

function orderUnitCost(o) {
  return Number(o.buying_price || 0) + Number(o.shipping_cost ?? 0)
}

function orderProfit(o) {
  if (o.profit != null && o.profit !== '') return Number(o.profit) || 0
  const qty = Number(o.qty) || 0, price = Number(o.price) || 0
  const total = Number(o.total) || (qty * price + Number(o.shipping || 0) - Number(o.discount || 0))
  return total - qty * orderUnitCost(o)
}

function inventoryUnitCost(i) {
  return itemUnitCost(i)
}

function OrderStatusBadge({ status, backorderQty = 0 }) {
  if (String(status || '').trim().toLowerCase() === 'void') {
    return <span className="status-badge void-badge">Void</span>
  }
  const label = normalizeOrderStatus(status)
  const isBackOrder = label === 'Back Order' || backorderQty > 0
  return <span className={isBackOrder ? 'status-badge backorder-badge' : 'status-badge'}>{label || '—'}</span>
}

function HeaderUserMenu({ role, email, onLogout }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const displayRole = role || 'Admin'

  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div className="header-user-menu" ref={ref}>
      <button type="button" className="header-user-btn soft" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        {displayRole} ▼
      </button>
      {open && (
        <div className="header-user-dropdown">
          <div className="header-user-item">
            <span className="header-user-label">Account Email</span>
            <span className="header-user-value">{email || '—'}</span>
          </div>
          <div className="header-user-item">
            <span className="header-user-label">Role</span>
            <span className="header-user-value">{displayRole}</span>
          </div>
          <button type="button" className="header-user-logout" onClick={() => { setOpen(false); onLogout() }}>Logout</button>
        </div>
      )}
    </div>
  )
}

function MonthlyProfitSummaryPanel({ data }) {
  const [monthKey, setMonthKey] = useState(currentMonthKey())
  const summary = calcMonthlyProfitSummary(
    data.orders,
    data.order_items,
    data.inventory,
    data.purchase_order_items || [],
    monthKey,
  )
  const thisMonthKey = currentMonthKey()
  const prevMonthKey = shiftMonthKey(thisMonthKey, -1)

  return (
    <div className="panel panel-compact dashboard-monthly-profit-summary">
      <div className="dashboard-section-head dashboard-profit-head">
        <div>
          <p className="dashboard-row-label">Monthly Profit Summary</p>
          <p className="dashboard-profit-subhead">{formatMonthKeyLabel(monthKey)}</p>
        </div>
        <div className="dashboard-month-toggle" role="group" aria-label="Select month">
          <button
            type="button"
            className={monthKey === thisMonthKey ? 'active' : 'soft'}
            onClick={() => setMonthKey(thisMonthKey)}
          >
            Current Month
          </button>
          <button
            type="button"
            className={monthKey === prevMonthKey ? 'active' : 'soft'}
            onClick={() => setMonthKey(prevMonthKey)}
          >
            Previous Month
          </button>
        </div>
      </div>

      <dl className="dashboard-profit-lines dashboard-monthly-profit-lines">
        <div className="dashboard-profit-line">
          <dt>Sales Revenue</dt>
          <dd>{money(summary.salesRevenue)}</dd>
        </div>
        <div className="dashboard-profit-line dashboard-profit-line-sub">
          <dt>Product Cost (COGS)</dt>
          <dd className="negative">-{money(summary.productCogs)}</dd>
        </div>
        <div className="dashboard-profit-line dashboard-profit-line-sub">
          <dt>Shipping Cost (COGS)</dt>
          <dd className="negative">-{money(summary.shippingCogs)}</dd>
        </div>
        <div className="dashboard-profit-line dashboard-profit-line-sub">
          <dt>
            Commission
            {summary.commissionIncludedInProductCost && (
              <span className="dashboard-profit-meta dashboard-profit-inline-note"> (included in Product Cost when unknown)</span>
            )}
          </dt>
          <dd className="negative">-{money(summary.commissionCogs)}</dd>
        </div>

        <div className="dashboard-profit-section-divider dashboard-profit-section-divider-strong" aria-hidden="true" />

        <div className="dashboard-profit-line dashboard-profit-line-total">
          <dt>Gross Profit</dt>
          <dd>{money(summary.grossProfit)}</dd>
        </div>
        <div className="dashboard-profit-line">
          <dt>Gross Margin</dt>
          <dd>{formatGrossMarginPercent(summary.grossMargin)}</dd>
        </div>

        <div className="dashboard-profit-section-divider" aria-hidden="true" />

        <div className="dashboard-profit-line dashboard-profit-line-inventory">
          <dt>Inventory Value Remaining</dt>
          <dd>{money(summary.inventoryValueRemaining)}</dd>
        </div>
      </dl>

      <p className="hint dashboard-profit-hint">
        COGS applies only to units sold or allocated this month ({summary.orderCount} orders).
        Product and inbound shipping costs come from each order line&apos;s stored unit cost — not from PO payments.
        {summary.commissionIncludedInProductCost
          ? ' Commission is embedded in Product Cost when PO commission data is unavailable for a product.'
          : ' Inbound shipping is in Shipping Cost (COGS), separate from inventory buying price.'}
        {' '}Inventory Value Remaining is unsold stock — not subtracted from profit.
      </p>
    </div>
  )
}

function ThisMonthBusinessSummary({ summary, purchaseSpending, compact = false }) {
  const recordedExpenses = summary.expenses ?? summary.operatingExpenses ?? 0
  const purchaseShippingOther = (purchaseSpending?.purchaseShipping ?? 0) + (purchaseSpending?.otherPoCosts ?? 0)
  const showProductRevenue = Math.abs((summary.sales ?? 0) - (summary.productRevenue ?? 0)) > 0.005

  return (
    <dl className="dashboard-profit-lines">
      <div className="dashboard-profit-line">
        <dt>Sales</dt>
        <dd>{money(summary.sales)}</dd>
      </div>
      {showProductRevenue && (
        <div className="dashboard-profit-line dashboard-profit-line-detail">
          <dt>Product Revenue</dt>
          <dd>{money(summary.productRevenue)}</dd>
        </div>
      )}
      <div className="dashboard-profit-line dashboard-profit-line-sub">
        <dt>COGS</dt>
        <dd className="negative">-{money(summary.cogs)}</dd>
      </div>
      <div className="dashboard-profit-line dashboard-profit-line-total">
        <dt>Gross Profit</dt>
        <dd>{money(summary.grossProfit)}</dd>
      </div>

      <div className="dashboard-profit-section-divider" aria-hidden="true" />

      <div className="dashboard-profit-line dashboard-profit-line-cash">
        <dt>Inventory Purchases</dt>
        <dd>{money(purchaseSpending?.inventoryPurchases ?? 0)}</dd>
      </div>
      <div className="dashboard-profit-line dashboard-profit-line-sub dashboard-profit-line-cash">
        <dt>Purchase Shipping / Other Cost</dt>
        <dd>{money(purchaseShippingOther)}</dd>
      </div>

      <div className="dashboard-profit-section-divider" aria-hidden="true" />

      <div className="dashboard-profit-line">
        <dt>Gross Margin</dt>
        <dd>{formatGrossMarginPercent(summary.grossMargin)}</dd>
      </div>

      {!compact && (
        <>
          <div className="dashboard-profit-line dashboard-profit-line-sub">
            <dt>Recorded Expenses</dt>
            <dd className="negative">-{money(recordedExpenses)}</dd>
          </div>
          <div className="dashboard-profit-line dashboard-profit-line-net">
            <dt>Gross Profit After Recorded Expenses</dt>
            <dd>{money(summary.netProfit)}</dd>
          </div>
        </>
      )}
    </dl>
  )
}

function PurchaseSpendingSummary({ spending }) {
  return (
    <dl className="dashboard-profit-lines dashboard-purchase-lines">
      <div className="dashboard-profit-line">
        <dt>Inventory Purchases</dt>
        <dd>{money(spending.inventoryPurchases)}</dd>
      </div>
      <div className="dashboard-profit-line dashboard-profit-line-sub">
        <dt>Purchase Shipping</dt>
        <dd>{money(spending.purchaseShipping)}</dd>
      </div>
      {spending.otherPoCosts > 0 && (
        <div className="dashboard-profit-line dashboard-profit-line-sub">
          <dt>Other PO Costs</dt>
          <dd>{money(spending.otherPoCosts)}</dd>
        </div>
      )}
      <div className="dashboard-profit-line dashboard-profit-line-total">
        <dt>Total Purchase Spending</dt>
        <dd>{money(spending.totalPurchaseSpending)}</dd>
      </div>
    </dl>
  )
}

function ProfitLossSummary({ summary, showNetMargin = true, grossOnly = false }) {
  if (grossOnly) {
    return (
      <dl className="dashboard-profit-lines">
        <div className="dashboard-profit-line">
          <dt>Monthly Sales</dt>
          <dd>{money(summary.sales)}</dd>
        </div>
        <div className="dashboard-profit-line dashboard-profit-line-sub">
          <dt>Product Revenue</dt>
          <dd>{money(summary.productRevenue)}</dd>
        </div>
        <div className="dashboard-profit-line dashboard-profit-line-sub">
          <dt>COGS</dt>
          <dd className="negative">-{money(summary.cogs)}</dd>
        </div>
        <div className="dashboard-profit-line dashboard-profit-line-total">
          <dt>Gross Profit</dt>
          <dd>{money(summary.grossProfit)}</dd>
        </div>
        <div className="dashboard-profit-line">
          <dt>Gross Margin</dt>
          <dd>{formatGrossMarginPercent(summary.grossMargin)}</dd>
        </div>
      </dl>
    )
  }

  return (
    <dl className="dashboard-profit-lines">
      <div className="dashboard-profit-line">
        <dt>Monthly Sales</dt>
        <dd>{money(summary.sales)}</dd>
      </div>
      <div className="dashboard-profit-line dashboard-profit-line-sub">
        <dt>Product Revenue</dt>
        <dd>{money(summary.productRevenue)}</dd>
      </div>
      <div className="dashboard-profit-line dashboard-profit-line-sub">
        <dt>COGS</dt>
        <dd className="negative">-{money(summary.cogs)}</dd>
      </div>
      <div className="dashboard-profit-line dashboard-profit-line-total">
        <dt>Gross Profit</dt>
        <dd>
          {money(summary.grossProfit)}
          {' '}
          <span className="dashboard-profit-meta">({formatGrossMarginPercent(summary.grossMargin)} gross margin)</span>
        </dd>
      </div>
      <div className="dashboard-profit-line dashboard-profit-line-sub">
        <dt>Expenses</dt>
        <dd className="negative">-{money(summary.expenses ?? summary.operatingExpenses ?? 0)}</dd>
      </div>
      <div className="dashboard-profit-line dashboard-profit-line-net">
        <dt>Net Profit</dt>
        <dd>
          {money(summary.netProfit)}
          {showNetMargin && (
            <>
              {' '}
              <span className="dashboard-profit-meta">({formatNetMarginPercent(summary.netMargin)} net margin)</span>
            </>
          )}
        </dd>
      </div>
    </dl>
  )
}

function ProfitDetailsDialog({ summary, onClose, onManageExpenses }) {
  const { monthExpenses } = summary

  return (
    <div className="restore-dialog-overlay profit-details-overlay" onClick={onClose}>
      <div className="restore-dialog profit-details-dialog" onClick={e => e.stopPropagation()}>
        <h2>This Month — Business Summary</h2>
        <p className="hint">
          Gross Profit uses product revenue minus COGS on units sold or allocated — not invoice total minus PO payments.
          Purchase shipping in COGS is the per-unit inbound cost already in inventory; PO header shipping below is cash out only.
        </p>
        <ThisMonthBusinessSummary
          summary={summary}
          purchaseSpending={summary.purchaseSpending}
        />

        <h3 className="profit-details-subtitle">Expenses Included</h3>
        {monthExpenses.length === 0 ? (
          <p className="hint">No expenses recorded this month.</p>
        ) : (
          <div className="table-wrap profit-details-expenses-table">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {monthExpenses.map(expense => (
                  <tr key={expense.id}>
                    <td>{formatDisplayDate(expenseDateKey(expense))}</td>
                    <td>{expense.category || '—'}</td>
                    <td>{expense.description || '—'}</td>
                    <td>{money(expense.amount)}</td>
                    <td>{expense.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="restore-dialog-actions">
          {onManageExpenses && (
            <button type="button" onClick={() => { onManageExpenses(); onClose() }}>Manage Expenses</button>
          )}
          <button type="button" className="soft" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function ReorderListDialog({ items, onClose, onCreatePo, isAdmin }) {
  const totalUnits = items.reduce((s, r) => s + r.needToOrder, 0)
  const totalCost = items.reduce((s, r) => s + r.estimatedCost, 0)
  const listDate = formatLocalShortDate()

  function downloadCsv() {
    const header = ['Date', 'Product / SKU', 'Brand', 'Stock On Hand', 'Minimum Stock', 'Need to Order', 'Buying Price', 'Estimated Cost', 'Notes']
    const rows = items.map(r => [
      listDate, r.style, r.brand, r.stockOnHand, r.minimumStock, r.needToOrder,
      r.buyingPrice.toFixed(2), r.estimatedCost.toFixed(2), r.notes,
    ])
    const csv = [header, ...rows].map(cols => cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `ISB_Reorder_List_${today()}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  function handlePrint() {
    window.print()
  }

  return (
    <div className="restore-dialog-overlay reorder-list-overlay" onClick={onClose}>
      <div className="restore-dialog reorder-list-dialog" onClick={e => e.stopPropagation()}>
        <div className="reorder-list-screen">
          <h2>Reorder List</h2>
          <p className="hint">Date: {listDate}</p>
          {items.length === 0 ? (
            <p className="hint">No products currently need reordering.</p>
          ) : (
            <>
              <div className="table-wrap reorder-list-table">
                <table>
                  <thead>
                    <tr>
                      <th>Product / SKU</th>
                      <th>Brand</th>
                      <th>Stock On Hand</th>
                      <th>Minimum Stock</th>
                      <th>Need to Order</th>
                      <th>Buying Price</th>
                      <th>Estimated Cost</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(r => (
                      <tr key={r.id}>
                        <td>{r.style}</td>
                        <td>{r.brand}</td>
                        <td>{r.stockOnHand}</td>
                        <td>{r.minimumStock}</td>
                        <td>{r.needToOrder}</td>
                        <td>{money(r.buyingPrice)}</td>
                        <td>{money(r.estimatedCost)}</td>
                        <td>{r.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="reorder-list-totals">
                <p><strong>Total Units to Order:</strong> {totalUnits}</p>
                <p><strong>Estimated Total Cost:</strong> {money(totalCost)}</p>
              </div>
            </>
          )}
        </div>
        <div className="restore-dialog-actions reorder-list-actions">
          <button type="button" onClick={handlePrint} disabled={!items.length}>Print</button>
          <button type="button" className="soft" onClick={downloadCsv} disabled={!items.length}>Download CSV</button>
          {isAdmin && (
            <button type="button" onClick={() => { onCreatePo?.(items); onClose() }} disabled={!items.length}>Create Purchase Order</button>
          )}
          <button type="button" className="soft" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function DashboardLowStockMobileCards({ items }) {
  return (
    <div className="dashboard-lowstock-cards">
      {items.map(item => (
        <article key={item.id} className="dashboard-lowstock-card">
          <p className="dashboard-lowstock-product">{item.label}</p>
          <dl className="dashboard-card-meta">
            <div className="dashboard-card-row"><dt>Stock On Hand</dt><dd>{item.stockOnHand}</dd></div>
            <div className="dashboard-card-row"><dt>Minimum Stock</dt><dd>{item.minimumStockDisplay}</dd></div>
            <div className="dashboard-card-row"><dt>Need to Order</dt><dd>{item.needToOrder}</dd></div>
            <div className="dashboard-card-row"><dt>Status</dt><dd><span className={`stock-status-badge ${item.statusClass}`}>{item.status}</span></dd></div>
          </dl>
        </article>
      ))}
    </div>
  )
}

function DashboardRecentOrdersMobileCards({ rows, onNavigate }) {
  return (
    <div className="dashboard-recent-orders-cards">
      {rows.map(o => (
        <article key={o.id} className="dashboard-recent-order-card">
          <p className="dashboard-recent-order-date">{o.order_date}</p>
          <dl className="dashboard-card-meta">
            <div className="dashboard-card-row"><dt>Invoice No</dt><dd>
              <button type="button" className="link-cell invoice-link dashboard-card-link" onClick={() => onNavigate?.('Invoice', o.id)}>{o.invoice_no}</button>
            </dd></div>
            <div className="dashboard-card-row"><dt>Customer</dt><dd>{o.customer_name}</dd></div>
            <div className="dashboard-card-row"><dt>Total</dt><dd>{o.total}</dd></div>
            <div className="dashboard-card-row"><dt>Payment Status</dt><dd>{o.payment_status}</dd></div>
          </dl>
        </article>
      ))}
    </div>
  )
}

function Dashboard({ data, stats, onNavigate, onCreatePoFromReorder }) {
  const [showReorderList, setShowReorderList] = useState(false)
  const [showProfitDetails, setShowProfitDetails] = useState(false)
  const todayOrders = ordersForDashboardSales(data.orders.filter(o => isOrderDateToday(o)))
  const monthOrders = ordersForDashboardSales(data.orders.filter(o => isOrderDateThisMonth(o)))
  const boStats = backOrderDashboardStats(data.orders, data.order_items)
  const backorderAlerts = activeBackorderAlerts(data.orders, data.order_items, 10)
  const partiallyAllocatedCount = partiallyAllocatedOrders(data.orders, data.order_items).length
  const pickupCount = awaitingPickupCount(data.orders, data.order_items)
  const deliveryCount = companyDeliveryCount(data.orders, data.order_items)
  const partiallyAllocatedList = partiallyAllocatedAlerts(data.orders, data.order_items, 10)
  const pickupAlerts = partiallyAllocatedOrders(data.orders, data.order_items).filter(o => isCustomerPickup(o.shipping_method)).slice(0, 10)
  const deliveryAlerts = partiallyAllocatedOrders(data.orders, data.order_items).filter(o => isCompanyDelivery(o.shipping_method)).slice(0, 10)

  function openOrderForEdit(orderId, focusFulfillment = false) {
    onNavigate?.('Orders', orderId, { focusFulfillment })
  }

  function scrollToSection(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const todaySales = todayOrders.reduce((s, o) => s + Number(o.total || 0), 0)
  const todayProfit = calcRealizedProfitForOrders(todayOrders, data.order_items, data.inventory)
  const ordersToday = todayOrders.length
  const monthFinancials = calcMonthFinancialSummary(
    monthOrders,
    data.order_items,
    data.inventory,
    data.expenses,
  )
  const monthPurchaseSpending = calcMonthPurchaseSpending(data.purchase_orders || [])
  const openBalance = stats.balance
  const inventoryExpectedProfit = calcDashboardExpectedProfit(data.inventory)
  const inventoryValue = calcDashboardInventoryValue(data.inventory)
  const { itemCount: lowStockCount, unitsToReorder } = lowStockSummary(data.inventory)
  const lowStockAlerts = buildLowStockAlerts(data.inventory, 10)
  const reorderList = reorderListItems(data.inventory)
  const poStats = poSummaryStats(data.purchase_orders || [], data.purchase_order_items || [])
  const incomingAlerts = incomingInventoryAlerts(data.purchase_orders || [], data.purchase_order_items || [], 8)

  const formatAlertOrderDate = raw => formatDisplayDate(raw)

  function formatAlertOrder(o) {
    const f = normalizeFulfillment(o, data.order_items)
    return {
      id: o.id,
      order_date: formatAlertOrderDate(o.order_date || o.created_at),
      invoice_no: o.invoice_no || '—',
      customer_name: o.customer_name || '—',
      style: orderDisplayProduct(o, data.order_items),
      qty: f.qty,
      allocated_qty: f.allocated_qty,
      backorder_qty: f.backorder_qty,
      status: normalizeOrderStatus(o.status),
    }
  }

  const recentOrders = data.orders.filter(o => !isVoidOrder(o)).slice(0, 10).map(o => ({
    id: o.id,
    order_date: formatAlertOrderDate(o.order_date || o.created_at),
    invoice_no: o.invoice_no || '—',
    customer_name: o.customer_name || '—',
    total: money(o.total),
    payment_status: o.payment_status || '—',
  }))

  function FulfillmentAlertTable({ rows, showAction = true }) {
    return (
      <div className="table-wrap rtf-alerts-table">
        <table>
          <thead>
            <tr>
              <th>Invoice No</th>
              <th>Customer</th>
              <th>Product</th>
              <th>Qty</th>
              <th>Fulfillment Method</th>
              <th>Tracking / Handled By</th>
              <th>Status</th>
              {showAction && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(o => {
              const ff = normalizeFulfillment(o, data.order_items)
              return (
                <tr key={o.id}>
                  <td>
                    <button type="button" className="link-cell invoice-link" onClick={() => openOrderForEdit(o.id)}>
                      {o.invoice_no || '—'}
                    </button>
                  </td>
                  <td>{o.customer_name || '—'}</td>
                  <td>{orderDisplayProduct(o, data.order_items)}</td>
                  <td>{ff.qty}</td>
                  <td>{o.shipping_method || '—'}</td>
                  <td>{fulfillmentHandledBy(o)}</td>
                  <td><OrderStatusBadge status={o.status} backorderQty={ff.backorder_qty} /></td>
                  {showAction && (
                    <td>
                      <button type="button" className="soft" onClick={() => openOrderForEdit(o.id)}>
                        View Order
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-rows dashboard-rows-compact">
        <div className="dashboard-row-group">
          <p className="dashboard-row-label">Daily Summary</p>
          <div className="cards dashboard-row">
            <Card t="Today's Sales" v={money(todaySales)} compact />
            <Card t="Today's Profit" v={money(todayProfit)} compact />
            <Card t="Today's Orders" v={ordersToday} compact />
            <Card t="Outstanding Balance" v={money(openBalance)} compact />
          </div>
        </div>
        <div className="dashboard-row-group">
          <div className="dashboard-section-head dashboard-profit-head">
            <p className="dashboard-row-label">This Month</p>
            <button type="button" className="soft" onClick={() => setShowProfitDetails(true)}>View Details</button>
          </div>
          <div className="panel panel-compact dashboard-profit-breakdown">
            <ThisMonthBusinessSummary
              summary={monthFinancials}
              purchaseSpending={monthPurchaseSpending}
              compact
            />
            <p className="hint dashboard-profit-hint">
              Sales = invoice total. Gross Profit = product revenue − COGS (sold/allocated units only).
              Inventory Purchases and shipping are cash out — not subtracted from Gross Profit.
              Inbound shipping in COGS is per-unit landed cost, not double-counted.
            </p>
          </div>
        </div>
        <div className="dashboard-row-group">
          <MonthlyProfitSummaryPanel data={data} />
        </div>
        <div className="dashboard-row-group">
          <p className="dashboard-row-label">Current Inventory</p>
          <div className="cards dashboard-row dashboard-row-2">
            <Card t="Inventory Value" v={money(inventoryValue)} compact />
            <Card t="Expected Profit" v={money(inventoryExpectedProfit)} compact />
          </div>
        </div>
        <div className="dashboard-row-group">
          <p className="dashboard-row-label">Purchase Orders</p>
          <div className="cards dashboard-row dashboard-row-2">
            <Card t="Open Purchase Orders" v={poStats.openCount} compact cls={poStats.openCount > 0 ? 'card-warn' : ''} onClick={() => onNavigate?.('Purchase Orders')} actionCompact />
            <Card t="Incoming Units" v={poStats.incomingUnits} compact onClick={() => scrollToSection('dashboard-incoming-po')} actionCompact />
          </div>
        </div>
        <div className="dashboard-row-group">
          <p className="dashboard-row-label">Action Required</p>
          <div className="cards dashboard-row dashboard-row-4">
            <Card
              t="Partially Allocated"
              v={partiallyAllocatedCount}
              compact
              actionCompact
              cls="card-action-rtf"
              onClick={() => scrollToSection('dashboard-partial-alerts')}
            />
            <Card
              t="Back Orders"
              v={boStats.units}
              compact
              actionCompact
              cls="card-action-bo"
              onClick={() => scrollToSection('dashboard-backorder-alerts')}
            />
            <Card
              t="Low Stock Items"
              v={lowStockCount}
              compact
              actionCompact
              cls="card-action-low"
              onClick={() => scrollToSection('dashboard-lowstock-alerts')}
            />
            <Card
              t="Units to Reorder"
              v={unitsToReorder}
              compact
              actionCompact
              cls="card-action-low"
              onClick={() => scrollToSection('dashboard-lowstock-alerts')}
            />
          </div>
        </div>
      </div>

      {partiallyAllocatedCount > 0 ? (
        <div className="panel panel-compact dashboard-section" id="dashboard-partial-alerts">
          <h2 className="dashboard-section-title">Partially Allocated Alerts</h2>
          <FulfillmentAlertTable rows={partiallyAllocatedList} showAction={false} />
        </div>
      ) : (
        <p className="dashboard-empty-note" id="dashboard-partial-alerts">No partially allocated orders.</p>
      )}

      {boStats.units > 0 ? (
        <div className="panel panel-compact dashboard-section" id="dashboard-backorder-alerts">
          <h2 className="dashboard-section-title">Back Order Alerts</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Invoice No</th>
                  <th>Product</th>
                  <th>Order Qty</th>
                  <th>Allocated Qty</th>
                  <th>Back Order Qty</th>
                  <th>Order Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {backorderAlerts.map(o => {
                  const row = formatAlertOrder(o)
                  return (
                    <tr key={o.id}>
                      <td>{row.customer_name}</td>
                      <td>
                        <button type="button" className="link-cell invoice-link" onClick={() => onNavigate?.('Invoice', o.id)}>
                          {row.invoice_no}
                        </button>
                      </td>
                      <td>{row.style}</td>
                      <td>{row.qty}</td>
                      <td>{row.allocated_qty}</td>
                      <td><span className="backorder-badge">{row.backorder_qty}</span></td>
                      <td>{row.order_date}</td>
                      <td><OrderStatusBadge status={row.status} backorderQty={row.backorder_qty} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="dashboard-empty-note" id="dashboard-backorder-alerts">No active back orders.</p>
      )}

      {lowStockAlerts.length > 0 ? (
        <div className="panel panel-compact dashboard-section" id="dashboard-lowstock-alerts">
          <div className="dashboard-section-head">
            <h2 className="dashboard-section-title">Low Stock Alerts</h2>
            <button type="button" className="soft reorder-list-btn" onClick={() => setShowReorderList(true)}>
              Create Reorder List
            </button>
          </div>
          <DashboardLowStockMobileCards items={lowStockAlerts} />
          <div className="table-wrap low-stock-table dashboard-lowstock-table">
            <table>
              <thead>
                <tr>
                  <th className="low-stock-col-product">Product</th>
                  <th>Stock On Hand</th>
                  <th>Minimum Stock</th>
                  <th>Need to Order</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {lowStockAlerts.map(item => (
                  <tr key={item.id}>
                    <td className="low-stock-col-product">{item.label}</td>
                    <td>{item.stockOnHand}</td>
                    <td>{item.minimumStockDisplay}</td>
                    <td>{item.needToOrder}</td>
                    <td>
                      <span className={`stock-status-badge ${item.statusClass}`}>
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="dashboard-empty-note" id="dashboard-lowstock-alerts">No low stock items right now.</p>
      )}

      {incomingAlerts.length > 0 && (
        <div className="panel panel-compact dashboard-section" id="dashboard-incoming-po">
          <h2 className="dashboard-section-title">Incoming Inventory</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>PO Number</th><th>Supplier</th><th>ETA</th><th>Remaining Units</th><th>Status</th></tr>
              </thead>
              <tbody>
                {incomingAlerts.map(a => (
                  <tr key={a.id}>
                    <td><button type="button" className="link-cell" onClick={() => onNavigate?.('Purchase Orders', a.id)}>{a.po_number}</button></td>
                    <td>{a.supplier || '—'}</td>
                    <td>{formatDisplayDate(a.eta)}</td>
                    <td>{a.remaining_units}</td>
                    <td>{a.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showReorderList && (
        <ReorderListDialog
          items={reorderList}
          onClose={() => setShowReorderList(false)}
          onCreatePo={onCreatePoFromReorder}
          isAdmin={!!onCreatePoFromReorder}
        />
      )}

      {showProfitDetails && (
        <ProfitDetailsDialog
          summary={{ ...monthFinancials, purchaseSpending: monthPurchaseSpending }}
          onClose={() => setShowProfitDetails(false)}
          onManageExpenses={() => onNavigate?.('Expenses')}
        />
      )}

      {pickupCount > 0 && (
        <div className="panel panel-compact dashboard-section" id="dashboard-pickup-alerts">
          <h2 className="dashboard-section-title">Awaiting Pickup Alerts</h2>
          <FulfillmentAlertTable rows={pickupAlerts} showAction={false} />
        </div>
      )}

      {deliveryCount > 0 && (
        <div className="panel panel-compact dashboard-section" id="dashboard-delivery-alerts">
          <h2 className="dashboard-section-title">Company Delivery Alerts</h2>
          <FulfillmentAlertTable rows={deliveryAlerts} showAction={false} />
        </div>
      )}

      {recentOrders.length > 0 && (
        <div className="panel panel-compact dashboard-section">
          <h2 className="dashboard-section-title">Recent Orders</h2>
          <DashboardRecentOrdersMobileCards rows={recentOrders} onNavigate={onNavigate} />
          <div className="table-wrap dashboard-recent-orders-table">
            <table>
              <thead>
                <tr>
                  <th>Order Date</th>
                  <th>Invoice No</th>
                  <th>Customer</th>
                  <th>Total</th>
                  <th>Payment Status</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map(o => (
                  <tr key={o.id}>
                    <td>{o.order_date}</td>
                    <td>
                      <button type="button" className="link-cell invoice-link" onClick={() => onNavigate?.('Invoice', o.id)}>
                        {o.invoice_no}
                      </button>
                    </td>
                    <td>{o.customer_name}</td>
                    <td>{o.total}</td>
                    <td>{o.payment_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function Card({ t, v, cls, compact, actionCompact, onClick }) {
  const interactive = typeof onClick === 'function'
  const props = interactive ? {
    role: 'button',
    tabIndex: 0,
    onClick,
    onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } },
  } : {}
  return (
    <div className={`card ${compact ? 'card-compact' : ''} ${actionCompact ? 'card-action-compact' : ''} ${interactive ? 'card-clickable' : ''} ${cls || ''}`.trim()} {...props}>
      <p>{t}</p>
      <b>{v}</b>
    </div>
  )
}

function Customers({ data, addRow, updateRow, deleteRow, onNavigate, selectedCustomerId, clearSelection }) {
  const blank = {
    name: '', company: '', phone: '', email: '', billing_address: '', shipping_address: '',
    shipping_same_as_billing: false, preferred_payment: 'Zelle', payment_terms: 'COD',
    tax_id: '', note: '', status: 'Active',
  }
  const [f, setF] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const [selected, setSelected] = useState(null)
  const [q, setQ] = useState('')
  const customers = data.customers.filter(c => [c.name, c.company, c.phone, c.email].join(' ').toLowerCase().includes(q.toLowerCase()))

  useEffect(() => {
    if (!selectedCustomerId) return
    const c = data.customers.find(x => String(x.id) === String(selectedCustomerId))
    if (c) loadCustomer(c)
    clearSelection?.()
    requestAnimationFrame(() => {
      document.getElementById(`customer-row-${selectedCustomerId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      document.getElementById(`customer-card-${selectedCustomerId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [selectedCustomerId, clearSelection, data.customers])

  function setSame(v) {
    setF({ ...f, shipping_same_as_billing: v, shipping_address: v ? f.billing_address : f.shipping_address })
  }

  function loadCustomer(c) {
    setEditingId(c.id)
    setSelected(c.id)
    const billing = c.billing_address || c.address || ''
    const shipping = c.shipping_address || billing
    const sameAsBilling = Boolean(c.shipping_same_as_billing) || (shipping === billing && billing !== '')
    setF({
      name: c.name || '',
      company: c.company || '',
      phone: c.phone || '',
      email: c.email || '',
      billing_address: billing,
      shipping_address: sameAsBilling ? billing : shipping,
      shipping_same_as_billing: sameAsBilling,
      preferred_payment: c.preferred_payment || 'Zelle',
      payment_terms: c.payment_terms || 'COD',
      tax_id: c.tax_id || '',
      note: c.note || '',
      status: c.status || 'Active',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setF(blank)
  }

  async function save() {
    const row = { ...f, shipping_address: f.shipping_same_as_billing ? f.billing_address : f.shipping_address }
    const id = editingId
    if (editingId) await updateRow('customers', editingId, row)
    else await addRow('customers', row)
    cancelEdit()
    if (id) setSelected(id)
  }

  const selectedCustomer = data.customers.find(c => String(c.id) === String(selected))

  function customerBillingCityState(c) {
    const addr = c.billing_address || c.address || ''
    const line = String(addr).split(/\n/).map(l => l.trim()).filter(Boolean).pop()
    return line || '—'
  }

  return (
    <div className="customers-page">
      <div className="customers-desktop-left">
        <section className="panel customers-form-panel">
          <h2>{editingId ? 'Edit Customer' : 'Add Customer'}</h2>
          <div className="form-grid customer-form customer-form-fields">
            <input placeholder="Contact Name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
            <input placeholder="Business Name" value={f.company} onChange={e => setF({ ...f, company: e.target.value })} />
            <input placeholder="Phone" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />
            <input placeholder="Email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
            <textarea className="customer-billing-field" placeholder="Billing Address" value={f.billing_address}
              onChange={e => setF({ ...f, billing_address: e.target.value, shipping_address: f.shipping_same_as_billing ? e.target.value : f.shipping_address })} />
            <textarea className="customer-shipping-field" placeholder="Shipping Address" value={f.shipping_address} disabled={f.shipping_same_as_billing}
              onChange={e => setF({ ...f, shipping_address: e.target.value })} />
            <label className="customer-same-billing">
              <input type="checkbox" checked={f.shipping_same_as_billing} onChange={e => setSame(e.target.checked)} />
              <span>Same as Billing</span>
            </label>
            <select value={f.preferred_payment} onChange={e => setF({ ...f, preferred_payment: e.target.value })}>
              {PAYMENT_METHODS.map(x => <option key={x}>{x}</option>)}
            </select>
            <select value={f.payment_terms} onChange={e => setF({ ...f, payment_terms: e.target.value })}>
              {TERMS.map(x => <option key={x}>{x}</option>)}
            </select>
            <input placeholder="Tax ID / Seller Permit" value={f.tax_id} onChange={e => setF({ ...f, tax_id: e.target.value })} />
            <input placeholder="Customer Note" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
            <select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>
              {STATUSES.map(x => <option key={x}>{x}</option>)}
            </select>
            <div className="customer-form-actions">
              <button type="button" className="customer-save-btn" onClick={save}>Save Customer</button>
              {editingId && <button type="button" className="soft" onClick={cancelEdit}>Cancel</button>}
            </div>
          </div>
        </section>
        <section className="panel customers-list-panel">
          <h2>Customers</h2>
          <input className="search customers-local-search" placeholder="Search customer..." value={q} onChange={e => setQ(e.target.value)} />
          <div className="customer-cards">
            {customers.map(c => {
              const isSelected = String(selected) === String(c.id) || String(editingId) === String(c.id)
              return (
                <article
                  key={c.id}
                  id={`customer-card-${c.id}`}
                  className={`customer-card${isSelected ? ' sel' : ''}`}
                  onClick={() => loadCustomer(c)}
                >
                  <div className="customer-card-head">
                    <strong className="customer-card-name">{c.company || c.name || '—'}</strong>
                    <span className={`status-badge status-${(c.status || 'Active').toLowerCase()}`}>{c.status || 'Active'}</span>
                  </div>
                  {c.company && c.name ? <p className="customer-card-meta"><span className="customer-card-label">Contact:</span> {c.name}</p> : null}
                  <p className="customer-card-meta"><span className="customer-card-label">Phone:</span> {c.phone || '—'}</p>
                  <p className="customer-card-meta"><span className="customer-card-label">Email:</span> {c.email || '—'}</p>
                  <p className="customer-card-meta"><span className="customer-card-label">Billing:</span> {customerBillingCityState(c)}</p>
                  <button
                    type="button"
                    className="soft customer-card-edit"
                    onClick={e => { e.stopPropagation(); loadCustomer(c) }}
                  >
                    Edit
                  </button>
                </article>
              )
            })}
            {customers.length === 0 && <p className="customer-cards-empty">No customers found.</p>}
          </div>
          <div className="table-wrap customer-table">
            <table>
              <thead><tr><th>Business</th><th>Contact</th><th>Phone</th><th>Status</th><th>Balance</th><th>Last Order</th><th></th></tr></thead>
              <tbody>{customers.map(c => {
                const s = customerStats(c, data)
                return (
                  <tr key={c.id} id={`customer-row-${c.id}`} onClick={() => loadCustomer(c)}
                    className={String(selected) === String(c.id) || String(editingId) === String(c.id) ? 'sel' : ''}>
                    <td><b>{c.company || '—'}</b></td>
                    <td>{c.name}</td>
                    <td>{c.phone}</td>
                    <td><span className={`status-badge status-${(c.status || 'Active').toLowerCase()}`}>{c.status || 'Active'}</span></td>
                    <td>{money(s.balance)}</td>
                    <td>{s.lastOrder || '—'}</td>
                    <td className="row-actions" onClick={e => e.stopPropagation()}>
                      <button type="button" className="soft" onClick={() => loadCustomer(c)}>Edit</button>
                    </td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        </section>
      </div>
      <CustomerDetail customer={selectedCustomer} data={data} deleteRow={deleteRow} onNavigate={onNavigate} />
    </div>
  )
}

function CustomerDetail({ customer, data, deleteRow, onNavigate }) {
  if (!customer) return <div className="panel detail customers-detail-panel"><h2>Customer Detail</h2><p>Select a customer.</p></div>
  const s = customerStats(customer, data)
  const moneyCols = ['total', 'amount']
  const cellValue = (r, c) => {
    if (c === 'status') return normalizeOrderStatus(r[c])
    if (moneyCols.includes(c)) return money(r[c])
    if (isDisplayDateField(c)) return formatDisplayDate(r[c])
    return String(r[c] ?? '')
  }

  return (
    <div className="panel detail customers-detail-panel">
      <h2>{customer.company || customer.name}</h2>
      <p>
        <b>Business:</b> {customer.company || '—'}<br />
        <b>Contact:</b> {customer.name}<br />
        <b>Phone:</b> {customer.phone}<br />
        <b>Email:</b> {customer.email}<br />
        <b>Preferred Payment:</b> {customer.preferred_payment || '—'}<br />
        <b>Terms:</b> {customer.payment_terms || '—'}<br />
        <b>Status:</b> <span className={`status-badge status-${(customer.status || 'Active').toLowerCase()}`}>{customer.status || 'Active'}</span>
      </p>
      <div className="mini-cards">
        <Card t="Open Balance" v={money(s.balance)} />
        <Card t="Last Order" v={s.lastOrder || '—'} />
        <Card t="Total Orders" v={s.orders.length} />
        <Card t="Total Sales" v={money(s.sales)} />
        <Card t="Average Order" v={money(s.avgOrder)} />
        <Card t="Paid" v={money(s.paid)} />
      </div>
      <h3>Billing Address</h3><pre>{customer.billing_address || customer.address || ''}</pre>
      <h3>Shipping Address</h3><pre>{customer.shipping_address || customer.billing_address || customer.address || ''}</pre>
      <h3>Note</h3><pre>{customer.note || ''}</pre>
      <h3>Invoices</h3>
      <div className="table-wrap detail-nav-table">
        <table>
          <thead><tr>{['invoice_no', 'style', 'qty', 'total', 'status', 'payment_status'].map(c => <th key={c}>{c.replaceAll('_', ' ')}</th>)}</tr></thead>
          <tbody>{s.orders.map(r => (
            <tr key={r.id}>
              <td>
                <button type="button" className="link-cell" onClick={() => onNavigate('Invoice', r.id)}>
                  {r.invoice_no || '—'}
                </button>
              </td>
              {['style', 'qty', 'total', 'status', 'payment_status'].map(c => <td key={c}>{cellValue(r, c)}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
      <h3>Payments</h3>
      <div className="table-wrap detail-nav-table">
        <table>
          <thead><tr>{['payment_date', 'invoice_no', 'amount', 'method', 'reference_no', 'note'].map(c => <th key={c}>{c.replaceAll('_', ' ')}</th>)}</tr></thead>
          <tbody>{s.payments.map(r => (
            <tr key={r.id} className="clickable-row" onClick={() => onNavigate('Payments', r.id)}>
              {['payment_date', 'invoice_no', 'amount', 'method', 'reference_no', 'note'].map(c => <td key={c}>{cellValue(r, c)}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
      <h3>Order History</h3>
      <div className="table-wrap detail-nav-table">
        <table>
          <thead><tr>{['created_at', 'invoice_no', 'style', 'qty', 'total', 'payment_status'].map(c => <th key={c}>{c.replaceAll('_', ' ')}</th>)}</tr></thead>
          <tbody>{s.orders.map(r => (
            <tr key={r.id} className="clickable-row" onClick={() => onNavigate('Orders', r.id)}>
              {['created_at', 'invoice_no', 'style', 'qty', 'total', 'payment_status'].map(c => <td key={c}>{cellValue(r, c)}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}

function InventorySalesHistoryDialog({ item, orders, orderItems, onClose, onOpenInvoice }) {
  const { rows, totalQtySold } = useMemo(
    () => buildInventorySalesHistory(item.id, orders, orderItems),
    [item.id, orders, orderItems],
  )
  const productName = item.style || 'Product'

  return (
    <div className="restore-dialog-overlay inventory-sales-history-overlay" onClick={onClose}>
      <div
        className="restore-dialog inventory-sales-history-dialog"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-labelledby="inventory-sales-history-title"
      >
        <header className="inventory-sales-history-header">
          <h2 id="inventory-sales-history-title" className="inventory-sales-history-product">{productName}</h2>
          <p className="inventory-sales-history-subtitle">Sales History</p>
        </header>

        <dl className="inventory-sales-history-summary">
          <div className="inventory-sales-history-summary-card">
            <dt>Current Stock On Hand</dt>
            <dd>{item.stockOnHand ?? item.qty ?? 0}</dd>
          </div>
          <div className="inventory-sales-history-summary-card">
            <dt>Total Qty Sold</dt>
            <dd>{totalQtySold}</dd>
          </div>
        </dl>

        <div className="inventory-sales-history-body">
          {rows.length === 0 ? (
            <p className="hint inventory-sales-history-empty">No sales history for this product.</p>
          ) : (
            <div className="table-wrap inventory-sales-history-table">
              <table>
                <thead>
                  <tr>
                    <th>Order Date</th>
                    <th>Invoice No</th>
                    <th className="col-customer-name">Customer Name</th>
                    <th className="col-qty-sold">Qty Sold</th>
                    <th className="col-sales-person">Sales Person</th>
                    <th className="col-unit-price">Unit Price</th>
                    <th className="col-line-total">Line Total</th>
                    <th className="col-status">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={`${row.orderId}-${row.orderItemId}`}>
                      <td className="col-order-date">{formatDisplayDate(row.orderDate)}</td>
                      <td className="col-invoice-no">
                        <button
                          type="button"
                          className="link-cell invoice-link"
                          onClick={() => onOpenInvoice?.(row.orderId)}
                        >
                          {row.invoiceNo}
                        </button>
                      </td>
                      <td className="col-customer-name">{row.customerName}</td>
                      <td className="col-qty-sold">{row.qtySold}</td>
                      <td className="col-sales-person">{row.salesPerson}</td>
                      <td className="col-unit-price">{money(row.unitPrice)}</td>
                      <td className="col-line-total">{money(row.lineTotal)}</td>
                      <td className="col-status"><OrderStatusBadge status={row.status} backorderQty={row.backorderQty} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <footer className="inventory-sales-history-footer">
          <button type="button" className="soft inventory-sales-history-close" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  )
}

function Inventory({ data, addRow, updateRow, deleteRow, allocateBackOrders, inventoryLoadError = '', dataLoading = false, onNavigate }) {
  const blank = {
    style: '', brand: '', category: '', qty: '', buying_price: '', shipping_cost: '', selling_price: '',
    low_stock: 5, supplier: '', default_middleman_name: '', default_commission_type: '', default_commission_value: '',
  }
  const [f, setF] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const [formError, setFormError] = useState('')
  const [allocPrompt, setAllocPrompt] = useState(null)
  const [allocSummary, setAllocSummary] = useState(null)
  const [salesHistoryItem, setSalesHistoryItem] = useState(null)
  const middlemanOptions = useMemo(
    () => collectMiddlemanOptions(data.purchase_orders || [], data.inventory || []),
    [data.purchase_orders, data.inventory],
  )
  const supplierOptions = useMemo(
    () => collectSupplierOptions(data.purchase_orders || [], data.inventory || []),
    [data.purchase_orders, data.inventory],
  )
  const margin = Number(f.selling_price) > 0
    ? formatMargin(f.buying_price, f.selling_price, f.shipping_cost)
    : 'Not Set'
  const profit = Number(f.selling_price) > 0
    ? money(calcProfit(f.buying_price, f.selling_price, f.shipping_cost))
    : 'Not Set'

  function loadItem(item) {
    setEditingId(item.id)
    setFormError('')
    setF({
      style: item.style || '',
      brand: item.brand || '',
      category: item.category || '',
      qty: item.qty ?? '',
      buying_price: itemBuying(item) || '',
      shipping_cost: item.shipping_cost ?? '',
      selling_price: itemSelling(item) || '',
      low_stock: itemMinimumStockOrDefault(item, 5),
      supplier: item.supplier || '',
      default_middleman_name: item.default_middleman_name || '',
      default_commission_type: item.default_commission_type || '',
      default_commission_value: item.default_commission_value ?? '',
    })
    if (window.matchMedia('(max-width: 1023px)').matches) {
      requestAnimationFrame(() => {
        document.getElementById('inventory-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }

  function cancelEdit() {
    setEditingId(null)
    setFormError('')
    setF(blank)
  }

  function formatDefaultCommissionOnly(item) {
    const type = item.default_commission_type || ''
    const value = Number(item.default_commission_value) || 0
    if (!type || value <= 0) return 'Not Set'
    if (type === 'percentage') return `${value}%`
    if (type === 'fixed_per_unit') return `$${value.toFixed(2)}/unit`
    if (type === 'fixed_total') return `$${value.toFixed(2)} total`
    return 'Not Set'
  }

  async function performSave(row) {
    const inventoryId = editingId
    if (inventoryId) await updateRow('inventory', inventoryId, row)
    else await addRow('inventory', row)
    cancelEdit()
    return { inventoryId, savedQty: row.qty }
  }

  async function save() {
    const buying = Number(f.buying_price) || 0, shippingCost = Number(f.shipping_cost) || 0
    const selling = Number(f.selling_price) || 0
    const commissionErr = validateInventoryCommissionDefaults(f)
    if (commissionErr) {
      setFormError(commissionErr)
      return
    }
    setFormError('')
    const row = {
      style: f.style, brand: f.brand, category: f.category,
      qty: Number(f.qty) || 0, buying_price: buying, shipping_cost: shippingCost, selling_price: selling,
      cost: buying, price: selling,
      supplier: String(f.supplier || '').trim(),
      default_middleman_name: String(f.default_middleman_name || '').trim(),
      default_commission_type: f.default_commission_type || '',
      default_commission_value: f.default_commission_value !== '' ? Math.max(Number(f.default_commission_value) || 0, 0) : 0,
      ...minimumStockPayload(f.low_stock),
    }
    const oldItem = editingId ? data.inventory.find(i => String(i.id) === String(editingId)) : null
    const oldQty = Number(oldItem?.qty || 0)
    const stockIncrease = editingId ? Math.max(row.qty - oldQty, 0) : 0
    const backorders = editingId ? activeBackorderOrders(data.orders, editingId, data.order_items) : []
    const inventoryId = editingId

    await performSave(row)

    if (inventoryId && stockIncrease > 0 && backorders.length > 0) {
      setAllocSummary(null)
      setAllocPrompt({ stockIncrease, inventoryId, savedQty: row.qty })
    }
  }

  async function saveWithoutAllocation() {
    setAllocPrompt(null)
  }

  async function saveWithAllocation() {
    if (!allocPrompt) return
    const { stockIncrease, inventoryId, savedQty } = allocPrompt
    const summary = await allocateBackOrders(inventoryId, stockIncrease, savedQty)
    setAllocSummary(summary)
    setAllocPrompt(null)
  }

  const rows = data.inventory.map(item => {
    const buying = itemBuying(item), shippingCost = itemShipping(item), selling = itemSelling(item)
    const stockOnHand = inventoryStockView(item)
    const backOrdered = backOrderedQtyForProduct(data.orders, item.id, data.order_items)
    const reorder = inventoryReorderView(item)
    return {
      ...item, buying_price: buying, shipping_cost: shippingCost, selling_price: selling,
      profit: formatInventoryProfit(buying, selling, shippingCost),
      margin: formatInventoryMargin(buying, selling, shippingCost),
      sellingDisplay: formatSellingDisplay(selling),
      stock: stockLevel(stockOnHand.display),
      stockOnHand: stockOnHand.display,
      stockRaw: stockOnHand.raw,
      stockNegative: stockOnHand.isNegative,
      backOrdered,
      available: stockOnHand.display,
      minimumStock: reorder.minimumStockDisplay,
      needToOrder: reorder.needToOrder,
      stockStatus: reorder.status,
      stockStatusClass: reorder.statusClass,
      supplierDisplay: String(item.supplier || '').trim() || 'Not Set',
      defaultMiddleman: String(item.default_middleman_name || '').trim() || 'Not Set',
      defaultCommission: formatDefaultCommissionOnly(item),
    }
  })

  function handleExportInventoryCsv() {
    exportInventoryCsv(data.inventory)
  }

  function openSalesHistory(row) {
    setSalesHistoryItem(row)
  }

  function openInvoiceFromSalesHistory(orderId) {
    setSalesHistoryItem(null)
    onNavigate?.('Invoice', orderId)
  }

  return (
    <div className="panel inventory-page">
      <h2 id="inventory-form">{editingId ? 'Edit Inventory Item' : 'Add Inventory Item'}</h2>
      {dataLoading && <p className="hint">Loading inventory…</p>}
      {inventoryLoadError && (
        <p className="field-error inventory-load-error" role="alert">
          Inventory load failed: {inventoryLoadError}
        </p>
      )}
      <div className="inventory-form">
        <div className="form-section">
          <h3>Product Details</h3>
          <div className="form-grid inventory-grid">
            <label>Style / SKU<input value={f.style} onChange={e => setF({ ...f, style: e.target.value })} /></label>
            <label>Brand<input value={f.brand} onChange={e => setF({ ...f, brand: e.target.value })} /></label>
            <label>Category<input value={f.category} onChange={e => setF({ ...f, category: e.target.value })} /></label>
            <label>Qty<input type="number" min="0" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} /></label>
            <label className="inventory-minimum-field">
              Minimum Stock
              <input type="number" min="0" value={f.low_stock} onChange={e => setF({ ...f, low_stock: e.target.value })} />
              <span className="field-hint">Low stock alerts appear when Stock On Hand is at or below this quantity.</span>
            </label>
          </div>
        </div>
        <div className="form-section">
          <h3>Pricing</h3>
          <div className="form-grid inventory-grid pricing-grid">
            <label>Buying Price<input type="number" min="0" step="0.01" value={f.buying_price} onChange={e => setF({ ...f, buying_price: e.target.value })} /></label>
            <label>Shipping Cost<input type="number" min="0" step="0.01" value={f.shipping_cost} onChange={e => setF({ ...f, shipping_cost: e.target.value })} /></label>
            <label>Selling Price<input type="number" min="0" step="0.01" value={f.selling_price} onChange={e => setF({ ...f, selling_price: e.target.value })} /></label>
            <div className="margin-display">
              <span>Profit $</span><strong>{profit}</strong>
              <span>Margin</span><strong className="margin-value">{margin}</strong>
            </div>
          </div>
        </div>
        <div className="form-section">
          <h3>Default Purchase Order Settings</h3>
          <p className="hint">Optional. These values auto-fill when this product is added to a Purchase Order.</p>
          <div className="form-grid inventory-grid">
            <label>Supplier
              <input
                list="inventory-supplier-options"
                value={f.supplier}
                placeholder="Select or type supplier"
                onChange={e => setF({ ...f, supplier: e.target.value })}
              />
            </label>
            <label>Default Middle Man
              <input
                list="inventory-middleman-options"
                value={f.default_middleman_name}
                placeholder="Select or type name"
                onChange={e => setF({ ...f, default_middleman_name: e.target.value })}
              />
            </label>
            <label>Default Commission Type
              <select
                value={f.default_commission_type}
                onChange={e => setF({ ...f, default_commission_type: e.target.value })}
              >
                <option value="">None</option>
                {COMMISSION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label>Default Commission Value
              <input
                type="number"
                min="0"
                step={f.default_commission_type === 'percentage' ? '0.01' : '0.01'}
                value={f.default_commission_value}
                disabled={!f.default_commission_type}
                onChange={e => setF({ ...f, default_commission_value: e.target.value })}
              />
            </label>
          </div>
          <datalist id="inventory-middleman-options">
            {middlemanOptions.map(name => <option key={name} value={name} />)}
          </datalist>
          <datalist id="inventory-supplier-options">
            {supplierOptions.map(name => <option key={name} value={name} />)}
          </datalist>
        </div>
        {formError && <p className="field-error">{formError}</p>}
        <div className="inventory-actions">
          <button type="button" className="inventory-save" onClick={save}>Save Item</button>
          {editingId && <button type="button" className="soft" onClick={cancelEdit}>Cancel</button>}
        </div>
      </div>
      <div className="inventory-list-header">
        <h2>Inventory</h2>
        <button type="button" className="soft inventory-export-btn" onClick={handleExportInventoryCsv}>
          Export CSV
        </button>
      </div>
      {allocPrompt && (
        <div className="alloc-prompt panel-inline">
          <p><strong>Stock saved.</strong> New stock is available for existing Back Orders.<br />Would you like to allocate it now?</p>
          <div className="alloc-prompt-actions">
            <button type="button" className="soft" onClick={saveWithoutAllocation}>Not Now</button>
            <button type="button" onClick={saveWithAllocation}>Allocate Back Orders</button>
          </div>
        </div>
      )}
      {allocSummary?.length > 0 && (
        <div className="alloc-summary panel-inline">
          <h3>Allocation Summary</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Invoice No</th><th>Customer</th><th>Allocated Now</th><th>Remaining Back Order</th><th>New Status</th></tr>
              </thead>
              <tbody>
                {allocSummary.map((s, i) => (
                  <tr key={i}>
                    <td>{s.invoice_no || '—'}</td>
                    <td>{s.customer_name || '—'}</td>
                    <td>{s.allocatedNow}</td>
                    <td>{s.remainingBackOrder}</td>
                    <td>{s.newStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <InventoryTable
        rows={rows}
        editingId={editingId}
        onEdit={loadItem}
        onDelete={id => deleteRow('inventory', id)}
        onStockClick={openSalesHistory}
      />
      {salesHistoryItem && (
        <InventorySalesHistoryDialog
          item={salesHistoryItem}
          orders={data.orders}
          orderItems={data.order_items}
          onClose={() => setSalesHistoryItem(null)}
          onOpenInvoice={openInvoiceFromSalesHistory}
        />
      )}
    </div>
  )
}

function InventoryTable({ rows, editingId, onEdit, onDelete, onStockClick }) {
  return (
    <>
      <div className="inventory-cards">
        {rows.map(r => (
          <article
            key={r.id}
            className={`inventory-card${String(editingId) === String(r.id) ? ' sel' : ''}`}
            onClick={() => onEdit(r)}
          >
            <h3 className="inventory-card-title">{r.style || '—'}</h3>
            <dl className="inventory-card-meta">
              <div className="inventory-card-row">
                <dt>Brand</dt>
                <dd>{r.brand || '—'}</dd>
              </div>
              <div className="inventory-card-row">
                <dt>Category</dt>
                <dd>{r.category || '—'}</dd>
              </div>
              <div className="inventory-card-row">
                <dt>Supplier</dt>
                <dd>{r.supplierDisplay}</dd>
              </div>
              <div className="inventory-card-row">
                <dt>Stock On Hand</dt>
                <dd>
                  <button
                    type="button"
                    className={`stock-badge stock-badge-link ${r.stock.cls}`}
                    onClick={e => { e.stopPropagation(); onStockClick?.(r) }}
                    aria-label={`View sales history for ${r.style || 'product'}`}
                  >
                    {r.stockOnHand}
                  </button>
                  {r.stockNegative && <span className="negative-stock-warn" title={`Stored qty: ${r.stockRaw}`}> ⚠</span>}
                </dd>
              </div>
              <div className="inventory-card-row">
                <dt>Back Ordered</dt>
                <dd>{r.backOrdered > 0 ? <span className="backorder-badge">{r.backOrdered}</span> : '0'}</dd>
              </div>
              <div className="inventory-card-row">
                <dt>Available</dt>
                <dd>{r.available}</dd>
              </div>
              <div className="inventory-card-row">
                <dt>Minimum Stock</dt>
                <dd>{r.minimumStock}</dd>
              </div>
              <div className="inventory-card-row">
                <dt>Need To Order</dt>
                <dd>{r.needToOrder}</dd>
              </div>
              <div className="inventory-card-row">
                <dt>Buying Price</dt>
                <dd>{money(r.buying_price)}</dd>
              </div>
              <div className="inventory-card-row">
                <dt>Shipping Cost</dt>
                <dd>{money(r.shipping_cost)}</dd>
              </div>
              <div className="inventory-card-row">
                <dt>Selling Price</dt>
                <dd>{formatSellingDisplay(r.selling_price)}</dd>
              </div>
              <div className="inventory-card-row">
                <dt>Default Middle Man</dt>
                <dd>{r.defaultMiddleman}</dd>
              </div>
              <div className="inventory-card-row">
                <dt>Default Commission</dt>
                <dd>{r.defaultCommission}</dd>
              </div>
              <div className="inventory-card-row">
                <dt>Profit</dt>
                <dd>{r.profit}</dd>
              </div>
              <div className="inventory-card-row">
                <dt>Margin</dt>
                <dd className="margin-cell">{r.margin}</dd>
              </div>
              <div className="inventory-card-row">
                <dt>Status</dt>
                <dd><span className={`stock-status-badge ${r.stockStatusClass}`}>{r.stockStatus}</span></dd>
              </div>
            </dl>
            <div className="inventory-card-actions" onClick={e => e.stopPropagation()}>
              <button type="button" className="soft" onClick={e => { e.stopPropagation(); onEdit(r) }}>Edit</button>
              <button type="button" className="danger" onClick={() => onDelete(r.id)}>Delete</button>
            </div>
          </article>
        ))}
        {rows.length === 0 && <p className="inventory-cards-empty">No inventory items found.</p>}
      </div>
      <div className="table-wrap inventory-table">
      <table>
        <thead><tr>
          <th>Style / SKU</th><th>Brand</th><th>Category</th>
          <th className="inventory-default-col">Supplier</th>
          <th>Stock On Hand</th><th>Back Ordered</th><th>Available</th>
          <th>Minimum Stock</th><th>Need to Order</th>
          <th>Buying Price</th><th>Shipping Cost</th><th>Selling Price</th>
          <th className="inventory-default-col">Default Middle Man</th>
          <th className="inventory-default-col">Default Commission</th>
          <th>Profit</th><th>Margin</th><th>Status</th><th>Edit</th><th>Delete</th>
        </tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.id} className={String(editingId) === String(r.id) ? 'sel' : ''} onClick={() => onEdit(r)}>
            <td><b>{r.style || '—'}</b></td>
            <td>{r.brand || '—'}</td>
            <td>{r.category || '—'}</td>
            <td className="inventory-default-col">{r.supplierDisplay}</td>
            <td>
              <button
                type="button"
                className={`stock-badge stock-badge-link ${r.stock.cls}`}
                onClick={e => { e.stopPropagation(); onStockClick?.(r) }}
                aria-label={`View sales history for ${r.style || 'product'}`}
              >
                {r.stockOnHand}
              </button>
              {r.stockNegative && <span className="negative-stock-warn" title={`Stored qty: ${r.stockRaw}`}> ⚠</span>}
            </td>
            <td>{r.backOrdered > 0 ? <span className="backorder-badge">{r.backOrdered}</span> : '0'}</td>
            <td>{r.available}</td>
            <td>{r.minimumStock}</td>
            <td>{r.needToOrder}</td>
            <td>{money(r.buying_price)}</td>
            <td>{money(r.shipping_cost)}</td>
            <td>{formatSellingDisplay(r.selling_price)}</td>
            <td className="inventory-default-col">{r.defaultMiddleman}</td>
            <td className="inventory-default-col">{r.defaultCommission}</td>
            <td>{r.profit}</td>
            <td className="margin-cell">{r.margin}</td>
            <td>
              <span className={`stock-status-badge ${r.stockStatusClass}`}>{r.stockStatus}</span>
            </td>
            <td className="row-actions" onClick={e => e.stopPropagation()}>
              <button type="button" className="soft" onClick={() => onEdit(r)}>Edit</button>
            </td>
            <td className="row-actions" onClick={e => e.stopPropagation()}>
              <button type="button" className="danger" onClick={() => onDelete(r.id)}>Delete</button>
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
    </>
  )
}

function OrderMemoIndicator({ order }) {
  if (!orderHasMemo(order)) return null
  const internal = orderInternalNote(order)
  const customer = orderCustomerNote(order)
  return (
    <span className="order-memo-cell">
      <button type="button" className="order-memo-trigger soft" aria-label="View order memos">Memo</button>
      <span className="order-memo-popover" role="tooltip">
        {internal && (
          <span className="order-memo-popover-block">
            <strong>Internal Memo</strong>
            <span>{internal}</span>
          </span>
        )}
        {customer && (
          <span className="order-memo-popover-block">
            <strong>Customer Note</strong>
            <span>{customer}</span>
          </span>
        )}
      </span>
    </span>
  )
}

function OrderTrackingEditor({ values, onChange, showLabel = true, readOnly = false }) {
  const rows = values?.length ? values : [blankTrackingRow()]
  return (
    <div className="order-tracking-list">
      {showLabel && <span className="order-tracking-label">Tracking Numbers</span>}
      {rows.map((row, idx) => (
        <div key={`track-${idx}`} className="order-tracking-row">
          <select
            className="order-tracking-carrier"
            value={row.carrier || 'USPS'}
            disabled={readOnly}
            onChange={e => {
              const next = rows.map((r, i) => (i === idx ? { ...r, carrier: e.target.value } : r))
              onChange(next)
            }}
          >
            {TRACKING_CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            placeholder="Tracking Number"
            value={row.tracking_number || ''}
            disabled={readOnly}
            onChange={e => {
              const next = rows.map((r, i) => (i === idx ? { ...r, tracking_number: e.target.value } : r))
              onChange(next)
            }}
          />
          {!readOnly && rows.length > 1 && (
            <button
              type="button"
              className="soft order-tracking-remove"
              onClick={() => {
                const next = rows.filter((_, i) => i !== idx)
                onChange(next.length ? next : [blankTrackingRow()])
              }}
            >
              Remove
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button
          type="button"
          className="soft order-tracking-add"
          onClick={() => onChange([...rows, blankTrackingRow()])}
        >
          + Add Tracking Number
        </button>
      )}
    </div>
  )
}

function ManageTrackingModal({ draft, onChange, onSave, onCancel, busy, error }) {
  return (
    <div className="restore-dialog-overlay tracking-modal-overlay" onClick={onCancel}>
      <div className="restore-dialog tracking-modal" onClick={e => e.stopPropagation()} role="dialog" aria-labelledby="tracking-modal-title">
        <h3 id="tracking-modal-title">Manage Tracking</h3>
        <OrderTrackingEditor values={draft} onChange={onChange} showLabel={false} />
        {error && <p className="field-error">{error}</p>}
        <div className="restore-dialog-actions">
          <button type="button" className="soft" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" onClick={onSave} disabled={busy}>{busy ? 'Saving…' : 'Save Tracking'}</button>
        </div>
      </div>
    </div>
  )
}

function OrderMobileCards({
  orders, orderItems, staffUsers, readOnly, editingId, highlightId,
  formatOrderDate, onEdit, onDelete, onInvoice,
}) {
  return (
    <div className="order-cards">
      {orders.map(o => {
        const ff = normalizeFulfillment(o, orderItems)
        const voided = isVoidOrder(o)
        const isSelected = String(highlightId) === String(o.id) || String(editingId) === String(o.id)
        return (
          <article
            key={o.id}
            id={`order-card-${o.id}`}
            className={`order-card${isSelected ? ' sel' : ''}`}
          >
            <div className="order-card-head">
              <div className="order-card-invoice">{o.invoice_no || '—'}</div>
              <div className="order-card-date">{formatOrderDate(o)}</div>
            </div>
            <p className="order-card-customer">{o.customer_name || '—'}</p>
            <dl className="order-card-meta">
              <div className="order-card-row">
                <dt>Sales Person</dt>
                <dd>{orderSalesPersonDisplay(o, staffUsers)}</dd>
              </div>
              <div className="order-card-row">
                <dt>Product</dt>
                <dd className="order-card-product">{orderDisplayProduct(o, orderItems)}</dd>
              </div>
              <div className="order-card-row">
                <dt>Qty</dt>
                <dd>{ff.qty}</dd>
              </div>
              <div className="order-card-row">
                <dt>Allocated</dt>
                <dd>{ff.allocated_qty}</dd>
              </div>
              <div className="order-card-row">
                <dt>Back Order</dt>
                <dd>{ff.backorder_qty > 0 ? <span className="backorder-badge">{ff.backorder_qty}</span> : ff.backorder_qty}</dd>
              </div>
              <div className="order-card-row">
                <dt>Fulfillment</dt>
                <dd>{o.shipping_method || '—'}</dd>
              </div>
              <div className="order-card-row">
                <dt>Tracking</dt>
                <dd className="order-card-tracking">{fulfillmentHandledBy(o)}</dd>
              </div>
              <div className="order-card-row">
                <dt>Status</dt>
                <dd><OrderStatusBadge status={o.status} backorderQty={ff.backorder_qty} /></dd>
              </div>
              <div className="order-card-row">
                <dt>Payment</dt>
                <dd>{o.payment_status || '—'}</dd>
              </div>
            </dl>
            {orderHasMemo(o) && (
              <div className="order-card-memo">
                <OrderMemoIndicator order={o} />
              </div>
            )}
            {!readOnly && (
              <div className="order-card-actions">
                {!voided && (
                  <button type="button" className="soft" onClick={() => onEdit(o)}>Edit</button>
                )}
                {onInvoice && (
                  <button type="button" className="soft" onClick={() => onInvoice(o.id)}>Invoice</button>
                )}
                <button type="button" className="danger order-card-delete" onClick={() => onDelete(o.id)}>Delete</button>
              </div>
            )}
          </article>
        )
      })}
      {orders.length === 0 && <p className="order-cards-empty">No orders found.</p>}
    </div>
  )
}

function Orders({ data, staffUsers, createOrder, updateOrder, deleteOrder, selectedOrderId, focusFulfillment, clearSelection, readOnly = false, onNavigate, currentUserId = '' }) {
  const blank = {
    customer_id: '', customer_name: '',
    sales_person_id: '',
    lines: [{ ...blankOrderLine(), _clientKey: newClientOrderLineKey() }],
    shipping_method: '', shipping: '0', discount: '0', tax: '0',
    status: 'Completed', internal_note: '', customer_note: '', tracking_entries: [blankTrackingRow()],
    due_date: '', order_date: '', fulfillment_date: '', delivered_by: '', picked_up_by: '',
    fulfillment_note: '', signature_name: '',
  }
  const [f, setF] = useState(blank)
  const [highlightId, setHighlightId] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editSnapshot, setEditSnapshot] = useState(null)
  const [editError, setEditError] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [salesPersonFilter, setSalesPersonFilter] = useState('All')
  const [showBackorderConfirm, setShowBackorderConfirm] = useState(false)

  const method = f.shipping_method || ''
  const showCarrierFields = isCarrierMethod(method)
  const showDeliveryFields = isCompanyDelivery(method)
  const showPickupFields = isCustomerPickup(method)
  const editingOrder = editingId ? data.orders.find(o => String(o.id) === String(editingId)) : null
  const lastNavRef = useRef('')

  useEffect(() => {
    if (!selectedOrderId) {
      lastNavRef.current = ''
      return
    }
    const navKey = `${selectedOrderId}:${focusFulfillment ? '1' : '0'}`
    if (lastNavRef.current === navKey) return
    const order = data.orders.find(o => String(o.id) === String(selectedOrderId))
    if (!order) return
    lastNavRef.current = navKey
    loadOrderForEdit(order, focusFulfillment)
    clearSelection?.()
  }, [selectedOrderId, focusFulfillment, data.orders])

  function cancelEdit() {
    setEditingId(null)
    setEditSnapshot(null)
    setEditError('')
    setF({ ...blank, lines: [{ ...blankOrderLine(), _clientKey: newClientOrderLineKey() }] })
  }

  function loadOrderForEdit(order, scrollToFulfillment = false) {
    if (isVoidOrder(order)) return
    setEditingId(order.id)
    const orderLines = itemsForOrder(order, data.order_items)
    setEditSnapshot({
      lines: orderLines.map(line => ({
        id: line.id,
        inventory_id: line.inventory_id,
        allocated_qty: line.allocated_qty,
      })),
    })
    setEditError('')
    setHighlightId(order.id)
    setF({
      customer_id: order.customer_id || '',
      customer_name: order.customer_name || '',
      sales_person_id: order.sales_person_id || '',
      lines: orderLines.length
        ? orderLines.map(line => ({
          id: line.id,
          _clientKey: String(line.id || newClientOrderLineKey()),
          inventory_id: line.inventory_id || '',
          style: line.style || '',
          qty: line.qty ?? '',
          price: line.price ?? '',
          discount: line.discount ?? '0',
        }))
        : [blankOrderLine()],
      shipping_method: order.shipping_method || '',
      shipping: order.shipping ?? '0',
      discount: order.discount ?? '0',
      tax: order.tax ?? '0',
      status: normalizeOrderStatus(order.status || 'Completed'),
      internal_note: orderInternalNote(order),
      customer_note: orderCustomerNote(order),
      tracking_entries: trackingEntriesToFormValues(data.order_tracking_numbers, order.id, order.tracking),
      due_date: toDbDate(order.due_date || ''),
      order_date: toDbDate(order.order_date || order.created_at || ''),
      fulfillment_date: toDbDate(order.fulfillment_date || ''),
      delivered_by: order.delivered_by || '',
      picked_up_by: order.picked_up_by || '',
      fulfillment_note: order.fulfillment_note || '',
      signature_name: order.signature_name || '',
    })
    requestAnimationFrame(() => {
      document.getElementById('order-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      if (!scrollToFulfillment) return
      requestAnimationFrame(() => {
        if (order.shipping_method) {
          document.getElementById('fulfillment-fields')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        } else {
          const methodSelect = document.getElementById('fulfillment-method-select')
          methodSelect?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          methodSelect?.focus()
        }
      })
    })
  }

  async function handleSave() {
    if (editingId) {
      const result = await updateOrder(editingId, f, editSnapshot)
      if (result?.error) {
        setEditError(result.error)
        return
      }
      if (result?.mergedCount > 0) {
        setEditError(`Duplicate products were merged into single lines (${result.mergedCount} merge${result.mergedCount === 1 ? '' : 's'}).`)
      }
      cancelEdit()
      return
    }
    const preview = previewTotals()
    if (preview.totalBackorder > 0) {
      setShowBackorderConfirm(true)
      return
    }
    const result = await createOrder(f)
    if (result?.error) {
      setEditError(result.error)
      return
    }
    setEditError(result?.mergedCount > 0
      ? `Duplicate products were merged into single lines (${result.mergedCount} merge${result.mergedCount === 1 ? '' : 's'}). Invoice created.`
      : '')
    setF({ ...blank, lines: [{ ...blankOrderLine(), _clientKey: newClientOrderLineKey() }] })
  }

  async function confirmCreateWithBackorder() {
    setShowBackorderConfirm(false)
    const result = await createOrder(f)
    if (result?.error) {
      setEditError(result.error)
      return
    }
    setEditError(result?.mergedCount > 0
      ? `Duplicate products were merged into single lines (${result.mergedCount} merge${result.mergedCount === 1 ? '' : 's'}). Invoice created with back order.`
      : '')
    setF({ ...blank, lines: [{ ...blankOrderLine(), _clientKey: newClientOrderLineKey() }] })
  }

  async function handleDeleteOrder(id) {
    const ok = await deleteOrder(id)
    if (ok && String(editingId) === String(id)) cancelEdit()
  }

  function chooseCustomer(id) {
    const c = data.customers.find(x => String(x.id) === String(id))
    setF({ ...f, customer_id: id, customer_name: c?.company || c?.name || '', due_date: toDbDate(calcDueDate(c?.payment_terms, today())) })
  }

  function updateLine(idx, patch) {
    setF(prev => ({
      ...prev,
      lines: prev.lines.map((line, i) => i === idx ? { ...line, ...patch } : line),
    }))
  }

  function pickLineProduct(idx, inventoryId) {
    const item = data.inventory.find(x => String(x.id) === String(inventoryId))
    updateLine(idx, {
      inventory_id: inventoryId,
      style: item?.style || '',
      price: orderItemSelling(item) || '',
    })
  }

  function removeLine(idx) {
    setF(prev => ({
      ...prev,
      lines: prev.lines.length <= 1 ? prev.lines : prev.lines.filter((_, i) => i !== idx),
    }))
  }

  function addLine() {
    setF(prev => ({ ...prev, lines: [...prev.lines, { ...blankOrderLine(), _clientKey: newClientOrderLineKey() }] }))
  }

  function applyVoiceOrderToForm(voicePatch) {
    const customer = voicePatch.customerId
      ? data.customers.find(c => String(c.id) === String(voicePatch.customerId))
      : null
    const terms = voicePatch.paymentTerms || customer?.payment_terms || 'COD'
    const newLines = (voicePatch.lines || []).map(line => {
      const item = data.inventory.find(i => String(i.id) === String(line.inventoryId))
      return {
        ...blankOrderLine(),
        _clientKey: newClientOrderLineKey(),
        inventory_id: line.inventoryId,
        style: item?.style || '',
        price: orderItemSelling(item) || '',
        qty: line.qty,
      }
    })
    setF(prev => ({
      ...prev,
      customer_id: voicePatch.customerId || prev.customer_id,
      customer_name: customer?.company || customer?.name || prev.customer_name,
      sales_person_id: voicePatch.salesPersonId || prev.sales_person_id,
      shipping_method: voicePatch.shippingMethod || prev.shipping_method,
      due_date: voicePatch.customerId ? toDbDate(calcDueDate(terms, prev.order_date || today())) : prev.due_date,
      customer_note: voicePatch.customerNote ? voicePatch.customerNote : prev.customer_note,
      lines: newLines.length ? newLines : prev.lines,
    }))
    setEditError('')
    requestAnimationFrame(() => {
      document.getElementById('order-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  function previewTotals() {
    const snapshots = editingId && editSnapshot?.lines ? editSnapshot.lines : null
    const linesWithContext = (f.lines || []).map(line => {
      const snap = snapshots?.find(s =>
        (line.id && String(s.id) === String(line.id))
        || String(s.inventory_id || '') === String(line.inventory_id || ''),
      )
      return { ...line, _editContext: snap }
    })
    return calcOrderTotals(linesWithContext, f, data.inventory)
  }

  const totalsPreview = previewTotals()
  const allocPreview = {
    allocated_qty: totalsPreview.totalAllocated,
    backorder_qty: totalsPreview.totalBackorder,
    orderQty: totalsPreview.totalQty,
  }
  const filteredOrders = data.orders.filter(o => {
    if (!statusMatchesFilterWithVoid(o, statusFilter)) return false
    if (salesPersonFilter === 'All') return true
    if (salesPersonFilter === 'None') return !o.sales_person_id && !o.sales_person_name
    return String(o.sales_person_id) === String(salesPersonFilter)
  })
  const salesStaff = salesStaffOptions(staffUsers)

  function filterLabel(s) {
    if (s === 'All') return 'All'
    if (s === 'Void') {
      const count = data.orders.filter(o => isVoidOrder(o)).length
      return count ? `Void (${count})` : 'Void'
    }
    const count = countOrdersByStatus(data.orders, s)
    if (['Back Order', 'Partially Allocated', 'Completed'].includes(s)) return `${s} (${count})`
    return s
  }

  const formatOrderDate = order => formatDisplayDate(order.order_date || order.created_at)

  const dateFieldLabel = showDeliveryFields ? 'Delivery Date' : showPickupFields ? 'Pickup Date' : 'Fulfillment Date'
  const noteFieldLabel = showDeliveryFields ? 'Delivery Note' : showPickupFields ? 'Pickup Note' : 'Fulfillment Note'

  if (readOnly) {
    return (
      <div className="panel">
        <h2>Orders</h2>
        <p className="hint">View-only access.</p>
        <div className="orders-list-section">
        <div className="order-filters">
          {['All', ...ORDER_FILTER_STATUSES].map(s => (
            <button key={s} type="button" className={statusFilter === s ? 'filter-btn active' : 'filter-btn soft'} onClick={() => setStatusFilter(s)}>{filterLabel(s)}</button>
          ))}
        </div>
        <div className="order-filters order-sales-person-filter">
          <label>
            Sales Person
            <select value={salesPersonFilter} onChange={e => setSalesPersonFilter(e.target.value)}>
              <option value="All">All Sales People</option>
              <option value="None">Unassigned</option>
              {salesStaff.map(u => (
                <option key={u.id} value={u.id}>{staffSalesPersonLabel(u)}</option>
              ))}
            </select>
          </label>
        </div>
        <OrderMobileCards
          orders={filteredOrders}
          orderItems={data.order_items}
          staffUsers={staffUsers}
          readOnly
          editingId={editingId}
          highlightId={highlightId}
          formatOrderDate={formatOrderDate}
          onEdit={loadOrderForEdit}
          onDelete={handleDeleteOrder}
        />
        <div className="table-wrap orders-table">
          <table>
            <thead>
              <tr>
                <th>Order Date</th>
                <th>Invoice No</th>
                <th>Customer Name</th>
                <th>Sales Person</th>
                <th>Product</th>
                <th>Qty</th>
                <th>Allocated</th>
                <th>Back Order</th>
                <th>Fulfillment Method</th>
                <th>Tracking / Handled By</th>
                <th>Status</th>
                <th>Payment Status</th>
                <th>Memo</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map(o => {
                const ff = normalizeFulfillment(o, data.order_items)
                return (
                  <tr key={o.id} id={`order-row-${o.id}`}>
                    <td>{formatOrderDate(o)}</td>
                    <td>{o.invoice_no || '—'}</td>
                    <td>{o.customer_name || '—'}</td>
                    <td>{orderSalesPersonDisplay(o, staffUsers)}</td>
                    <td>{orderDisplayProduct(o, data.order_items)}</td>
                    <td>{ff.qty}</td>
                    <td>{ff.allocated_qty}</td>
                    <td>{ff.backorder_qty > 0 ? <span className="backorder-badge">{ff.backorder_qty}</span> : ff.backorder_qty}</td>
                    <td>{o.shipping_method || '—'}</td>
                    <td>{fulfillmentHandledBy(o)}</td>
                    <td><OrderStatusBadge status={o.status} backorderQty={ff.backorder_qty} /></td>
                    <td>{o.payment_status || '—'}</td>
                    <td className="order-memo-col"><OrderMemoIndicator order={o} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        </div>
      </div>
    )
  }

  return (
    <div className="panel">
      <h2 id="order-form">{editingId ? 'Edit Order / Invoice' : 'Create Order / Invoice'}</h2>
      {editingId && (
        <p className="hint">
          Editing invoice <strong>{data.orders.find(o => String(o.id) === String(editingId))?.invoice_no || '—'}</strong>
        </p>
      )}
      {editError && <p className="field-error order-edit-error">{editError}</p>}
      {!editingId && !readOnly && (
        <VoiceOrderPanel
          customers={data.customers}
          inventory={data.inventory}
          staffUsers={salesStaff}
          currentUserId={currentUserId}
          onApplyToForm={applyVoiceOrderToForm}
        />
      )}
      <div className="form-grid">
        <select value={f.customer_id} onChange={e => chooseCustomer(e.target.value)}>
          <option value="">Select Customer</option>
          {data.customers.map(c => <option key={c.id} value={c.id}>{c.company || c.name}</option>)}
        </select>
        <label className="order-field">
          Sales Person
          <select value={f.sales_person_id} onChange={e => setF({ ...f, sales_person_id: e.target.value })}>
            <option value="">Select Sales Person</option>
            {salesStaff.map(u => (
              <option key={u.id} value={u.id}>{staffSalesPersonLabel(u)}</option>
            ))}
          </select>
        </label>
      </div>

      {editingId && editingOrder && (
        <div className="form-section order-details-section">
          <h3>Order Details</h3>
          <div className="order-details-grid">
            <p><strong>Invoice #:</strong> {editingOrder.invoice_no || '—'}</p>
            <p><strong>Customer:</strong> {editingOrder.customer_name || '—'}</p>
            <p><strong>Sales Person:</strong> {
              f.sales_person_id
                ? staffSalesPersonLabel(salesStaff.find(u => String(u.id) === String(f.sales_person_id)))
                : orderSalesPersonDisplay(editingOrder, staffUsers)
            }</p>
            <p><strong>Status:</strong> {normalizeOrderStatus(editingOrder.status)}</p>
            <p><strong>Payment:</strong> {editingOrder.payment_status || '—'}</p>
          </div>
        </div>
      )}

      <div className="form-section order-lines-section">
        <h3>Product Lines</h3>
        {(f.lines || []).map((line, idx) => {
          const item = data.inventory.find(i => String(i.id) === String(line.inventory_id))
          const itemStock = inventoryStockView(item)
          const snap = editingId && editSnapshot?.lines
            ? editSnapshot.lines.find(s =>
              (line.id && String(s.id) === String(line.id))
              || String(s.inventory_id || '') === String(line.inventory_id || ''),
            )
            : null
          const lineAlloc = previewLineAllocation(line, item, snap)
          const lineCalc = totalsPreview.lines[idx] || calcOrderTotals([line], f, data.inventory).lines[0]
          return (
            <div key={line._clientKey || line.id || idx} className="order-line-card">
              <div className="form-grid order-line-grid order-line-row">
                <label>Product / SKU
                  <select value={line.inventory_id || ''} onChange={e => pickLineProduct(idx, e.target.value)}>
                    <option value="">Select Product</option>
                    {data.inventory.map(i => (
                      <option key={i.id} value={i.id}>{i.style}{i.brand ? ` · ${i.brand}` : ''}</option>
                    ))}
                  </select>
                </label>
                <label>Current Stock
                  <span className="order-line-readonly">{item ? itemStock.display : '—'}</span>
                </label>
                <label>Order Qty
                  <input type="number" min="1" value={line.qty} onChange={e => updateLine(idx, { qty: e.target.value })} />
                </label>
                <label>Unit Price
                  <input type="number" min="0" step="0.01" value={line.price} onChange={e => updateLine(idx, { price: e.target.value })} />
                </label>
                <label>Discount
                  <input type="number" min="0" step="0.01" value={line.discount} onChange={e => updateLine(idx, { discount: e.target.value })} />
                </label>
                <label>Line Total
                  <span className="order-line-readonly">{money(lineCalc?.line_total || 0)}</span>
                </label>
                <label>Profit
                  <span className="order-line-readonly">{money(lineCalc?.profit || 0)}</span>
                </label>
                <div className="order-line-actions">
                  <button type="button" className="danger soft" onClick={() => removeLine(idx)} disabled={(f.lines || []).length <= 1}>Remove</button>
                </div>
              </div>
              {item && Number(line.qty || 0) > 0 && (
                <div className="order-stock-preview order-line-allocation">
                  <p>Allocated Now: <strong>{lineAlloc.allocated_qty}</strong></p>
                  <p>Back Order: <strong>{lineAlloc.backorder_qty}</strong></p>
                  {itemStock.isNegative && (
                    <p className="field-error">Warning: stored qty is {itemStock.raw}. Use Repair Negative Inventory in Settings.</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
        <button type="button" className="soft" onClick={addLine}>+ Add Product Line</button>
      </div>

      {allocPreview.backorder_qty > 0 && !editingId && (
        <p className="field-error backorder-warning">
          {allocPreview.allocated_qty} unit{allocPreview.allocated_qty === 1 ? '' : 's'} allocated now.
          {' '}{allocPreview.backorder_qty} unit{allocPreview.backorder_qty === 1 ? '' : 's'} will be placed on Back Order.
        </p>
      )}

      <div className="order-totals-box">
        <p><strong>Subtotal:</strong> {money(totalsPreview.subtotal)}</p>
        <p><strong>Line Discounts:</strong> {money(totalsPreview.lineDiscountTotal)}</p>
        <p><strong>Shipping Charge:</strong> {money(totalsPreview.shipping)}</p>
        <p><strong>Tax:</strong> {money(totalsPreview.tax)}</p>
        <p className="order-grand-total-preview"><strong>Grand Total:</strong> {money(totalsPreview.grandTotal)}</p>
      </div>

      <div className="form-section order-memo-section">
        <h3>Order Memos</h3>
        <div className="order-memo-grid">
          <label className="order-field order-memo-field">
            Internal Memo
            <span className="hint-inline">Staff only — not shown on invoice</span>
            <textarea
              className="order-memo-textarea order-memo-internal"
              placeholder="Internal notes for staff only"
              value={f.internal_note}
              onChange={e => setF({ ...f, internal_note: e.target.value })}
              rows={4}
            />
          </label>
          <label className="order-field order-memo-field">
            Customer Note
            <span className="hint-inline">Shown on the customer invoice</span>
            <textarea
              className="order-memo-textarea order-memo-customer"
              placeholder="Message shown on the customer invoice"
              value={f.customer_note}
              onChange={e => setF({ ...f, customer_note: e.target.value })}
              rows={3}
            />
          </label>
        </div>
      </div>

      <div className="form-grid">
        <label className="order-field fulfillment-method-field" id="fulfillment-method-field">
          Fulfillment Method
          <select id="fulfillment-method-select" value={f.shipping_method} onChange={e => setF({ ...f, shipping_method: e.target.value })}>
            <option value="">Select Fulfillment Method</option>
            {FULFILLMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="order-field">
          Shipping Charge
          <input placeholder="Shipping Charge" type="number" min="0" step="0.01" value={f.shipping} onChange={e => setF({ ...f, shipping: e.target.value })} />
        </label>
        <label className="order-field">
          Invoice Discount
          <input placeholder="Invoice Discount" type="number" min="0" step="0.01" value={f.discount} onChange={e => setF({ ...f, discount: e.target.value })} />
        </label>
        <label className="order-field">
          Tax
          <input placeholder="Tax" type="number" min="0" step="0.01" value={f.tax} onChange={e => setF({ ...f, tax: e.target.value })} />
        </label>
        <label className="order-field">
          Order Date
          <input type="date" value={f.order_date} onChange={e => setF({ ...f, order_date: e.target.value })} />
        </label>
        <input type="date" placeholder="Due Date" value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })} />
        <select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>
          {ORDER_STATUSES.map(x => <option key={x}>{x}</option>)}
        </select>

        {(showCarrierFields || showDeliveryFields || showPickupFields) && (
          <div className="fulfillment-fields" id="fulfillment-fields">
            <h3>Fulfillment Details</h3>
            {showCarrierFields && (
              <>
                <OrderTrackingEditor
                  values={f.tracking_entries}
                  onChange={tracking_entries => setF({ ...f, tracking_entries })}
                  readOnly={readOnly}
                />
                <label className="order-field">
                  Fulfillment Date
                  <input type="date" value={f.fulfillment_date} onChange={e => setF({ ...f, fulfillment_date: e.target.value })} />
                </label>
              </>
            )}
            {showDeliveryFields && (
              <>
                <label className="order-field">
                  Delivery Date
                  <input type="date" value={f.fulfillment_date} onChange={e => setF({ ...f, fulfillment_date: e.target.value })} />
                </label>
                <label className="order-field">
                  Delivered By
                  <input placeholder="Delivered By" value={f.delivered_by} onChange={e => setF({ ...f, delivered_by: e.target.value })} />
                </label>
                <label className="order-field">
                  Delivery Note
                  <input placeholder="Delivery Note" value={f.fulfillment_note} onChange={e => setF({ ...f, fulfillment_note: e.target.value })} />
                </label>
                <label className="order-field">
                  Signature Name <span className="hint-inline">(optional)</span>
                  <input placeholder="Signature Name" value={f.signature_name} onChange={e => setF({ ...f, signature_name: e.target.value })} />
                </label>
              </>
            )}
            {showPickupFields && (
              <>
                <label className="order-field">
                  Pickup Date
                  <input type="date" value={f.fulfillment_date} onChange={e => setF({ ...f, fulfillment_date: e.target.value })} />
                </label>
                <label className="order-field">
                  Picked Up By
                  <input placeholder="Picked Up By" value={f.picked_up_by} onChange={e => setF({ ...f, picked_up_by: e.target.value })} />
                </label>
                <label className="order-field">
                  Pickup Note
                  <input placeholder="Pickup Note" value={f.fulfillment_note} onChange={e => setF({ ...f, fulfillment_note: e.target.value })} />
                </label>
                <label className="order-field">
                  Signature Name <span className="hint-inline">(optional)</span>
                  <input placeholder="Signature Name" value={f.signature_name} onChange={e => setF({ ...f, signature_name: e.target.value })} />
                </label>
              </>
            )}
            {!showCarrierFields && !showDeliveryFields && !showPickupFields && method && (
              <p className="hint">{dateFieldLabel} and {noteFieldLabel.toLowerCase()} available when a fulfillment method is selected.</p>
            )}
          </div>
        )}

        <div className="order-form-actions">
          <button type="button" onClick={handleSave}>{editingId ? 'Update Invoice' : 'Create Invoice'}</button>
          {editingId && <button type="button" className="soft" onClick={cancelEdit}>Cancel Edit</button>}
        </div>

      </div>
      {showBackorderConfirm && (
        <div className="restore-dialog-overlay" onClick={() => setShowBackorderConfirm(false)}>
          <div className="restore-dialog" onClick={e => e.stopPropagation()}>
            <p className="restore-dialog-text">
              {allocPreview.allocated_qty} unit{allocPreview.allocated_qty === 1 ? '' : 's'} allocated now.
              {' '}{allocPreview.backorder_qty} unit{allocPreview.backorder_qty === 1 ? '' : 's'} will be placed on Back Order.
            </p>
            <div className="restore-dialog-actions">
              <button type="button" className="soft" onClick={() => setShowBackorderConfirm(false)}>Cancel</button>
              <button type="button" onClick={confirmCreateWithBackorder}>Create Invoice with Back Order</button>
            </div>
          </div>
        </div>
      )}
      <div className="orders-list-section">
      <h2>Orders</h2>
      <div className="order-filters">
        {['All', ...ORDER_FILTER_STATUSES].map(s => (
          <button key={s} type="button" className={statusFilter === s ? 'filter-btn active' : 'filter-btn soft'} onClick={() => setStatusFilter(s)}>{filterLabel(s)}</button>
        ))}
      </div>
      <div className="order-filters order-sales-person-filter">
        <label>
          Sales Person
          <select value={salesPersonFilter} onChange={e => setSalesPersonFilter(e.target.value)}>
            <option value="All">All Sales People</option>
            <option value="None">Unassigned</option>
            {salesStaff.map(u => (
              <option key={u.id} value={u.id}>{staffSalesPersonLabel(u)}</option>
            ))}
          </select>
        </label>
      </div>
      <OrderMobileCards
        orders={filteredOrders}
        orderItems={data.order_items}
        staffUsers={staffUsers}
        readOnly={false}
        editingId={editingId}
        highlightId={highlightId}
        formatOrderDate={formatOrderDate}
        onEdit={loadOrderForEdit}
        onDelete={handleDeleteOrder}
        onInvoice={id => onNavigate?.('Invoice', id)}
      />
      <div className="table-wrap orders-table">
        <table>
          <thead>
            <tr>
              <th>Order Date</th>
              <th>Invoice No</th>
              <th>Customer Name</th>
              <th>Sales Person</th>
              <th>Product</th>
              <th>Qty</th>
              <th>Allocated</th>
              <th>Back Order</th>
              <th>Fulfillment Method</th>
              <th>Tracking / Handled By</th>
              <th>Status</th>
              <th>Payment Status</th>
              <th>Memo</th>
              <th>Edit</th>
              <th>Delete</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.map(o => {
              const ff = normalizeFulfillment(o, data.order_items)
              return (
              <tr
                key={o.id}
                id={`order-row-${o.id}`}
                className={String(highlightId) === String(o.id) || String(editingId) === String(o.id) ? 'sel' : ''}
              >
                <td>{formatOrderDate(o)}</td>
                <td>{o.invoice_no || '—'}</td>
                <td>{o.customer_name || '—'}</td>
                <td>{orderSalesPersonDisplay(o, staffUsers)}</td>
                <td>{orderDisplayProduct(o, data.order_items)}</td>
                <td>{ff.qty}</td>
                <td>{ff.allocated_qty}</td>
                <td>{ff.backorder_qty > 0 ? <span className="backorder-badge">{ff.backorder_qty}</span> : ff.backorder_qty}</td>
                <td>{o.shipping_method || '—'}</td>
                <td>{fulfillmentHandledBy(o)}</td>
                <td><OrderStatusBadge status={o.status} backorderQty={ff.backorder_qty} /></td>
                <td>{o.payment_status || '—'}</td>
                <td className="order-memo-col"><OrderMemoIndicator order={o} /></td>
                <td className="row-actions">
                  {isVoidOrder(o) ? '—' : (
                    <button type="button" className="soft" onClick={() => loadOrderForEdit(o)}>Edit</button>
                  )}
                </td>
                <td className="row-actions">
                  <button type="button" className="danger" onClick={() => handleDeleteOrder(o.id)}>Delete</button>
                </td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>
      </div>
    </div>
  )
}

function VoidInvoiceModal({ order, paid, restoreQty, onCancel, onConfirm }) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const needsNote = reason === 'Other'
  const canConfirm = reason && (!needsNote || note.trim()) && confirmText === VOID_CONFIRM_TEXT && !busy

  async function handleConfirm() {
    if (!canConfirm) return
    setBusy(true)
    setError('')
    const result = await onConfirm({ reason, note: needsNote ? note.trim() : note.trim() })
    setBusy(false)
    if (result?.error) setError(result.error)
  }

  return (
    <div className="restore-dialog-overlay void-modal-overlay" onClick={onCancel}>
      <div className="restore-dialog void-modal" onClick={e => e.stopPropagation()}>
        <h2>Void Invoice {order.invoice_no || '—'}?</h2>
        <p className="void-modal-intro">This action will:</p>
        <ul className="void-modal-list">
          <li>Restore allocated inventory ({restoreQty} unit{restoreQty === 1 ? '' : 's'})</li>
          <li>Cancel remaining back-order quantity</li>
          <li>Mark the invoice as VOID</li>
          <li>Preserve the invoice number and full history</li>
          <li>Preserve payment records for audit purposes</li>
        </ul>
        {paid > 0 && (
          <p className="field-error void-modal-warn">
            This invoice has recorded payments. Voiding the invoice does not issue a refund or remove payment history.
          </p>
        )}
        <label className="void-field">
          Void Reason <span className="req">*</span>
          <select value={reason} onChange={e => setReason(e.target.value)}>
            <option value="">Select reason</option>
            {VOID_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        {needsNote && (
          <label className="void-field">
            Explanation <span className="req">*</span>
            <textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Explain why this invoice is being voided" />
          </label>
        )}
        <label className="void-field">
          Type {VOID_CONFIRM_TEXT} to confirm
          <input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder={VOID_CONFIRM_TEXT} autoComplete="off" />
        </label>
        {error && <p className="field-error">{error}</p>}
        <div className="restore-dialog-actions">
          <button type="button" className="soft" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="danger void-confirm-btn" onClick={handleConfirm} disabled={!canConfirm}>
            Confirm VOID
          </button>
        </div>
      </div>
    </div>
  )
}

function Invoice({ data, staffUsers, updateRow, saveOrderTrackingNumbers, reloadData, voidInvoice, role, profile, selectedOrderId, clearSelection }) {
  const [id, setId] = useState('')
  const [highlightId, setHighlightId] = useState('')
  const [invoiceFilter, setInvoiceFilter] = useState('All')
  const [showVoidModal, setShowVoidModal] = useState(false)
  const [showTrackingModal, setShowTrackingModal] = useState(false)
  const [trackingDraft, setTrackingDraft] = useState([blankTrackingRow()])
  const [trackingError, setTrackingError] = useState('')
  const [trackingBusy, setTrackingBusy] = useState(false)
  const isAdmin = (role || 'Admin') === 'Admin'

  useEffect(() => {
    if (!selectedOrderId) return
    setId(selectedOrderId)
    setHighlightId(selectedOrderId)
    clearSelection?.()
    requestAnimationFrame(() => {
      document.getElementById('invoice-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [selectedOrderId, clearSelection])

  const filteredOrderList = data.orders.filter(o => {
    if (invoiceFilter === 'Void') return isVoidOrder(o)
    if (invoiceFilter === 'Active') return !isVoidOrder(o)
    return true
  })

  const o = filteredOrderList.find(x => String(x.id) === String(id))
    || data.orders.find(x => String(x.id) === String(id))
    || filteredOrderList[0]
    || data.orders[0]

  const c = data.customers.find(x => String(x.id) === String(o?.customer_id))
  if (!o) return <div className="panel">No invoice yet. Create an order first.</div>

  const paid = orderPaidTotal(data.payments, o)
  const due = Number(o.total || 0) - paid
  const voided = isVoidOrder(o)
  const fulfillmentStatus = voided ? 'Void' : normalizeOrderStatus(o.status)
  const paymentDisplay = voided ? (o.payment_status || (paid > 0 ? 'VOID — Payment Recorded' : 'VOID')) : o.payment_status
  const invoiceLines = itemsForOrder(o, data.order_items)
  const subtotal = invoiceLines.reduce((s, line) => s + Number(line.qty || 0) * Number(line.price || 0), 0)
  const lineDiscountTotal = invoiceLines.reduce((s, line) => s + Number(line.discount || 0), 0)
  const shippingCharge = Number(o.shipping || 0)
  const headerDiscount = Number(o.discount || 0)
  const tax = Number(o.tax || 0)
  const discountTotal = lineDiscountTotal + headerDiscount
  const restoreQty = voidRestoreQty(o, data.order_items)
  const method = o.shipping_method || ''
  const trackingEntries = trackingEntriesForOrder(data.order_tracking_numbers, o.id, o.tracking)
  const shipmentStatus = shipmentStatusLabel(o, trackingEntries)
  const showShipmentSection = !voided && (isCarrierMethod(method) || trackingEntries.length > 0)
  const customerNote = orderCustomerNote(o)
  const company = c?.company || o.customer_name || ''
  const contact = c?.name && c.name !== company ? c.name : ''
  const billLines = addressLines(c?.billing_address || c?.address)
  const shipLines = addressLines(c?.shipping_address || c?.billing_address || c?.address)

  function handleVoidClick() {
    setShowVoidModal(true)
  }

  function openTrackingModal() {
    setTrackingDraft(trackingEntriesToFormValues(data.order_tracking_numbers, o.id, o.tracking))
    setTrackingError('')
    setShowTrackingModal(true)
  }

  async function handleSaveTracking() {
    if (!o?.id || trackingBusy) return
    setTrackingBusy(true)
    setTrackingError('')
    const result = await saveOrderTrackingNumbers(o.id, trackingDraft)
    setTrackingBusy(false)
    if (result.error) {
      setTrackingError(result.error)
      return
    }
    if (hasSupabaseConfig) await reloadData?.()
    setShowTrackingModal(false)
  }

  return (
    <div className="panel" id="invoice-panel">
      <div className="invoice-toolbar no-print">
        <select
          className={String(highlightId) === String(id || o.id) ? 'sel' : ''}
          value={id || o.id}
          onChange={e => { setId(e.target.value); setHighlightId('') }}
        >
          {filteredOrderList.map(o2 => (
            <option key={o2.id} value={o2.id}>
              {o2.invoice_no} — {o2.customer_name}{isVoidOrder(o2) ? ' (VOID)' : ''}
            </option>
          ))}
        </select>
        <div className="invoice-filter-btns">
          {['All', 'Active', 'Void'].map(f => (
            <button key={f} type="button" className={`soft filter-btn${invoiceFilter === f ? ' active' : ''}`} onClick={() => setInvoiceFilter(f)}>
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className={`invoice invoice-print invoice-void-wrap${voided ? ' invoice-is-void' : ''}${String(highlightId) === String(o.id) ? ' invoice-highlight' : ''}`}>
        {voided && (
          <div className="invoice-void-watermark" aria-hidden="true"><span>VOID</span></div>
        )}
        <div className="invoice-header">
          <div className="invoice-brand">
            <img src={COMPANY_LOGO_SRC} alt="Inner Source Beauty" className="invoice-logo" />
            <div className="invoice-company-contact">
              <span>11511 GARVEY AVE</span>
              <span>EL MONTE CA 91732</span>
              <span>714-249-5678</span>
              <a href="https://innersourcebeauty.com">https://innersourcebeauty.com</a>
            </div>
          </div>
          <div className="invoice-meta">
            <h2>INVOICE</h2>
            <p><b>Invoice #:</b> {o.invoice_no}<br />
              <b>Date:</b> {formatDisplayDate(o.order_date || o.created_at)}<br />
              <b>Sales Person:</b> {orderSalesPersonDisplay(o, staffUsers)}<br />
              <b>Due Date:</b> {formatDisplayDate(o.due_date || calcDueDate(c?.payment_terms, o.order_date || o.created_at))}<br />
              <b>Payment Status:</b> <span className={voided ? 'void-text' : ''}>{paymentDisplay}</span><br />
              <b>Fulfillment Status:</b> <span className={voided ? 'void-text' : ''}>{fulfillmentStatus}</span><br />
              {!voided && (
                <>
                  <b>Fulfillment Method:</b> {o.shipping_method || '—'}<br />
                </>
              )}
              {voided && (
                <>
                  <b className="void-text">Status:</b> <span className="void-text">VOID</span><br />
                  <b>Void Date:</b> {formatVoidDate(o.voided_at)}<br />
                  <b>Void Reason:</b> {o.void_reason || '—'}<br />
                  <b>Voided By:</b> {o.voided_by || '—'}<br />
                  {o.void_note && <><b>Void Note:</b> {o.void_note}<br /></>}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="address-grid">
          <div className="bill-to">
            <h3>BILL TO</h3>
            <div className="invoice-address">
              {company && <span className="invoice-address-line">{company}</span>}
              {contact && <span className="invoice-address-line">{contact}</span>}
              {billLines.map((line, i) => <span key={i} className="invoice-address-line">{line}</span>)}
            </div>
          </div>
          <div className="address-spacer" aria-hidden="true" />
          <div className="ship-to">
            <h3>SHIP TO</h3>
            <div className="invoice-address">
              {company && <span className="invoice-address-line">{company}</span>}
              {shipLines.map((line, i) => <span key={i} className="invoice-address-line">{line}</span>)}
            </div>
          </div>
        </div>
        <div className="invoice-block invoice-terms-block">
          <h3>Terms</h3>
          <p>{c?.payment_terms || 'COD'}<br />Preferred: {c?.preferred_payment || '—'}</p>
        </div>
        <table className="invoice-table">
          <thead><tr><th>Style</th><th>Qty</th><th>Unit Price</th><th>Discount</th><th>Line Total</th></tr></thead>
          <tbody>
            {invoiceLines.map((line, idx) => (
              <tr key={line.id || idx}>
                <td>{line.style || '—'}</td>
                <td>{line.qty}</td>
                <td>{money(line.price)}</td>
                <td>{money(line.discount || 0)}</td>
                <td>{money(line.line_total ?? (Number(line.qty || 0) * Number(line.price || 0) - Number(line.discount || 0)))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="invoice-totals">
          <p><b>Subtotal:</b> {money(subtotal)}</p>
          <p><b>Discount:</b> {money(discountTotal)}</p>
          <p><b>Shipping Charge:</b> {money(shippingCharge)}</p>
          <p><b>Tax:</b> {money(tax)}</p>
          <p className="invoice-grand-total"><b>Grand Total:</b> {money(o.total)}</p>
          <p><b>Amount Paid:</b> {money(paid)}</p>
          {!voided && <p className="balance-due"><b>Balance Due:</b> {money(due)}</p>}
        </div>
        {customerNote && (
          <div className="invoice-block invoice-customer-note-block">
            <h3>Customer Note</h3>
            <p className="invoice-customer-note">{customerNote}</p>
          </div>
        )}
        {trackingEntries.length > 0 && (
          <div className="invoice-shipment-section invoice-shipment-print-wrap">
            <div className="invoice-shipment-print">
              <h3 className="invoice-shipment-print-title">TRACKING</h3>
              <div className="invoice-tracking-list">
                {trackingEntries.map((entry, idx) => (
                  <p key={`print-${entry.tracking_number}-${idx}`} className="invoice-tracking-line">
                    {formatTrackingPrintLine(entry)}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}
        {showShipmentSection && (
          <div className="invoice-shipment-section invoice-shipment-screen no-print">
            <h3>Shipment</h3>
            {trackingEntries.length === 0 ? (
              <>
                <p className="invoice-shipment-meta"><b>Tracking:</b> None</p>
                <button type="button" className="soft invoice-shipment-btn" onClick={openTrackingModal}>Add Tracking</button>
              </>
            ) : (
              <>
                <p className="invoice-shipment-meta"><b>Status:</b> {shipmentStatus}</p>
                <div className="invoice-shipment-lines">
                  {trackingEntries.map((entry, idx) => (
                    <p key={`screen-${entry.tracking_number}-${idx}`} className="invoice-shipment-line">
                      {formatTrackingScreenLine(entry)}
                    </p>
                  ))}
                </div>
                <button type="button" className="soft invoice-shipment-btn" onClick={openTrackingModal}>Manage Tracking</button>
              </>
            )}
          </div>
        )}
        <p className="terms">ALL RETURNS ARE STORE CREDIT ONLY. RETURNS MUST BE DONE WITHIN 10 BUSINESS DAYS. 20% RESTOCKING FEE MAY APPLY. SHIPPING AND HANDLING ARE NOT REFUNDABLE BOTH WAYS.</p>
        <div className="signature-line">
          <div className="sig-box"><div className="sig-line" /><p>Authorized Signature</p></div>
          <div className="sig-box"><div className="sig-line" /><p>Date</p></div>
        </div>
        <div className="invoice-actions no-print">
          <button type="button" onClick={() => window.print()}>Print / Save PDF</button>
          {isAdmin && !voided && (
            <button type="button" className="danger void-invoice-btn" onClick={handleVoidClick}>VOID INVOICE</button>
          )}
        </div>
      </div>
      {showTrackingModal && (
        <ManageTrackingModal
          draft={trackingDraft}
          onChange={setTrackingDraft}
          onSave={handleSaveTracking}
          onCancel={() => { setShowTrackingModal(false); setTrackingError('') }}
          busy={trackingBusy}
          error={trackingError}
        />
      )}
      {showVoidModal && (
        <VoidInvoiceModal
          order={o}
          paid={paid}
          restoreQty={restoreQty}
          onCancel={() => setShowVoidModal(false)}
          onConfirm={async (form) => {
            const result = await voidInvoice(o.id, form)
            if (!result?.error) setShowVoidModal(false)
            return result
          }}
        />
      )}
    </div>
  )
}

function OpenInvoiceMobileCards({ invoices, orderCustomerName, paymentBadgeClass, onNavigate, onReceivePayment }) {
  return (
    <div className="open-invoice-cards">
      {invoices.map(o => (
        <article key={o.id} className="open-invoice-card">
          <p className="open-invoice-customer">
            {o.customer_id ? (
              <button
                type="button"
                className="link-cell"
                onClick={() => onNavigate('Customers', o.customer_id)}
              >
                {orderCustomerName(o)}
              </button>
            ) : orderCustomerName(o)}
          </p>
          <p className="open-invoice-no">
            <button
              type="button"
              className="link-cell"
              onClick={() => onNavigate('Invoice', o.id)}
            >
              {o.invoice_no || '—'}
            </button>
          </p>
          <p className="open-invoice-date">{o.invoice_date}</p>
          <dl className="open-invoice-meta">
            <div className="open-invoice-row">
              <dt>Total</dt>
              <dd>{money(o.total)}</dd>
            </div>
            <div className="open-invoice-row">
              <dt>Paid</dt>
              <dd>{money(o.paid)}</dd>
            </div>
            <div className="open-invoice-row">
              <dt>Balance</dt>
              <dd>{money(o.balance)}</dd>
            </div>
            <div className="open-invoice-row">
              <dt>Status</dt>
              <dd>
                <span className={`status-badge ${paymentBadgeClass(o.payment_status)}`}>
                  {o.payment_status}
                </span>
              </dd>
            </div>
          </dl>
          <button type="button" className="open-invoice-receive-btn" onClick={() => onReceivePayment(o)}>
            Receive Payment
          </button>
        </article>
      ))}
    </div>
  )
}

function ReceiveInvoiceMobileCards({
  invoices, selectedIds, applyAmounts, paymentBadgeClass, toggleInvoice, updateApplyAmount,
}) {
  return (
    <div className="receive-invoice-cards">
      {invoices.map(o => {
        const selected = selectedIds.includes(String(o.id))
        return (
          <article key={o.id} className={`receive-invoice-card${selected ? ' sel' : ''}`}>
            <label className="receive-invoice-select">
              <input
                type="checkbox"
                checked={selected}
                onChange={e => toggleInvoice(o.id, e.target.checked)}
              />
              <span>Select invoice {o.invoice_no || '—'}</span>
            </label>
            <dl className="receive-invoice-meta">
              <div className="receive-invoice-row">
                <dt>Invoice Date</dt>
                <dd>{o.invoice_date}</dd>
              </div>
              <div className="receive-invoice-row">
                <dt>Original Total</dt>
                <dd>{money(o.total)}</dd>
              </div>
              <div className="receive-invoice-row">
                <dt>Amount Paid</dt>
                <dd>{money(o.paid)}</dd>
              </div>
              <div className="receive-invoice-row">
                <dt>Balance Due</dt>
                <dd>{money(o.balance)}</dd>
              </div>
              <div className="receive-invoice-row">
                <dt>Status</dt>
                <dd>
                  <span className={`status-badge ${paymentBadgeClass(o.payment_status)}`}>
                    {o.payment_status}
                  </span>
                </dd>
              </div>
            </dl>
            <label className="receive-invoice-apply">
              Apply Amount
              <input
                type="number"
                min="0"
                step="0.01"
                max={o.balance}
                disabled={!selected}
                value={selected ? (applyAmounts[o.id] ?? '') : ''}
                onChange={e => updateApplyAmount(o.id, e.target.value)}
                className="apply-amount-input"
              />
            </label>
          </article>
        )
      })}
    </div>
  )
}

function PaymentHistoryMobileCards({ rows, highlightId, onDelete }) {
  return (
    <div className="payment-history-cards">
      {rows.map(p => (
        <article
          key={p.id}
          id={`payment-card-${p.id}`}
          className={`payment-history-card${String(highlightId) === String(p.id) ? ' sel' : ''}`}
        >
          <p className="payment-history-date">{formatDisplayDate(p.payment_date)}</p>
          <p className="payment-history-customer">{p.customer_name || '—'}</p>
          <dl className="payment-history-meta">
            <div className="payment-history-row">
              <dt>Invoice</dt>
              <dd>{p.invoice_no || '—'}</dd>
            </div>
            <div className="payment-history-row">
              <dt>Amount</dt>
              <dd>{money(p.amount)}</dd>
            </div>
            <div className="payment-history-row">
              <dt>Method</dt>
              <dd>{p.method || '—'}</dd>
            </div>
            <div className="payment-history-row">
              <dt>Reference</dt>
              <dd>{p.reference_no || '—'}</dd>
            </div>
            {p.note ? (
              <div className="payment-history-row">
                <dt>Note</dt>
                <dd>{p.note}</dd>
              </div>
            ) : null}
          </dl>
          {onDelete && (
            <button type="button" className="danger payment-history-delete" onClick={() => onDelete(p.id)}>
              Delete
            </button>
          )}
        </article>
      ))}
      {rows.length === 0 && <p className="payment-history-empty">No payment records found.</p>}
    </div>
  )
}

function Payments({ data, recordMultiPayment, deleteRow, onNavigate, selectedPaymentId, clearSelection }) {
  const receiveBlank = {
    customer_id: '', payment_date: today(), total_amount: '', method: 'Zelle', reference_no: '', note: '',
  }
  const [receive, setReceive] = useState(receiveBlank)
  const [selectedIds, setSelectedIds] = useState([])
  const [applyAmounts, setApplyAmounts] = useState({})
  const [receiveError, setReceiveError] = useState('')
  const [highlightId, setHighlightId] = useState('')
  const [invoiceFilter, setInvoiceFilter] = useState('All')

  function orderCustomerName(order) {
    if (order?.customer_name) return order.customer_name
    const customer = data.customers.find(c => String(c.id) === String(order?.customer_id))
    return customer?.company || customer?.name || '—'
  }

  function paymentCustomerName(payment) {
    const order = data.orders.find(o =>
      String(o.id) === String(payment.order_id) || o.invoice_no === payment.invoice_no
    )
    if (order) return orderCustomerName(order)
    const customer = data.customers.find(c => String(c.id) === String(payment.customer_id))
    return customer?.company || customer?.name || '—'
  }

  function orderPaidAmount(order) {
    return data.payments
      .filter(p => String(p.order_id) === String(order.id) || p.invoice_no === order.invoice_no)
      .reduce((s, p) => s + Number(p.amount || 0), 0)
  }

  function resolvePaymentStatus(order, paid) {
    if (isVoidOrder(order)) return order.payment_status || (paid > 0 ? 'VOID — Payment Recorded' : 'VOID')
    const total = Number(order.total || 0)
    const stored = order.payment_status || ''
    if (stored === 'Paid' || stored === 'Partial' || stored === 'Unpaid') return stored
    if (paid <= 0) return 'Unpaid'
    if (paid >= total) return 'Paid'
    return 'Partial'
  }

  const formatInvoiceDate = order => formatDisplayDate(order.order_date || order.created_at)

  const formatDueDate = order => formatDisplayDate(
    order.due_date || calcDueDate(
      data.customers.find(c => String(c.id) === String(order.customer_id))?.payment_terms,
      order.order_date || order.created_at,
    ),
  )

  function paymentBadgeClass(status) {
    if (String(status || '').startsWith('VOID')) return 'payment-status-void'
    if (status === 'Paid') return 'payment-status-paid'
    if (status === 'Partial') return 'payment-status-partial'
    return 'payment-status-unpaid'
  }

  function invoiceSortDueKey(order) {
    const raw = order.due_date || calcDueDate(
      data.customers.find(c => String(c.id) === String(order.customer_id))?.payment_terms,
      order.created_at
    )
    if (!raw) return '9999-99-99'
    return /^\d{4}-\d{2}-\d{2}$/.test(String(raw)) ? String(raw) : localDateKey(raw)
  }

  function invoiceSortDateKey(order) {
    return localDateKey(order.order_date || order.created_at) || '9999-99-99'
  }

  function comparePayableInvoices(a, b) {
    const byDue = invoiceSortDueKey(a).localeCompare(invoiceSortDueKey(b))
    if (byDue !== 0) return byDue
    return invoiceSortDateKey(a).localeCompare(invoiceSortDateKey(b))
  }

  const invoiceRows = data.orders.map(order => {
    const paid = orderPaidAmount(order)
    const total = Number(order.total || 0)
    const balance = Math.max(total - paid, 0)
    const payment_status = resolvePaymentStatus(order, paid)
    return {
      ...order,
      customer_name: orderCustomerName(order),
      invoice_date: formatInvoiceDate(order),
      paid,
      balance,
      payment_status,
      due_date_display: formatDueDate(order),
    }
  })

  const unpaidCount = invoiceRows.filter(o => o.payment_status === 'Unpaid').length
  const partialCount = invoiceRows.filter(o => o.payment_status === 'Partial').length
  const paidCount = invoiceRows.filter(o => o.payment_status === 'Paid').length
  const totalOpenBalance = invoiceRows
    .filter(o => !isVoidOrder(o) && (o.payment_status === 'Unpaid' || o.payment_status === 'Partial'))
    .reduce((s, o) => s + o.balance, 0)

  const openInvoices = invoiceRows.filter(o => {
    if (invoiceFilter === 'Void') return isVoidOrder(o)
    if (isVoidOrder(o)) return false
    if (invoiceFilter === 'Unpaid') return o.payment_status === 'Unpaid'
    if (invoiceFilter === 'Partial') return o.payment_status === 'Partial'
    if (invoiceFilter === 'Paid') return o.payment_status === 'Paid'
    if (invoiceFilter === 'All') return true
    return o.payment_status === 'Unpaid' || o.payment_status === 'Partial'
  })

  const customerOpenInvoices = receive.customer_id
    ? invoiceRows
      .filter(o =>
        !isVoidOrder(o)
        && String(o.customer_id) === String(receive.customer_id)
        && o.balance > 0
        && (o.payment_status === 'Unpaid' || o.payment_status === 'Partial')
      )
      .sort(comparePayableInvoices)
    : []

  const customerPayments = receive.customer_id
    ? (() => {
      const customerOrders = data.orders.filter(o => String(o.customer_id) === String(receive.customer_id))
      const orderIds = new Set(customerOrders.map(o => String(o.id)))
      const invoiceNos = new Set(customerOrders.map(o => o.invoice_no).filter(Boolean))
      return data.payments.filter(p =>
        String(p.customer_id) === String(receive.customer_id)
        || orderIds.has(String(p.order_id))
        || (p.invoice_no && invoiceNos.has(p.invoice_no))
      )
    })()
    : []

  const customerSummary = {
    openBalance: customerOpenInvoices.reduce((s, o) => s + o.balance, 0),
    openCount: customerOpenInvoices.length,
    oldestInvoice: customerOpenInvoices.length
      ? customerOpenInvoices.reduce((min, o) => {
        const key = invoiceSortDateKey(o)
        return key < min ? key : min
      }, '9999-99-99')
      : '',
    lastPayment: customerPayments.length
      ? customerPayments.reduce((latest, p) => {
        const key = localDateKey(p.payment_date)
        return key > latest ? key : latest
      }, '')
      : '',
  }

  const selectedBalanceTotal = selectedIds.reduce((s, id) => {
    const row = customerOpenInvoices.find(o => String(o.id) === String(id))
    return s + (row?.balance || 0)
  }, 0)

  const totalApplied = selectedIds.reduce((s, id) => s + Number(applyAmounts[id] || 0), 0)
  const totalPaymentAmount = Number(receive.total_amount || 0)
  const remainingUnapplied = totalPaymentAmount - totalApplied

  function resetReceiveSelection() {
    setSelectedIds([])
    setApplyAmounts({})
    setReceiveError('')
  }

  function selectCustomer(id) {
    setReceive({ ...receiveBlank, customer_id: id, payment_date: today(), method: receive.method || 'Zelle' })
    resetReceiveSelection()
  }

  function toggleInvoice(id, checked) {
    const row = customerOpenInvoices.find(o => String(o.id) === String(id))
    if (!row) return
    if (checked) {
      setSelectedIds(prev => [...prev.filter(x => String(x) !== String(id)), String(id)])
      setApplyAmounts(prev => ({ ...prev, [id]: String(row.balance) }))
    } else {
      setSelectedIds(prev => prev.filter(x => String(x) !== String(id)))
      setApplyAmounts(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
    setReceiveError('')
  }

  function updateApplyAmount(id, value) {
    setApplyAmounts(prev => ({ ...prev, [id]: value }))
    setReceiveError('')
  }

  function autoApplyPayment() {
    const payment = Number(receive.total_amount || 0)
    if (payment <= 0) {
      setReceiveError('Enter a Total Payment Amount before using Auto Apply.')
      return
    }
    let remaining = payment
    const sorted = customerOpenInvoices.filter(o => selectedIds.includes(String(o.id)))
    const next = { ...applyAmounts }
    for (const inv of sorted) {
      if (remaining <= 0) {
        next[inv.id] = '0'
        continue
      }
      const apply = Math.min(remaining, inv.balance)
      next[inv.id] = String(Number(apply.toFixed(2)))
      remaining -= apply
    }
    setApplyAmounts(next)
    setReceiveError('')
  }

  function validateReceivePayment() {
    if (!receive.customer_id) return 'Select a customer.'
    if (totalPaymentAmount <= 0) return 'Total Payment Amount must be greater than zero.'
    if (!selectedIds.length) return 'Select at least one invoice.'
    const active = selectedIds.filter(id => Number(applyAmounts[id] || 0) > 0)
    if (!active.length) return 'Apply at least one payment amount.'
    if (totalApplied > totalPaymentAmount + 0.001) {
      return 'Sum of Apply Amounts cannot exceed Total Payment Amount.'
    }
    for (const id of selectedIds) {
      const row = customerOpenInvoices.find(o => String(o.id) === String(id))
      const apply = Number(applyAmounts[id] || 0)
      if (apply < 0) return `Apply Amount for ${row?.invoice_no || 'invoice'} cannot be negative.`
      if (row && apply > row.balance + 0.001) {
        return `Apply Amount for ${row.invoice_no || 'invoice'} cannot exceed balance of ${money(row.balance)}.`
      }
    }
    return ''
  }

  async function saveReceivePayment() {
    const err = validateReceivePayment()
    if (err) {
      setReceiveError(err)
      return
    }
    const allocations = selectedIds
      .map(id => {
        const row = customerOpenInvoices.find(o => String(o.id) === String(id))
        return {
          order_id: id,
          invoice_no: row?.invoice_no || '',
          amount: Number(applyAmounts[id] || 0),
        }
      })
      .filter(a => a.amount > 0)
    const result = await recordMultiPayment({
      customer_id: receive.customer_id,
      payment_date: receive.payment_date,
      method: receive.method,
      reference_no: receive.reference_no,
      note: receive.note,
      allocations,
    })
    if (result?.error) {
      setReceiveError(result.error)
      return
    }
    setReceive(receiveBlank)
    resetReceiveSelection()
  }

  const paymentRows = data.payments.map(p => ({ ...p, customer_name: paymentCustomerName(p) }))

  useEffect(() => {
    if (!selectedPaymentId) return
    setHighlightId(selectedPaymentId)
    const payment = data.payments.find(p => String(p.id) === String(selectedPaymentId))
    if (payment?.customer_id) {
      setReceive({ ...receiveBlank, customer_id: payment.customer_id, payment_date: payment.payment_date || today(), method: payment.method || 'Zelle' })
      resetReceiveSelection()
    }
    clearSelection?.()
    requestAnimationFrame(() => {
      document.getElementById(`payment-row-${selectedPaymentId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      document.getElementById(`payment-card-${selectedPaymentId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [selectedPaymentId, clearSelection, data.payments])

  function pickOpenInvoice(order) {
    setReceive({
      ...receiveBlank,
      customer_id: order.customer_id || '',
      payment_date: today(),
      total_amount: String(order.balance || ''),
      method: 'Zelle',
    })
    setSelectedIds([String(order.id)])
    setApplyAmounts({ [order.id]: String(order.balance) })
    setReceiveError('')
    document.getElementById('receive-payment-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function formatSummaryDate(key) {
    if (!key || key === '9999-99-99') return '—'
    const [y, m, d] = key.split('-')
    return `${m}/${d}/${y}`
  }

  return (
    <div className="payment-page">
      <div className="panel">
        <h2>Payment Status Summary</h2>
        <div className="cards dashboard-row">
          <Card t="Unpaid Invoices" v={unpaidCount} cls={unpaidCount > 0 ? 'card-warn' : ''} />
          <Card t="Partial Invoices" v={partialCount} cls={partialCount > 0 ? 'card-warn' : ''} />
          <Card t="Paid Invoices" v={paidCount} />
          <Card t="Total Open Balance" v={money(totalOpenBalance)} cls={totalOpenBalance > 0 ? 'card-warn' : ''} />
        </div>
        <div className="payment-filters">
          {['All', 'Unpaid', 'Partial', 'Paid', 'Void'].map(label => (
            <button
              key={label}
              type="button"
              className={invoiceFilter === label ? 'active' : ''}
              onClick={() => setInvoiceFilter(label)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>Open Invoices</h2>
        {openInvoices.length === 0 ? (
          <p className="hint">No invoices match this filter.</p>
        ) : (
          <>
          <OpenInvoiceMobileCards
            invoices={openInvoices}
            orderCustomerName={orderCustomerName}
            paymentBadgeClass={paymentBadgeClass}
            onNavigate={onNavigate}
            onReceivePayment={pickOpenInvoice}
          />
          <div className="table-wrap open-invoices-table">
            <table>
              <thead>
                <tr>
                  <th>Customer Name</th>
                  <th>Invoice No</th>
                  <th>Invoice Date</th>
                  <th>Total</th>
                  <th>Paid</th>
                  <th>Balance Due</th>
                  <th>Payment Status</th>
                  <th>Due Date</th>
                </tr>
              </thead>
              <tbody>
                {openInvoices.map(o => (
                  <tr key={o.id} onClick={() => pickOpenInvoice(o)}>
                    <td>
                      {o.customer_id ? (
                        <button
                          type="button"
                          className="link-cell"
                          onClick={e => { e.stopPropagation(); onNavigate('Customers', o.customer_id) }}
                        >
                          {orderCustomerName(o)}
                        </button>
                      ) : orderCustomerName(o)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="link-cell"
                        onClick={e => { e.stopPropagation(); onNavigate('Invoice', o.id) }}
                      >
                        {o.invoice_no || '—'}
                      </button>
                    </td>
                    <td>{o.invoice_date}</td>
                    <td>{money(o.total)}</td>
                    <td>{money(o.paid)}</td>
                    <td>{money(o.balance)}</td>
                    <td>
                      <span className={`status-badge ${paymentBadgeClass(o.payment_status)}`}>
                        {o.payment_status}
                      </span>
                    </td>
                    <td>{o.due_date_display}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      <div className="panel" id="receive-payment-form">
        <h2>Receive Payment</h2>
        <div className="form-grid payment-form">
          <select value={receive.customer_id} onChange={e => selectCustomer(e.target.value)}>
            <option value="">Select Customer</option>
            {data.customers.map(c => (
              <option key={c.id} value={c.id}>{c.company || c.name}</option>
            ))}
          </select>
        </div>

        {receive.customer_id && (
          <>
            <div className="mini-cards receive-summary">
              <Card t="Open Balance" v={money(customerSummary.openBalance)} cls={customerSummary.openBalance > 0 ? 'card-warn' : ''} />
              <Card t="Open Invoices" v={customerSummary.openCount} />
              <Card t="Oldest Invoice" v={formatSummaryDate(customerSummary.oldestInvoice)} />
              <Card t="Last Payment" v={formatSummaryDate(customerSummary.lastPayment)} />
            </div>

            {customerOpenInvoices.length === 0 ? (
              <p className="hint">No open invoices for this customer.</p>
            ) : (
              <>
              <ReceiveInvoiceMobileCards
                invoices={customerOpenInvoices}
                selectedIds={selectedIds}
                applyAmounts={applyAmounts}
                paymentBadgeClass={paymentBadgeClass}
                toggleInvoice={toggleInvoice}
                updateApplyAmount={updateApplyAmount}
              />
              <div className="table-wrap receive-invoices-table">
                <table>
                  <thead>
                    <tr>
                      <th>Select</th>
                      <th>Invoice Date</th>
                      <th>Invoice No</th>
                      <th>Original Total</th>
                      <th>Amount Paid</th>
                      <th>Balance Due</th>
                      <th>Apply Amount</th>
                      <th>Payment Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerOpenInvoices.map(o => {
                      const selected = selectedIds.includes(String(o.id))
                      return (
                        <tr key={o.id} className={selected ? 'sel' : ''}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={e => toggleInvoice(o.id, e.target.checked)}
                            />
                          </td>
                          <td>{o.invoice_date}</td>
                          <td>{o.invoice_no || '—'}</td>
                          <td>{money(o.total)}</td>
                          <td>{money(o.paid)}</td>
                          <td>{money(o.balance)}</td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              max={o.balance}
                              disabled={!selected}
                              value={selected ? (applyAmounts[o.id] ?? '') : ''}
                              onChange={e => updateApplyAmount(o.id, e.target.value)}
                              className="apply-amount-input"
                            />
                          </td>
                          <td>
                            <span className={`status-badge ${paymentBadgeClass(o.payment_status)}`}>
                              {o.payment_status}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              </>
            )}

            <div className="receive-totals">
              <p><b>Selected Balance Total:</b> {money(selectedBalanceTotal)}</p>
              <p><b>Total Applied:</b> {money(totalApplied)}</p>
              <p><b>Remaining Unapplied:</b> {money(remainingUnapplied)}</p>
            </div>

            <div className="form-grid payment-form receive-payment-fields">
              <label className="order-field">
                Total Payment Amount
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Total Payment Amount"
                  value={receive.total_amount}
                  onChange={e => { setReceive({ ...receive, total_amount: e.target.value }); setReceiveError('') }}
                />
              </label>
              <button type="button" className="soft auto-apply-btn" onClick={autoApplyPayment}>Auto Apply</button>
              <input type="date" value={receive.payment_date} onChange={e => setReceive({ ...receive, payment_date: e.target.value })} />
              <div className="method-boxes">
                {PAYMENT_METHODS.map(m => (
                  <button key={m} type="button" className={receive.method === m ? 'chosen' : ''} onClick={() => setReceive({ ...receive, method: m })}>{m}</button>
                ))}
              </div>
              <input placeholder="Reference / Check #" value={receive.reference_no} onChange={e => setReceive({ ...receive, reference_no: e.target.value })} />
              <input placeholder="Memo" value={receive.note} onChange={e => setReceive({ ...receive, note: e.target.value })} />
              <button type="button" onClick={saveReceivePayment}>Save Payment</button>
            </div>
            {receiveError && <p className="field-error">{receiveError}</p>}
            <p className="hint">Auto Apply pays oldest selected invoices first. Each invoice receives its own payment record.</p>
          </>
        )}
      </div>

      <div className="panel payment-history-section">
        <h2>Payment History</h2>
        <PaymentHistoryMobileCards rows={paymentRows} highlightId={highlightId} onDelete={id => deleteRow('payments', id)} />
        <div className="payment-history-table">
          <Table rows={paymentRows} cols={['payment_date', 'customer_name', 'invoice_no', 'amount', 'method', 'reference_no', 'note']}
            highlightId={highlightId} rowIdPrefix="payment-row-" onDelete={id => deleteRow('payments', id)} />
        </div>
      </div>
    </div>
  )
}

function CustomerRankingMobileCards({ ranked }) {
  return (
    <div className="report-customer-ranking-cards">
      {ranked.map((c, i) => (
        <article key={c.id} className="report-ranking-card">
          <p className="report-ranking-rank">#{i + 1}</p>
          <p className="report-ranking-customer">{c.company || c.name || '—'}</p>
          <p className="report-ranking-sales">Sales: {money(c.sales)}</p>
        </article>
      ))}
    </div>
  )
}

function BackOrderCustomerMobileCards({ rows }) {
  return (
    <div className="report-backorder-customer-cards">
      {rows.map(r => (
        <article key={r.customer} className="report-backorder-card">
          <p className="report-backorder-title">{r.customer}</p>
          <dl className="report-card-meta">
            <div className="report-card-row"><dt>Orders</dt><dd>{r.orders}</dd></div>
            <div className="report-card-row"><dt>Units</dt><dd>{r.units}</dd></div>
            <div className="report-card-row"><dt>Value</dt><dd>{money(r.value)}</dd></div>
          </dl>
        </article>
      ))}
    </div>
  )
}

function BackOrderProductMobileCards({ rows }) {
  return (
    <div className="report-backorder-product-cards">
      {rows.map(r => (
        <article key={r.product} className="report-backorder-card">
          <p className="report-backorder-title">{r.product}</p>
          <dl className="report-card-meta">
            <div className="report-card-row"><dt>Orders</dt><dd>{r.orders}</dd></div>
            <div className="report-card-row"><dt>Units</dt><dd>{r.units}</dd></div>
            <div className="report-card-row"><dt>Value</dt><dd>{money(r.value)}</dd></div>
          </dl>
        </article>
      ))}
    </div>
  )
}

function Reports({ data, staffUsers, stats, poStats }) {
  const [reportFilter, setReportFilter] = useState('Active')
  const [plMonth, setPlMonth] = useState(currentMonthKey())
  const [poDateFrom, setPoDateFrom] = useState('')
  const [poDateTo, setPoDateTo] = useState('')
  const plOrders = ordersForDashboardSales(filterOrdersForMonth(data.orders, plMonth))
  const plSummary = calcMonthFinancialSummary(
    plOrders,
    data.order_items,
    data.inventory,
    data.expenses || [],
    plMonth,
  )
  const activeOrders = ordersForSalesMetrics(data.orders)
  const voidOrders = data.orders.filter(isVoidOrder)
  const ranked = [...data.customers].map(c => ({ ...c, ...customerStats(c, data) })).sort((a, b) => b.sales - a.sales)
  const boReport = backOrderReports(data.orders, data.order_items)
  const salesByPersonMap = {}
  activeOrders.forEach(o => {
    const label = orderSalesPersonDisplay(o, staffUsers)
    if (!salesByPersonMap[label]) salesByPersonMap[label] = { sales: 0, profit: 0, orders: 0 }
    salesByPersonMap[label].sales += Number(o.total || 0)
    salesByPersonMap[label].profit += orderProfit(o)
    salesByPersonMap[label].orders += 1
  })
  const salesByPerson = Object.entries(salesByPersonMap)
    .map(([name, statsRow]) => ({ name, ...statsRow }))
    .sort((a, b) => b.sales - a.sales)
  const monthlyBreakdown = {}
  activeOrders.forEach(o => {
    const m = localDateKey(o.created_at).slice(0, 7)
    monthlyBreakdown[m] = (monthlyBreakdown[m] || 0) + Number(o.total || 0)
  })
  const productStats = {}
  activeOrders.forEach(o => {
    const k = o.style || 'Unknown'
    if (!productStats[k]) productStats[k] = { qty: 0, profit: 0 }
    productStats[k].qty += Number(o.qty || 0)
    productStats[k].profit += orderProfit(o)
  })
  const sorted = Object.entries(productStats).sort((a, b) => b[1].qty - a[1].qty)
  const best = sorted[0], worst = sorted[sorted.length - 1]
  const totalProfit = activeOrders.reduce((s, o) => s + orderProfit(o), 0)
  const lowStockReport = buildLowStockAlerts(data.inventory, 50)
  const { itemCount: lowStockItemCount, unitsToReorder } = lowStockSummary(data.inventory)
  const showActiveReports = reportFilter === 'Active' || reportFilter === 'All'
  const showVoidAudit = reportFilter === 'Void' || reportFilter === 'All'

  return (
    <div className="panel reports-page">
      <h2>Reports</h2>
      <div className="report-filters">
        {['Active', 'Void', 'All'].map(f => (
          <button
            key={f}
            type="button"
            className={`filter-btn soft${reportFilter === f ? ' active' : ''}`}
            onClick={() => setReportFilter(f)}
          >
            {f === 'Void' && voidOrders.length ? `Void (${voidOrders.length})` : f}
          </button>
        ))}
      </div>
      {showActiveReports && (
        <>
      <h3>Profit &amp; Loss Summary</h3>
      <div className="report-pl-toolbar">
        <label>
          Month
          <input type="month" value={plMonth} onChange={e => setPlMonth(e.target.value)} />
        </label>
        <p className="hint report-pl-hint">
          {plOrders.length} invoice{plOrders.length === 1 ? '' : 's'} in {plMonth}. COGS uses landed unit cost for units sold only.
        </p>
      </div>
      <div className="panel panel-compact dashboard-profit-breakdown report-pl-summary">
        <ProfitLossSummary summary={plSummary} />
      </div>
      {plSummary.monthExpenses.length > 0 && (
        <>
          <h3>Expenses — {plMonth}</h3>
          <div className="table-wrap profit-details-expenses-table">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {plSummary.monthExpenses.map(expense => (
                  <tr key={expense.id}>
                    <td>{formatDisplayDate(expenseDateKey(expense))}</td>
                    <td>{expense.category || '—'}</td>
                    <td>{expense.description || '—'}</td>
                    <td>{money(expense.amount)}</td>
                    <td>{expense.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="cards">
        <Card t="Total Sales" v={money(stats.sales)} />
        <Card t="Total Profit" v={money(totalProfit)} />
        <Card t="Inventory Value" v={money(stats.inventoryValue)} />
        <Card t="Open Balance" v={money(stats.balance)} />
        <Card t="Monthly Sales" v={money(stats.monthlySales)} />
        <Card t="Customers" v={stats.customers} />
      </div>
      <h3>Customer Ranking</h3>
      <CustomerRankingMobileCards ranked={ranked} />
      <div className="table-wrap report-customer-ranking-table">
      <table><thead><tr><th>#</th><th>Customer</th><th>Sales</th><th>Paid</th><th>Balance</th><th>Orders</th></tr></thead>
        <tbody>{ranked.map((c, i) => (
          <tr key={c.id}><td>{i + 1}</td><td>{c.company || c.name}</td><td>{money(c.sales)}</td><td>{money(c.paid)}</td><td>{money(c.balance)}</td><td>{c.orders.length}</td></tr>
        ))}</tbody></table>
      </div>
      <h3>Sales by Sales Person</h3>
      {salesByPerson.length === 0 ? (
        <p className="hint">No sales recorded yet.</p>
      ) : (
        <table>
          <thead><tr><th>Sales Person</th><th>Orders</th><th>Sales</th><th>Profit</th></tr></thead>
          <tbody>{salesByPerson.map(row => (
            <tr key={row.name}><td>{row.name}</td><td>{row.orders}</td><td>{money(row.sales)}</td><td>{money(row.profit)}</td></tr>
          ))}</tbody>
        </table>
      )}
      <h3>Monthly Sales Breakdown</h3>
      <table><thead><tr><th>Month</th><th>Sales</th></tr></thead>
        <tbody>{Object.entries(monthlyBreakdown).sort((a, b) => b[0].localeCompare(a[0])).map(([m, v]) => (
          <tr key={m}><td>{m}</td><td>{money(v)}</td></tr>
        ))}</tbody></table>
      <div className="report-row">
        <div><h3>Best Seller</h3><p>{best ? `${best[0]} — ${best[1].qty} units · ${money(best[1].profit)} profit` : '—'}</p></div>
        <div><h3>Worst Seller</h3><p>{worst && sorted.length > 1 ? `${worst[0]} — ${worst[1].qty} units · ${money(worst[1].profit)} profit` : '—'}</p></div>
      </div>

      <h3>Low Stock Report</h3>
      <div className="cards">
        <Card t="Low Stock Items" v={lowStockItemCount} cls={lowStockItemCount > 0 ? 'card-warn' : ''} />
        <Card t="Units to Reorder" v={unitsToReorder} cls={unitsToReorder > 0 ? 'card-warn' : ''} />
      </div>
      {lowStockReport.length === 0 ? (
        <p className="hint">No low stock items.</p>
      ) : (
        <div className="table-wrap low-stock-table">
          <table>
            <thead>
              <tr>
                <th className="low-stock-col-product">Product</th>
                <th>Stock On Hand</th>
                <th>Minimum Stock</th>
                <th>Need to Order</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {lowStockReport.map(item => (
                <tr key={item.id}>
                  <td className="low-stock-col-product">{item.label}</td>
                  <td>{item.stockOnHand}</td>
                  <td>{item.minimumStockDisplay}</td>
                  <td>{item.needToOrder}</td>
                  <td><span className={`stock-status-badge ${item.statusClass}`}>{item.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>Back Order Reports</h3>
      <div className="cards">
        <Card t="Total Back Order Units" v={boReport.totalUnits} cls={boReport.totalUnits > 0 ? 'card-warn' : ''} />
        <Card t="Total Back Order Value" v={money(boReport.totalValue)} cls={boReport.totalValue > 0 ? 'card-warn' : ''} />
      </div>
      <h4>Open Back Orders by Customer</h4>
      {boReport.byCustomer.length === 0 ? (
        <p className="hint">No open back orders.</p>
      ) : (
        <>
        <BackOrderCustomerMobileCards rows={boReport.byCustomer} />
        <div className="table-wrap report-backorder-customer-table">
        <table><thead><tr><th>Customer</th><th>Orders</th><th>Units</th><th>Value</th></tr></thead>
          <tbody>{boReport.byCustomer.map(r => (
            <tr key={r.customer}><td>{r.customer}</td><td>{r.orders}</td><td>{r.units}</td><td>{money(r.value)}</td></tr>
          ))}</tbody></table>
        </div>
        </>
      )}
      <h4>Open Back Orders by Product</h4>
      {boReport.byProduct.length === 0 ? (
        <p className="hint">No open back orders.</p>
      ) : (
        <>
        <BackOrderProductMobileCards rows={boReport.byProduct} />
        <div className="table-wrap report-backorder-product-table">
        <table><thead><tr><th>Product</th><th>Orders</th><th>Units</th><th>Value</th></tr></thead>
          <tbody>{boReport.byProduct.map(r => (
            <tr key={r.product}><td>{r.product}</td><td>{r.orders}</td><td>{r.units}</td><td>{money(r.value)}</td></tr>
          ))}</tbody></table>
        </div>
        </>
      )}
        </>
      )}
      {showVoidAudit && (
        <>
          <h3>Void Invoice Audit</h3>
          {voidOrders.length === 0 ? (
            <p className="hint">No voided invoices.</p>
          ) : (
            <div className="table-wrap void-audit-table">
              <table>
                <thead>
                  <tr>
                    <th>Invoice No</th>
                    <th>Customer</th>
                    <th>Date</th>
                    <th>Void Date</th>
                    <th>Reason</th>
                    <th>Voided By</th>
                    <th>Amount Paid</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {voidOrders.map(o => (
                    <tr key={o.id}>
                      <td>{o.invoice_no || '—'}</td>
                      <td>{o.customer_name || '—'}</td>
                      <td>{formatDisplayDate(o.order_date || o.created_at)}</td>
                      <td>{formatVoidDate(o.voided_at)}</td>
                      <td>{o.void_reason || '—'}{o.void_note ? ` — ${o.void_note}` : ''}</td>
                      <td>{o.voided_by || '—'}</td>
                      <td>{money(orderPaidTotal(data.payments, o))}</td>
                      <td>{money(o.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <PurchaseOrderReports
        data={data}
        dateFrom={poDateFrom}
        dateTo={poDateTo}
        onDateFromChange={setPoDateFrom}
        onDateToChange={setPoDateTo}
      />
    </div>
  )
}

function Settings({ data, reload, profile, setProfile, session, fetchProfilesForBackup, restoreBackupData, setLocalData, repairNegativeInventory, saveStaffProfile, reloadStaffUsers, currentUserId }) {
  const isAdmin = (profile.role || 'Admin') === 'Admin'
  const [settingsSection, setSettingsSection] = useState('general')
  const [busy, setBusy] = useState(false)
  const [repairSummary, setRepairSummary] = useState(null)
  const [status, setStatus] = useState('')
  const [statusError, setStatusError] = useState(false)
  const [lastBackup, setLastBackup] = useState(getLastBackupTime())
  const [restoreFile, setRestoreFile] = useState(null)
  const [restorePreview, setRestorePreview] = useState(null)
  const [restoreMode, setRestoreMode] = useState('upsert')
  const [restoreConfirm, setRestoreConfirm] = useState(false)
  const [restoreErrors, setRestoreErrors] = useState([])
  const [restoreStats, setRestoreStats] = useState(null)
  const [backupDetails, setBackupDetails] = useState(null)
  const [showRestoreDialog, setShowRestoreDialog] = useState(false)
  const [myFullName, setMyFullName] = useState(profile.full_name || '')
  const [userMgmtStatus, setUserMgmtStatus] = useState('')
  const [userMgmtBusy, setUserMgmtBusy] = useState(false)

  useEffect(() => {
    setMyFullName(profile.full_name || '')
  }, [profile.full_name])

  function setStatusMsg(msg, isError = false) {
    setStatus(msg)
    setStatusError(isError)
  }

  const exportLabels = {
    customers: 'Customers', inventory: 'Inventory', orders: 'Orders', order_items: 'Invoice Line Items', payments: 'Payments',
    purchase_orders: 'Purchase Orders', purchase_order_items: 'PO Line Items', purchase_order_receipts: 'PO Receipts', purchase_order_receives: 'PO Receives', purchase_order_commission_payments: 'PO Commission Payments',
  }

  function formatLocalBackupDisplay(iso) {
    if (!iso) return 'Never'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return 'Never'
    const pad = n => String(n).padStart(2, '0')
    const mm = pad(d.getMonth() + 1)
    const dd = pad(d.getDate())
    const yyyy = d.getFullYear()
    let hours = d.getHours()
    const ampm = hours >= 12 ? 'PM' : 'AM'
    hours = hours % 12 || 12
    return `${mm}/${dd}/${yyyy} ${hours}:${pad(d.getMinutes())} ${ampm}`
  }

  function formatBackupDate(iso) {
    if (!iso) return '—'
    return formatLocalBackupDisplay(iso)
  }

  function formatFileSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  async function updateRole(newRole) {
    if (!hasSupabaseConfig || !session?.user?.id) { setProfile({ ...profile, role: newRole }); return }
    await supabase.from('profiles').upsert({ id: session.user.id, email: session.user.email, role: newRole, full_name: profile.full_name || '' })
    setProfile({ ...profile, role: newRole })
  }

  async function saveMyFullName() {
    setUserMgmtBusy(true)
    setUserMgmtStatus('')
    const result = await saveStaffProfile(profile.id || session?.user?.id, { full_name: myFullName })
    setUserMgmtStatus(result.error || 'Your name was saved.')
    setUserMgmtBusy(false)
  }

  async function runBackupAll() {
    setBusy(true)
    setRestoreStats(null)
    setBackupDetails(null)
    setStatusMsg('Preparing backup...')
    try {
      const profiles = await fetchProfilesForBackup()
      const { blob, filename } = await createFullBackupZip({
        data,
        profiles,
        exportedBy: session?.user?.email || profile.email || '',
        onProgress: setStatusMsg,
      })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = filename
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
      const backupAt = new Date().toISOString()
      saveLastBackupTime()
      setLastBackup(getLastBackupTime())
      setStatusMsg('')
      setBackupDetails({
        filename,
        size: formatFileSize(blob.size),
        date: formatLocalBackupDisplay(backupAt),
      })
      setStatusError(false)
    } catch (err) {
      setBackupDetails(null)
      setStatusMsg(err.message || 'Backup failed.', true)
    } finally {
      setBusy(false)
    }
  }

  function exportTable(table) {
    setBusy(true)
    setBackupDetails(null)
    try {
      downloadJson(`${table}.json`, data[table] || [])
      setStatusMsg(`${exportLabels[table] || table} export downloaded successfully.`)
      setStatusError(false)
    } catch (err) {
      setStatusMsg(`${exportLabels[table] || table} export failed: ${err.message || 'Download error.'}`, true)
    } finally {
      setBusy(false)
    }
  }

  async function previewRestore() {
    if (!restoreFile) {
      setStatusMsg('Choose a backup ZIP file first.', true)
      return
    }
    setBusy(true)
    setRestoreStats(null)
    setRestoreErrors([])
    try {
      const parsed = await readBackupZip(restoreFile)
      const errors = validateRestoreRows(parsed, data)
      setRestorePreview(parsed)
      setRestoreErrors(errors)
      setRestoreConfirm(false)
      setStatusMsg(errors.length ? 'Preview loaded — fix validation issues before restoring.' : 'Preview loaded — ready to restore.')
      setStatusError(errors.length > 0)
    } catch (err) {
      setRestorePreview(null)
      setStatusMsg(err.message || 'Could not read backup file.', true)
      setStatusError(true)
    } finally {
      setBusy(false)
    }
  }

  function requestRestore() {
    if (!restorePreview) {
      setStatusMsg('Preview the backup before restoring.', true)
      return
    }
    if (!restoreConfirm) {
      setStatusMsg('Check the confirmation box before restoring.', true)
      return
    }
    if (restoreErrors.length) {
      setStatusMsg('Fix validation errors before restoring.', true)
      return
    }
    setShowRestoreDialog(true)
  }

  async function confirmRestore() {
    setShowRestoreDialog(false)
    setBusy(true)
    setRestoreStats(null)
    setStatusMsg('Restoring customers...')
    try {
      const result = await restoreBackupData(restorePreview, restoreMode, setStatusMsg)
      if (!result.ok) {
        setRestoreErrors(result.errors || [])
        setRestoreStats(result.stats)
        setStatusMsg('')
        setStatusError((result.stats?.failed ?? 0) > 0)
        return
      }
      setRestoreStats(result.stats)
      setRestorePreview(null)
      setRestoreFile(null)
      setRestoreConfirm(false)
      setRestoreErrors([])
      setStatusMsg('')
      setStatusError(result.stats.failed > 0)
    } catch (err) {
      setStatusMsg(err.message || 'Restore failed.', true)
      setStatusError(true)
    } finally {
      setBusy(false)
    }
  }

  const canRestore = restorePreview && restoreErrors.length === 0

  return (
    <div className="settings-page">
      {isAdmin && (
        <div className="settings-subnav">
          <button
            type="button"
            className={settingsSection === 'general' ? 'filter-btn active' : 'filter-btn soft'}
            onClick={() => setSettingsSection('general')}
          >
            General
          </button>
          <button
            type="button"
            className={settingsSection === 'staff' ? 'filter-btn active' : 'filter-btn soft'}
            onClick={() => setSettingsSection('staff')}
          >
            Staff Management
          </button>
        </div>
      )}

      {settingsSection === 'staff' && isAdmin ? (
        <StaffManagement
          currentUserId={profile.id || session?.user?.id}
          reloadStaffUsers={reloadStaffUsers}
        />
      ) : (
        <>
      <div className="panel">
        <h2>Settings</h2>
        <p>INNER SOURCE BEAUTY ERP v2 — Supabase Cloud</p>
        <div className="settings-row">
          <label>Your Role
            <select value={profile.role || 'Admin'} onChange={e => updateRole(e.target.value)}>
              {ROLES.map(r => <option key={r}>{r}</option>)}
            </select>
          </label>
        </div>
        <div className="settings-row">
          <label>Your Full Name
            <input
              placeholder="Full Name"
              value={myFullName}
              onChange={e => setMyFullName(e.target.value)}
            />
          </label>
          <button type="button" className="soft" disabled={userMgmtBusy} onClick={saveMyFullName}>Save Name</button>
        </div>
        {userMgmtStatus && <p className="hint">{userMgmtStatus}</p>}
        <p className="hint">Admin: all features · Staff: customers, orders, invoices, payments, reports · Warehouse: inventory, purchase orders, orders (view only)</p>
        <button type="button" onClick={reload} disabled={busy}>Reload Cloud Data</button>
      </div>

      {isAdmin && (
        <div className="panel">
          <h2>Inventory Repair</h2>
          <p className="hint">Reset stored inventory quantities below zero back to 0. Orders are not changed.</p>
          <button type="button" className="soft" disabled={busy} onClick={async () => {
            setBusy(true)
            try {
              const result = await repairNegativeInventory()
              setRepairSummary(result)
            } finally {
              setBusy(false)
            }
          }}>Repair Negative Inventory</button>
          {repairSummary && (
            <div className="repair-summary panel-inline">
              <p>{repairSummary.message}</p>
              {repairSummary.repaired?.length > 0 && (
                <ul>
                  {repairSummary.repaired.map(r => (
                    <li key={r.id}>{r.style}{r.brand ? ` · ${r.brand}` : ''}: {r.previousQty} → 0</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {isAdmin && (
        <div className="panel backup-restore-panel">
          <h2>Backup &amp; Restore</h2>
          <p className="backup-warning">
            Backup files contain confidential business data. Store them securely.
          </p>
          <p className="hint last-backup-line">Last Local Backup: <strong>{formatLocalBackupDisplay(lastBackup)}</strong></p>

          {status && <p className={statusError ? 'field-error backup-status backup-status-msg' : 'hint backup-status backup-status-msg'}>{status}</p>}

          {backupDetails && (
            <div className="backup-result">
              <p className="backup-result-title">Backup completed successfully.</p>
              <p><span className="backup-result-label">Filename:</span><br />{backupDetails.filename}</p>
              <p><span className="backup-result-label">File Size:</span> {backupDetails.size}</p>
              <p><span className="backup-result-label">Backup Date:</span> {backupDetails.date}</p>
            </div>
          )}

          <div className="backup-section">
            <h3>Database Backup</h3>
            <button type="button" onClick={runBackupAll} disabled={busy}>Download Full Backup</button>
          </div>

          <div className="backup-section">
            <h3>Individual Exports</h3>
            <div className="backup-export-buttons">
              {BACKUP_TABLES.map(t => (
                <button key={t} type="button" className="soft" onClick={() => exportTable(t)} disabled={busy}>
                  {exportLabels[t] || t}
                </button>
              ))}
            </div>
          </div>

          <div className="backup-section">
            <h3>Restore Backup</h3>
            <div className="restore-controls-vertical">
              <p className="restore-step-label">Choose ZIP File</p>
              <label className="restore-file-label">
                <input
                  type="file"
                  accept=".zip,application/zip"
                  disabled={busy}
                  onChange={e => {
                    setRestoreFile(e.target.files?.[0] || null)
                    setRestorePreview(null)
                    setRestoreErrors([])
                    setRestoreStats(null)
                    setRestoreConfirm(false)
                    setShowRestoreDialog(false)
                    setStatusMsg('')
                  }}
                />
              </label>
              <button type="button" className="soft restore-preview-btn" onClick={previewRestore} disabled={busy || !restoreFile}>Preview Backup</button>
            </div>

            {restorePreview && (
              <div className="restore-summary">
                <h4>Restore Summary</h4>
                <div className="restore-summary-grid">
                  <p><span className="summary-label">Backup Date:</span> {formatBackupDate(restorePreview.manifest?.exported_at)}</p>
                  <p><span className="summary-label">Backup Version:</span> {restorePreview.manifest?.backup_version ?? '—'}</p>
                  <p><span className="summary-label">Customers:</span> {restorePreview.customers?.length ?? 0} rows</p>
                  <p><span className="summary-label">Inventory:</span> {restorePreview.inventory?.length ?? 0} rows</p>
                  <p><span className="summary-label">Orders:</span> {restorePreview.orders?.length ?? 0} rows</p>
                  <p><span className="summary-label">Payments:</span> {restorePreview.payments?.length ?? 0} rows</p>
                </div>

                {restoreErrors.length > 0 && (
                  <div className="restore-validation-errors">
                    <h4>Validation Issues</h4>
                    <ul>
                      {restoreErrors.slice(0, 20).map((e, i) => (
                        <li key={i}>{e.table} row {e.rowNum}: {e.reason}</li>
                      ))}
                    </ul>
                    {restoreErrors.length > 20 && <p className="hint">…and {restoreErrors.length - 20} more issues.</p>}
                  </div>
                )}

                {canRestore && (
                  <>
                    <div className="restore-mode-section">
                      <p className="restore-mode-heading">Restore Mode:</p>
                      <div className="restore-mode">
                        <label><input type="radio" name="restoreMode" value="upsert" checked={restoreMode === 'upsert'} onChange={() => setRestoreMode('upsert')} disabled={busy} /> Safe Upsert</label>
                        <label><input type="radio" name="restoreMode" value="insert_missing" checked={restoreMode === 'insert_missing'} onChange={() => setRestoreMode('insert_missing')} disabled={busy} /> Insert Missing Only</label>
                      </div>
                    </div>

                    <p className="restore-notice">
                      Existing records will not be deleted.<br />
                      Safe Upsert may update matching records and insert missing records.
                    </p>

                    <label className="check restore-confirm">
                      <input type="checkbox" checked={restoreConfirm} onChange={e => setRestoreConfirm(e.target.checked)} disabled={busy} />
                      I understand that restoring data may update existing records.
                    </label>

                    <div className="restore-actions">
                      <button type="button" onClick={requestRestore} disabled={busy || !restoreConfirm}>Restore Now</button>
                    </div>
                  </>
                )}
              </div>
            )}

            {restoreStats && (
              <div className="restore-result">
                <p className="restore-result-title">Restore complete</p>
                <p>Inserted: {restoreStats.inserted}</p>
                <p>Updated: {restoreStats.updated}</p>
                <p>Failed: {restoreStats.failed}</p>
              </div>
            )}
          </div>

          <div className="backup-section auto-backup-section">
            <div className="auto-backup-card">
              <div className="auto-backup-card-header">
                <strong>Automatic Cloud Backup</strong>
                <span className="coming-soon-badge">Coming Soon</span>
              </div>
              <p className="auto-backup-note">Daily and weekly automatic cloud backups will be available in a future update.</p>
            </div>
          </div>

          {showRestoreDialog && (
            <div className="restore-dialog-overlay" onClick={() => setShowRestoreDialog(false)}>
              <div className="restore-dialog" onClick={e => e.stopPropagation()}>
                <p className="restore-dialog-text">Restore this backup now?</p>
                <div className="restore-dialog-actions">
                  <button type="button" className="soft" onClick={() => setShowRestoreDialog(false)}>Cancel</button>
                  <button type="button" onClick={confirmRestore}>Restore Backup</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
        </>
      )}
    </div>
  )
}

function Table({ rows, cols, onDelete, highlightId, rowIdPrefix }) {
  const moneyCols = ['total', 'amount', 'price', 'cost', 'buying_price', 'shipping_cost', 'selling_price', 'shipping', 'discount', 'profit']
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{cols.map(c => <th key={c}>{c.replaceAll('_', ' ')}</th>)}{onDelete && <th></th>}</tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.id} id={rowIdPrefix ? `${rowIdPrefix}${r.id}` : undefined}
            className={highlightId && String(highlightId) === String(r.id) ? 'sel' : ''}>
            {cols.map(c => <td key={c}>{
              moneyCols.includes(c) ? money(r[c])
                : isDisplayDateField(c) ? formatDisplayDate(r[c])
                  : String(r[c] ?? '')
            }</td>)}
            {onDelete && <td><button className="danger" onClick={() => onDelete(r.id)}>Delete</button></td>}
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
