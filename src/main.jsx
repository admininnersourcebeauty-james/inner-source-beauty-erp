import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase, hasSupabaseConfig } from './supabaseClient.js'
import './style.css'

const TABLES = ['customers', 'inventory', 'orders', 'payments']
const EMPTY = { customers: [], inventory: [], orders: [], payments: [] }
const PAYMENT_METHODS = ['Zelle', 'Venmo', 'Cash', 'Credit Card', 'Check', 'ACH/Wire']
const TERMS = ['COD', 'NET 15', 'NET 30', 'NET 45', 'NET 60']
const STATUSES = ['Active', 'Hold', 'VIP']
const ROLES = ['Admin', 'Staff', 'Warehouse']

const money = n => `$${(Number(n) || 0).toFixed(2)}`
const itemBuying = item => Number(item?.buying_price ?? item?.cost ?? 0)
const itemSelling = item => Number(item?.selling_price ?? item?.price ?? item?.retail ?? 0)
const calcMargin = (buying, selling) => {
  const b = Number(buying) || 0, s = Number(selling) || 0
  if (s <= 0) return null
  return ((s - b) / s) * 100
}
const calcProfit = (buying, selling) => Number(selling) - Number(buying)
const formatMargin = (buying, selling) => {
  const m = calcMargin(buying, selling)
  return m === null ? '—' : `${m.toFixed(1)}%`
}
const dateOnly = d => d ? String(d).slice(0, 10) : ''
const localDateKey = d => {
  if (!d) return ''
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
const today = () => new Date().toISOString().slice(0, 10)
const toDbDate = value => {
  if (!value) return today()
  const s = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return today()
  return d.toISOString().slice(0, 10)
}
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36)
const isToday = d => dateOnly(d) === today()
const isThisMonth = d => {
  if (!d) return false
  const dt = new Date(d), now = new Date()
  return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth()
}
const calcDueDate = (terms, fromDate) => {
  const base = fromDate ? new Date(fromDate) : new Date()
  const map = { 'NET 15': 15, 'NET 30': 30, 'NET 45': 45, 'NET 60': 60 }
  const days = map[terms] || 0
  if (days === 0) return dateOnly(base)
  base.setDate(base.getDate() + days)
  return dateOnly(base)
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

  async function createOrder(f) {
    const item = data.inventory.find(i => String(i.id) === String(f.inventory_id))
    const customer = data.customers.find(c => String(c.id) === String(f.customer_id))
    const qty = Number(f.qty || 0), price = Number(f.price || 0)
    const shipping = Number(f.shipping || 0), discount = Number(f.discount || 0)
    const buying = item ? itemBuying(item) : 0
    const total = qty * price + shipping - discount
    const profit = total - (qty * buying)
    const dueDate = toDbDate(f.due_date || calcDueDate(customer?.payment_terms, today()))
    const payload = {
      customer_id: f.customer_id || null,
      inventory_id: f.inventory_id || null,
      customer_name: customer?.company || customer?.name || f.customer_name || '',
      style: item?.style || f.style,
      qty, price, buying_price: buying, profit,
      shipping, discount, total,
      invoice_no: f.invoice_no || `ISB-${Date.now().toString().slice(-6)}`,
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

  async function recordPayment(f) {
    const amount = Number(f.amount || 0)
    const order = data.orders.find(o => String(o.id) === String(f.order_id))
    await addRow('payments', {
      customer_id: f.customer_id || order?.customer_id || null,
      order_id: f.order_id || null,
      invoice_no: f.invoice_no || order?.invoice_no || '',
      payment_date: f.payment_date || today(),
      amount, method: f.method || 'Zelle',
      reference_no: f.reference_no || '',
      note: f.note || '',
    })
    if (order) {
      const paid = data.payments
        .filter(p => String(p.order_id) === String(order.id) || p.invoice_no === order.invoice_no)
        .reduce((s, p) => s + Number(p.amount || 0), 0) + amount
      const total = Number(order.total || 0)
      const status = paid <= 0 ? 'Unpaid' : paid >= total ? 'Paid' : 'Partial'
      await updateRow('orders', order.id, { payment_status: status })
    }
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
        {page === 'Customers' && <Customers data={data} addRow={addRow} updateRow={updateRow} deleteRow={deleteRow} onNavigate={openRecord} />}
        {page === 'Inventory' && <Inventory data={data} addRow={addRow} updateRow={updateRow} deleteRow={deleteRow} />}
        {page === 'Orders' && <Orders data={data} createOrder={createOrder} deleteRow={deleteRow}
          selectedOrderId={selectedRecord.page === 'Orders' ? selectedRecord.id : ''} clearSelection={clearSelectedRecord} />}
        {page === 'Invoice' && <Invoice data={data} updateRow={updateRow}
          selectedOrderId={selectedRecord.page === 'Invoice' ? selectedRecord.id : ''} clearSelection={clearSelectedRecord} />}
        {page === 'Payments' && <Payments data={data} recordPayment={recordPayment} deleteRow={deleteRow}
          selectedPaymentId={selectedRecord.page === 'Payments' ? selectedRecord.id : ''} clearSelection={clearSelectedRecord} />}
        {page === 'Reports' && <Reports data={data} stats={stats} />}
        {page === 'Settings' && <Settings data={data} reload={loadCloudData} profile={profile} setProfile={setProfile} session={session} />}
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
  const inventoryValue = data.inventory.reduce((s, i) => s + Number(i.qty || 0) * itemBuying(i), 0)
  const expectedProfit = data.orders.reduce((s, o) => s + Number(o.profit ?? ((Number(o.qty) * Number(o.price)) - (Number(o.qty) * Number(o.buying_price || 0)))), 0)
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

function orderProfit(o) {
  if (o.profit != null && o.profit !== '') return Number(o.profit) || 0
  const qty = Number(o.qty) || 0, price = Number(o.price) || 0, buying = Number(o.buying_price) || 0
  return qty * price - qty * buying
}

function inventoryQty(i) {
  return Math.max(0, Number(i.qty) || 0)
}

function inventoryUnitCost(i) {
  return Number(i?.buying_price || i?.cost || i?.buy_price || 0)
}

function Dashboard({ data, stats }) {
  const todayOrders = data.orders.filter(o => isToday(o.created_at))
  const monthOrders = data.orders.filter(o => isThisMonth(o.created_at))

  const todaySales = todayOrders.reduce((s, o) => s + Number(o.total || 0), 0)
  const todayProfit = todayOrders.reduce((s, o) => s + orderProfit(o), 0)
  const ordersToday = todayOrders.length
  const monthlySales = monthOrders.reduce((s, o) => s + Number(o.total || 0), 0)
  const monthlyProfit = monthOrders.reduce((s, o) => s + orderProfit(o), 0)
  const openBalance = stats.balance
  const inventoryValue = data.inventory.reduce((s, i) => {
    const qty = Math.max(0, Number(i.qty) || 0)
    const unit = Number(i.buying_price || i.cost || i.buy_price || 0)
    return s + qty * unit
  }, 0)
  const expectedProfit = data.orders.reduce((s, o) => s + orderProfit(o), 0)
  const totalCustomers = data.customers.length
  const lowStock = data.inventory.filter(i => inventoryQty(i) < 5).length
  const salesByDay = buildSalesGraph(data.orders)

  return (
    <>
      <div className="cards">
        <Card t="Today's Sales" v={money(todaySales)} />
        <Card t="Today's Profit" v={money(todayProfit)} />
        <Card t="Orders Today" v={ordersToday} />
        <Card t="Monthly Sales" v={money(monthlySales)} />
        <Card t="Monthly Profit" v={money(monthlyProfit)} />
        <Card t="Open Balance" v={money(openBalance)} />
        <Card t="Inventory Value" v={money(inventoryValue)} />
        <Card t="Expected Profit" v={money(expectedProfit)} />
        <Card t="Total Customers" v={totalCustomers} />
        <Card t="Low Stock" v={lowStock} cls={lowStock > 0 ? 'card-warn' : ''} />
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

function Customers({ data, addRow, updateRow, deleteRow, onNavigate }) {
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
                <tr key={c.id} onClick={() => loadCustomer(c)}
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
  const blank = { style: '', brand: '', category: '', qty: '', buying_price: '', selling_price: '', low_stock: 5 }
  const [f, setF] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const margin = formatMargin(f.buying_price, f.selling_price)
  const profit = calcProfit(f.buying_price, f.selling_price)

  function loadItem(item) {
    setEditingId(item.id)
    setF({
      style: item.style || '',
      brand: item.brand || '',
      category: item.category || '',
      qty: item.qty ?? '',
      buying_price: itemBuying(item) || '',
      selling_price: itemSelling(item) || '',
      low_stock: item.low_stock ?? 5,
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setF(blank)
  }

  async function save() {
    const buying = Number(f.buying_price) || 0, selling = Number(f.selling_price) || 0
    const row = {
      style: f.style, brand: f.brand, category: f.category,
      qty: Number(f.qty) || 0, buying_price: buying, selling_price: selling,
      cost: buying, price: selling, low_stock: Number(f.low_stock) || 5,
    }
    if (editingId) await updateRow('inventory', editingId, row)
    else await addRow('inventory', row)
    cancelEdit()
  }

  const rows = data.inventory.map(item => {
    const buying = itemBuying(item), selling = itemSelling(item)
    const ri = reorderInfo(item, data.orders)
    return {
      ...item, buying_price: buying, selling_price: selling,
      profit: calcProfit(buying, selling),
      margin: formatMargin(buying, selling),
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
          <th>Buying</th><th>Selling</th><th>Profit $</th><th>Margin</th><th>Reorder</th><th></th>
        </tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.id} className={String(editingId) === String(r.id) ? 'sel' : ''} onClick={() => onEdit(r)}>
            <td><b>{r.style || '—'}</b></td>
            <td>{r.brand || '—'}</td>
            <td>{r.category || '—'}</td>
            <td><span className={`stock-badge ${r.stock.cls}`}>{r.stock.label}</span></td>
            <td>{money(r.buying_price)}</td>
            <td>{money(r.selling_price)}</td>
            <td>{money(r.profit)}</td>
            <td className="margin-cell">{r.margin}</td>
            <td>{r.reorder ? (r.reorder.recommended
              ? <span className="reorder-yes">Reorder Recommended<br /><small>Avg {r.reorder.avg}/mo · Stock {r.qty}</small></span>
              : <span className="reorder-no">OK · Avg {r.reorder.avg}/mo</span>) : '—'}</td>
            <td className="row-actions" onClick={e => e.stopPropagation()}>
              <button type="button" className="soft" onClick={() => onEdit(r)}>Edit</button>
              <button type="button" className="danger" onClick={() => onDelete(r.id)}>Delete</button>
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

function Orders({ data, createOrder, deleteRow, selectedOrderId, clearSelection }) {
  const blank = {
    customer_id: '', inventory_id: '', customer_name: '', style: '', qty: '', price: '',
    shipping: '0', discount: '0', status: 'Open', note: '', tracking: '', due_date: '',
  }
  const [f, setF] = useState(blank)
  const [highlightId, setHighlightId] = useState('')

  useEffect(() => {
    if (!selectedOrderId) return
    setHighlightId(selectedOrderId)
    clearSelection?.()
    requestAnimationFrame(() => {
      document.getElementById(`order-row-${selectedOrderId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [selectedOrderId, clearSelection])

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
  const buying = item ? itemBuying(item) : 0
  const lineProfit = (price - buying) * qty

  return (
    <div className="panel">
      <h2>Create Order / Invoice</h2>
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
        <input placeholder="Shipping" value={f.shipping} onChange={e => setF({ ...f, shipping: e.target.value })} />
        <input placeholder="Discount" value={f.discount} onChange={e => setF({ ...f, discount: e.target.value })} />
        <input placeholder="Tracking #" value={f.tracking} onChange={e => setF({ ...f, tracking: e.target.value })} />
        <input type="date" placeholder="Due Date" value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })} />
        <select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>
          {['Open', 'Pending', 'Shipped', 'Cancelled'].map(x => <option key={x}>{x}</option>)}
        </select>
        <input placeholder="Order Note" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
        <button onClick={() => { createOrder(f); setF(blank) }}>Create Invoice</button>
      </div>
      <h2>Orders</h2>
      <Table rows={data.orders} cols={['invoice_no', 'customer_name', 'style', 'qty', 'price', 'total', 'profit', 'status', 'payment_status']}
        highlightId={highlightId} rowIdPrefix="order-row-" onDelete={id => deleteRow('orders', id)} />
    </div>
  )
}

function Invoice({ data, updateRow, selectedOrderId, clearSelection }) {
  const [id, setId] = useState('')

  useEffect(() => {
    if (!selectedOrderId) return
    setId(selectedOrderId)
    clearSelection?.()
  }, [selectedOrderId, clearSelection])

  const o = data.orders.find(x => String(x.id) === String(id)) || data.orders[0]
  const c = data.customers.find(x => String(x.id) === String(o?.customer_id))
  if (!o) return <div className="panel">No invoice yet. Create an order first.</div>

  const paid = data.payments
    .filter(p => String(p.order_id) === String(o.id) || p.invoice_no === o.invoice_no)
    .reduce((s, p) => s + Number(p.amount || 0), 0)
  const due = Number(o.total || 0) - paid

  return (
    <div className="panel">
      <select value={id || o.id} onChange={e => setId(e.target.value)}>
        {data.orders.map(o2 => <option key={o2.id} value={o2.id}>{o2.invoice_no} — {o2.customer_name}</option>)}
      </select>
      <div className="invoice">
        <div className="invoice-header">
          <div><h1>INNER SOURCE BEAUTY</h1><p className="invoice-sub">Professional Beauty Distribution</p></div>
          <div className="invoice-meta">
            <h2>INVOICE</h2>
            <p><b>Invoice #:</b> {o.invoice_no}<br />
              <b>Date:</b> {dateOnly(o.created_at) || today()}<br />
              <b>Due Date:</b> {o.due_date || calcDueDate(c?.payment_terms, o.created_at)}<br />
              <b>Status:</b> {o.payment_status}<br />
              <b>Tracking:</b> {o.tracking || '—'}</p>
          </div>
        </div>
        <div className="invoice-grid">
          <div className="invoice-block">
            <h3>Bill To</h3>
            <p>{c?.company || o.customer_name}<br />{c?.name && c.name !== c?.company ? <>{c.name}<br /></> : null}{c?.billing_address || c?.address || ''}</p>
          </div>
          <div className="invoice-block">
            <h3>Ship To</h3>
            <p>{c?.company || o.customer_name}<br />{c?.shipping_address || c?.billing_address || c?.address || ''}</p>
          </div>
          <div className="invoice-block">
            <h3>Terms</h3>
            <p>{c?.payment_terms || 'COD'}<br />Preferred: {c?.preferred_payment || '—'}</p>
          </div>
        </div>
        <table className="invoice-table">
          <thead><tr><th>Style</th><th>Qty</th><th>Unit Price</th><th>Shipping</th><th>Discount</th><th>Total</th></tr></thead>
          <tbody><tr>
            <td>{o.style}</td><td>{o.qty}</td><td>{money(o.price)}</td>
            <td>{money(o.shipping)}</td><td>{money(o.discount)}</td><td>{money(o.total)}</td>
          </tr></tbody>
        </table>
        <div className="invoice-totals">
          <p><b>Total Due:</b> {money(o.total)}</p>
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

function Payments({ data, recordPayment, deleteRow, selectedPaymentId, clearSelection }) {
  const blank = { customer_id: '', order_id: '', invoice_no: '', payment_date: today(), amount: '', method: 'Zelle', reference_no: '', note: '' }
  const [f, setF] = useState(blank)
  const [highlightId, setHighlightId] = useState('')

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

  const paymentRows = data.payments.map(p => ({ ...p, customer_name: paymentCustomerName(p) }))

  useEffect(() => {
    if (!selectedPaymentId) return
    setHighlightId(selectedPaymentId)
    const payment = data.payments.find(p => String(p.id) === String(selectedPaymentId))
    if (payment) {
      setF({
        customer_id: payment.customer_id || '',
        order_id: payment.order_id || '',
        invoice_no: payment.invoice_no || '',
        payment_date: payment.payment_date || today(),
        amount: payment.amount ?? '',
        method: payment.method || 'Zelle',
        reference_no: payment.reference_no || '',
        note: payment.note || '',
      })
    }
    clearSelection?.()
    requestAnimationFrame(() => {
      document.getElementById(`payment-row-${selectedPaymentId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [selectedPaymentId, clearSelection, data.payments])

  function chooseOrder(id) {
    const o = data.orders.find(x => String(x.id) === String(id))
    const paid = data.payments.filter(p => String(p.order_id) === String(id)).reduce((s, p) => s + Number(p.amount || 0), 0)
    const remaining = Number(o?.total || 0) - paid
    setF({ ...f, order_id: id, customer_id: o?.customer_id || '', invoice_no: o?.invoice_no || '', amount: remaining > 0 ? remaining : o?.total || '' })
  }

  return (
    <div className="panel">
      <h2>Add Payment</h2>
      <div className="form-grid">
        <select value={f.order_id} onChange={e => chooseOrder(e.target.value)}>
          <option value="">Select Invoice</option>
          {data.orders.map(o => (
            <option key={o.id} value={o.id}>{o.invoice_no} - {orderCustomerName(o)} - {money(o.total)}</option>
          ))}
        </select>
        <input type="date" value={f.payment_date} onChange={e => setF({ ...f, payment_date: e.target.value })} />
        <input placeholder="Amount" type="number" step="0.01" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} />
        <div className="method-boxes">
          {PAYMENT_METHODS.map(m => (
            <button key={m} type="button" className={f.method === m ? 'chosen' : ''} onClick={() => setF({ ...f, method: m })}>{m}</button>
          ))}
        </div>
        <input placeholder="Reference / Check #" value={f.reference_no} onChange={e => setF({ ...f, reference_no: e.target.value })} />
        <input placeholder="Memo" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
        <button onClick={() => { recordPayment(f); setF(blank) }}>Save Payment</button>
      </div>
      <p className="hint">Payment automatically updates invoice status (Paid / Partial / Unpaid) and reduces customer balance.</p>
      <h2>Payments</h2>
      <Table rows={paymentRows} cols={['payment_date', 'customer_name', 'invoice_no', 'amount', 'method', 'reference_no', 'note']}
        highlightId={highlightId} rowIdPrefix="payment-row-" onDelete={id => deleteRow('payments', id)} />
    </div>
  )
}

function Reports({ data, stats }) {
  const ranked = [...data.customers].map(c => ({ ...c, ...customerStats(c, data) })).sort((a, b) => b.sales - a.sales)
  const monthlyBreakdown = {}
  data.orders.forEach(o => {
    const m = o.created_at ? o.created_at.slice(0, 7) : 'unknown'
    monthlyBreakdown[m] = (monthlyBreakdown[m] || 0) + Number(o.total || 0)
  })
  const productSales = {}
  data.orders.forEach(o => {
    const k = o.style || 'Unknown'
    productSales[k] = (productSales[k] || 0) + Number(o.qty || 0)
  })
  const sorted = Object.entries(productSales).sort((a, b) => b[1] - a[1])
  const best = sorted[0], worst = sorted[sorted.length - 1]
  const totalProfit = data.orders.reduce((s, o) => s + Number(o.profit || 0), 0)

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
        <div><h3>Best Seller</h3><p>{best ? `${best[0]} — ${best[1]} units sold` : '—'}</p></div>
        <div><h3>Worst Seller</h3><p>{worst && sorted.length > 1 ? `${worst[0]} — ${worst[1]} units sold` : '—'}</p></div>
      </div>
    </div>
  )
}

function Settings({ data, reload, profile, setProfile, session }) {
  function backup() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'inner-source-beauty-backup.json'
    a.click()
  }

  async function updateRole(newRole) {
    if (!hasSupabaseConfig || !session?.user?.id) { setProfile({ ...profile, role: newRole }); return }
    await supabase.from('profiles').upsert({ id: session.user.id, email: session.user.email, role: newRole })
    setProfile({ ...profile, role: newRole })
  }

  return (
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
      <button onClick={backup}>Download Backup JSON</button>
      <button onClick={reload}>Reload Cloud Data</button>
    </div>
  )
}

function Table({ rows, cols, onDelete, highlightId, rowIdPrefix }) {
  const moneyCols = ['total', 'amount', 'price', 'cost', 'buying_price', 'selling_price', 'shipping', 'discount', 'profit']
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
