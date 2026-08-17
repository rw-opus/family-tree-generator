-- Keep abuse-control identity metadata separate from feedback content. The
-- bucket records prove only how many submissions an account attempted during
-- an hour; they never record an exact request time, reference a site_feedback
-- row, or contain message text.
create table if not exists private.site_feedback_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  hour_bucket timestamptz not null,
  message_count integer not null check (message_count between 1 and 20),
  primary key (user_id, hour_bucket)
);

create index if not exists site_feedback_rate_limits_bucket_idx
  on private.site_feedback_rate_limits (hour_bucket);

alter table private.site_feedback_rate_limits enable row level security;
revoke all on table private.site_feedback_rate_limits from public, anon, authenticated;

-- Any authenticated account may submit feedback. The atomic upsert serializes
-- concurrent requests for the same account/hour and enforces a per-account
-- ceiling without adding sender identity to the feedback record itself.
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
  current_hour timestamptz := date_trunc('hour', now());
  accepted_count integer;
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

  -- Feedback older than 24 months is removed on this submission (and on the
  -- next admin read), so dormant records can remain until that next event.
  -- Expired hourly rate buckets are likewise removed on the next submission.
  delete from public.site_feedback as expired_feedback
  where expired_feedback.created_at < now() - interval '24 months';

  delete from private.site_feedback_rate_limits
  where hour_bucket <= current_hour - interval '24 hours';

  insert into private.site_feedback_rate_limits (
    user_id,
    hour_bucket,
    message_count
  ) values (
    caller_id,
    current_hour,
    1
  )
  on conflict (user_id, hour_bucket) do update
  set message_count = private.site_feedback_rate_limits.message_count + 1
  where private.site_feedback_rate_limits.message_count < 20
  returning message_count into accepted_count;

  if accepted_count is null then
    raise exception 'Too many feedback messages have been sent recently. Please try again later.';
  end if;

  insert into public.site_feedback (kind, message)
  values (clean_kind, clean_message);
end;
$$;

revoke all on function public.submit_site_feedback(text, text)
  from public, anon, authenticated;
grant execute on function public.submit_site_feedback(text, text) to authenticated;

-- Clean expired rows before every admin read and apply the retention predicate
-- to the result as a fail-closed guard. `include_handled = false` is filtered
-- in SQL before the 1,000-row cap, so handled messages cannot crowd unresolved
-- feedback out of the inbox.
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

  delete from public.site_feedback as expired_feedback
  where expired_feedback.created_at < now() - interval '24 months';

  return query
  select feedback.id, feedback.kind, feedback.message, feedback.created_at, feedback.handled_at
  from public.site_feedback feedback
  where feedback.created_at >= now() - interval '24 months'
    and (coalesce(include_handled, false) or feedback.handled_at is null)
  order by feedback.created_at desc, feedback.id desc
  limit 1000;
end;
$$;

revoke all on function public.list_site_feedback(boolean)
  from public, anon, authenticated;
grant execute on function public.list_site_feedback(boolean) to authenticated;
