-- =============================================================================
-- INNER SOURCE BEAUTY ERP — PO-level shipping/other costs on receive
-- =============================================================================
-- Run manually in Supabase SQL Editor after reviewing.
-- Safe and rerunnable. Does NOT use DROP TABLE, DELETE, or TRUNCATE.
--
-- Run AFTER:
--   supabase-purchase-order-receive-selling-price-migration.sql
--
-- Uses purchase_orders.shipping_cost and purchase_orders.other_cost (entered at
-- PO creation) spread evenly across all ordered units when calculating landed
-- unit cost on receive. Legacy receives without PO-level costs still accept
-- p_shipping_cost / p_other_cost on the receive RPC.
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
set search_path = public
as $$
declare
  line jsonb;
  v_item_id uuid;
  v_receive_now numeric;
  v_line_note text;
  v_selling_price numeric;
  v_po record;
  v_item record;
  v_inv record;
  v_inv_id bigint;
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
  v_factory_usd numeric;
  v_commission_per_unit numeric;
  v_all_received boolean := true;
  v_any_received boolean := false;
  v_receive_id uuid;
  v_receive_number text;
  v_receive_seq int;
  v_shipping_cost numeric;
  v_other_cost numeric;
  v_new_buying numeric;
  v_old_buying numeric;
  v_exchange_rate numeric;
  v_product_cost_usd numeric := 0;
  v_commission_usd numeric := 0;
  v_new_shipping numeric := 0;
  v_new_other numeric := 0;
  v_total_purchase_usd numeric := 0;
  v_total_order_units numeric := 0;
  v_po_shipping numeric := 0;
  v_po_other numeric := 0;
  v_po_shipping_per_unit numeric := 0;
  v_po_other_per_unit numeric := 0;
  v_batch_shipping numeric := 0;
  v_batch_other numeric := 0;
  v_uses_po_level_costs boolean := false;
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

  v_shipping_cost := greatest(coalesce(p_shipping_cost, 0), 0);
  v_other_cost := greatest(coalesce(p_other_cost, 0), 0);

  if coalesce(v_po.currency, 'KRW') = 'USD' then
    v_exchange_rate := 1;
  else
    v_exchange_rate := coalesce(v_po.exchange_rate, 0);
    if v_exchange_rate <= 0 then
      raise exception 'Exchange Rate must be greater than 0.';
    end if;
  end if;

  select coalesce(sum(greatest(coalesce(order_qty, 0), 0)), 0)
  into v_total_order_units
  from public.purchase_order_items
  where purchase_order_id = p_po_id;

  v_total_order_units := greatest(v_total_order_units, 1);
  v_po_shipping := greatest(coalesce(v_po.shipping_cost, 0), 0);
  v_po_other := greatest(coalesce(v_po.other_cost, 0), 0);
  v_uses_po_level_costs := v_po_shipping > 0 or v_po_other > 0;
  v_po_shipping_per_unit := v_po_shipping / v_total_order_units;
  v_po_other_per_unit := v_po_other / v_total_order_units;
  v_batch_shipping := case when v_uses_po_level_costs then 0 else v_shipping_cost end;
  v_batch_other := case when v_uses_po_level_costs then 0 else v_other_cost end;

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

    if trim(coalesce(v_item.product_sku, v_item.product_name, '')) = '' then
      raise exception 'Product SKU is required to receive inventory';
    end if;

    v_selling_price := coalesce((line->>'selling_price')::numeric, 0);
    if v_selling_price < 0 then
      raise exception 'Selling Price (USD) must be 0 or greater';
    end if;

    v_remaining := greatest(coalesce(v_item.order_qty, 0) - coalesce(v_item.received_qty, 0), 0);
    if v_receive_now > v_remaining then
      raise exception 'Receive quantity exceeds remaining for item %', v_item_id;
    end if;

    v_factory_usd := public.po_item_factory_unit_cost_usd(
      v_item.factory_unit_cost_usd,
      v_item.korean_unit_cost,
      v_po.currency,
      v_exchange_rate
    );
    v_total_value := v_total_value + (v_receive_now * v_factory_usd);
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
    case when v_uses_po_level_costs then 0 else v_shipping_cost end,
    case when v_uses_po_level_costs then 0 else v_other_cost end,
    coalesce(p_other_cost_description, ''), coalesce(p_notes, ''),
    coalesce(p_received_by, '')
  )
  returning id into v_receive_id;

  for line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_item_id := (line->>'purchase_order_item_id')::uuid;
    v_receive_now := coalesce((line->>'receive_now')::numeric, 0);
    v_line_note := coalesce(line->>'note', '');
    v_selling_price := greatest(coalesce((line->>'selling_price')::numeric, 0), 0);

    if v_receive_now <= 0 then
      continue;
    end if;

    if v_selling_price < 0 then
      raise exception 'Selling Price (USD) must be 0 or greater';
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

    v_factory_usd := public.po_item_factory_unit_cost_usd(
      v_item.factory_unit_cost_usd,
      v_item.korean_unit_cost,
      v_po.currency,
      v_exchange_rate
    );

    v_commission_per_unit := case
      when public.po_is_middleman_purchase_type(v_po.purchase_type) then
        coalesce(nullif(v_item.commission_per_unit_usd, 0),
          v_factory_usd * coalesce(v_item.commission_percent, 0) / 100)
      else 0
    end;

    v_item_value := v_receive_now * v_factory_usd;
    v_share := v_item_value / v_total_value;
    v_ship_alloc := (v_po_shipping_per_unit * v_receive_now) + (v_batch_shipping * v_share);
    v_other_alloc := (v_po_other_per_unit * v_receive_now) + (v_batch_other * v_share);
    v_landed := v_factory_usd
      + v_commission_per_unit
      + case when v_receive_now > 0 then v_ship_alloc / v_receive_now else 0 end
      + case when v_receive_now > 0 then v_other_alloc / v_receive_now else 0 end;

    v_inv_id := public.po_resolve_receive_inventory_id(v_item_id, p_po_id);

    select * into v_inv from public.inventory where id = v_inv_id for update;
    if not found then
      raise exception 'Inventory item not found for PO line';
    end if;

    v_inv_before := coalesce(v_inv.qty, 0);
    v_inv_after := v_inv_before + v_receive_now;
    v_old_buying := coalesce(
      nullif(v_inv.buying_price, 0),
      nullif(v_inv.cost, 0),
      0
    );

    if v_inv_before <= 0 then
      v_new_buying := v_landed;
    else
      v_new_buying := ((v_inv_before * v_old_buying) + (v_receive_now * v_landed)) / v_inv_after;
    end if;

    update public.inventory
    set qty = v_inv_after,
        buying_price = v_new_buying,
        cost = v_new_buying
    where id = v_inv_id;

    if v_selling_price > 0 then
      update public.inventory
      set selling_price = v_selling_price,
          price = v_selling_price
      where id = v_inv_id;
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
      p_po_id, v_item_id, v_inv_id, v_receive_id,
      v_receive_now, coalesce(p_received_date, now()), coalesce(p_received_by, ''), v_line_note,
      v_inv_before, v_inv_after,
      v_factory_usd, v_commission_per_unit,
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

  v_product_cost_usd := public.po_calc_product_cost_usd(p_po_id, v_po.currency, v_exchange_rate);
  v_commission_usd := public.po_calc_commission_total_usd(
    p_po_id, v_po.purchase_type, v_po.currency, v_exchange_rate
  );
  if v_uses_po_level_costs then
    v_new_shipping := v_po_shipping;
    v_new_other := v_po_other;
  else
    v_new_shipping := coalesce(v_po.shipping_cost, 0) + v_shipping_cost;
    v_new_other := coalesce(v_po.other_cost, 0) + v_other_cost;
  end if;
  v_total_purchase_usd := v_product_cost_usd + v_commission_usd + v_new_shipping + v_new_other;

  update public.purchase_orders
  set status = case
        when v_all_received then 'Received'
        else 'Partially Received'
      end,
      shipping_cost = v_new_shipping,
      other_cost = v_new_other,
      total_product_cost_usd = v_product_cost_usd,
      total_purchase_cost_usd = v_total_purchase_usd,
      grand_total = v_total_purchase_usd,
      updated_at = now()
  where id = p_po_id;

  return jsonb_build_object(
    'ok', true,
    'receive_id', v_receive_id,
    'receive_number', v_receive_number,
    'status', case when v_all_received then 'Received' else 'Partially Received' end,
    'total_product_cost_usd', v_product_cost_usd,
    'total_commission_usd', v_commission_usd,
    'total_purchase_cost_usd', v_total_purchase_usd
  );
end;
$$;
