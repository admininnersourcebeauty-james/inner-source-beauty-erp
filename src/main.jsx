import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase, hasSupabaseConfig } from './supabaseClient.js'
import './style.css'

const tables = ['customers', 'inventory', 'orders', 'payments']
const emptyData = { customers: [], inventory: [], orders: [], payments: [] }
const money = n => `$${(Number(n) || 0).toFixed(2)}`
const today = () => new Date().toISOString().slice(0, 10)

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function useLocalFallback() {
  const [data, setData] = useState(() => {
    try { return JSON.parse(localStorage.getItem('isb_local_data')) || emptyData } catch { return emptyData }
  })
  useEffect(() => localStorage.setItem('isb_local_data', JSON.stringify(data)), [data])
  return [data, setData]
}

function App() {
  const [session, setSession] = useState(null)
  const [authMode, setAuthMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authMsg, setAuthMsg] = useState('')
  const [page, setPage] = useState('Dashboard')
  const [cloudData, setCloudData] = useState(emptyData)
  const [localData, setLocalData] = useLocalFallback()
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')

  const data = hasSupabaseConfig && session ? cloudData : localData

  useEffect(() => {
    if (!hasSupabaseConfig) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setSession(session))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!hasSupabaseConfig || !session) return
    loadCloudData()
  }, [session])

  async function loadCloudData() {
    setLoading(true)
    const next = { ...emptyData }
    for (const t of tables) {
      const { data, error } = await supabase.from(t).select('*').order('created_at', { ascending: false })
      if (error) setNotice(error.message)
      next[t] = data || []
    }
    setCloudData(next)
    setLoading(false)
  }

  async function authAction(e) {
    e.preventDefault()
    setAuthMsg('')
    if (!hasSupabaseConfig) {
      if (!email || !password) return setAuthMsg('Enter any email and password for local test mode.')
      setSession({ user: { email } })
      return
    }
    const fn = authMode === 'signup' ? supabase.auth.signUp : supabase.auth.signInWithPassword
    const { error } = await fn.call(supabase.auth, { email, password })
    if (error) setAuthMsg(error.message)
    else setAuthMsg(authMode === 'signup' ? 'Account created. Check email if confirmation is enabled.' : '')
  }

  async function logout() {
    if (hasSupabaseConfig) await supabase.auth.signOut()
    setSession(null)
  }

  async function addRow(table, row) {
    if (hasSupabaseConfig && session) {
      const { error } = await supabase.from(table).insert(row)
      if (error) return setNotice(error.message)
      await loadCloudData()
    } else {
      setLocalData(prev => ({ ...prev, [table]: [{ id: uid(), created_at: new Date().toISOString(), ...row }, ...prev[table]] }))
    }
  }

  async function deleteRow(table, id) {
    if (!confirm('Delete this item?')) return
    if (hasSupabaseConfig && session) {
      const { error } = await supabase.from(table).delete().eq('id', id)
      if (error) return setNotice(error.message)
      await loadCloudData()
    } else {
      setLocalData(prev => ({ ...prev, [table]: prev[table].filter(r => r.id !== id) }))
    }
  }

  async function createOrder(order) {
    const item = data.inventory.find(i => String(i.id) === String(order.inventory_id))
    const total = Number(order.qty || 0) * Number(order.price || 0) + Number(order.shipping || 0) - Number(order.discount || 0)
    const payload = { ...order, total, invoice_no: order.invoice_no || `ISB-${Date.now().toString().slice(-6)}` }
    await addRow('orders', payload)
    if (item && !hasSupabaseConfig) {
      setLocalData(prev => ({
        ...prev,
        inventory: prev.inventory.map(i => String(i.id) === String(item.id) ? { ...i, qty: Number(i.qty || 0) - Number(order.qty || 0) } : i)
      }))
    }
  }

  const stats = useMemo(() => {
    const sales = data.orders.reduce((s, o) => s + Number(o.total || 0), 0)
    const paid = data.payments.reduce((s, p) => s + Number(p.amount || 0), 0)
    const stock = data.inventory.reduce((s, i) => s + Number(i.qty || 0), 0)
    return { sales, paid, balance: sales - paid, stock }
  }, [data])

  if (!session) {
    return <div className="login-wrap"><form className="login-card" onSubmit={authAction}>
      <div className="logo">ISB</div>
      <h1>INNER SOURCE BEAUTY ERP</h1>
      <p>{hasSupabaseConfig ? 'Supabase Cloud Login' : 'Local Test Login - add Supabase env in Vercel later'}</p>
      <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
      <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
      <button>{authMode === 'signin' ? 'Login' : 'Create Account'}</button>
      <button type="button" className="soft" onClick={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')}>
        {authMode === 'signin' ? 'Create Account' : 'Back to Login'}
      </button>
      {authMsg && <div className="msg">{authMsg}</div>}
    </form></div>
  }

  return <div className="app">
    <aside>
      <div className="brand"><span>ISB</span><b>INNER SOURCE BEAUTY</b></div>
      {['Dashboard','Customers','Inventory','Orders','Invoice','Payments','Reports','Settings'].map(x => <button key={x} className={page === x ? 'active' : ''} onClick={() => setPage(x)}>{x}</button>)}
      <button className="logout" onClick={logout}>Logout</button>
    </aside>
    <main>
      <header><h2>{page}</h2><div>{session.user?.email || 'Local user'}</div></header>
      {notice && <div className="notice" onClick={() => setNotice('')}>{notice}</div>}
      {loading ? <div className="panel">Loading...</div> : null}
      {page === 'Dashboard' && <Dashboard stats={stats} data={data} />}
      {page === 'Customers' && <Customers data={data} addRow={addRow} deleteRow={deleteRow} />}
      {page === 'Inventory' && <Inventory data={data} addRow={addRow} deleteRow={deleteRow} />}
      {page === 'Orders' && <Orders data={data} createOrder={createOrder} deleteRow={deleteRow} />}
      {page === 'Invoice' && <Invoice data={data} />}
      {page === 'Payments' && <Payments data={data} addRow={addRow} deleteRow={deleteRow} />}
      {page === 'Reports' && <Reports stats={stats} data={data} />}
      {page === 'Settings' && <Settings data={data} />}
    </main>
  </div>
}

