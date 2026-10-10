-- Order memo fields: staff-only internal_note and customer-facing customer_note.
-- Safe to run multiple times.

alter table public.orders
  add column if not exists internal_note text default '';

alter table public.orders
  add column if not exists customer_note text default '';

-- Legacy orders.note was a staff-only order memo (never shown on invoice).
-- Copy existing note text into internal_note when internal_note is still empty.
update public.orders
set internal_note = trim(note)
where coalesce(trim(internal_note), '') = ''
  and coalesce(trim(note), '') <> '';
