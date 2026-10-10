-- Sales Person on orders (nullable — existing orders remain valid)
alter table public.orders
  add column if not exists sales_person_id uuid references public.profiles(id) on delete set null;

alter table public.orders
  add column if not exists sales_person_name text default '';
