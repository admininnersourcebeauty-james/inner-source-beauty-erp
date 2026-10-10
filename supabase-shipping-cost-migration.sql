-- INNER SOURCE BEAUTY ERP — Per-unit inbound shipping cost
-- Safe: ADD columns only. Does NOT delete or reset existing data.
-- Run once in Supabase SQL Editor.

-- Inbound shipping cost per unit on inventory
alter table public.inventory
add column if not exists shipping_cost numeric default 0;

update public.inventory
set shipping_cost = 0
where shipping_cost is null;

-- Snapshot inbound shipping cost on orders for historical profit accuracy
alter table public.orders
add column if not exists shipping_cost numeric default 0;

update public.orders
set shipping_cost = 0
where shipping_cost is null;
