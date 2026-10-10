-- Staff Management security patch: restrict profile updates to Admin + secure RPC for full_name
-- Safe to re-run

create or replace function public.update_my_full_name(p_full_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.profiles
  set full_name = trim(coalesce(p_full_name, ''))
  where id = auth.uid();
end;
$$;

create or replace function public.touch_my_last_login()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  update public.profiles
  set last_login = now()
  where id = auth.uid();
end;
$$;

revoke all on function public.update_my_full_name(text) from public;
revoke all on function public.touch_my_last_login() from public;
grant execute on function public.update_my_full_name(text) to authenticated;
grant execute on function public.touch_my_last_login() to authenticated;

drop policy if exists "profiles_update" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;

create policy "profiles_update_admin" on public.profiles
  for update to authenticated
  using (public.get_user_role() = 'Admin')
  with check (public.get_user_role() = 'Admin');
