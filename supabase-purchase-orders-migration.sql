-- =============================================================================
-- INNER SOURCE BEAUTY ERP — Purchase Orders migration
-- =============================================================================
-- Run manually in Supabase SQL Editor after reviewing.
-- Safe: creates tables/columns only. Does NOT delete existing data.
-- =============================================================================

create extension if not exists "pgcrypto";

-- =============================================================================
-- purchase_orders
-- =============================================================================
create table if not exists public.purchase_orders (
  id                          uuid primary key default gen_random_uuid(),
  po_number                   text unique not null,
  order_date                  date default current_date,
  supplier                    text default '',
  middleman_name              text default '',
  currency                    text default 'KRW' check (currency in ('KRW', 'USD')),
  exchange_rate               numeric default 1350,
  shipping_cost               numeric default 0,
  other_cost                  numeric default 0,
  eta                         date,
  status                      text default 'Draft',
  notes                       text default '',
  total_ordered_units         numeric default 0,
  total_product_cost          numeric default 0,
  total_commission            numeric default 0,
  grand_total                 numeric default 0,
  commission_payment_status   text default 'Unpaid',
  commission_amount_paid      numeric default 0,
  commission_payment_date     date,
  commission_payment_method   text default '',
  commission_payment_note     text default '',
  created_at                  timestamptz not null default now(),
  created_by                  text default '',
  updated_at                  timestamptz not null default now()
);

alter table public.purchase_orders add column if not exists po_number text;
alter table public.purchase_orders add column if not exists order_date date default current_date;
alter table public.purchase_orders add column if not exists supplier text default '';
alter table public.purchase_orders add column if not exists middleman_name text default '';
alter table public.purchase_orders add column if not exists currency text default 'KRW';
alter table public.purchase_orders add column if not exists exchange_rate numeric default 1350;
alter table public.purchase_orders add column if not exists shipping_cost numeric default 0;
alter table public.purchase_orders add column if not exists other_cost numeric default 0;
alter table public.purchase_orders add column if not exists eta date;
alter table public.purchase_orders add column if not exists status text default 'Draft';
alter table public.purchase_orders add column if not exists notes text default '';
alter table public.purchase_orders add column if not exists total_ordered_units numeric default 0;
alter table public.purchase_orders add column if not exists total_product_cost numeric default 0;
alter table public.purchase_orders add column if not exists total_commission numeric default 0;
alter table public.purchase_orders add column if not exists grand_total numeric default 0;
alter table public.purchase_orders add column if not exists commission_payment_status text default 'Unpaid';
alter table public.purchase_orders add column if not exists commission_amount_paid numeric default 0;
alter table public.purchase_orders add column if not exists commission_payment_date date;
alter table public.purchase_orders add column if not exists commission_payment_method text default '';
alter table public.purchase_orders add column if not exists commission_payment_note text default '';
alter table public.purchase_orders add column if not exists created_by text default '';
alter table public.purchase_orders add column if not exists updated_at timestamptz default now();

create unique index if not exists purchase_orders_po_number_idx on public.purchase_orders (po_number);

-- =============================================================================
-- purchase_order_items
-- =============================================================================
create table if not exists public.purchase_order_items (
  id                    uuid primary key default gen_random_uuid(),
  purchase_order_id     uuid not null references public.purchase_orders(id) on delete cascade,
  inventory_id          bigint references public.inventory(id) on delete set null,
  product_sku           text default '',
  product_name          text default '',
  brand                 text default '',
  order_qty             numeric default 0,
  korean_unit_cost      numeric default 0,
  commission_percent    numeric default 0,
  commission_per_unit   numeric default 0,
  product_cost          numeric default 0,
  commission_total      numeric default 0,
  total_line_cost       numeric default 0,
  received_qty          numeric default 0,
  note                  text default '',
  created_at            timestamptz not null default now()
);

alter table public.purchase_order_items add column if not exists purchase_order_id uuid;
alter table public.purchase_order_items add column if not exists inventory_id bigint;
alter table public.purchase_order_items add column if not exists product_sku text default '';
alter table public.purchase_order_items add column if not exists product_name text default '';
alter table public.purchase_order_items add column if not exists brand text default '';
alter table public.purchase_order_items add column if not exists order_qty numeric default 0;
alter table public.purchase_order_items add column if not exists korean_unit_cost numeric default 0;
alter table public.purchase_order_items add column if not exists commission_percent numeric default 0;
alter table public.purchase_order_items add column if not exists commission_per_unit numeric default 0;
alter table public.purchase_order_items add column if not exists product_cost numeric default 0;
alter table public.purchase_order_items add column if not exists commission_total numeric default 0;
alter table public.purchase_order_items add column if not exists total_line_cost numeric default 0;
alter table public.purchase_order_items add column if not exists received_qty numeric default 0;
alter table public.purchase_order_items add column if not exists note text default '';

create index if not exists purchase_order_items_po_id_idx on public.purchase_order_items (purchase_order_id);

-- =============================================================================
-- purchase_order_receipts
-- =============================================================================
create table if not exists public.purchase_order_receipts (
  id                      uuid primary key default gen_random_uuid(),
  purchase_order_id       uuid not null references public.purchase_orders(id) on delete cascade,
  purchase_order_item_id  uuid not null references public.purchase_order_items(id) on delete cascade,
  inventory_id            bigint references public.inventory(id) on delete set null,
  received_qty            numeric default 0,
  received_date           timestamptz not null default now(),
  received_by             text default '',
  note                    text default '',
  inventory_before        numeric default 0,
  inventory_after         numeric default 0,
  created_at              timestamptz not null default now()
);

