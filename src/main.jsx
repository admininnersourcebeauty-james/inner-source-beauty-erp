import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase, hasSupabaseConfig } from './supabaseClient.js'
import './style.css'

const TABLES = ['customers','inventory','orders','payments']
const EMPTY = { customers: [], inventory: [], orders: [], payments: [] }
const PAYMENT_METHODS = ['Zelle','Venmo','Cash','Credit Card','Check','ACH/Wire']
const TERMS = ['COD','NET 15','NET 30','NET 45','NET 60']
const money = n => `$${(Number(n)||0).toFixed(2)}`
const itemBuying = item => Number(item?.buying_price ?? item?.cost ?? 0)
const itemSelling = item => Number(item?.selling_price ?? item?.price ?? item?.retail ?? 0)
const calcMargin = (buying, selling) => {
  const b = Number(buying) || 0, s = Number(selling) || 0
  if (s <= 0) return null
  return ((s - b) / s) * 100
}
const formatMargin = (buying, selling) => {
  const m = calcMargin(buying, selling)
  return m === null ? '—' : `${m.toFixed(1)}%`
}
const dateOnly = d => d ? String(d).slice(0,10) : ''
const today = () => new Date().toISOString().slice(0,10)
const uid = () => Math.random().toString(36).slice(2)+Date.now().toString(36)

function useLocalData(){
  const [data,setData]=useState(()=>{try{return JSON.parse(localStorage.getItem('isb_data_v1'))||EMPTY}catch{return EMPTY}})
  useEffect(()=>localStorage.setItem('isb_data_v1',JSON.stringify(data)),[data])
  return [data,setData]
}

