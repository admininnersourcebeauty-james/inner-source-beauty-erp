-- =============================================================================
-- INNER SOURCE BEAUTY ERP — Purchase Order receive history migration
-- =============================================================================
-- Run manually in Supabase SQL Editor after reviewing.
-- Safe and rerunnable: creates tables/columns only. Does NOT delete existing data.
-- =============================================================================

-- =============================================================================
-- purchase_order_receives — one row per receive shipment / transaction
-- =============================================================================
create table if not exists public.purchase_order_receives (
  id                      uuid primary key default gen_random_uuid(),
  purchase_order_id       uuid not null references public.purchase_orders(id) on delete cascade,
  receive_number          text not null,
  received_date           timestamptz not null default now(),
  shipment_number         text default '',
  shipping_cost           numeric default 0,
  other_cost              numeric default 0,
  other_cost_description  text default '',
  notes                   text default '',
  received_by             text default '',
  created_at              timestamptz not null default now()
);

alter table public.purchase_order_receives add column if not exists purchase_order_id uuid;
alter table public.purchase_order_receives add column if not exists receive_number text;
alter table public.purchase_order_receives add column if not exists received_date timestamptz default now();
alter table public.purchase_order_receives add column if not exists shipment_number text default '';
alter table public.purchase_order_receives add column if not exists shipping_cost numeric default 0;
alter table public.purchase_order_receives add column if not exists other_cost numeric default 0;
alter table public.purchase_order_receives add column if not exists other_cost_description text default '';
alter table public.purchase_order_receives add column if not exists notes text default '';
alter table public.purchase_order_receives add column if not exists received_by text default '';
alter table public.purchase_order_receives add column if not exists created_at timestamptz default now();

create unique index if not exists purchase_order_receives_po_number_idx
  on public.purchase_order_receives (purchase_order_id, receive_number);

create index if not exists purchase_order_receives_po_id_idx
  on public.purchase_order_receives (purchase_order_id);

-- =============================================================================
-- purchase_order_receipts — extend with receive batch + cost snapshots
-- =============================================================================
alter table public.purchase_order_receipts add column if not exists receive_id uuid;
alter table public.purchase_order_receipts add column if not exists factory_unit_cost numeric default 0;
alter table public.purchase_order_receipts add column if not exists commission_per_unit numeric default 0;
alter table public.purchase_order_receipts add column if not exists shipping_allocation numeric default 0;
alter table public.purchase_order_receipts add column if not exists other_cost_allocation numeric default 0;
alter table public.purchase_order_receipts add column if not exists landed_unit_cost numeric default 0;
alter table public.purchase_order_receipts add column if not exists buying_price_before numeric default 0;
alter table public.purchase_order_receipts add column if not exists buying_price_after numeric default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'purchase_order_receipts_receive_id_fkey'
      and conrelid = 'public.purchase_order_receipts'::regclass
  ) then
    alter table public.purchase_order_receipts
      add constraint purchase_order_receipts_receive_id_fkey
      foreign key (receive_id) references public.purchase_order_receives(id) on delete set null;
  end if;
end $$;

create index if not exists purchase_order_receipts_receive_id_idx
  on public.purchase_order_receipts (receive_id);

