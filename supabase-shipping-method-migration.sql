-- INNER SOURCE BEAUTY ERP — Outbound shipping method on orders
-- Run in Supabase SQL Editor

alter table public.orders
add column if not exists shipping_method text default '';

update public.orders
set shipping_method = ''
where shipping_method is null;
