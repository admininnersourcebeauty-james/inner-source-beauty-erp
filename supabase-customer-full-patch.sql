-- INNER SOURCE BEAUTY ERP customer full update
-- Run once in Supabase SQL Editor. This only ADDS columns. It does NOT delete existing data.
alter table customers add column if not exists billing_address text;
alter table customers add column if not exists shipping_address text;
alter table customers add column if not exists shipping_same_as_billing boolean default false;
alter table customers add column if not exists preferred_payment text;
alter table customers add column if not exists payment_terms text;
alter table customers add column if not exists tax_id text;
alter table customers add column if not exists note text;

-- Copy old address into Billing Address if Billing Address is empty.
update customers
set billing_address = address
where billing_address is null and address is not null;
