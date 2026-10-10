-- =============================================================================
-- INNER SOURCE BEAUTY ERP — Complete Staff Management Migration
-- Safe to re-run (uses IF NOT EXISTS / DROP IF EXISTS)
-- =============================================================================

create extension if not exists "pgcrypto";

-- =============================================================================
-- 1. PROFILES TABLE (create if missing)
-- =============================================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  role        text not null default 'Staff'
                check (role in ('Admin', 'Staff', 'Warehouse')),
  created_at  timestamptz not null default now()
);

-- =============================================================================
-- 2. PROFILES COLUMNS
-- =============================================================================
alter table public.profiles add column if not exists full_name text default '';
alter table public.profiles add column if not exists status text default 'active';
alter table public.profiles add column if not exists active boolean not null default true;
alter table public.profiles add column if not exists last_login timestamptz;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- Migrate legacy active boolean -> status text
update public.profiles
set status = case when active = false then 'inactive' else 'active' end
where status is null or status = '';

update public.profiles set status = 'active' where status is null or status = '';

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles
  add constraint profiles_status_check check (status in ('active', 'inactive'));

-- Keep active boolean in sync with status for backward compatibility
update public.profiles set active = (status = 'active');

-- =============================================================================
-- 3. HELPER: get current user role
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
-- 4. UPDATED_AT TRIGGER
-- =============================================================================
create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  if new.status is not null then
    new.active = (new.status = 'active');
  elsif new.active is not null then
    new.status = case when new.active then 'active' else 'inactive' end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_profiles_updated_at();

-- =============================================================================
-- 5. AUTO-CREATE PROFILE ON SIGNUP
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role, full_name, status, active)
  values (
    new.id,
    new.email,
    'Staff',
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'active',
    true
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = case
      when coalesce(public.profiles.full_name, '') = '' then excluded.full_name
      else public.profiles.full_name
    end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for existing auth users
insert into public.profiles (id, email, role, full_name, status, active)
select id, email, 'Staff', '', 'active', true
from auth.users
on conflict (id) do nothing;

-- =============================================================================
-- 6. SECURE RPC — users may only update their own full_name
-- =============================================================================
create or replace function public.update_my_full_name(p_full_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.profiles
  set full_name = trim(coalesce(p_full_name, ''))
  where id = auth.uid();
end;
$$;

create or replace function public.touch_my_last_login()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  update public.profiles
  set last_login = now()
  where id = auth.uid();
end;
$$;

revoke all on function public.update_my_full_name(text) from public;
revoke all on function public.touch_my_last_login() from public;
grant execute on function public.update_my_full_name(text) to authenticated;
grant execute on function public.touch_my_last_login() to authenticated;

-- =============================================================================
-- 7. PROFILES RLS — select own or admin all; update admin only
-- =============================================================================
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_admin_all" on public.profiles;
drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;

-- Users read own profile; Admin reads all
create policy "profiles_select" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.get_user_role() = 'Admin');

-- Only Admin may directly update profiles (role, status, active, email, last_login, full_name)
-- Normal users update full_name via update_my_full_name() RPC only
create policy "profiles_update_admin" on public.profiles
  for update to authenticated
  using (public.get_user_role() = 'Admin')
  with check (public.get_user_role() = 'Admin');

-- =============================================================================
-- 8. SALES PERSON ON ORDERS (optional but recommended)
-- =============================================================================
alter table public.orders
  add column if not exists sales_person_id uuid references public.profiles(id) on delete set null;

alter table public.orders
  add column if not exists sales_person_name text default '';

-- =============================================================================
-- 9. WAREHOUSE — read-only access to orders
-- =============================================================================
drop policy if exists "orders_warehouse_read" on public.orders;
create policy "orders_warehouse_read" on public.orders
  for select to authenticated
  using (public.get_user_role() = 'Warehouse');

drop policy if exists "order_items_warehouse_read" on public.order_items;
create policy "order_items_warehouse_read" on public.order_items
  for select to authenticated
  using (public.get_user_role() = 'Warehouse');

-- =============================================================================
-- 10. SET YOUR ADMIN ACCOUNT (edit email before running if needed)
-- =============================================================================
-- update public.profiles
-- set role = 'Admin', status = 'active', active = true
-- where email = 'admin.innersourcebeauty@gmail.com';
