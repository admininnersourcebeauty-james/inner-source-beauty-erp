-- INNER SOURCE BEAUTY ERP — Add carrier to order_tracking_numbers
-- Safe to run on existing production. Does not delete tracking data.

alter table public.order_tracking_numbers
  add column if not exists carrier text not null default '';

-- Backfill: none required (default '' is valid for legacy rows)
