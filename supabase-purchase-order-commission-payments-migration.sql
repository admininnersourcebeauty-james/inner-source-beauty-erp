-- =============================================================================
-- INNER SOURCE BEAUTY ERP — Purchase Order commission payment history
-- =============================================================================
-- Run manually in Supabase SQL Editor after reviewing.
-- Safe and rerunnable. Does NOT use DROP TABLE, DELETE, or TRUNCATE.
-- =============================================================================

create table if not exists public.purchase_order_commission_payments (
  id                  uuid primary key default gen_random_uuid(),
  purchase_order_id   uuid not null references public.purchase_orders(id) on delete cascade,
  amount              numeric not null default 0,
  payment_date        date,
  payment_method      text default '',
  reference_number    text default '',
  notes               text default '',
  created_by          text default '',
  created_at          timestamptz default now()
);

create index if not exists purchase_order_commission_payments_po_id_idx
  on public.purchase_order_commission_payments (purchase_order_id);

-- Backfill a single legacy payment record when header has amount but no history rows.
insert into public.purchase_order_commission_payments (
  purchase_order_id, amount, payment_date, payment_method, reference_number, notes, created_by, created_at
)
select
  po.id,
  coalesce(po.commission_amount_paid, 0),
  po.commission_payment_date,
  coalesce(po.commission_payment_method, ''),
  '',
  coalesce(po.commission_payment_note, ''),
  coalesce(po.created_by, 'Legacy Import'),
  coalesce(po.updated_at, po.created_at, now())
from public.purchase_orders po
where coalesce(po.commission_amount_paid, 0) > 0
  and not exists (
    select 1
    from public.purchase_order_commission_payments p
    where p.purchase_order_id = po.id
  );
