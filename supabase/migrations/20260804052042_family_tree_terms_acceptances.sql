-- Versioned, append-only clickwrap audit trail.
create table if not exists public.terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version text not null check (char_length(version) between 1 and 200),
  accepted_at timestamptz not null default now(),
  user_agent text check (user_agent is null or char_length(user_agent) <= 500)
);

create unique index if not exists terms_acceptances_user_version_idx
  on public.terms_acceptances (user_id, version);

alter table public.terms_acceptances enable row level security;

drop policy if exists "terms acceptances select own" on public.terms_acceptances;
drop policy if exists "terms acceptances insert own" on public.terms_acceptances;

create policy "terms acceptances select own"
on public.terms_acceptances for select to authenticated
using ((select auth.uid()) = user_id);

create policy "terms acceptances insert own"
on public.terms_acceptances for insert to authenticated
with check ((select auth.uid()) = user_id);

revoke all on table public.terms_acceptances from anon, authenticated;
grant select, insert on table public.terms_acceptances to authenticated;