function App(){
  const [session,setSession]=useState(null)
  const [authMode,setAuthMode]=useState('signin')
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [authMsg,setAuthMsg]=useState('')
  const [page,setPage]=useState('Dashboard')
  const [cloudData,setCloudData]=useState(EMPTY)
  const [localData,setLocalData]=useLocalData()
  const [notice,setNotice]=useState('')
  const [loading,setLoading]=useState(false)

  const data = hasSupabaseConfig && session ? cloudData : localData

  useEffect(()=>{
    if(!hasSupabaseConfig) return
    supabase.auth.getSession().then(({data})=>setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e,s)=>setSession(s))
    return ()=>sub.subscription.unsubscribe()
  },[])
  useEffect(()=>{ if(hasSupabaseConfig && session) loadCloudData() },[session])

  async function loadCloudData(){
    setLoading(true); setNotice('')
    const next={...EMPTY}
    for(const t of TABLES){
      const { data: rows, error } = await supabase.from(t).select('*').order('created_at',{ascending:false})
      if(error) setNotice(error.message)
      next[t]=rows||[]
    }
    setCloudData(next); setLoading(false)
  }

  async function authAction(e){
    e.preventDefault(); setAuthMsg('')
    if(!email || !password) return setAuthMsg('Email and password required')
    if(!hasSupabaseConfig){ setSession({user:{email}}); return }
    const res = authMode==='signup'
      ? await supabase.auth.signUp({email,password})
      : await supabase.auth.signInWithPassword({email,password})
    if(res.error) setAuthMsg(res.error.message)
    else setAuthMsg(authMode==='signup'?'Account created. Check email if confirmation is enabled.':'')
  }
  async function logout(){ if(hasSupabaseConfig) await supabase.auth.signOut(); setSession(null) }

  async function addRow(table,row){
    setNotice('')
    if(hasSupabaseConfig && session){
      const { error } = await supabase.from(table).insert(row)
      if(error) return setNotice(error.message)
      await loadCloudData()
    } else setLocalData(p=>({...p,[table]:[{id:uid(),created_at:new Date().toISOString(),...row},...p[table]]}))
  }
  async function updateRow(table,id,row){
    setNotice('')
    if(hasSupabaseConfig && session){
      const { error } = await supabase.from(table).update(row).eq('id',id)
      if(error) return setNotice(error.message)
      await loadCloudData()
    } else setLocalData(p=>({...p,[table]:p[table].map(x=>String(x.id)===String(id)?{...x,...row}:x)}))
  }
  async function deleteRow(table,id){
    if(!confirm('Delete this item?')) return
    if(hasSupabaseConfig && session){
      const { error } = await supabase.from(table).delete().eq('id',id)
      if(error) return setNotice(error.message)
      await loadCloudData()
    } else setLocalData(p=>({...p,[table]:p[table].filter(x=>String(x.id)!==String(id))}))
  }
  async function createOrder(f){
    const item=data.inventory.find(i=>String(i.id)===String(f.inventory_id))
    const qty=Number(f.qty||0), price=Number(f.price||0), shipping=Number(f.shipping||0), discount=Number(f.discount||0)
    const total=qty*price+shipping-discount
    const customer=data.customers.find(c=>String(c.id)===String(f.customer_id))
    const payload={...f, qty, price, shipping, discount, total, invoice_no:f.invoice_no||`ISB-${Date.now().toString().slice(-6)}`, customer_name:customer?.company||customer?.name||f.customer_name||'', style:item?.style||f.style, status:f.status||'Open', payment_status:f.payment_status||'Unpaid'}
    await addRow('orders', payload)
    if(item){
      const newQty=Number(item.qty||0)-qty
      await updateRow('inventory', item.id, { qty:newQty })
    }
  }

  const stats=useMemo(()=>calcStats(data),[data])

  if(!session) return <Login authMode={authMode} setAuthMode={setAuthMode} email={email} setEmail={setEmail} password={password} setPassword={setPassword} authAction={authAction} authMsg={authMsg}/>

  return <div className="app">
    <aside><div className="brand"><span>ISB</span><b>INNER SOURCE<br/>BEAUTY</b></div>{['Dashboard','Customers','Inventory','Orders','Invoice','Payments','Reports','Settings'].map(x=><button key={x} className={page===x?'active':''} onClick={()=>setPage(x)}>{x}</button>)}<button className="logout" onClick={logout}>Logout</button></aside>
    <main><header><h1>{page}</h1><div className="user">{session.user?.email}</div></header>{notice&&<div className="notice" onClick={()=>setNotice('')}>{notice}</div>}{loading&&<div className="panel">Loading...</div>}
      {page==='Dashboard'&&<Dashboard data={data} stats={stats}/>} {page==='Customers'&&<Customers data={data} addRow={addRow} updateRow={updateRow} deleteRow={deleteRow}/>} {page==='Inventory'&&<Inventory data={data} addRow={addRow} updateRow={updateRow} deleteRow={deleteRow}/>} {page==='Orders'&&<Orders data={data} createOrder={createOrder} deleteRow={deleteRow}/>} {page==='Invoice'&&<Invoice data={data}/>} {page==='Payments'&&<Payments data={data} addRow={addRow} deleteRow={deleteRow}/>} {page==='Reports'&&<Reports data={data} stats={stats}/>} {page==='Settings'&&<Settings data={data} reload={loadCloudData}/>} </main>
  </div>
}
function Login(p){return <div className="login-wrap"><form className="login-card" onSubmit={p.authAction}><div className="logo">ISB</div><h1>INNER SOURCE<br/>BEAUTY ERP</h1><p>Supabase Cloud Login</p><input placeholder="Email" value={p.email} onChange={e=>p.setEmail(e.target.value)}/><input placeholder="Password" type="password" value={p.password} onChange={e=>p.setPassword(e.target.value)}/><div><button>{p.authMode==='signin'?'Login':'Create Account'}</button><button type="button" className="soft" onClick={()=>p.setAuthMode(p.authMode==='signin'?'signup':'signin')}>{p.authMode==='signin'?'Create Account':'Back to Login'}</button></div>{p.authMsg&&<div className="msg">{p.authMsg}</div>}</form></div>}
function calcStats(data){const sales=data.orders.reduce((s,o)=>s+Number(o.total||0),0); const paid=data.payments.reduce((s,p)=>s+Number(p.amount||0),0); const stock=data.inventory.reduce((s,i)=>s+Number(i.qty||0),0); return {sales,paid,balance:sales-paid,stock,orders:data.orders.length,customers:data.customers.length}}
function Dashboard({data,stats}){return <><div className="cards"><Card t="Total Sales" v={money(stats.sales)}/><Card t="Amount Paid" v={money(stats.paid)}/><Card t="Open Balance" v={money(stats.balance)}/><Card t="Stock Qty" v={stats.stock}/></div><div className="panel"><h2>Recent Orders</h2><Table rows={data.orders.slice(0,8)} cols={['invoice_no','customer_name','style','qty','total','status']}/></div></>}
function Card({t,v}){return <div className="card"><p>{t}</p><b>{v}</b></div>}
function Customers({data,addRow,updateRow,deleteRow}){const blank={name:'',company:'',phone:'',email:'',billing_address:'',shipping_address:'',shipping_same_as_billing:false,preferred_payment:'Zelle',payment_terms:'COD',tax_id:'',note:'',status:'Active'}; const [f,setF]=useState(blank); const [selected,setSelected]=useState(null); const [q,setQ]=useState(''); const customers=data.customers.filter(c=>[c.name,c.company,c.phone,c.email].join(' ').toLowerCase().includes(q.toLowerCase())); function setSame(v){setF({...f,shipping_same_as_billing:v,shipping_address:v?f.billing_address:f.shipping_address})} async function save(){const row={...f,shipping_address:f.shipping_same_as_billing?f.billing_address:f.shipping_address}; await addRow('customers', row); setF(blank)} const selectedCustomer=data.customers.find(c=>String(c.id)===String(selected)); return <div className="split"><div className="panel"><h2>Add Customer</h2><div className="form-grid customer-form"><input placeholder="Contact Name" value={f.name} onChange={e=>setF({...f,name:e.target.value})}/><input placeholder="Business Name" value={f.company} onChange={e=>setF({...f,company:e.target.value})}/><input placeholder="Phone" value={f.phone} onChange={e=>setF({...f,phone:e.target.value})}/><input placeholder="Email" value={f.email} onChange={e=>setF({...f,email:e.target.value})}/><textarea placeholder="Billing Address" value={f.billing_address} onChange={e=>setF({...f,billing_address:e.target.value,shipping_address:f.shipping_same_as_billing?e.target.value:f.shipping_address})}/><textarea placeholder="Shipping Address" value={f.shipping_address} disabled={f.shipping_same_as_billing} onChange={e=>setF({...f,shipping_address:e.target.value})}/><label className="check"><input type="checkbox" checked={f.shipping_same_as_billing} onChange={e=>setSame(e.target.checked)}/> Shipping Address is same as Billing Address</label><select value={f.preferred_payment} onChange={e=>setF({...f,preferred_payment:e.target.value})}>{PAYMENT_METHODS.map(x=><option key={x}>{x}</option>)}</select><select value={f.payment_terms} onChange={e=>setF({...f,payment_terms:e.target.value})}>{TERMS.map(x=><option key={x}>{x}</option>)}</select><input placeholder="Tax ID / Seller Permit" value={f.tax_id} onChange={e=>setF({...f,tax_id:e.target.value})}/><input placeholder="Customer Note" value={f.note} onChange={e=>setF({...f,note:e.target.value})}/><button onClick={save}>Save Customer</button></div><h2>Customers</h2><input className="search" placeholder="Search customer..." value={q} onChange={e=>setQ(e.target.value)}/><table><thead><tr><th>Business</th><th>Contact</th><th>Phone</th><th>Balance</th><th>Last Order</th></tr></thead><tbody>{customers.map(c=>{const s=customerStats(c,data);return <tr key={c.id} onClick={()=>setSelected(c.id)} className={String(selected)===String(c.id)?'sel':''}><td><b>{c.company||'-'}</b></td><td>{c.name}</td><td>{c.phone}</td><td>{money(s.balance)}</td><td>{s.lastOrder||'-'}</td></tr>})}</tbody></table></div><CustomerDetail customer={selectedCustomer} data={data} deleteRow={deleteRow}/></div>}
function customerStats(c,data){const orders=data.orders.filter(o=>String(o.customer_id)===String(c.id)||o.customer_name===(c.company||c.name)); const payments=data.payments.filter(p=>String(p.customer_id)===String(c.id)||orders.some(o=>o.invoice_no===p.invoice_no)); const sales=orders.reduce((s,o)=>s+Number(o.total||0),0); const paid=payments.reduce((s,p)=>s+Number(p.amount||0),0); const last=orders[0]?.created_at?dateOnly(orders[0].created_at):''; return {orders,payments,sales,paid,balance:sales-paid,lastOrder:last}}
function CustomerDetail({customer,data,deleteRow}){if(!customer)return <div className="panel detail"><h2>Customer Detail</h2><p>No customer selected.</p></div>; const s=customerStats(customer,data); return <div className="panel detail"><h2>{customer.company||customer.name}</h2><p><b>Contact:</b> {customer.name}<br/><b>Phone:</b> {customer.phone}<br/><b>Email:</b> {customer.email}<br/><b>Preferred Payment:</b> {customer.preferred_payment||'-'}<br/><b>Terms:</b> {customer.payment_terms||'-'}<br/><b>Tax ID:</b> {customer.tax_id||'-'}</p><div className="mini-cards"><Card t="Total Sales" v={money(s.sales)}/><Card t="Paid" v={money(s.paid)}/><Card t="Balance" v={money(s.balance)}/><Card t="Orders" v={s.orders.length}/></div><h3>Billing Address</h3><pre>{customer.billing_address||customer.address||''}</pre><h3>Shipping Address</h3><pre>{customer.shipping_address||customer.billing_address||customer.address||''}</pre><h3>Note</h3><pre>{customer.note||''}</pre><h3>Invoice / Order History</h3><Table rows={s.orders} cols={['invoice_no','style','qty','total','status','payment_status']}/><h3>Payment History</h3><Table rows={s.payments} cols={['payment_date','invoice_no','amount','method','reference_no','note']}/></div>}
function Inventory({data,addRow,deleteRow}){
  const blank={style:'',brand:'',category:'',qty:'',buying_price:'',selling_price:'',low_stock:5}
  const [f,setF]=useState(blank)
  const margin=formatMargin(f.buying_price,f.selling_price)
  async function save(){
    const buying=Number(f.buying_price)||0, selling=Number(f.selling_price)||0
    await addRow('inventory',{
      style:f.style, brand:f.brand, category:f.category,
      qty:Number(f.qty)||0, buying_price:buying, selling_price:selling,
      cost:buying, price:selling, low_stock:Number(f.low_stock)||5
    })
    setF(blank)
  }
  const rows=data.inventory.map(item=>({
    ...item,
    buying_price:itemBuying(item),
    selling_price:itemSelling(item),
    margin:formatMargin(itemBuying(item),itemSelling(item))
  }))
  return <div className="panel inventory-page">
    <h2>Add Inventory Item</h2>
    <div className="inventory-form">
      <div className="form-section">
        <h3>Product Details</h3>
        <div className="form-grid inventory-grid">
          <label>Style / SKU<input placeholder="Style or SKU" value={f.style} onChange={e=>setF({...f,style:e.target.value})}/></label>
          <label>Brand<input placeholder="Brand" value={f.brand} onChange={e=>setF({...f,brand:e.target.value})}/></label>
          <label>Category<input placeholder="Category" value={f.category} onChange={e=>setF({...f,category:e.target.value})}/></label>
          <label>Qty<input placeholder="0" type="number" min="0" value={f.qty} onChange={e=>setF({...f,qty:e.target.value})}/></label>
          <label>Low Stock Alert<input placeholder="5" type="number" min="0" value={f.low_stock} onChange={e=>setF({...f,low_stock:e.target.value})}/></label>
        </div>
      </div>
      <div className="form-section">
        <h3>Pricing</h3>
        <div className="form-grid inventory-grid pricing-grid">
          <label>Buying Price<input placeholder="0.00" type="number" min="0" step="0.01" value={f.buying_price} onChange={e=>setF({...f,buying_price:e.target.value})}/></label>
          <label>Selling Price<input placeholder="0.00" type="number" min="0" step="0.01" value={f.selling_price} onChange={e=>setF({...f,selling_price:e.target.value})}/></label>
          <div className="margin-display"><span>Margin</span><strong className="margin-value">{margin}</strong><small>Auto-calculated from buying &amp; selling price</small></div>
        </div>
      </div>
      <button className="inventory-save" onClick={save}>Save Item</button>
    </div>
    <h2>Inventory</h2>
    <InventoryTable rows={rows} onDelete={id=>deleteRow('inventory',id)}/>
  </div>
}
function InventoryTable({rows,onDelete}){
  return <div className="table-wrap inventory-table"><table><thead><tr><th>Style</th><th>Brand</th><th>Category</th><th>Qty</th><th>Buying Price</th><th>Selling Price</th><th>Margin</th><th></th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><b>{r.style||'—'}</b></td><td>{r.brand||'—'}</td><td>{r.category||'—'}</td><td>{r.qty??0}</td><td>{money(r.buying_price)}</td><td>{money(r.selling_price)}</td><td className="margin-cell">{r.margin}</td><td><button className="danger" onClick={()=>onDelete(r.id)}>Delete</button></td></tr>)}</tbody></table></div>
}
function Orders({data,createOrder,deleteRow}){const blank={customer_id:'',inventory_id:'',customer_name:'',style:'',qty:'',price:'',shipping:'0',discount:'0',status:'Open',payment_status:'Unpaid',note:''}; const [f,setF]=useState(blank); function chooseCustomer(id){const c=data.customers.find(x=>String(x.id)===String(id)); setF({...f,customer_id:id,customer_name:c?.company||c?.name||''})} function chooseItem(id){const i=data.inventory.find(x=>String(x.id)===String(id)); setF({...f,inventory_id:id,style:i?.style||'',price:itemSelling(i)||''})} return <div className="panel"><h2>Create Order / Invoice</h2><div className="form-grid"><select value={f.customer_id} onChange={e=>chooseCustomer(e.target.value)}><option value="">Select Customer</option>{data.customers.map(c=><option key={c.id} value={c.id}>{c.company||c.name}</option>)}</select><select value={f.inventory_id} onChange={e=>chooseItem(e.target.value)}><option value="">Select Product</option>{data.inventory.map(i=><option key={i.id} value={i.id}>{i.style}{i.brand?` · ${i.brand}`:''} — Stock {i.qty}</option>)}</select>{['style','qty','price','shipping','discount'].map(x=><input key={x} placeholder={x} value={f[x]} onChange={e=>setF({...f,[x]:e.target.value})}/>) }<select value={f.status} onChange={e=>setF({...f,status:e.target.value})}>{['Open','Pending','Shipped','Cancelled'].map(x=><option key={x}>{x}</option>)}</select><select value={f.payment_status} onChange={e=>setF({...f,payment_status:e.target.value})}>{['Unpaid','Partial','Paid'].map(x=><option key={x}>{x}</option>)}</select><input placeholder="Order Note" value={f.note} onChange={e=>setF({...f,note:e.target.value})}/><button onClick={()=>{createOrder(f);setF(blank)}}>Create Invoice</button></div><h2>Orders</h2><Table rows={data.orders} cols={['invoice_no','customer_name','style','qty','price','shipping','discount','total','status','payment_status']} onDelete={id=>deleteRow('orders',id)}/></div>}
function Invoice({data}){const [id,setId]=useState(''); const o=data.orders.find(x=>String(x.id)===String(id))||data.orders[0]; const c=data.customers.find(x=>String(x.id)===String(o?.customer_id)); if(!o)return <div className="panel">No invoice yet.</div>; return <div className="panel"><select value={id} onChange={e=>setId(e.target.value)}>{data.orders.map(o=><option key={o.id} value={o.id}>{o.invoice_no} - {o.customer_name}</option>)}</select><div className="invoice"><h1>INNER SOURCE BEAUTY</h1><h2>INVOICE</h2><div className="invoice-grid"><p><b>Invoice #:</b> {o.invoice_no}<br/><b>Date:</b> {dateOnly(o.created_at)||today()}<br/><b>Status:</b> {o.payment_status}</p><p><b>Bill To</b><br/>{c?.company||o.customer_name}<br/>{c?.billing_address||c?.address||''}</p><p><b>Ship To</b><br/>{c?.shipping_address||c?.billing_address||c?.address||''}</p></div><table><tbody><tr><th>Style</th><th>Qty</th><th>Unit</th><th>Shipping</th><th>Discount</th><th>Total</th></tr><tr><td>{o.style}</td><td>{o.qty}</td><td>{money(o.price)}</td><td>{money(o.shipping)}</td><td>{money(o.discount)}</td><td>{money(o.total)}</td></tr></tbody></table><h2>Total Due: {money(o.total)}</h2><p className="terms">ALL RETURNS ARE STORE CREDIT ONLY. RETURNS MUST BE DONE WITHIN 10 BUSINESS DAYS. 20% RESTOCKING FEE MAY APPLY. SHIPPING AND HANDLING ARE NOT REFUNDABLE BOTH WAYS.</p><button onClick={()=>window.print()}>Print / Save PDF</button></div></div>}
function Payments({data,addRow,deleteRow}){const blank={customer_id:'',order_id:'',invoice_no:'',payment_date:today(),amount:'',method:'Zelle',reference_no:'',note:''}; const [f,setF]=useState(blank); function chooseOrder(id){const o=data.orders.find(x=>String(x.id)===String(id)); setF({...f,order_id:id,customer_id:o?.customer_id||'',invoice_no:o?.invoice_no||'',amount:o?.total||''})} return <div className="panel"><h2>Add Payment</h2><div className="form-grid"><select value={f.order_id} onChange={e=>chooseOrder(e.target.value)}><option value="">Select Invoice</option>{data.orders.map(o=><option key={o.id} value={o.id}>{o.invoice_no} - {o.customer_name} - {money(o.total)}</option>)}</select><input type="date" value={f.payment_date} onChange={e=>setF({...f,payment_date:e.target.value})}/><input placeholder="Amount" value={f.amount} onChange={e=>setF({...f,amount:e.target.value})}/><div className="method-boxes">{PAYMENT_METHODS.map(m=><button key={m} type="button" className={f.method===m?'chosen':''} onClick={()=>setF({...f,method:m})}>{m}</button>)}</div><input placeholder="Reference / Check #" value={f.reference_no} onChange={e=>setF({...f,reference_no:e.target.value})}/><input placeholder="Memo" value={f.note} onChange={e=>setF({...f,note:e.target.value})}/><button onClick={()=>{addRow('payments',{...f,amount:Number(f.amount)});setF(blank)}}>Save Payment</button></div><h2>Payments</h2><Table rows={data.payments} cols={['payment_date','invoice_no','amount','method','reference_no','note']} onDelete={id=>deleteRow('payments',id)}/></div>}
function Reports({data,stats}){const top=[...data.customers].map(c=>({...c,...customerStats(c,data)})).sort((a,b)=>b.sales-a.sales).slice(0,10); return <div className="panel"><h2>Reports</h2><div className="cards"><Card t="Customers" v={stats.customers}/><Card t="Orders" v={stats.orders}/><Card t="Sales" v={money(stats.sales)}/><Card t="Open Balance" v={money(stats.balance)}/></div><h3>Top Customers</h3><table><thead><tr><th>Customer</th><th>Sales</th><th>Paid</th><th>Balance</th></tr></thead><tbody>{top.map(c=><tr key={c.id}><td>{c.company||c.name}</td><td>{money(c.sales)}</td><td>{money(c.paid)}</td><td>{money(c.balance)}</td></tr>)}</tbody></table></div>}
function Settings({data,reload}){function backup(){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='inner-source-beauty-backup.json'; a.click()} return <div className="panel"><h2>Settings</h2><p>INNER SOURCE BEAUTY ERP cloud version. Data is stored in Supabase.</p><button onClick={backup}>Download Backup JSON</button><button onClick={reload}>Reload Cloud Data</button></div>}
function Table({rows,cols,onDelete}){return <div className="table-wrap"><table><thead><tr>{cols.map(c=><th key={c}>{c.replaceAll('_',' ')}</th>)}{onDelete&&<th></th>}</tr></thead><tbody>{rows.map(r=><tr key={r.id}>{cols.map(c=><td key={c}>{['total','amount','price','cost','buying_price','selling_price','shipping','discount'].includes(c)?money(r[c]):String(r[c]??'')}</td>)}{onDelete&&<td><button className="danger" onClick={()=>onDelete(r.id)}>Delete</button></td>}</tr>)}</tbody></table></div>}

createRoot(document.getElementById('root')).render(<App />)
