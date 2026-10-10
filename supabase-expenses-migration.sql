-- INNER SOURCE BEAUTY ERP — Operating Expenses
-- Safe additive migration. Does not modify existing tables or historical data.
-- Run once in Supabase SQL Editor.

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category text not null default 'Other',
  description text not null default '',
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists expenses_expense_date_idx on public.expenses (expense_date desc);
create index if not exists expenses_category_idx on public.expenses (category);

comment on table public.expenses is 'Operating expenses for monthly net profit. Do not record inventory purchases or inbound shipping capitalized into inventory cost.';
comment on column public.expenses.expense_date is 'Date the operating expense was incurred.';
comment on column public.expenses.category is 'Expense category such as International Shipping, Domestic Shipping, Supplies, Office Expense, Other.';
comment on column public.expenses.amount is 'Operating expense amount in USD.';

alter table public.expenses enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'expenses' and policyname = 'expenses_all_authenticated'
  ) then
    create policy expenses_all_authenticated
      on public.expenses
      for all
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;