function Dashboard({ stats, data }) {
  return <><div className="cards">
    <Card title="Total Sales" value={money(stats.sales)} />
    <Card title="Amount Paid" value={money(stats.paid)} />
    <Card title="Open Balance" value={money(stats.balance)} />
    <Card title="Stock Qty" value={stats.stock} />
  </div><div className="panel"><h3>Recent Orders</h3><Table rows={data.orders.slice(0, 6)} cols={['invoice_no','customer_name','style','qty','total','status']} /></div></>
}
function Card({ title, value }) { return <div className="card"><p>{title}</p><b>{value}</b></div> }
function Table({ rows, cols, onDelete }) { return <table><thead><tr>{cols.map(c => <th key={c}>{c}</th>)}{onDelete && <th></th>}</tr></thead><tbody>{rows.map(r => <tr key={r.id}>{cols.map(c => <td key={c}>{c.includes('price') || c.includes('total') || c.includes('amount') ? money(r[c]) : String(r[c] ?? '')}</td>)}{onDelete && <td><button className="danger" onClick={() => onDelete(r.id)}>Delete</button></td>}</tr>)}</tbody></table> }

function Customers({ data, addRow, deleteRow }) {
  const [f, setF] = useState({ name:'', company:'', phone:'', email:'', address:'' })
  return <div className="panel"><h3>Add Customer</h3><Form fields={['name','company','phone','email','address']} f={f} setF={setF} onSubmit={() => { addRow('customers', f); setF({ name:'', company:'', phone:'', email:'', address:'' }) }} /><h3>Customers</h3><Table rows={data.customers} cols={['name','company','phone','email','address']} onDelete={id => deleteRow('customers', id)} /></div>
}
function Inventory({ data, addRow, deleteRow }) {
  const [f, setF] = useState({ style:'', color:'', qty:'', cost:'', price:'' })
  return <div className="panel"><h3>Add Inventory</h3><Form fields={['style','color','qty','cost','price']} f={f} setF={setF} onSubmit={() => { addRow('inventory', { ...f, qty:Number(f.qty), cost:Number(f.cost), price:Number(f.price) }); setF({ style:'', color:'', qty:'', cost:'', price:'' }) }} /><h3>Inventory</h3><Table rows={data.inventory} cols={['style','color','qty','cost','price']} onDelete={id => deleteRow('inventory', id)} /></div>
}
function Orders({ data, createOrder, deleteRow }) {
  const [f, setF] = useState({ customer_name:'', inventory_id:'', style:'', qty:'', price:'', shipping:'0', discount:'0', status:'Pending' })
  function chooseItem(id){ const item=data.inventory.find(i=>String(i.id)===String(id)); setF({...f, inventory_id:id, style:item?.style||'', price:item?.price||''}) }
  return <div className="panel"><h3>Create Order</h3><div className="form-grid">
    <input placeholder="Customer Name" value={f.customer_name} onChange={e=>setF({...f,customer_name:e.target.value})}/>
    <select value={f.inventory_id} onChange={e=>chooseItem(e.target.value)}><option value="">Select Item</option>{data.inventory.map(i=><option key={i.id} value={i.id}>{i.style} / {i.color} / Stock {i.qty}</option>)}</select>
    {['style','qty','price','shipping','discount','status'].map(x=><input key={x} placeholder={x} value={f[x]} onChange={e=>setF({...f,[x]:e.target.value})}/>) }
    <button onClick={()=>{createOrder({...f, qty:Number(f.qty), price:Number(f.price), shipping:Number(f.shipping), discount:Number(f.discount)}); setF({ customer_name:'', inventory_id:'', style:'', qty:'', price:'', shipping:'0', discount:'0', status:'Pending' })}}>Create Order</button>
  </div><h3>Orders</h3><Table rows={data.orders} cols={['invoice_no','customer_name','style','qty','price','total','status']} onDelete={id => deleteRow('orders', id)} /></div>
}
function Invoice({ data }) {
  const [id, setId] = useState('')
  const o = data.orders.find(x => String(x.id) === String(id)) || data.orders[0]
  if (!o) return <div className="panel">No invoice yet.</div>
  return <div className="panel"><select value={id} onChange={e=>setId(e.target.value)}>{data.orders.map(o=><option key={o.id} value={o.id}>{o.invoice_no} - {o.customer_name}</option>)}</select><div className="invoice"><h1>INNER SOURCE BEAUTY</h1><h2>INVOICE</h2><p><b>Invoice #:</b> {o.invoice_no}<br/><b>Date:</b> {new Date(o.created_at || Date.now()).toLocaleDateString()}<br/><b>Bill To:</b> {o.customer_name}</p><table><tbody><tr><th>Style</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr><tr><td>{o.style}</td><td>{o.qty}</td><td>{money(o.price)}</td><td>{money(o.total)}</td></tr></tbody></table><h2>Total Due: {money(o.total)}</h2><p className="terms">ALL RETURNS ARE STORE CREDIT ONLY. RETURNS MUST BE DONE WITHIN 10 BUSINESS DAYS. 20% RESTOCKING FEE MAY APPLY. SHIPPING AND HANDLING ARE NOT REFUNDABLE BOTH WAYS.</p><button onClick={()=>window.print()}>Print / Save PDF</button></div></div>
}
function Payments({ data, addRow, deleteRow }) {
  const [f, setF] = useState({ invoice_no:'', amount:'', method:'Zelle', note:'' })
  return <div className="panel"><h3>Add Payment</h3><Form fields={['invoice_no','amount','method','note']} f={f} setF={setF} onSubmit={() => { addRow('payments', { ...f, amount:Number(f.amount) }); setF({ invoice_no:'', amount:'', method:'Zelle', note:'' }) }} /><h3>Payments</h3><Table rows={data.payments} cols={['invoice_no','amount','method','note']} onDelete={id => deleteRow('payments', id)} /></div>
}
function Reports({ stats, data }) { return <div className="panel"><h3>Reports</h3><p>Total Customers: {data.customers.length}</p><p>Total Inventory Items: {data.inventory.length}</p><p>Total Orders: {data.orders.length}</p><p>Total Sales: {money(stats.sales)}</p><p>Open Balance: {money(stats.balance)}</p></div> }
function Settings({ data }) { return <div className="panel"><h3>Settings</h3><p>Use Supabase Authentication to add employees. Add environment variables in Vercel for cloud mode.</p><button onClick={()=>{const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='isb-backup.json'; a.click();}}>Download Backup JSON</button></div> }
function Form({ fields, f, setF, onSubmit }) { return <div className="form-grid">{fields.map(x => <input key={x} placeholder={x} value={f[x] || ''} onChange={e => setF({ ...f, [x]: e.target.value })} />)}<button onClick={onSubmit}>Save</button></div> }

createRoot(document.getElementById('root')).render(<App />)
