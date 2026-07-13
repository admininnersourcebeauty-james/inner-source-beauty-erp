-- INNER SOURCE BEAUTY ERP — Back Order support
-- Run in Supabase SQL Editor

alter table public.orders
add column if not exists allocated_qty numeric default 0;

alter table public.orders
add column if not exists backorder_qty numeric default 0;

alter table public.orders
add column if not exists shipped_qty numeric default 0;

-- Backfill existing orders (does not delete or overwrite business totals)
update public.orders
set allocated_qty = coalesce(qty, 0)
where coalesce(allocated_qty, 0) = 0
  and coalesce(status, '') not in ('Cancelled');

update public.orders
set shipped_qty = coalesce(qty, 0)
where coalesce(status, '') = 'Shipped'
  and coalesce(shipped_qty, 0) = 0;

update public.orders
set backorder_qty = 0
where backorder_qty is null;

update public.orders
set status = 'Open'
where status = 'Pending';

update public.orders
set allocated_qty = 0
where coalesce(status, '') = 'Cancelled'
  and coalesce(allocated_qty, 0) > 0
  and coalesce(shipped_qty, 0) = 0;
