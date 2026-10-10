-- =============================================================================
-- INNER SOURCE BEAUTY ERP v2 — FULL MIGRATION
-- =============================================================================
-- Run this ONE file once in Supabase SQL Editor (Dashboard → SQL → New query).
-- Safe for existing v1 data: creates missing tables/columns, migrates legacy
-- fields, and does NOT delete rows.
-- =============================================================================

-- Extensions
create extension if not exists "pgcrypto";

-- =============================================================================
-- 1. PROFILES (user roles)
-- =============================================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  role        text not null default 'Staff'
                check (role in ('Admin', 'Staff', 'Warehouse')),
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- =============================================================================
-- 2. CUSTOMERS
-- =============================================================================
create table if not exists public.customers (
  id                          bigint generated always as identity primary key,
  created_at                  timestamptz not null default now(),
  name                        text default '',
  company                     text default '',
  phone                       text default '',
  email                       text default '',
  address                     text default '',
  billing_address             text default '',
  shipping_address            text default '',
  shipping_same_as_billing    boolean default false,
  preferred_payment           text default 'Zelle',
  payment_terms               text default 'COD',
  tax_id                      text default '',
  note                        text default '',
  status                      text default 'Active'
);

-- Add v2 columns if table already existed from v1
alter table public.customers add column if not exists name text default '';
alter table public.customers add column if not exists company text default '';
alter table public.customers add column if not exists phone text default '';
alter table public.customers add column if not exists email text default '';
alter table public.customers add column if not exists address text default '';
alter table public.customers add column if not exists billing_address text default '';
alter table public.customers add column if not exists shipping_address text default '';
alter table public.customers add column if not exists shipping_same_as_billing boolean default false;
alter table public.customers add column if not exists preferred_payment text default 'Zelle';
alter table public.customers add column if not exists payment_terms text default 'COD';
alter table public.customers add column if not exists tax_id text default '';
alter table public.customers add column if not exists note text default '';
alter table public.customers add column if not exists status text default 'Active';

-- Migrate legacy address → billing_address
update public.customers
set billing_address = address
where (billing_address is null or billing_address = '')
  and address is not null and address != '';

-- Normalize status values
update public.customers set status = 'Active' where status is null or status = '';
update public.customers set status = 'Active' where status not in ('Active', 'Hold', 'VIP');

-- =============================================================================
-- 3. INVENTORY
-- =============================================================================
create table if not exists public.inventory (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  style           text default '',
  brand           text default '',
  category        text default '',
  qty             numeric default 0,
  buying_price    numeric default 0,
  selling_price   numeric default 0,
  cost            numeric default 0,
  price           numeric default 0,
  retail          numeric default 0,
  low_stock       int default 5,
  lot             text default '',
  expiration_date date
);

alter table public.inventory add column if not exists style text default '';
alter table public.inventory add column if not exists brand text default '';
alter table public.inventory add column if not exists category text default '';
alter table public.inventory add column if not exists qty numeric default 0;
alter table public.inventory add column if not exists buying_price numeric default 0;
alter table public.inventory add column if not exists selling_price numeric default 0;
alter table public.inventory add column if not exists cost numeric default 0;
alter table public.inventory add column if not exists price numeric default 0;
alter table public.inventory add column if not exists retail numeric default 0;
alter table public.inventory add column if not exists low_stock int default 5;
alter table public.inventory add column if not exists lot text default '';
alter table public.inventory add column if not exists expiration_date date;

-- Migrate legacy pricing
update public.inventory set buying_price = cost
where (buying_price is null or buying_price = 0) and cost is not null and cost != 0;

update public.inventory set selling_price = price
where (selling_price is null or selling_price = 0) and price is not null and price != 0;

update public.inventory set selling_price = retail
where (selling_price is null or selling_price = 0) and retail is not null and retail != 0;

update public.inventory set cost = buying_price
where buying_price is not null and buying_price != 0 and (cost is null or cost = 0);

update public.inventory set price = selling_price
where selling_price is not null and selling_price != 0 and (price is null or price = 0);

update public.inventory set low_stock = 5 where low_stock is null;

