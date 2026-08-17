-- Platform announcement banner (2026-08-17).
--
-- The product owner posts a single banner that every signed-in account sees
-- at the top of the app. active_announcement() is readable by any
-- authenticated account; only a platform admin can set or clear it.

create table if not exists public.platform_announcements (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  level text not null default 'info' check (level in ('info', 'warning')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.platform_announcements enable row level security;
revoke all on table public.platform_announcements from public, anon, authenticated;

-- The current banner, for every account to display. Returns no row when cleared.
create or replace function public.active_announcement()
returns table (id uuid, message text, level text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.message, a.level
  from public.platform_announcements a
  where a.active
  order by a.updated_at desc
  limit 1;
$$;
revoke all on function public.active_announcement() from public, anon;
grant execute on function public.active_announcement() to authenticated;

-- Post a banner (empty message clears it). Only one is active at a time.
create or replace function public.admin_set_announcement(new_message text, new_level text default 'info')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Not allowed';
  end if;
  update public.platform_announcements set active = false, updated_at = now() where active;
  if coalesce(trim(new_message), '') <> '' then
    insert into public.platform_announcements (message, level, active)
    values (trim(new_message), case when new_level = 'warning' then 'warning' else 'info' end, true);
  end if;
end;
$$;
revoke all on function public.admin_set_announcement(text, text) from public, anon;
grant execute on function public.admin_set_announcement(text, text) to authenticated;
