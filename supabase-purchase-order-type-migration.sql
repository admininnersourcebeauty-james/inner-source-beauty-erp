-- =============================================================================
-- INNER SOURCE BEAUTY ERP — Purchase Order purchase_type migration
-- =============================================================================
-- Run manually in Supabase SQL Editor after reviewing.
-- Safe and rerunnable: adds column, backfills null/blank rows only, sets default,
-- adds check constraint, and updates receive RPC.
-- Does NOT delete, drop, or truncate data.
-- Does NOT overwrite an existing valid purchase_type value.
-- =============================================================================

-- 1. Add purchase_type without forcing existing rows to 'direct'
alter table public.purchase_orders
add column if not exists purchase_type text;

-- 2. Backfill only rows whose purchase_type is null or blank
update public.purchase_orders
set purchase_type = 'middleman'
where (purchase_type is null or btrim(purchase_type) = '')
  and (
    coalesce(btrim(middleman_name), '') <> ''
    or coalesce(total_commission, 0) > 0
  );

update public.purchase_orders
set purchase_type = 'direct'
where purchase_type is null or btrim(purchase_type) = '';

-- 3. Default for future inserts only
alter table public.purchase_orders
alter column purchase_type set default 'direct';

-- 4. Restrict purchase_type to allowed values (add once)
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'purchase_orders_purchase_type_check'
      and conrelid = 'public.purchase_orders'::regclass
  ) then
    alter table public.purchase_orders
      add constraint purchase_orders_purchase_type_check
      check (purchase_type in ('direct', 'middleman'));
  end if;
end $$;

-- 5. Receive RPC — purchase_type is the single source of truth
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
  v_is_middleman boolean := false;
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
          + case when v_is_middleman then coalesce(v_item.commission_per_unit, 0) else 0 end
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
