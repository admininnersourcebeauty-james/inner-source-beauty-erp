-- =============================================================================
-- INNER SOURCE BEAUTY ERP — Inventory default commission + PO line commission
-- Safe to re-run. Does NOT use DROP TABLE, DELETE, or TRUNCATE.
-- =============================================================================
-- No separate middleman table exists in this ERP; middleman names are stored as text
-- (purchase_orders.middleman_name). default_middleman_name reuses that pattern.
-- =============================================================================

-- Inventory defaults
alter table public.inventory add column if not exists supplier text default '';
alter table public.inventory add column if not exists default_middleman_name text default '';
alter table public.inventory add column if not exists default_commission_type text default '';
alter table public.inventory add column if not exists default_commission_value numeric default 0;

-- PO line-level middleman + commission (reuse existing commission total columns)
alter table public.purchase_order_items add column if not exists middleman_name text default '';
alter table public.purchase_order_items add column if not exists commission_type text default '';
alter table public.purchase_order_items add column if not exists commission_value numeric default 0;

-- Optional traceability on commission payments (nullable; existing rows unaffected)
alter table public.purchase_order_commission_payments add column if not exists purchase_order_item_id uuid;
alter table public.purchase_order_commission_payments add column if not exists middleman_name text default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'purchase_order_commission_payments_item_fkey'
  ) then
    alter table public.purchase_order_commission_payments
      add constraint purchase_order_commission_payments_item_fkey
      foreign key (purchase_order_item_id)
      references public.purchase_order_items(id)
      on delete set null;
  end if;
exception when others then
  null;
end $$;

-- Backfill line middleman_name from PO header where line has commission but no name
update public.purchase_order_items i
set middleman_name = po.middleman_name
from public.purchase_orders po
where po.id = i.purchase_order_id
  and coalesce(btrim(i.middleman_name), '') = ''
  and coalesce(btrim(po.middleman_name), '') <> ''
  and (
    coalesce(i.middleman_commission_unit_krw, 0) > 0
    or coalesce(i.commission_percent, 0) > 0
    or coalesce(i.commission_total_usd, 0) > 0
  );

-- Backfill commission_type for legacy fixed-per-unit KRW lines
update public.purchase_order_items
set commission_type = 'fixed_per_unit',
    commission_value = middleman_commission_unit_krw
where coalesce(btrim(commission_type), '') = ''
  and coalesce(middleman_commission_unit_krw, 0) > 0;

-- Backfill commission_type for legacy percentage lines
update public.purchase_order_items
set commission_type = 'percentage',
    commission_value = commission_percent
where coalesce(btrim(commission_type), '') = ''
  and coalesce(commission_percent, 0) > 0;
