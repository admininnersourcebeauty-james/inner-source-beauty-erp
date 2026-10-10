-- =============================================================================
-- INNER SOURCE BEAUTY ERP — Safe Production Reset (business / test data only)
-- =============================================================================
-- Run manually in Supabase Dashboard → SQL Editor.
-- DO NOT run until you have a full backup.
--
-- PRESERVES (untouched):
--   auth.users, public.profiles, public.customers, staff users, settings
--
-- DELETES / RESETS:
--   purchase order history, sales orders/invoices, payments, stock history
--   inventory quantities only (product catalog rows kept, qty set to 0)
-- =============================================================================

begin;

-- STEP 0 — Pre-reset row counts
select 'BEFORE RESET' as phase, 'customers' as table_name, count(*) as row_count from public.customers
union all select 'BEFORE RESET', 'profiles',           count(*) from public.profiles
union all select 'BEFORE RESET', 'inventory',          count(*) from public.inventory
union all select 'BEFORE RESET', 'orders',             count(*) from public.orders
union all select 'BEFORE RESET', 'order_items',      count(*) from public.order_items
union all select 'BEFORE RESET', 'payments',           count(*) from public.payments
union all select 'BEFORE RESET', 'purchase_orders',  count(*) from public.purchase_orders
union all select 'BEFORE RESET', 'purchase_order_items', count(*) from public.purchase_order_items
union all select 'BEFORE RESET', 'purchase_order_receipts', count(*) from public.purchase_order_receipts
union all select 'BEFORE RESET', 'purchase_order_receives', count(*) from public.purchase_order_receives
union all select 'BEFORE RESET', 'purchase_order_commission_payments', count(*) from public.purchase_order_commission_payments
order by table_name;

-- STEP 1 — Purchase orders (children before parents)
delete from public.purchase_order_receipts;
delete from public.purchase_order_commission_payments;
delete from public.purchase_order_receives;
delete from public.purchase_order_items;
delete from public.purchase_orders;

-- STEP 2 — Sales / invoices / payments
delete from public.payments;
delete from public.order_items;
delete from public.orders;

-- STEP 3 — Inventory stock only (keep product rows, zero on-hand qty)
update public.inventory set qty = 0;

-- STEP 4 — Post-reset verification
select 'AFTER RESET' as phase, 'customers' as table_name, count(*) as row_count from public.customers
union all select 'AFTER RESET', 'profiles',           count(*) from public.profiles
union all select 'AFTER RESET', 'inventory',          count(*) from public.inventory
union all select 'AFTER RESET', 'orders',             count(*) from public.orders
union all select 'AFTER RESET', 'order_items',      count(*) from public.order_items
union all select 'AFTER RESET', 'payments',           count(*) from public.payments
union all select 'AFTER RESET', 'purchase_orders',  count(*) from public.purchase_orders
union all select 'AFTER RESET', 'purchase_order_items', count(*) from public.purchase_order_items
union all select 'AFTER RESET', 'purchase_order_receipts', count(*) from public.purchase_order_receipts
union all select 'AFTER RESET', 'purchase_order_receives', count(*) from public.purchase_order_receives
union all select 'AFTER RESET', 'purchase_order_commission_payments', count(*) from public.purchase_order_commission_payments
order by table_name;

commit;

-- To abort without saving, replace commit with:
-- rollback;
