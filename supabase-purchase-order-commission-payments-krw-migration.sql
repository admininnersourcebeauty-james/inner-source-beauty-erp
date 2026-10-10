-- =============================================================================
-- INNER SOURCE BEAUTY ERP — Commission payment KRW column
-- =============================================================================
-- Run manually in Supabase SQL Editor after reviewing.
-- Safe and rerunnable. Does NOT use DROP TABLE, DELETE, or TRUNCATE.
-- =============================================================================

alter table public.purchase_order_commission_payments
  add column if not exists amount_krw numeric not null default 0;

-- Backfill KRW from legacy USD amount when PO has a valid saved exchange rate.
update public.purchase_order_commission_payments p
set amount_krw = round((coalesce(p.amount, 0) * coalesce(po.exchange_rate, 0))::numeric, 0)
from public.purchase_orders po
where po.id = p.purchase_order_id
  and coalesce(p.amount_krw, 0) = 0
  and coalesce(p.amount, 0) > 0
  and coalesce(po.exchange_rate, 0) > 0;
