create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text,
  company text,
  phone text,
  email text,
  address text,
  created_at timestamptz default now()
);

create table if not exists inventory (
  id uuid primary key default gen_random_uuid(),
  style text,
  color text,
  qty numeric default 0,
  cost numeric default 0,
  price numeric default 0,
  created_at timestamptz default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  invoice_no text,
  customer_name text,
  inventory_id text,
  style text,
  qty numeric default 0,
  price numeric default 0,
  shipping numeric default 0,
  discount numeric default 0,
  total numeric default 0,
  status text default 'Pending',
  created_at timestamptz default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  invoice_no text,
  amount numeric default 0,
  method text,
  note text,
  created_at timestamptz default now()
);

alter table customers enable row level security;
alter table inventory enable row level security;
alter table orders enable row level security;
alter table payments enable row level security;

create policy "auth customers all" on customers for all to authenticated using (true) with check (true);
create policy "auth inventory all" on inventory for all to authenticated using (true) with check (true);
create policy "auth orders all" on orders for all to authenticated using (true) with check (true);
create policy "auth payments all" on payments for all to authenticated using (true) with check (true);
