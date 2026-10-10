-- =============================================================================
-- INNER SOURCE BEAUTY ERP — RLS for purchase_order_commission_payments
-- Safe to re-run. Does NOT use DROP TABLE, DELETE, or TRUNCATE.
-- =============================================================================

-- Requires public.get_user_role() from staff-management migrations.
create or replace function public.get_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'Staff'
  );
$$;

alter table public.purchase_order_commission_payments enable row level security;

drop policy if exists "po_commission_payments_all_authenticated" on public.purchase_order_commission_payments;
drop policy if exists "po_commission_payments_admin" on public.purchase_order_commission_payments;
drop policy if exists "po_commission_payments_staff" on public.purchase_order_commission_payments;
drop policy if exists "po_commission_payments_warehouse" on public.purchase_order_commission_payments;

-- Admin: full access
create policy "po_commission_payments_admin"
  on public.purchase_order_commission_payments
  for all
  to authenticated
  using (public.get_user_role() = 'Admin')
  with check (public.get_user_role() = 'Admin');

-- Staff: full access (accounting / payments workflows)
create policy "po_commission_payments_staff"
  on public.purchase_order_commission_payments
  for all
  to authenticated
  using (public.get_user_role() = 'Staff')
  with check (public.get_user_role() = 'Staff');

-- Warehouse: no policy (no SELECT / INSERT / UPDATE / DELETE)

grant select, insert, update, delete
  on public.purchase_order_commission_payments
  to authenticated;
