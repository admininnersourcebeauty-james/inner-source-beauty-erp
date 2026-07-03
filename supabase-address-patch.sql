-- INNER SOURCE BEAUTY ERP customer address update
-- Run once in Supabase SQL Editor before using separate Billing / Shipping addresses.
alter table customers add column if not exists shipping_address text;
alter table customers add column if not exists note text;