-- =============================================================================
-- Receive RPC — per-shipment shipping/other with weighted average buying price
-- =============================================================================
create or replace function public.receive_purchase_order_items(
  p_po_id uuid,
  p_lines jsonb,
  p_received_by text default '',
  p_received_date timestamptz default now(),
  p_shipment_number text default '',
  p_shipping_cost numeric default 0,
  p_other_cost numeric default 0,
  p_other_cost_description text default '',
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
as $$
declare
  line jsonb;
  v_item_id uuid;
  v_receive_now numeric;
  v_line_note text;
  v_po record;
  v_item record;
  v_inv record;
  v_remaining numeric;
  v_new_received numeric;
  v_inv_before numeric;
  v_inv_after numeric;
  v_landed numeric;
  v_total_value numeric := 0;
  v_item_value numeric;
  v_share numeric;
  v_ship_alloc numeric;
  v_other_alloc numeric;
  v_factory numeric;
  v_commission_per_unit numeric;
  v_all_received boolean := true;
  v_any_received boolean := false;
  v_is_middleman boolean := false;
  v_receive_id uuid;
  v_receive_number text;
  v_receive_seq int;
  v_shipping_cost numeric;
  v_other_cost numeric;
  v_new_buying numeric;
  v_old_buying numeric;
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

  v_is_middleman := coalesce(v_po.purchase_type, 'direct') = 'middleman';
  v_shipping_cost := greatest(coalesce(p_shipping_cost, 0), 0);
  v_other_cost := greatest(coalesce(p_other_cost, 0), 0);

  -- Total received value for this transaction (for cost allocation)
  for line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_item_id := (line->>'purchase_order_item_id')::uuid;
    v_receive_now := coalesce((line->>'receive_now')::numeric, 0);
    if v_receive_now <= 0 then
      continue;
    end if;

    select * into v_item from public.purchase_order_items
    where id = v_item_id and purchase_order_id = p_po_id;
    if not found then
      raise exception 'PO line item not found';
    end if;

    v_remaining := greatest(coalesce(v_item.order_qty, 0) - coalesce(v_item.received_qty, 0), 0);
    if v_receive_now > v_remaining then
      raise exception 'Receive quantity exceeds remaining for item %', v_item_id;
    end if;

    v_factory := coalesce(v_item.korean_unit_cost, 0);
    v_total_value := v_total_value + (v_receive_now * v_factory);
  end loop;

  if v_total_value <= 0 then
    raise exception 'No quantities to receive';
  end if;

  select count(*) + 1 into v_receive_seq
  from public.purchase_order_receives
  where purchase_order_id = p_po_id;

  v_receive_number := coalesce(v_po.po_number, 'PO') || '-R' || lpad(v_receive_seq::text, 2, '0');

  insert into public.purchase_order_receives (
    purchase_order_id, receive_number, received_date, shipment_number,
    shipping_cost, other_cost, other_cost_description, notes, received_by
  ) values (
    p_po_id, v_receive_number, coalesce(p_received_date, now()), coalesce(p_shipment_number, ''),
    v_shipping_cost, v_other_cost, coalesce(p_other_cost_description, ''), coalesce(p_notes, ''),
    coalesce(p_received_by, '')
  )
  returning id into v_receive_id;

  for line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_item_id := (line->>'purchase_order_item_id')::uuid;
    v_receive_now := coalesce((line->>'receive_now')::numeric, 0);
    v_line_note := coalesce(line->>'note', '');

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

    v_factory := coalesce(v_item.korean_unit_cost, 0);
    v_commission_per_unit := case when v_is_middleman then coalesce(v_item.commission_per_unit, 0) else 0 end;
    v_item_value := v_receive_now * v_factory;
    v_share := v_item_value / v_total_value;
    v_ship_alloc := v_shipping_cost * v_share;
    v_other_alloc := v_other_cost * v_share;
    v_landed := v_factory
      + v_commission_per_unit
      + case when v_receive_now > 0 then v_ship_alloc / v_receive_now else 0 end
      + case when v_receive_now > 0 then v_other_alloc / v_receive_now else 0 end;

    if v_item.inventory_id is not null then
      select * into v_inv from public.inventory where id = v_item.inventory_id for update;
      if not found then
        raise exception 'Inventory item not found for PO line';
      end if;
      v_inv_before := coalesce(v_inv.qty, 0);
      v_inv_after := v_inv_before + v_receive_now;
      v_old_buying := coalesce(v_inv.buying_price, v_inv.cost, 0);

      if v_inv_before <= 0 then
        v_new_buying := v_landed;
      else
        v_new_buying := ((v_inv_before * v_old_buying) + (v_receive_now * v_landed)) / v_inv_after;
      end if;

      update public.inventory
      set qty = v_inv_after,
          buying_price = v_new_buying,
          cost = v_new_buying
      where id = v_item.inventory_id;
    else
      v_inv_before := 0;
      v_inv_after := 0;
      v_old_buying := 0;
      v_new_buying := v_landed;
    end if;

    v_new_received := coalesce(v_item.received_qty, 0) + v_receive_now;
    update public.purchase_order_items
    set received_qty = v_new_received
    where id = v_item_id;

    insert into public.purchase_order_receipts (
      purchase_order_id, purchase_order_item_id, inventory_id, receive_id,
      received_qty, received_date, received_by, note,
      inventory_before, inventory_after,
      factory_unit_cost, commission_per_unit,
      shipping_allocation, other_cost_allocation, landed_unit_cost,
      buying_price_before, buying_price_after
    ) values (
      p_po_id, v_item_id, v_item.inventory_id, v_receive_id,
      v_receive_now, coalesce(p_received_date, now()), coalesce(p_received_by, ''), v_line_note,
      v_inv_before, v_inv_after,
      v_factory, v_commission_per_unit,
      v_ship_alloc, v_other_alloc, v_landed,
      v_old_buying, v_new_buying
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
      shipping_cost = coalesce(shipping_cost, 0) + v_shipping_cost,
      other_cost = coalesce(other_cost, 0) + v_other_cost,
      grand_total = coalesce(total_product_cost, 0)
        + coalesce(total_commission, 0)
        + coalesce(shipping_cost, 0) + v_shipping_cost
        + coalesce(other_cost, 0) + v_other_cost,
      updated_at = now()
  where id = p_po_id;

  return jsonb_build_object(
    'ok', true,
    'receive_id', v_receive_id,
    'receive_number', v_receive_number,
    'status', case when v_all_received then 'Received' else 'Partially Received' end
  );
end;
$$;

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.purchase_order_receives enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'purchase_order_receives' and policyname = 'po_receives_all_authenticated'
  ) then
    create policy po_receives_all_authenticated on public.purchase_order_receives
      for all to authenticated using (true) with check (true);
  end if;
end $$;
