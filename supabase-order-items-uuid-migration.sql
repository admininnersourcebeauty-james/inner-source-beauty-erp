-- INNER SOURCE BEAUTY ERP — order_items.id → uuid (gen_random_uuid)
-- Safe to re-run. No DROP TABLE / DELETE / TRUNCATE.
--
-- Fixes: "cannot insert a non-DEFAULT value into column id"
-- when id was bigint GENERATED ALWAYS AS IDENTITY.
--
-- Target: order_items.id uuid primary key default gen_random_uuid()

create extension if not exists pgcrypto;

-- orders.tax (from prior migration, kept here for environments that skipped it)
alter table public.orders add column if not exists tax numeric default 0;
update public.orders set tax = 0 where tax is null;

-- Create table with uuid id when missing entirely
create table if not exists public.order_items (
  id              uuid primary key default gen_random_uuid(),
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

-- Convert legacy bigint identity PK → uuid PK (preserves all rows)
do $$
declare
  v_id_type text;
  v_has_legacy boolean;
begin
  select c.data_type into v_id_type
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'order_items'
    and c.column_name = 'id';

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'order_items'
      and column_name = 'id_legacy_bigint'
  ) into v_has_legacy;

  if v_has_legacy then
    -- Already converted
    null;
  elsif v_id_type = 'bigint' then
    alter table public.order_items add column if not exists id_uuid uuid;
    update public.order_items set id_uuid = gen_random_uuid() where id_uuid is null;
    alter table public.order_items alter column id_uuid set default gen_random_uuid();
    alter table public.order_items alter column id_uuid set not null;

    alter table public.order_items drop constraint if exists order_items_pkey;
    alter table public.order_items rename column id to id_legacy_bigint;
    alter table public.order_items rename column id_uuid to id;
    alter table public.order_items add primary key (id);
  elsif v_id_type = 'uuid' then
    alter table public.order_items alter column id set default gen_random_uuid();
  end if;
end $$;

create index if not exists order_items_order_id_idx on public.order_items (order_id);
create index if not exists order_items_inventory_id_idx on public.order_items (inventory_id);

-- Backfill one line per existing order when table is empty for that order
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

-- Legacy single-line orders: discount lives on line item only
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
