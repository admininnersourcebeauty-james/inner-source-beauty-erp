-- Editable display name for staff/users (Sales Person dropdown, invoices, reports)
alter table public.profiles
  add column if not exists full_name text default '';