-- =============================================================================
-- 4. ORDERS (also serves as invoices)
-- =============================================================================
create table if not exists public.orders (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  customer_id     bigint,
  inventory_id    bigint,
  customer_name   text default '',
  style           text default '',
  qty             numeric default 0,
  price           numeric default 0,
  buying_price    numeric default 0,
  profit          numeric default 0,
  shipping        numeric default 0,
  discount        numeric default 0,
  total           numeric default 0,
  invoice_no      text default '',
  status          text default 'Open',
  payment_status  text default 'Unpaid',
  note            text default '',
  due_date        date,
  tracking        text default ''
);

alter table public.orders add column if not exists customer_id bigint;
alter table public.orders add column if not exists inventory_id bigint;
alter table public.orders add column if not exists customer_name text default '';
alter table public.orders add column if not exists style text default '';
alter table public.orders add column if not exists qty numeric default 0;
alter table public.orders add column if not exists price numeric default 0;
alter table public.orders add column if not exists buying_price numeric default 0;
alter table public.orders add column if not exists profit numeric default 0;
alter table public.orders add column if not exists shipping numeric default 0;
alter table public.orders add column if not exists discount numeric default 0;
alter table public.orders add column if not exists total numeric default 0;
alter table public.orders add column if not exists invoice_no text default '';
alter table public.orders add column if not exists status text default 'Open';
alter table public.orders add column if not exists payment_status text default 'Unpaid';
alter table public.orders add column if not exists note text default '';
alter table public.orders add column if not exists internal_note text default '';
alter table public.orders add column if not exists customer_note text default '';
alter table public.orders add column if not exists due_date date;
alter table public.orders add column if not exists tracking text default '';

-- Backfill profit on existing orders where missing
update public.orders o
set buying_price = coalesce(i.buying_price, i.cost, 0),
    profit = (o.qty * o.price + coalesce(o.shipping,0) - coalesce(o.discount,0))
             - (o.qty * coalesce(i.buying_price, i.cost, 0))
from public.inventory i
where o.inventory_id = i.id
  and (o.profit is null or o.profit = 0)
  and o.qty > 0;

-- =============================================================================
-- 5. PAYMENTS
-- =============================================================================
create table if not exists public.payments (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  customer_id     bigint,
  order_id        bigint,
  invoice_no      text default '',
  payment_date    date default current_date,
  amount          numeric default 0,
  method          text default 'Zelle',
  reference_no    text default '',
  note            text default ''
);

alter table public.payments add column if not exists customer_id bigint;
alter table public.payments add column if not exists order_id bigint;
alter table public.payments add column if not exists invoice_no text default '';
alter table public.payments add column if not exists payment_date date default current_date;
alter table public.payments add column if not exists amount numeric default 0;
alter table public.payments add column if not exists method text default 'Zelle';
alter table public.payments add column if not exists reference_no text default '';
alter table public.payments add column if not exists note text default '';

-- =============================================================================
-- 6. INDEXES
-- =============================================================================
create index if not exists idx_customers_company   on public.customers (company);
create index if not exists idx_customers_phone     on public.customers (phone);
create index if not exists idx_customers_email     on public.customers (email);
create index if not exists idx_inventory_style     on public.inventory (style);
create index if not exists idx_inventory_brand     on public.inventory (brand);
create index if not exists idx_orders_customer_id  on public.orders (customer_id);
create index if not exists idx_orders_invoice_no   on public.orders (invoice_no);
create index if not exists idx_orders_created_at   on public.orders (created_at);
create index if not exists idx_payments_order_id   on public.payments (order_id);
create index if not exists idx_payments_invoice_no on public.payments (invoice_no);

-- =============================================================================
-- 7. HELPER: get current user role
-- =============================================================================
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

-- =============================================================================
-- 8. AUTO-CREATE PROFILE ON SIGNUP
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'Staff')
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for existing auth users
insert into public.profiles (id, email, role)
select id, email, 'Admin'
from auth.users
on conflict (id) do nothing;

-- =============================================================================
-- 9. AUTO-UPDATE ORDER PAYMENT STATUS WHEN PAYMENTS CHANGE
-- =============================================================================
create or replace function public.sync_order_payment_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order_id bigint;
  order_total     numeric;
  paid_total      numeric;