alter table public.purchase_order_receipts add column if not exists purchase_order_id uuid;
alter table public.purchase_order_receipts add column if not exists purchase_order_item_id uuid;
alter table public.purchase_order_receipts add column if not exists inventory_id bigint;
alter table public.purchase_order_receipts add column if not exists received_qty numeric default 0;
alter table public.purchase_order_receipts add column if not exists received_date timestamptz default now();
alter table public.purchase_order_receipts add column if not exists received_by text default '';
alter table public.purchase_order_receipts add column if not exists note text default '';
alter table public.purchase_order_receipts add column if not exists inventory_before numeric default 0;
alter table public.purchase_order_receipts add column if not exists inventory_after numeric default 0;

create index if not exists purchase_order_receipts_po_id_idx on public.purchase_order_receipts (purchase_order_id);

-- =============================================================================
-- Atomic receive RPC (prevents partial inventory updates)
-- =============================================================================
create or replace function public.receive_purchase_order_items(
  p_po_id uuid,
  p_lines jsonb,
  p_update_buying_price boolean default false,
  p_received_by text default ''
)
returns jsonb
language plpgsql
security definer
as $$
declare
  line jsonb;
  v_item_id uuid;
  v_receive_now numeric;
  v_note text;
  v_po record;
  v_item record;
  v_inv record;
  v_remaining numeric;
  v_new_received numeric;
  v_inv_before numeric;
  v_inv_after numeric;
  v_landed numeric;
  v_total_product numeric;
  v_share numeric;
  v_ship_alloc numeric;
  v_other_alloc numeric;
  v_all_received boolean := true;
  v_any_received boolean := false;
begin
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found then
    raise exception 'Purchase order not found';
  end if;
  if v_po.status = 'Cancelled' then
    raise exception 'Cannot receive a cancelled purchase order';
  end if;
  if v_po.status = 'Received' then
    raise exception 'Purchase order is already fully received';
  end if;

  select coalesce(sum(product_cost), 0) into v_total_product
  from public.purchase_order_items where purchase_order_id = p_po_id;

  for line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_item_id := (line->>'purchase_order_item_id')::uuid;
    v_receive_now := coalesce((line->>'receive_now')::numeric, 0);
    v_note := coalesce(line->>'note', '');

    if v_receive_now <= 0 then
      continue;
    end if;

    select * into v_item from public.purchase_order_items
    where id = v_item_id and purchase_order_id = p_po_id for update;
    if not found then
      raise exception 'PO line item not found';
    end if;

    v_remaining := greatest(coalesce(v_item.order_qty, 0) - coalesce(v_item.received_qty, 0), 0);
    if v_receive_now > v_remaining then
      raise exception 'Receive quantity exceeds remaining for item %', v_item_id;
    end if;

    if v_item.inventory_id is not null then
      select * into v_inv from public.inventory where id = v_item.inventory_id for update;
      if not found then
        raise exception 'Inventory item not found for PO line';
      end if;
      v_inv_before := coalesce(v_inv.qty, 0);
      v_inv_after := v_inv_before + v_receive_now;

      if p_update_buying_price then
        v_share := case when v_total_product > 0 then coalesce(v_item.product_cost, 0) / v_total_product else 0 end;
        v_ship_alloc := coalesce(v_po.shipping_cost, 0) * v_share;
        v_other_alloc := coalesce(v_po.other_cost, 0) * v_share;
        v_landed := coalesce(v_item.korean_unit_cost, 0)
          + coalesce(v_item.commission_per_unit, 0)
          + case when coalesce(v_item.order_qty, 0) > 0 then v_ship_alloc / v_item.order_qty else 0 end
          + case when coalesce(v_item.order_qty, 0) > 0 then v_other_alloc / v_item.order_qty else 0 end;
        update public.inventory
        set qty = v_inv_after,
            buying_price = v_landed,
            cost = v_landed
        where id = v_item.inventory_id;
      else
        update public.inventory set qty = v_inv_after where id = v_item.inventory_id;
      end if;
    else
      v_inv_before := 0;
      v_inv_after := 0;
    end if;

    v_new_received := coalesce(v_item.received_qty, 0) + v_receive_now;
    update public.purchase_order_items
    set received_qty = v_new_received
    where id = v_item_id;

    insert into public.purchase_order_receipts (
      purchase_order_id, purchase_order_item_id, inventory_id,
      received_qty, received_date, received_by, note,
      inventory_before, inventory_after
    ) values (
      p_po_id, v_item_id, v_item.inventory_id,
      v_receive_now, now(), p_received_by, v_note,
      v_inv_before, v_inv_after
    );

    v_any_received := true;
  end loop;

  if not v_any_received then
    raise exception 'No quantities to receive';
  end if;

  select bool_and(coalesce(received_qty, 0) >= coalesce(order_qty, 0))
  into v_all_received
  from public.purchase_order_items where purchase_order_id = p_po_id;

  update public.purchase_orders
  set status = case
        when v_all_received then 'Received'
        else 'Partially Received'
      end,
      updated_at = now()
  where id = p_po_id;

  return jsonb_build_object('ok', true, 'status', case when v_all_received then 'Received' else 'Partially Received' end);
end;
$$;

-- =============================================================================
-- RLS (permissive for authenticated users — match existing ERP pattern)
-- =============================================================================
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.purchase_order_receipts enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'purchase_orders' and policyname = 'po_all_authenticated') then
    create policy po_all_authenticated on public.purchase_orders for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'purchase_order_items' and policyname = 'po_items_all_authenticated') then
    create policy po_items_all_authenticated on public.purchase_order_items for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'purchase_order_receipts' and policyname = 'po_receipts_all_authenticated') then
    create policy po_receipts_all_authenticated on public.purchase_order_receipts for all to authenticated using (true) with check (true);
  end if;
end $$;
