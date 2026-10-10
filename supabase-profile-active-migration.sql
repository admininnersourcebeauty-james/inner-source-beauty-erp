-- Staff active flag for Staff Management (default active for existing users)
alter table public.profiles
  add column if not exists active boolean not null default true;
