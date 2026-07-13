import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase, hasSupabaseConfig } from './supabaseClient.js'
import {
  BACKUP_TABLES, createFullBackupZip, downloadJson, readBackupZip,
  saveLastBackupTime, getLastBackupTime, validateRestoreRows, executeRestore,
} from './backupRestore.js'
import './style.css'

const TABLES = ['customers', 'inventory', 'orders', 'payments']
const EMPTY = { customers: [], inventory: [], orders: [], payments: [] }
const PAYMENT_METHODS = ['Zelle', 'Venmo', 'Cash', 'Credit Card', 'Check', 'ACH/Wire']
const SHIPPING_METHODS = ['UPS Next Day', 'UPS 2nd Day', 'UPS 3 Day', 'UPS Ground', 'USPS Ground', 'USPS Priority']
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
  return m === null ? '—' : `${m.toFixed(1)}%`
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

const PAGE_ACCESS = {
  Admin: ['Dashboard', 'Customers', 'Inventory', 'Orders', 'Invoice', 'Payments', 'Reports', 'Settings'],
  Staff: ['Dashboard', 'Customers', 'Orders', 'Invoice', 'Payments'],
  Warehouse: ['Inventory'],
}

function useLocalData() {
  const [data, setData] = useState(() => {
    try { return JSON.parse(localStorage.getItem('isb_data_v2')) || EMPTY } catch { return EMPTY }
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
  const [globalSearch, setGlobalSearch] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [selectedRecord, setSelectedRecord] = useState({ page: '', id: '' })

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

  async function loadProfile() {
    if (!session?.user?.id) return
    const { data: row } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
    if (row) setProfile(row)
    else setProfile({ role: 'Admin', email: session.user.email })
  }

  async function loadCloudData() {
    setLoading(true); setNotice('')
    const next = { ...EMPTY }
    for (const t of TABLES) {
      const { data: rows, error } = await supabase.from(t).select('*').order('created_at', { ascending: false })
      if (error) setNotice(error.message)
      next[t] = rows || []
    }
    setCloudData(next); setLoading(false)
  }

  async function authAction(e) {
    e.preventDefault(); setAuthMsg('')
    if (!email || !password) return setAuthMsg('Email and password required')
    if (!hasSupabaseConfig) { setSession({ user: { email } }); setProfile({ role: 'Admin', email }); return }
    const res = authMode === 'signup'
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password })
    if (res.error) setAuthMsg(res.error.message)
    else setAuthMsg(authMode === 'signup' ? 'Account created. Check email if confirmation is enabled.' : '')
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
    const restoreQty = Number(order.qty || 0)
    const inventoryId = order.inventory_id

    if (hasSupabaseConfig && session) {
      if (inventoryId && restoreQty > 0) {
        const inv = data.inventory.find(i => String(i.id) === String(inventoryId))
        if (inv) {
          const { error } = await supabase.from('inventory')
            .update({ qty: Number(inv.qty || 0) + restoreQty })
            .eq('id', inv.id)
          if (error) return setNotice(error.message), false
        }
      }
      for (const p of relatedPayments) {
        const { error } = await supabase.from('payments').delete().eq('id', p.id)
        if (error) return setNotice(error.message), false
      }
      const { error } = await supabase.from('orders').delete().eq('id', id)
      if (error) return setNotice(error.message), false
      await loadCloudData()
    } else {
      const paymentIds = new Set(relatedPayments.map(p => String(p.id)))
      setLocalData(p => ({
        ...p,
        inventory: inventoryId && restoreQty > 0
          ? p.inventory.map(i => String(i.id) === String(inventoryId)
            ? { ...i, qty: Number(i.qty || 0) + restoreQty }
            : i)
          : p.inventory,
        payments: p.payments.filter(x => !paymentIds.has(String(x.id))),
        orders: p.orders.filter(x => String(x.id) !== String(id)),
      }))
    }

    return true
  }

  async function createOrder(f) {
    const item = data.inventory.find(i => String(i.id) === String(f.inventory_id))
    const customer = data.customers.find(c => String(c.id) === String(f.customer_id))
    const qty = Number(f.qty || 0), price = Number(f.price || 0)
    const shipping = Number(f.shipping || 0), discount = Number(f.discount || 0)
    const buying = item ? itemBuying(item) : 0
    const inboundShipping = item ? itemShipping(item) : 0
    const total = qty * price + shipping - discount
    const profit = total - (qty * (buying + inboundShipping))
    const dueDate = toDbDate(f.due_date || calcDueDate(customer?.payment_terms, today()))
    const payload = {
      customer_id: f.customer_id || null,
      inventory_id: f.inventory_id || null,
      customer_name: customer?.company || customer?.name || f.customer_name || '',
      style: item?.style || f.style,
      qty, price, buying_price: buying, shipping_cost: inboundShipping, profit,
      shipping, discount, total,
      shipping_method: f.shipping_method || '',
      invoice_no: nextInvoiceNo(data.orders, f.invoice_no),
      status: f.status || 'Open',
      payment_status: 'Unpaid',
      note: f.note || '',
      due_date: dueDate,
      tracking: f.tracking || '',
    }
    await addRow('orders', payload)
    if (item) {
      const newQty = Number(item.qty || 0) - qty
      await updateRow('inventory', item.id, { qty: newQty })
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

    const item = data.inventory.find(i => String(i.id) === String(f.inventory_id))
    const customer = data.customers.find(c => String(c.id) === String(f.customer_id))
    const qty = Number(f.qty || 0), price = Number(f.price || 0)
    const shipping = Number(f.shipping || 0), discount = Number(f.discount || 0)
    const buying = item ? itemBuying(item) : 0
    const inboundShipping = item ? itemShipping(item) : 0
    const total = qty * price + shipping - discount
    const profit = total - (qty * (buying + inboundShipping))
    const paid = orderPaidTotal(existing)

    if (total < paid - 0.001) {
      return { error: 'Invoice total cannot be less than the amount already paid.' }
    }

    const payment_status = paid <= 0 ? 'Unpaid' : paid >= total ? 'Paid' : 'Partial'
    const payload = {
      customer_id: f.customer_id || null,
      inventory_id: f.inventory_id || null,
      customer_name: customer?.company || customer?.name || f.customer_name || existing.customer_name || '',
      style: item?.style || f.style || existing.style,
      qty, price, buying_price: buying, shipping_cost: inboundShipping, profit,
      shipping, discount, total,
      shipping_method: f.shipping_method || '',
      invoice_no: existing.invoice_no,
      status: f.status || 'Open',
      payment_status,
      note: f.note || '',
      due_date: toDbDate(f.due_date || existing.due_date),
      tracking: f.tracking || '',
      order_date: toDbDate(f.order_date || existing.order_date || existing.created_at),
    }
    await updateRow('orders', orderId, payload)

    const oldInventoryId = original?.inventory_id
    const newInventoryId = f.inventory_id
    const oldQty = Number(original?.qty || 0)
    const newQty = qty

    if (String(oldInventoryId || '') === String(newInventoryId || '')) {
      const diff = newQty - oldQty
      if (oldInventoryId && diff !== 0) {
        const inv = data.inventory.find(i => String(i.id) === String(oldInventoryId))
        if (inv) await updateRow('inventory', inv.id, { qty: Number(inv.qty || 0) - diff })
      }
    } else {
      if (oldInventoryId && oldQty > 0) {
        const oldInv = data.inventory.find(i => String(i.id) === String(oldInventoryId))
        if (oldInv) await updateRow('inventory', oldInv.id, { qty: Number(oldInv.qty || 0) + oldQty })
      }
      if (newInventoryId && newQty > 0) {
        const newInv = data.inventory.find(i => String(i.id) === String(newInventoryId))
        if (newInv) await updateRow('inventory', newInv.id, { qty: Number(newInv.qty || 0) - newQty })
      }
    }

    return { error: '' }
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
      const { data: rows, error } = await supabase.from('profiles').select('id, email, role, created_at')
      if (error) throw new Error(error.message)
      return rows || []
    }
    return [{
      id: profile.id || session?.user?.id || '',
      email: profile.email || session?.user?.email || '',
      role: profile.role || 'Admin',
    }]
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
            payments: [...(data.payments || [])],
          }
        }
        if (rowMode === 'insert_missing' && exists) return 'skipped'
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
    if (result.type === 'customer') { setPage('Customers') }
    else if (result.type === 'product') { setPage('Inventory') }
    else if (result.type === 'invoice') { openRecord('Invoice', result.id) }
    setMenuOpen(false)
  }

  function openRecord(targetPage, id) {
    setSelectedRecord({ page: targetPage, id: String(id) })
    setPage(targetPage)
    setMenuOpen(false)
  }

  function clearSelectedRecord() {
    setSelectedRecord({ page: '', id: '' })
  }

  if (!session) return (
    <Login authMode={authMode} setAuthMode={setAuthMode} email={email} setEmail={setEmail}
      password={password} setPassword={setPassword} authAction={authAction} authMsg={authMsg} />
  )

  return (
    <div className="app">
      <button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)}>☰</button>
      <aside className={menuOpen ? 'open' : ''}>
        <div className="brand"><span>ISB</span><b>INNER SOURCE<br />BEAUTY</b></div>
        <div className="role-badge">{role}</div>
        {allowedPages.map(x => (
          <button key={x} className={page === x ? 'active' : ''} onClick={() => { setPage(x); setMenuOpen(false) }}>{x}</button>
        ))}
        <button className="logout" onClick={logout}>Logout</button>
      </aside>
      <main>
        <header>
          <h1>{page}</h1>
          <div className="header-right">
            <input className="global-search" placeholder="Search customer, product, brand, invoice, phone, email..."
              value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} />
            <div className="user">{session.user?.email}</div>
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
        {page === 'Dashboard' && <Dashboard data={data} stats={stats} />}
        {page === 'Customers' && <Customers data={data} addRow={addRow} updateRow={updateRow} deleteRow={deleteRow} onNavigate={openRecord}
          selectedCustomerId={selectedRecord.page === 'Customers' ? selectedRecord.id : ''} clearSelection={clearSelectedRecord} />}
        {page === 'Inventory' && <Inventory data={data} addRow={addRow} updateRow={updateRow} deleteRow={deleteRow} />}
        {page === 'Orders' && <Orders data={data} createOrder={createOrder} updateOrder={updateOrder} deleteOrder={deleteOrder}
          selectedOrderId={selectedRecord.page === 'Orders' ? selectedRecord.id : ''} clearSelection={clearSelectedRecord} />}
        {page === 'Invoice' && <Invoice data={data} updateRow={updateRow}
          selectedOrderId={selectedRecord.page === 'Invoice' ? selectedRecord.id : ''} clearSelection={clearSelectedRecord} />}
        {page === 'Payments' && <Payments data={data} recordMultiPayment={recordMultiPayment} deleteRow={deleteRow} onNavigate={openRecord}
          selectedPaymentId={selectedRecord.page === 'Payments' ? selectedRecord.id : ''} clearSelection={clearSelectedRecord} />}
        {page === 'Reports' && <Reports data={data} stats={stats} />}
        {page === 'Settings' && <Settings data={data} reload={loadCloudData} profile={profile} setProfile={setProfile} session={session}
          fetchProfilesForBackup={fetchProfilesForBackup} restoreBackupData={restoreBackupData} setLocalData={setLocalData} />}
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
  const sales = data.orders.reduce((s, o) => s + Number(o.total || 0), 0)
  const paid = data.payments.reduce((s, p) => s + Number(p.amount || 0), 0)
  const todaySales = data.orders.filter(o => isToday(o.created_at)).reduce((s, o) => s + Number(o.total || 0), 0)
  const monthlySales = data.orders.filter(o => isThisMonth(o.created_at)).reduce((s, o) => s + Number(o.total || 0), 0)
  const inventoryValue = data.inventory.reduce((s, i) => s + Number(i.qty || 0) * itemUnitCost(i), 0)
  const expectedProfit = data.orders.reduce((s, o) => s + orderProfit(o), 0)
  const ordersToday = data.orders.filter(o => isToday(o.created_at)).length
  const lowStock = data.inventory.filter(i => Number(i.qty || 0) < 5).length
  const salesByDay = buildSalesGraph(data.orders)
  return { sales, paid, balance: sales - paid, stock: data.inventory.reduce((s, i) => s + Number(i.qty || 0), 0),
    orders: data.orders.length, customers: data.customers.length, todaySales, monthlySales,
    inventoryValue, expectedProfit, ordersToday, lowStock, salesByDay }
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
      .filter(o => localDateKey(o.created_at) === key)
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
  const orders = data.orders.filter(o => String(o.customer_id) === String(c.id) || o.customer_name === (c.company || c.name))
  const payments = data.payments.filter(p => String(p.customer_id) === String(c.id) || orders.some(o => o.invoice_no === p.invoice_no))
  const sales = orders.reduce((s, o) => s + Number(o.total || 0), 0)
  const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0)
  const last = orders[0]?.created_at ? dateOnly(orders[0].created_at) : ''
  const avgOrder = orders.length ? sales / orders.length : 0
  return { orders, payments, sales, paid, balance: sales - paid, lastOrder: last, avgOrder }
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
    const hay = [o.invoice_no, o.customer_name, o.style].join(' ').toLowerCase()
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

