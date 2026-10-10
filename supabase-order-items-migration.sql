-- INNER SOURCE BEAUTY ERP — Multi-line invoice order_items
-- NOTE: If you see "cannot insert a non-DEFAULT value into column id",
-- run supabase-order-items-uuid-migration.sql instead (uuid + gen_random_uuid).
-- Safe to re-run. No DROP / DELETE / TRUNCATE.

-- Invoice-level tax (optional header field)
alter table public.orders add column if not exists tax numeric default 0;

update public.orders
set tax = 0
where tax is null;

-- Line items table
create table if not exists public.order_items (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  order_id        bigint not null references public.orders(id) on delete cascade,
  inventory_id    bigint,
  style           text default '',
  qty             numeric default 0,
  price           numeric default 0,
  discount        numeric default 0,
  line_total      numeric default 0,
  buying_price    numeric default 0,
  shipping_cost   numeric default 0,
  profit          numeric default 0,
  allocated_qty   numeric default 0,
  backorder_qty   numeric default 0,
  shipped_qty     numeric default 0,
  sort_order      integer default 0
);

alter table public.order_items add column if not exists order_id bigint;
alter table public.order_items add column if not exists inventory_id bigint;
alter table public.order_items add column if not exists style text default '';
alter table public.order_items add column if not exists qty numeric default 0;
alter table public.order_items add column if not exists price numeric default 0;
alter table public.order_items add column if not exists discount numeric default 0;
alter table public.order_items add column if not exists line_total numeric default 0;
alter table public.order_items add column if not exists buying_price numeric default 0;
alter table public.order_items add column if not exists shipping_cost numeric default 0;
alter table public.order_items add column if not exists profit numeric default 0;
alter table public.order_items add column if not exists allocated_qty numeric default 0;
alter table public.order_items add column if not exists backorder_qty numeric default 0;
alter table public.order_items add column if not exists shipped_qty numeric default 0;
alter table public.order_items add column if not exists sort_order integer default 0;

create index if not exists order_items_order_id_idx on public.order_items (order_id);
create index if not exists order_items_inventory_id_idx on public.order_items (inventory_id);

-- Backfill one line per existing order (skip orders that already have items)
insert into public.order_items (
  order_id,
  inventory_id,
  style,
  qty,
  price,
  discount,
  line_total,
  buying_price,
  shipping_cost,
  profit,
  allocated_qty,
  backorder_qty,
  shipped_qty,
  sort_order
)
select
  o.id,
  o.inventory_id,
  coalesce(o.style, ''),
  coalesce(o.qty, 0),
  coalesce(o.price, 0),
  coalesce(o.discount, 0),
  greatest(coalesce(o.qty, 0) * coalesce(o.price, 0) - coalesce(o.discount, 0), 0),
  coalesce(o.buying_price, 0),
  coalesce(o.shipping_cost, 0),
  coalesce(o.profit, 0),
  coalesce(o.allocated_qty, o.qty, 0),
  coalesce(o.backorder_qty, 0),
  coalesce(o.shipped_qty, 0),
  0
from public.orders o
where not exists (
  select 1 from public.order_items oi where oi.order_id = o.id
);

-- Legacy single-line orders keep discount on the line item only (avoid header + line double count)
update public.orders o
set discount = 0
where coalesce(o.discount, 0) <> 0
  and (select count(*) from public.order_items oi where oi.order_id = o.id) = 1
  and (
    select coalesce(oi.discount, 0)
    from public.order_items oi
    where oi.order_id = o.id
    limit 1
  ) = coalesce(o.discount, 0);

alter table public.order_items enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'order_items' and policyname = 'order_items_all_authenticated'
  ) then
    create policy order_items_all_authenticated on public.order_items
      for all to authenticated using (true) with check (true);
  end if;
end $$;