begin
  target_order_id := coalesce(new.order_id, old.order_id);

  if target_order_id is null then
    -- Fallback: match by invoice_no
    select o.id into target_order_id
    from public.orders o
    where o.invoice_no = coalesce(new.invoice_no, old.invoice_no)
    limit 1;
  end if;

  if target_order_id is null then
    return coalesce(new, old);
  end if;

  select coalesce(total, 0) into order_total
  from public.orders where id = target_order_id;

  select coalesce(sum(amount), 0) into paid_total
  from public.payments
  where order_id = target_order_id
     or (order_id is null and invoice_no = (select invoice_no from public.orders where id = target_order_id));

  update public.orders
  set payment_status = case
    when paid_total <= 0 then 'Unpaid'
    when paid_total >= order_total then 'Paid'
    else 'Partial'
  end
  where id = target_order_id;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sync_payment_status on public.payments;
create trigger trg_sync_payment_status
  after insert or update or delete on public.payments
  for each row execute function public.sync_order_payment_status();

-- Backfill payment_status for all existing orders
update public.orders o
set payment_status = case
  when coalesce(p.paid, 0) <= 0 then 'Unpaid'
  when coalesce(p.paid, 0) >= coalesce(o.total, 0) then 'Paid'
  else 'Partial'
end
from (
  select order_id, sum(amount) as paid
  from public.payments
  where order_id is not null
  group by order_id
) p
where o.id = p.order_id;

-- =============================================================================
-- 10. ROW LEVEL SECURITY
-- =============================================================================
alter table public.customers enable row level security;
alter table public.inventory enable row level security;
alter table public.orders    enable row level security;
alter table public.payments  enable row level security;

-- Drop old policies if re-running
drop policy if exists "profiles_select_own"   on public.profiles;
drop policy if exists "profiles_update_own"   on public.profiles;
drop policy if exists "profiles_admin_all"    on public.profiles;
drop policy if exists "customers_admin"       on public.customers;
drop policy if exists "customers_staff"       on public.customers;
drop policy if exists "customers_staff_write" on public.customers;
drop policy if exists "customers_staff_update" on public.customers;
drop policy if exists "inventory_admin"       on public.inventory;
drop policy if exists "inventory_warehouse"     on public.inventory;
drop policy if exists "inventory_staff_read"  on public.inventory;
drop policy if exists "orders_admin"          on public.orders;
drop policy if exists "orders_staff"          on public.orders;
drop policy if exists "payments_admin"        on public.payments;
drop policy if exists "payments_staff"        on public.payments;

-- Profiles: users read/update own; Admin reads all
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.get_user_role() = 'Admin');

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.get_user_role() = 'Admin');

create policy "profiles_admin_all" on public.profiles
  for all to authenticated
  using (public.get_user_role() = 'Admin');

-- Customers: Admin full; Staff read + insert + update
create policy "customers_admin" on public.customers
  for all to authenticated
  using (public.get_user_role() = 'Admin');

create policy "customers_staff" on public.customers
  for select to authenticated
  using (public.get_user_role() in ('Admin', 'Staff'));

create policy "customers_staff_write" on public.customers
  for insert to authenticated
  with check (public.get_user_role() in ('Admin', 'Staff'));

create policy "customers_staff_update" on public.customers
  for update to authenticated
  using (public.get_user_role() in ('Admin', 'Staff'));

-- Inventory: Admin + Warehouse full; Staff read-only
create policy "inventory_admin" on public.inventory
  for all to authenticated
  using (public.get_user_role() = 'Admin');

create policy "inventory_warehouse" on public.inventory
  for all to authenticated
  using (public.get_user_role() = 'Warehouse');

create policy "inventory_staff_read" on public.inventory
  for select to authenticated
  using (public.get_user_role() = 'Staff');

-- Orders: Admin full; Staff read + write
create policy "orders_admin" on public.orders
  for all to authenticated
  using (public.get_user_role() = 'Admin');

create policy "orders_staff" on public.orders
  for all to authenticated
  using (public.get_user_role() in ('Admin', 'Staff'));

-- Payments: Admin full; Staff read + write
create policy "payments_admin" on public.payments
  for all to authenticated
  using (public.get_user_role() = 'Admin');

create policy "payments_staff" on public.payments
  for all to authenticated
  using (public.get_user_role() in ('Admin', 'Staff'));

-- =============================================================================
-- 11. GRANT ACCESS
-- =============================================================================
grant usage on schema public to anon, authenticated;
grant all on all tables    in schema public to authenticated;
grant all on all sequences in schema public to authenticated;

-- =============================================================================
-- DONE — Set your first admin (replace email):
--   update public.profiles set role = 'Admin' where email = 'you@example.com';
-- =============================================================================
