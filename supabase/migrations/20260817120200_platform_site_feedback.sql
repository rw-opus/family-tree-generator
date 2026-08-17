-- One-way, anonymous product feedback for the product owner (2026-08-17).
--
-- Any signed-in account may submit a bug report or suggestion; the message is
-- stored with NO submitter identity (no user_id column at all), so even a
-- platform admin browsing the inbox cannot tell who sent a given message.

create table if not exists public.site_feedback (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('suggestion', 'bug')),
  message text not null check (char_length(message) between 5 and 3000),
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
create index if not exists site_feedback_created_idx
  on public.site_feedback (created_at desc);

alter table public.site_feedback enable row level security;
revoke all on table public.site_feedback from public, anon, authenticated;

-- Any authenticated account may submit feedback; simple per-account rate
-- limiting keeps the channel usable without recording who sent what.
create or replace function public.submit_site_feedback(feedback_kind text, feedback_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  clean_kind text := lower(trim(coalesce(feedback_kind, '')));
  clean_message text := trim(coalesce(feedback_message, ''));
begin
  if caller_id is null then
    raise exception 'Sign in before sending feedback.';
  end if;
  if clean_kind not in ('suggestion', 'bug') then
    raise exception 'Feedback type must be suggestion or bug';
  end if;
  if char_length(clean_message) < 5 or char_length(clean_message) > 3000 then
    raise exception 'Feedback message must be between 5 and 3000 characters';
  end if;

  if (
    select count(*)
    from public.site_feedback
    where created_at >= now() - interval '1 hour'
  ) >= 200 then
    raise exception 'Too many feedback messages have been sent recently. Please try again later.';
  end if;

  insert into public.site_feedback (kind, message)
  values (clean_kind, clean_message);
end;
$$;
revoke all on function public.submit_site_feedback(text, text) from public, anon;
grant execute on function public.submit_site_feedback(text, text) to authenticated;

-- Every message, newest first. Non-admins are refused outright, so the app
-- can distinguish "not a platform admin" (error) from "admin, empty inbox".
create or replace function public.list_site_feedback(include_handled boolean default true)
returns table (
  id uuid,
  kind text,
  message text,
  created_at timestamptz,
  handled_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Not allowed';
  end if;

  return query
  select f.id, f.kind, f.message, f.created_at, f.handled_at
  from public.site_feedback f
  where include_handled or f.handled_at is null
  order by f.created_at desc
  limit 1000;
end;
$$;
revoke all on function public.list_site_feedback(boolean) from public, anon;
grant execute on function public.list_site_feedback(boolean) to authenticated;

create or replace function public.set_site_feedback_handled(feedback_id uuid, handled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Not allowed';
  end if;
  update public.site_feedback
  set handled_at = case when handled then coalesce(handled_at, now()) else null end
  where id = feedback_id;
end;
$$;
revoke all on function public.set_site_feedback_handled(uuid, boolean) from public, anon;
grant execute on function public.set_site_feedback_handled(uuid, boolean) to authenticated;
