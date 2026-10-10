-- INNER SOURCE BEAUTY ERP — Order invoice inventory deduction RPC
-- Matches PO receive pattern: SECURITY DEFINER so Staff can deduct stock on invoice create/edit.
-- Staff RLS on public.inventory is SELECT-only; direct client .update() silently updates 0 rows.
-- Safe to re-run.

create or replace function public.adjust_inventory_qty(
  p_inventory_id bigint,
  p_delta numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_before numeric;
  v_after numeric;
begin
  v_role := public.get_user_role();
  if v_role not in ('Admin', 'Staff', 'Warehouse') then
    raise exception 'Permission denied: inventory adjustment requires Admin, Staff, or Warehouse role (current: %)', v_role;
  end if;

  if p_inventory_id is null then
    raise exception 'inventory_id is required';
  end if;

  select qty into v_before
  from public.inventory
  where id = p_inventory_id
  for update;

  if not found then
    raise exception 'Inventory item % not found', p_inventory_id;
  end if;

  if coalesce(p_delta, 0) = 0 then
    return jsonb_build_object(
      'inventory_id', p_inventory_id,
      'qty_before', coalesce(v_before, 0),
      'qty_after', coalesce(v_before, 0),
      'delta', 0
    );
  end if;

  v_after := greatest(coalesce(v_before, 0) + p_delta, 0);

  update public.inventory
  set qty = v_after
  where id = p_inventory_id;

  return jsonb_build_object(
    'inventory_id', p_inventory_id,
    'qty_before', coalesce(v_before, 0),
    'qty_after', v_after,
    'delta', p_delta
  );
end;
$$;

revoke all on function public.adjust_inventory_qty(bigint, numeric) from public;
grant execute on function public.adjust_inventory_qty(bigint, numeric) to authenticated;
