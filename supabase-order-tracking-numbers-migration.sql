-- INNER SOURCE BEAUTY ERP — Multiple tracking numbers per order/invoice
-- Safe to run on existing production. Preserves orders.tracking (legacy column).

create table if not exists public.order_tracking_numbers (
  id              uuid primary key default gen_random_uuid(),
  order_id        bigint not null references public.orders (id) on delete cascade,
  tracking_number text not null default '',
  created_at      timestamptz not null default now()
);

create index if not exists order_tracking_numbers_order_id_idx
  on public.order_tracking_numbers (order_id);

create index if not exists order_tracking_numbers_created_at_idx
  on public.order_tracking_numbers (order_id, created_at);

-- Migrate existing single tracking values (do not delete orders.tracking).
insert into public.order_tracking_numbers (order_id, tracking_number, created_at)
select o.id, trim(o.tracking), coalesce(o.created_at, now())
from public.orders o
where coalesce(trim(o.tracking), '') <> ''
  and not exists (
    select 1
    from public.order_tracking_numbers t
    where t.order_id = o.id
      and trim(t.tracking_number) = trim(o.tracking)
  );

alter table public.order_tracking_numbers enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'order_tracking_numbers'
      and policyname = 'order_tracking_numbers_all_authenticated'
  ) then
    create policy order_tracking_numbers_all_authenticated
      on public.order_tracking_numbers
      for all
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;
