import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  calcDashboardInventoryPotentialProfit,
  calcDashboardInventoryValue,
  calcMonthFinancialSummary,
  ordersForDashboardSales,
} from '../src/dashboardMetrics.js'

function loadEnv() {
  try {
    const raw = readFileSync('.env.local', 'utf8')
    const env = {}
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx === -1) continue
      env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim()
    }
    return env
  } catch {
    return {}
  }
}

function localDateKey(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function todayKey() {
  return localDateKey(new Date())
}

function isOrderDateThisMonth(order) {
  const key = localDateKey(order?.order_date || order?.created_at)
  if (!key) return false
  return key.slice(0, 7) === todayKey().slice(0, 7)
}

async function main() {
  const env = loadEnv()
  const url = env.VITE_SUPABASE_URL
  const key = env.VITE_SUPABASE_ANON_KEY
  if (!url || !key || url.includes('YOUR-PROJECT-ID')) {
    console.log('Supabase env not configured — skipping live verification.')
    return
  }

  const supabase = createClient(url, key)
  const tables = ['orders', 'order_items', 'inventory']
  const data = {}
  for (const table of tables) {
    const { data: rows, error } = await supabase.from(table).select('*')
    if (error) throw new Error(`${table}: ${error.message}`)
    data[table] = rows || []
  }

  const monthOrders = ordersForDashboardSales(data.orders.filter(isOrderDateThisMonth))
  const monthFinancials = calcMonthFinancialSummary(monthOrders, data.order_items, data.inventory)
  const inventoryValue = calcDashboardInventoryValue(data.inventory)
  const inventoryPotentialProfit = calcDashboardInventoryPotentialProfit(data.inventory)

  console.log('=== Dashboard metrics (current month, live ERP data) ===')
  console.log('Month orders counted:', monthOrders.length)
  console.log('Sales:', monthFinancials.sales.toFixed(2))
  console.log('COGS:', monthFinancials.cogs.toFixed(2))
  console.log('Gross Profit:', monthFinancials.grossProfit.toFixed(2))
  console.log('Gross Margin:', `${monthFinancials.grossMargin.toFixed(1)}%`)
  console.log('Inventory Value:', inventoryValue.toFixed(2))
  console.log('Inventory Potential Profit:', inventoryPotentialProfit.toFixed(2))
}

main().catch(err => {
  console.error(err.message || err)
  process.exit(1)
})