function Dashboard({ data, stats }) {
  const todayOrders = data.orders.filter(isOrderDateToday)
  const monthOrders = data.orders.filter(isOrderDateThisMonth)

  const todaySales = todayOrders.reduce((s, o) => s + Number(o.total || 0), 0)
  const todayProfit = todayOrders.reduce((s, o) => s + orderProfit(o), 0)
  const ordersToday = todayOrders.length
  const monthlySales = monthOrders.reduce((s, o) => s + Number(o.total || 0), 0)
  const monthlyProfit = monthOrders.reduce((s, o) => s + orderProfit(o), 0)
  const openBalance = stats.balance
  const expectedProfit = data.orders.reduce((s, o) => s + orderProfit(o), 0)
  const totalCustomers = data.customers.length
  const totalProducts = data.inventory.length
  const totalInventoryQty = data.inventory.reduce((s, i) => {
    const qty = Number(i.qty) || 0
    return qty > 0 ? s + qty : s
  }, 0)
  const inventoryValue = data.inventory.reduce((s, i) => {
    const qty = Number(i.qty) || 0
    if (qty <= 0) return s
    return s + qty * inventoryUnitCost(i)
  }, 0)
  const lowStockLimit = i => Number(i.low_stock ?? 5) || 5
  const lowStockItems = data.inventory.filter(i => {
    const qty = Number(i.qty) || 0
    return qty > 0 && qty <= lowStockLimit(i)
  })
  const outOfStockItems = data.inventory.filter(i => (Number(i.qty) || 0) <= 0)
  const salesByDay = buildSalesGraph(data.orders)

  const lowStockAlerts = lowStockItems
    .slice()
    .sort((a, b) => (Number(a.qty) || 0) - (Number(b.qty) || 0))
    .slice(0, 5)
    .map(item => {
      const qty = Number(item.qty) || 0
      const limit = lowStockLimit(item)
      const reorder = reorderInfo(item, data.orders)
      const label = [item.style, item.brand].filter(Boolean).join(' ')
      return { id: item.id, label, qty, limit, recommended: reorder?.recommended }
    })

  function formatDashboardDate(raw) {
    if (!raw) return '—'
    const dt = new Date(raw)
    if (Number.isNaN(dt.getTime())) return '—'
    return `${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}/${dt.getFullYear()}`
  }

  const recentOrders = data.orders.slice(0, 5).map(o => ({
    id: o.id,
    order_date: formatDashboardDate(o.order_date || o.created_at),
    invoice_no: o.invoice_no || '—',
    customer_name: o.customer_name || '—',
    total: money(o.total),
    payment_status: o.payment_status || '—',
  }))

  return (
    <>
      <div className="dashboard-rows">
        <div className="cards dashboard-row">
          <Card t="Today's Sales" v={money(todaySales)} />
          <Card t="Today's Profit" v={money(todayProfit)} />
          <Card t="Orders Today" v={ordersToday} />
          <Card t="Monthly Sales" v={money(monthlySales)} />
        </div>
        <div className="cards dashboard-row">
          <Card t="Open Balance" v={money(openBalance)} />
          <Card t="Inventory Value" v={money(inventoryValue)} />
          <Card t="Expected Profit" v={money(expectedProfit)} />
          <Card t="Monthly Profit" v={money(monthlyProfit)} />
        </div>
        <div className="cards dashboard-row dashboard-row-5">
          <Card t="Total Customers" v={totalCustomers} />
          <Card t="Total Products" v={totalProducts} />
          <Card t="Total Inventory Qty" v={totalInventoryQty} />
          <Card t="Low Stock Items" v={lowStockItems.length} cls={lowStockItems.length > 0 ? 'card-warn' : ''} />
          <Card t="Out of Stock Items" v={outOfStockItems.length} cls={outOfStockItems.length > 0 ? 'card-warn' : ''} />
        </div>
      </div>

      <div className="panel">
        <h2>Low Stock Alerts</h2>
        {lowStockAlerts.length === 0 ? (
          <p className="hint">No low stock items right now.</p>
        ) : (
          <ul className="low-stock-alerts">
            {lowStockAlerts.map(item => (
              <li key={item.id}>
                <strong>{item.label}</strong>
                {' — Only '}{item.qty} left
                {' — Limit '}{item.limit}
                {' — '}
                <span className={item.recommended ? 'alert-reorder' : 'alert-ok'}>
                  {item.recommended ? 'Reorder Recommended' : 'Monitor'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel">
        <h2>Recent Orders</h2>
        {recentOrders.length === 0 ? (
          <p className="hint">No orders yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order Date</th>
                  <th>Invoice No</th>
                  <th>Customer Name</th>
                  <th>Total</th>
                  <th>Payment Status</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map(o => (
                  <tr key={o.id}>
                    <td>{o.order_date}</td>
                    <td>{o.invoice_no}</td>
                    <td>{o.customer_name}</td>
                    <td>{o.total}</td>
                    <td>{o.payment_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Sales — Last 30 Days</h2>
        <div className="sales-graph">
          {salesByDay.map(d => (
            <div key={d.date} className="bar-col" title={`${d.label}: ${money(d.total)}`}>
              <div className="bar-track" style={{ height: 140 }}>
                <div className="bar" style={{ height: `${d.pct}%` }} />
              </div>
              <span className="bar-label">{d.label}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function Card({ t, v, cls }) {
  return <div className={`card ${cls || ''}`}><p>{t}</p><b>{v}</b></div>
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

  return (
    <div className="split">
      <div className="panel">
        <h2>{editingId ? 'Edit Customer' : 'Add Customer'}</h2>
        <div className="form-grid customer-form">
          <input placeholder="Contact Name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
          <input placeholder="Business Name" value={f.company} onChange={e => setF({ ...f, company: e.target.value })} />
          <input placeholder="Phone" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />
          <input placeholder="Email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
          <textarea placeholder="Billing Address" value={f.billing_address}
            onChange={e => setF({ ...f, billing_address: e.target.value, shipping_address: f.shipping_same_as_billing ? e.target.value : f.shipping_address })} />
          <textarea placeholder="Shipping Address" value={f.shipping_address} disabled={f.shipping_same_as_billing}
            onChange={e => setF({ ...f, shipping_address: e.target.value })} />
          <label className="check">
            <input type="checkbox" checked={f.shipping_same_as_billing} onChange={e => setSame(e.target.checked)} />
            Same as Billing
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
            <button onClick={save}>Save Customer</button>
            {editingId && <button type="button" className="soft" onClick={cancelEdit}>Cancel</button>}
          </div>
        </div>
        <h2>Customers</h2>
        <input className="search" placeholder="Search customer..." value={q} onChange={e => setQ(e.target.value)} />
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
      </div>
      <CustomerDetail customer={selectedCustomer} data={data} deleteRow={deleteRow} onNavigate={onNavigate} />
    </div>
  )
}

function CustomerDetail({ customer, data, deleteRow, onNavigate }) {
  if (!customer) return <div className="panel detail"><h2>Customer Detail</h2><p>Select a customer.</p></div>
  const s = customerStats(customer, data)
  const moneyCols = ['total', 'amount']
  const cellValue = (r, c) => moneyCols.includes(c) ? money(r[c]) : c === 'created_at' ? dateOnly(r[c]) : String(r[c] ?? '')

  return (
    <div className="panel detail">
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

function Inventory({ data, addRow, updateRow, deleteRow }) {
  const blank = { style: '', brand: '', category: '', qty: '', buying_price: '', shipping_cost: '', selling_price: '', low_stock: 5 }
  const [f, setF] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const margin = formatMargin(f.buying_price, f.selling_price, f.shipping_cost)
  const profit = calcProfit(f.buying_price, f.selling_price, f.shipping_cost)

  function loadItem(item) {
    setEditingId(item.id)
    setF({
      style: item.style || '',
      brand: item.brand || '',
      category: item.category || '',
      qty: item.qty ?? '',
      buying_price: itemBuying(item) || '',
      shipping_cost: item.shipping_cost ?? '',
      selling_price: itemSelling(item) || '',
      low_stock: item.low_stock ?? 5,
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setF(blank)
  }

  async function save() {
    const buying = Number(f.buying_price) || 0, shippingCost = Number(f.shipping_cost) || 0
    const selling = Number(f.selling_price) || 0
    const row = {
      style: f.style, brand: f.brand, category: f.category,
      qty: Number(f.qty) || 0, buying_price: buying, shipping_cost: shippingCost, selling_price: selling,
      cost: buying, price: selling, low_stock: Number(f.low_stock) || 5,
    }
    if (editingId) await updateRow('inventory', editingId, row)
    else await addRow('inventory', row)
    cancelEdit()
  }

  const rows = data.inventory.map(item => {
    const buying = itemBuying(item), shippingCost = itemShipping(item), selling = itemSelling(item)
    const ri = reorderInfo(item, data.orders)
    return {
      ...item, buying_price: buying, shipping_cost: shippingCost, selling_price: selling,
      profit: calcProfit(buying, selling, shippingCost),
      margin: formatMargin(buying, selling, shippingCost),
      stock: stockLevel(item.qty),
      reorder: ri,
    }
  })

  return (
    <div className="panel inventory-page">
      <h2>{editingId ? 'Edit Inventory Item' : 'Add Inventory Item'}</h2>
      <div className="inventory-form">
        <div className="form-section">
          <h3>Product Details</h3>
          <div className="form-grid inventory-grid">
            <label>Style / SKU<input value={f.style} onChange={e => setF({ ...f, style: e.target.value })} /></label>
            <label>Brand<input value={f.brand} onChange={e => setF({ ...f, brand: e.target.value })} /></label>
            <label>Category<input value={f.category} onChange={e => setF({ ...f, category: e.target.value })} /></label>
            <label>Qty<input type="number" min="0" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} /></label>
          </div>
        </div>
        <div className="form-section">
          <h3>Pricing</h3>
          <div className="form-grid inventory-grid pricing-grid">
            <label>Buying Price<input type="number" min="0" step="0.01" value={f.buying_price} onChange={e => setF({ ...f, buying_price: e.target.value })} /></label>
            <label>Shipping Cost<input type="number" min="0" step="0.01" value={f.shipping_cost} onChange={e => setF({ ...f, shipping_cost: e.target.value })} /></label>
            <label>Selling Price<input type="number" min="0" step="0.01" value={f.selling_price} onChange={e => setF({ ...f, selling_price: e.target.value })} /></label>
            <div className="margin-display">
              <span>Profit $</span><strong>{money(profit)}</strong>
              <span>Margin</span><strong className="margin-value">{margin}</strong>
            </div>
          </div>
        </div>
        <div className="inventory-actions">
          <button className="inventory-save" onClick={save}>Save Item</button>
          {editingId && <button type="button" className="soft" onClick={cancelEdit}>Cancel</button>}
        </div>
      </div>
      <h2>Inventory</h2>
      <InventoryTable rows={rows} editingId={editingId} onEdit={loadItem} onDelete={id => deleteRow('inventory', id)} />
    </div>
  )
}

function InventoryTable({ rows, editingId, onEdit, onDelete }) {
  return (
    <div className="table-wrap inventory-table">
      <table>
        <thead><tr>
          <th>Style</th><th>Brand</th><th>Category</th><th>Qty</th>
          <th>Buying</th><th>Shipping</th><th>Selling</th><th>Profit $</th><th>Margin</th><th>Reorder</th><th>Edit</th><th>Delete</th>
        </tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.id} className={String(editingId) === String(r.id) ? 'sel' : ''} onClick={() => onEdit(r)}>
            <td><b>{r.style || '—'}</b></td>
            <td>{r.brand || '—'}</td>
            <td>{r.category || '—'}</td>
            <td><span className={`stock-badge ${r.stock.cls}`}>{r.stock.label}</span></td>
            <td>{money(r.buying_price)}</td>
            <td>{money(r.shipping_cost)}</td>
            <td>{money(r.selling_price)}</td>
            <td>{money(r.profit)}</td>
            <td className="margin-cell">{r.margin}</td>
            <td>{r.reorder ? (r.reorder.recommended
              ? <span className="reorder-yes">Reorder Recommended<br /><small>Avg {r.reorder.avg}/mo · Stock {r.qty}</small></span>
              : <span className="reorder-no">OK · Avg {r.reorder.avg}/mo</span>) : '—'}</td>
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
  )
}

function Orders({ data, createOrder, updateOrder, deleteOrder, selectedOrderId, clearSelection }) {
  const blank = {
    customer_id: '', inventory_id: '', customer_name: '', style: '', qty: '', price: '',
    shipping_method: '', shipping: '0', discount: '0', status: 'Open', note: '', tracking: '', due_date: '', order_date: '',
  }
  const [f, setF] = useState(blank)
  const [highlightId, setHighlightId] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editSnapshot, setEditSnapshot] = useState(null)
  const [editError, setEditError] = useState('')

  useEffect(() => {
    if (!selectedOrderId) return
    setHighlightId(selectedOrderId)
    clearSelection?.()
    requestAnimationFrame(() => {
      document.getElementById(`order-row-${selectedOrderId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [selectedOrderId, clearSelection])

  function cancelEdit() {
    setEditingId(null)
    setEditSnapshot(null)
    setEditError('')
    setF(blank)
  }

  function loadOrderForEdit(order) {
    setEditingId(order.id)
    setEditSnapshot({ inventory_id: order.inventory_id, qty: Number(order.qty || 0) })
    setEditError('')
    setHighlightId(order.id)
    setF({
      customer_id: order.customer_id || '',
      inventory_id: order.inventory_id || '',
      customer_name: order.customer_name || '',
      style: order.style || '',
      qty: order.qty ?? '',
      price: order.price ?? '',
      shipping_method: order.shipping_method || '',
      shipping: order.shipping ?? '0',
      discount: order.discount ?? '0',
      status: order.status || 'Open',
      note: order.note || '',
      tracking: order.tracking || '',
      due_date: toDbDate(order.due_date || ''),
      order_date: toDbDate(order.order_date || order.created_at || ''),
    })
    requestAnimationFrame(() => {
      document.getElementById('order-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  async function handleSave() {
    if (editingId) {
      const result = await updateOrder(editingId, f, editSnapshot)
      if (result?.error) {
        setEditError(result.error)
        return
      }
      cancelEdit()
      return
    }
    await createOrder(f)
    setF(blank)
  }

  async function handleDeleteOrder(id) {
    const ok = await deleteOrder(id)
    if (ok && String(editingId) === String(id)) cancelEdit()
  }

  function chooseCustomer(id) {
    const c = data.customers.find(x => String(x.id) === String(id))
    setF({ ...f, customer_id: id, customer_name: c?.company || c?.name || '', due_date: toDbDate(calcDueDate(c?.payment_terms, today())) })
  }

  function chooseItem(id) {
    const i = data.inventory.find(x => String(x.id) === String(id))
    setF({ ...f, inventory_id: id, style: i?.style || '', price: itemSelling(i) || '' })
  }

  const item = data.inventory.find(i => String(i.id) === String(f.inventory_id))
  const qty = Number(f.qty || 0), price = Number(f.price || 0)
  const outboundShipping = Number(f.shipping || 0), discount = Number(f.discount || 0)
  const unitCost = item ? itemUnitCost(item) : 0
  const lineProfit = qty * price + outboundShipping - discount - qty * unitCost

  function formatOrderDate(order) {
    const raw = order.order_date || order.created_at
    if (!raw) return '—'
    const dt = new Date(raw)
    if (Number.isNaN(dt.getTime())) return '—'
    return `${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}/${dt.getFullYear()}`
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
      <div className="form-grid">
        <select value={f.customer_id} onChange={e => chooseCustomer(e.target.value)}>
          <option value="">Select Customer</option>
          {data.customers.map(c => <option key={c.id} value={c.id}>{c.company || c.name}</option>)}
        </select>
        <select value={f.inventory_id} onChange={e => chooseItem(e.target.value)}>
          <option value="">Select Product</option>
          {data.inventory.map(i => (
            <option key={i.id} value={i.id}>{i.style}{i.brand ? ` · ${i.brand}` : ''} — Stock {i.qty}</option>
          ))}
        </select>
        {item && <div className="stock-info">Current Stock: <strong>{item.qty}</strong></div>}
        <input placeholder="Qty" type="number" min="1" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} />
        <input placeholder="Selling Price (auto)" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} />
        <div className="profit-preview">Profit: <strong>{money(lineProfit)}</strong></div>
        <label className="order-field">
          Shipping Method
          <select value={f.shipping_method} onChange={e => setF({ ...f, shipping_method: e.target.value })}>
            <option value="">Select Shipping Method</option>
            {SHIPPING_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="order-field">
          Shipping Charge
          <input placeholder="Shipping Charge" type="number" min="0" step="0.01" value={f.shipping} onChange={e => setF({ ...f, shipping: e.target.value })} />
        </label>
        <label className="order-field">
          Discount
          <input placeholder="Discount" type="number" min="0" step="0.01" value={f.discount} onChange={e => setF({ ...f, discount: e.target.value })} />
        </label>
        <input placeholder="Tracking #" value={f.tracking} onChange={e => setF({ ...f, tracking: e.target.value })} />
        <label className="order-field">
          Order Date
          <input type="date" value={f.order_date} onChange={e => setF({ ...f, order_date: e.target.value })} />
        </label>
        <input type="date" placeholder="Due Date" value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })} />
        <select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>
          {['Open', 'Pending', 'Shipped', 'Cancelled'].map(x => <option key={x}>{x}</option>)}
        </select>
        <input placeholder="Order Note" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
        <div className="order-form-actions">
          <button type="button" onClick={handleSave}>{editingId ? 'Update Invoice' : 'Create Invoice'}</button>
          {editingId && <button type="button" className="soft" onClick={cancelEdit}>Cancel Edit</button>}
        </div>
      </div>
      <h2>Orders</h2>
      <div className="table-wrap orders-table">
        <table>
          <thead>
            <tr>
              <th>Order Date</th>
              <th>Invoice No</th>
              <th>Customer Name</th>
              <th>Style</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Shipping Method</th>
              <th>Shipping Charge</th>
              <th>Total</th>
              <th>Profit</th>
              <th>Status</th>
              <th>Payment Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.orders.map(o => (
              <tr
                key={o.id}
                id={`order-row-${o.id}`}
                className={String(highlightId) === String(o.id) || String(editingId) === String(o.id) ? 'sel' : ''}
              >
                <td>{formatOrderDate(o)}</td>
                <td>{o.invoice_no || '—'}</td>
                <td>{o.customer_name || '—'}</td>
                <td>{o.style || '—'}</td>
                <td>{o.qty ?? 0}</td>
                <td>{money(o.price)}</td>
                <td>{o.shipping_method || '—'}</td>
                <td>{money(o.shipping)}</td>
                <td>{money(o.total)}</td>
                <td>{money(o.profit)}</td>
                <td>{o.status || '—'}</td>
                <td>{o.payment_status || '—'}</td>
                <td className="row-actions">
                  <button type="button" className="soft" onClick={() => loadOrderForEdit(o)}>Edit</button>
                  <button type="button" className="danger" onClick={() => handleDeleteOrder(o.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Invoice({ data, updateRow, selectedOrderId, clearSelection }) {
  const [id, setId] = useState('')
  const [highlightId, setHighlightId] = useState('')

  useEffect(() => {
    if (!selectedOrderId) return
    setId(selectedOrderId)
    setHighlightId(selectedOrderId)
    clearSelection?.()
    requestAnimationFrame(() => {
      document.getElementById('invoice-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [selectedOrderId, clearSelection])

  const o = data.orders.find(x => String(x.id) === String(id)) || data.orders[0]
  const c = data.customers.find(x => String(x.id) === String(o?.customer_id))
  if (!o) return <div className="panel">No invoice yet. Create an order first.</div>

  const paid = data.payments
    .filter(p => String(p.order_id) === String(o.id) || p.invoice_no === o.invoice_no)
    .reduce((s, p) => s + Number(p.amount || 0), 0)
  const due = Number(o.total || 0) - paid
  const subtotal = Number(o.qty || 0) * Number(o.price || 0)
  const shippingCharge = Number(o.shipping || 0)
  const discount = Number(o.discount || 0)
  const company = c?.company || o.customer_name || ''
  const contact = c?.name && c.name !== company ? c.name : ''
  const billLines = addressLines(c?.billing_address || c?.address)
  const shipLines = addressLines(c?.shipping_address || c?.billing_address || c?.address)

  return (
    <div className="panel" id="invoice-panel">
      <select
        className={String(highlightId) === String(id || o.id) ? 'sel' : ''}
        value={id || o.id}
        onChange={e => { setId(e.target.value); setHighlightId('') }}
      >
        {data.orders.map(o2 => <option key={o2.id} value={o2.id}>{o2.invoice_no} — {o2.customer_name}</option>)}
      </select>
      <div className={`invoice invoice-print${String(highlightId) === String(o.id) ? ' invoice-highlight' : ''}`}>
        <div className="invoice-header">
          <div><h1>INNER SOURCE BEAUTY</h1><p className="invoice-sub">Professional Beauty Distribution</p></div>
          <div className="invoice-meta">
            <h2>INVOICE</h2>
            <p><b>Invoice #:</b> {o.invoice_no}<br />
              <b>Date:</b> {dateOnly(o.created_at) || today()}<br />
              <b>Due Date:</b> {o.due_date || calcDueDate(c?.payment_terms, o.created_at)}<br />
              <b>Status:</b> {o.payment_status}<br />
              <b>Shipping Method:</b> {o.shipping_method || '—'}<br />
              <b>Tracking:</b> {o.tracking || '—'}</p>
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
          <thead><tr><th>Style</th><th>Qty</th><th>Unit Price</th><th>Line Total</th></tr></thead>
          <tbody><tr>
            <td>{o.style}</td><td>{o.qty}</td><td>{money(o.price)}</td><td>{money(subtotal)}</td>
          </tr></tbody>
        </table>
        <div className="invoice-totals">
          <p><b>Subtotal:</b> {money(subtotal)}</p>
          <p><b>Shipping Method:</b> {o.shipping_method || '—'}</p>
          <p><b>Shipping Charge:</b> {money(shippingCharge)}</p>
          <p><b>Discount:</b> {money(discount)}</p>
          <p className="invoice-grand-total"><b>Total:</b> {money(o.total)}</p>
          <p><b>Amount Paid:</b> {money(paid)}</p>
          <p className="balance-due"><b>Balance Due:</b> {money(due)}</p>
        </div>
        <p className="terms">ALL RETURNS ARE STORE CREDIT ONLY. RETURNS MUST BE DONE WITHIN 10 BUSINESS DAYS. 20% RESTOCKING FEE MAY APPLY. SHIPPING AND HANDLING ARE NOT REFUNDABLE BOTH WAYS.</p>
        <div className="signature-line">
          <div className="sig-box"><div className="sig-line" /><p>Authorized Signature</p></div>
          <div className="sig-box"><div className="sig-line" /><p>Date</p></div>
        </div>
        <div className="invoice-actions">
          <input placeholder="Update Tracking #" defaultValue={o.tracking || ''} id="track-input" />
          <button onClick={() => {
            const v = document.getElementById('track-input').value
            updateRow('orders', o.id, { tracking: v })
          }}>Save Tracking</button>
          <button onClick={() => window.print()}>Print / Save PDF</button>
        </div>
      </div>
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
    const total = Number(order.total || 0)
    const stored = order.payment_status || ''
    if (stored === 'Paid' || stored === 'Partial' || stored === 'Unpaid') return stored
    if (paid <= 0) return 'Unpaid'
    if (paid >= total) return 'Paid'
    return 'Partial'
  }

  function formatInvoiceDate(order) {
    const raw = order.order_date || order.created_at
    if (!raw) return '—'
    const dt = new Date(raw)
    if (Number.isNaN(dt.getTime())) return '—'
    return `${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}/${dt.getFullYear()}`
  }

  function formatDueDate(order) {
    const raw = order.due_date || calcDueDate(
      data.customers.find(c => String(c.id) === String(order.customer_id))?.payment_terms,
      order.created_at
    )
    if (!raw) return '—'
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) {
      const [y, m, d] = String(raw).split('-')
      return `${m}/${d}/${y}`
    }
    const dt = new Date(raw)
    if (Number.isNaN(dt.getTime())) return String(raw)
    return `${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}/${dt.getFullYear()}`
  }

  function paymentBadgeClass(status) {
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
    .filter(o => o.payment_status === 'Unpaid' || o.payment_status === 'Partial')
    .reduce((s, o) => s + o.balance, 0)

  const openInvoices = invoiceRows.filter(o => {
    if (invoiceFilter === 'Unpaid') return o.payment_status === 'Unpaid'
    if (invoiceFilter === 'Partial') return o.payment_status === 'Partial'
    if (invoiceFilter === 'Paid') return o.payment_status === 'Paid'
    return o.payment_status === 'Unpaid' || o.payment_status === 'Partial'
  })

  const customerOpenInvoices = receive.customer_id
    ? invoiceRows
      .filter(o =>
        String(o.customer_id) === String(receive.customer_id)
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
          {['All', 'Unpaid', 'Partial', 'Paid'].map(label => (
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

      <div className="panel">
        <h2>Payment History</h2>
        <Table rows={paymentRows} cols={['payment_date', 'customer_name', 'invoice_no', 'amount', 'method', 'reference_no', 'note']}
          highlightId={highlightId} rowIdPrefix="payment-row-" onDelete={id => deleteRow('payments', id)} />
      </div>
    </div>
  )
}

function Reports({ data, stats }) {
  const ranked = [...data.customers].map(c => ({ ...c, ...customerStats(c, data) })).sort((a, b) => b.sales - a.sales)
  const monthlyBreakdown = {}
  data.orders.forEach(o => {
    const m = localDateKey(o.created_at).slice(0, 7)
    monthlyBreakdown[m] = (monthlyBreakdown[m] || 0) + Number(o.total || 0)
  })
  const productStats = {}
  data.orders.forEach(o => {
    const k = o.style || 'Unknown'
    if (!productStats[k]) productStats[k] = { qty: 0, profit: 0 }
    productStats[k].qty += Number(o.qty || 0)
    productStats[k].profit += orderProfit(o)
  })
  const sorted = Object.entries(productStats).sort((a, b) => b[1].qty - a[1].qty)
  const best = sorted[0], worst = sorted[sorted.length - 1]
  const totalProfit = data.orders.reduce((s, o) => s + orderProfit(o), 0)

  return (
    <div className="panel">
      <h2>Reports</h2>
      <div className="cards">
        <Card t="Total Sales" v={money(stats.sales)} />
        <Card t="Total Profit" v={money(totalProfit)} />
        <Card t="Inventory Value" v={money(stats.inventoryValue)} />
        <Card t="Open Balance" v={money(stats.balance)} />
        <Card t="Monthly Sales" v={money(stats.monthlySales)} />
        <Card t="Customers" v={stats.customers} />
      </div>
      <h3>Customer Ranking</h3>
      <table><thead><tr><th>#</th><th>Customer</th><th>Sales</th><th>Paid</th><th>Balance</th><th>Orders</th></tr></thead>
        <tbody>{ranked.map((c, i) => (
          <tr key={c.id}><td>{i + 1}</td><td>{c.company || c.name}</td><td>{money(c.sales)}</td><td>{money(c.paid)}</td><td>{money(c.balance)}</td><td>{c.orders.length}</td></tr>
        ))}</tbody></table>
      <h3>Monthly Sales Breakdown</h3>
      <table><thead><tr><th>Month</th><th>Sales</th></tr></thead>
        <tbody>{Object.entries(monthlyBreakdown).sort((a, b) => b[0].localeCompare(a[0])).map(([m, v]) => (
          <tr key={m}><td>{m}</td><td>{money(v)}</td></tr>
        ))}</tbody></table>
      <div className="report-row">
        <div><h3>Best Seller</h3><p>{best ? `${best[0]} — ${best[1].qty} units · ${money(best[1].profit)} profit` : '—'}</p></div>
        <div><h3>Worst Seller</h3><p>{worst && sorted.length > 1 ? `${worst[0]} — ${worst[1].qty} units · ${money(worst[1].profit)} profit` : '—'}</p></div>
      </div>
    </div>
  )
}

function Settings({ data, reload, profile, setProfile, session, fetchProfilesForBackup, restoreBackupData, setLocalData }) {
  const isAdmin = (profile.role || 'Admin') === 'Admin'
  const [busy, setBusy] = useState(false)
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

  function setStatusMsg(msg, isError = false) {
    setStatus(msg)
    setStatusError(isError)
  }

  const exportLabels = { customers: 'Customers', inventory: 'Inventory', orders: 'Orders', payments: 'Payments' }

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
    await supabase.from('profiles').upsert({ id: session.user.id, email: session.user.email, role: newRole })
    setProfile({ ...profile, role: newRole })
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
        <p className="hint">Admin: all features · Staff: orders &amp; customers · Warehouse: inventory only</p>
        <button type="button" onClick={reload} disabled={busy}>Reload Cloud Data</button>
      </div>

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
            {cols.map(c => <td key={c}>{moneyCols.includes(c) ? money(r[c]) : c === 'created_at' ? dateOnly(r[c]) : String(r[c] ?? '')}</td>)}
            {onDelete && <td><button className="danger" onClick={() => onDelete(r.id)}>Delete</button></td>}
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
