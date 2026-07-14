-- INNER SOURCE BEAUTY ERP — Fulfillment workflow fields
-- Run in Supabase SQL Editor

alter table public.orders
add column if not exists fulfillment_date date;

alter table public.orders
add column if not exists delivered_by text;

alter table public.orders
add column if not exists picked_up_by text;

alter table public.orders
add column if not exists fulfillment_note text;

alter table public.orders
add column if not exists signature_name text;

-- Migrate legacy fulfillment statuses (safe, does not delete data)
update public.orders
set status = 'Ready to Fulfill'
where status = 'Ready to Ship';

update public.orders
set status = 'Partially Fulfilled'
where status = 'Partially Shipped';

update public.orders
set status = 'Completed'
where status = 'Shipped';
