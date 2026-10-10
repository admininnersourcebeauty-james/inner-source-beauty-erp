/**
 * Purchase Order KRW commission calculation test
 * Run: node scripts/test-po-commission-krw.mjs
 */
import {
  calcLineItem,
  calcPoTotals,
  formatUsd,
  PO_TYPE_MIDDLEMAN,
} from '../src/purchaseOrders.js'

const exchangeRate = 1350
const factoryUnitCostKrw = 50000
const commissionUnitKrw = 5000
const orderQty = 2

const line = calcLineItem(
  {
    order_qty: orderQty,
    korean_unit_cost: factoryUnitCostKrw,
    middleman_commission_unit_krw: commissionUnitKrw,
  },
  PO_TYPE_MIDDLEMAN,
  'KRW',
  exchangeRate,
)

const totals = calcPoTotals(
  { purchase_type: PO_TYPE_MIDDLEMAN, currency: 'KRW', exchange_rate: exchangeRate },
  [{ order_qty: orderQty, korean_unit_cost: factoryUnitCostKrw, middleman_commission_unit_krw: commissionUnitKrw }],
)

const expected = {
  factoryUnitCostUsd: 50000 / 1350,
  commissionPerUnitUsd: 5000 / 1350,
  totalUnitCostKrw: 55000,
  totalUnitCostUsd: 55000 / 1350,
  factoryProductCostKrw: 100000,
  commissionTotalUsd: (5000 / 1350) * 2,
  totalPurchaseCostUsd: (55000 / 1350) * 2,
}

function approx(a, b, label) {
  const diff = Math.abs(a - b)
  const ok = diff < 1e-9
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
  console.log(`  expected: ${b}`)
  console.log(`  actual:   ${a}`)
  if (!ok) process.exitCode = 1
}

console.log('=== Purchase Order KRW Commission Test ===')
console.log(`Exchange Rate: ${exchangeRate}`)
console.log(`Factory Unit Cost KRW: ${factoryUnitCostKrw}`)
console.log(`Middleman Commission Per Unit KRW: ${commissionUnitKrw}`)
console.log(`Order Qty: ${orderQty}`)
console.log('')

approx(line.factory_unit_cost_usd, expected.factoryUnitCostUsd, 'Converted Unit Cost USD')
approx(line.commission_per_unit_usd, expected.commissionPerUnitUsd, 'Commission Per Unit USD')
approx(line.total_unit_cost_krw, expected.totalUnitCostKrw, 'Total Unit Cost KRW')
approx(line.total_unit_cost_usd, expected.totalUnitCostUsd, 'Total Unit Cost USD')
approx(line.product_cost, expected.factoryProductCostKrw, 'Factory Product Cost KRW')
approx(line.commission_total_usd, expected.commissionTotalUsd, 'Commission Total USD')
approx(line.total_purchase_cost_usd, expected.totalPurchaseCostUsd, 'Total Purchase Cost USD')

console.log('')
console.log('UI display values:')
console.log(`  Converted Unit Cost USD: ${formatUsd(line.factory_unit_cost_usd)} (expected $37.04)`)
console.log(`  Commission Per Unit USD: ${formatUsd(line.commission_per_unit_usd)} (expected $3.70)`)
console.log(`  Commission Total USD: ${formatUsd(line.commission_total_usd)} (expected $7.41)`)
console.log(`  Total Unit Cost USD: ${formatUsd(line.total_unit_cost_usd)} (expected $40.74)`)
console.log(`  Total Purchase Cost USD: ${formatUsd(line.total_purchase_cost_usd)} (expected $81.48)`)

const displayOk =
  formatUsd(line.factory_unit_cost_usd) === '$37.04'
  && formatUsd(line.commission_per_unit_usd) === '$3.70'
  && formatUsd(line.commission_total_usd) === '$7.41'
  && formatUsd(line.total_unit_cost_usd) === '$40.74'
  && formatUsd(line.total_purchase_cost_usd) === '$81.48'
console.log(`Display match: ${displayOk ? 'PASS' : 'FAIL'}`)
if (!displayOk) process.exitCode = 1

console.log('')
approx(
  totals.totalProductCostUsd + totals.totalCommissionUsd,
  expected.totalPurchaseCostUsd,
  'Header Total Purchase Cost (USD)',
)
