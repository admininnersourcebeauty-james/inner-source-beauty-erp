-- INNER SOURCE BEAUTY ERP v1 proper patch
-- Safe: ADD columns only. Does NOT delete existing data.
alter table customers add column if not exists billing_address text;
alter table customers add column if not exists shipping_address text;
alter table customers add column if not exists shipping_same_as_billing boolean default false;
alter table customers add column if not exists preferred_payment text;
alter table customers add column if not exists payment_terms text;
alter table customers add column if not exists tax_id text;
alter table customers add column if not exists note text;
alter table customers add column if not exists status text default 'Active';
update customers set billing_address = address where billing_address is null and address is not null;

alter table inventory add column if not exists brand text;
alter table inventory add column if not exists lot text;
alter table inventory add column if not exists expiration_date date;
alter table inventory add column if not exists category text;
alter table inventory add column if not exists retail numeric default 0;
alter table inventory add column if not exists low_stock int default 5;

alter table orders add column if not exists customer_id bigint;
alter table orders add column if not exists shipping numeric default 0;
alter table orders add column if not exists discount numeric default 0;
alter table orders add column if not exists payment_status text default 'Unpaid';
alter table orders add column if not exists note text;

alter table payments add column if not exists customer_id bigint;
alter table payments add column if not exists order_id bigint;
alter table payments add column if not exists payment_date date default current_date;
alter table payments add column if not exists reference_no text;
