-- INNER SOURCE BEAUTY ERP — Invoice void audit fields
-- Run in Supabase SQL Editor if void columns are missing

alter table public.orders
add column if not exists void_reason text;

alter table public.orders
add column if not exists void_note text;

alter table public.orders
add column if not exists voided_at timestamptz;

alter table public.orders
add column if not exists voided_by text;
