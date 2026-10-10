-- INNER SOURCE BEAUTY ERP — Inventory pricing update
-- Safe: ADD columns and migrate from legacy fields. Does NOT delete existing data.
-- Run once in Supabase SQL Editor after supabase-v1-proper-patch.sql

alter table inventory add column if not exists buying_price numeric default 0;
alter table inventory add column if not exists selling_price numeric default 0;

-- Migrate legacy cost → buying_price
update inventory
set buying_price = cost
where (buying_price is null or buying_price = 0)
  and cost is not null
  and cost != 0;

-- Migrate legacy price → selling_price, then retail as fallback
update inventory
set selling_price = price
where (selling_price is null or selling_price = 0)
  and price is not null
  and price != 0;

update inventory
set selling_price = retail
where (selling_price is null or selling_price = 0)
  and retail is not null
  and retail != 0;

-- Keep order flow working: sync legacy price/cost columns
update inventory
set cost = buying_price
where buying_price is not null
  and buying_price != 0
  and (cost is null or cost = 0);

update inventory
set price = selling_price
where selling_price is not null
  and selling_price != 0
  and (price is null or price = 0);
