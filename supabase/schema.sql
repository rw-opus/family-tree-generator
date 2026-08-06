-- Family Tree Generator commercial schema.
-- Run this only in the Family Tree Generator's own Supabase project.
-- Commercial rule: the first five lifetime tree generations are free;
-- every later creation or GEDCOM import consumes one paid EUR 30 credit,
-- unless an operator has granted the account unlimited tree creation.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.family_trees (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null default 'Untitled family tree' check (char_length(title) <= 200),
  people jsonb not null default '[]'::jsonb check (jsonb_typeof(people) = 'array'),
  tree_data jsonb not null default '{}'::jsonb check (jsonb_typeof(tree_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.family_trees
  add column if not exists tree_data jsonb not null default '{}'::jsonb;

create index if not exists family_trees_owner_updated_idx
  on public.family_trees (owner_id, updated_at desc);

create table if not exists public.tree_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  free_tree_limit smallint not null default 5 check (free_tree_limit between 0 and 100),
  free_trees_used smallint not null default 0 check (free_trees_used >= 0),
  paid_tree_credits integer not null default 0 check (paid_tree_credits >= 0),
  unlimited_trees boolean not null default false,
  total_trees_created integer not null default 0 check (total_trees_created >= 0),
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (free_trees_used <= free_tree_limit)
);

alter table public.tree_accounts
  add column if not exists unlimited_trees boolean not null default false;

create table if not exists public.tree_credit_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  quantity integer not null default 1 check (quantity = 1),
  unit_amount_cents integer not null default 3000 check (unit_amount_cents = 3000),
  currency text not null default 'eur' check (currency = 'eur'),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'expired', 'refunded', 'disputed')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fulfilled_at timestamptz
);

create index if not exists tree_credit_orders_user_created_idx
  on public.tree_credit_orders (user_id, created_at desc);

create table if not exists public.tree_generations (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid unique references public.family_trees(id) on delete set null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  entitlement_source text not null
    check (entitlement_source in ('free', 'paid', 'legacy', 'admin')),
  order_id uuid references public.tree_credit_orders(id) on delete set null,
  tree_title text not null default 'Untitled family tree',
  created_at timestamptz not null default now()
);

create index if not exists tree_generations_owner_created_idx
  on public.tree_generations (owner_id, created_at desc);

create index if not exists tree_generations_order_idx
  on public.tree_generations (order_id)
  where order_id is not null;

-- No anon or authenticated policy is created for this idempotency ledger.
-- Only the Stripe webhook's secret-key client may read or write it.
create table if not exists public.stripe_tree_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists family_trees_set_updated_at on public.family_trees;
drop function if exists public.set_family_tree_updated_at();
create trigger family_trees_set_updated_at
before update on public.family_trees
for each row execute function private.set_updated_at();

drop trigger if exists tree_accounts_set_updated_at on public.tree_accounts;
create trigger tree_accounts_set_updated_at
before update on public.tree_accounts
for each row execute function private.set_updated_at();

drop trigger if exists tree_credit_orders_set_updated_at on public.tree_credit_orders;
create trigger tree_credit_orders_set_updated_at
before update on public.tree_credit_orders
for each row execute function private.set_updated_at();

-- Existing pre-commercial trees count towards lifetime use, but are never
-- charged retroactively. Rows after the first five are recorded as legacy.
insert into public.tree_accounts (user_id, free_trees_used, total_trees_created)
select
  owner_id,
  least(count(*), 5)::smallint,
  count(*)::integer
from public.family_trees
group by owner_id
on conflict (user_id) do update
set
  free_trees_used = greatest(public.tree_accounts.free_trees_used, excluded.free_trees_used),
  total_trees_created = greatest(
    public.tree_accounts.total_trees_created,
    excluded.total_trees_created
  );

with ranked_trees as (
  select
    tree.id,
    tree.owner_id,
    tree.title,
    tree.created_at,
    row_number() over (
      partition by tree.owner_id
      order by tree.created_at, tree.id
    ) as lifetime_number
  from public.family_trees tree
)
insert into public.tree_generations (
  tree_id,
  owner_id,
  entitlement_source,
  tree_title,
  created_at
)
select
  id,
  owner_id,
  case when lifetime_number <= 5 then 'free' else 'legacy' end,
  title,
  created_at
from ranked_trees
on conflict (tree_id) do nothing;

create or replace function private.consume_tree_entitlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  account public.tree_accounts%rowtype;
  allocation_source text;
begin
  if caller_id is null or new.owner_id <> caller_id then
    raise exception using
      errcode = '42501',
      message = 'TREE_OWNER_REQUIRED';
  end if;

  insert into public.tree_accounts (user_id)
  values (caller_id)
  on conflict (user_id) do nothing;

  select * into account
  from public.tree_accounts
  where user_id = caller_id
  for update;

  if account.unlimited_trees then
    allocation_source := 'admin';
    update public.tree_accounts
    set total_trees_created = total_trees_created + 1
    where user_id = caller_id;
  elsif account.free_trees_used < account.free_tree_limit then
    allocation_source := 'free';
    update public.tree_accounts
    set
      free_trees_used = free_trees_used + 1,
      total_trees_created = total_trees_created + 1
    where user_id = caller_id;
  elsif account.paid_tree_credits > 0 then
    allocation_source := 'paid';
    update public.tree_accounts
    set
      paid_tree_credits = paid_tree_credits - 1,
      total_trees_created = total_trees_created + 1
    where user_id = caller_id;
  else
    raise exception using
      errcode = 'P0001',
      message = 'TREE_PAYMENT_REQUIRED',
      detail = 'The five free tree generations have been used. Purchase one EUR 30 tree credit.';
  end if;

  insert into public.tree_generations (
    tree_id,
    owner_id,
    entitlement_source,
    tree_title
  ) values (
    new.id,
    caller_id,
    allocation_source,
    new.title
  );

  return new;
end;
$$;

revoke all on function private.consume_tree_entitlement() from public, anon, authenticated;

drop trigger if exists family_trees_consume_entitlement on public.family_trees;
create trigger family_trees_consume_entitlement
after insert on public.family_trees
for each row execute function private.consume_tree_entitlement();

create or replace function private.grant_paid_tree_credit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status <> 'paid') then
    insert into public.tree_accounts (user_id)
    values (new.user_id)
    on conflict (user_id) do nothing;

    update public.tree_accounts
    set paid_tree_credits = paid_tree_credits + new.quantity
    where user_id = new.user_id;

    new.fulfilled_at := coalesce(new.fulfilled_at, now());
  end if;
  return new;
end;
$$;

revoke all on function private.grant_paid_tree_credit() from public, anon, authenticated;

drop trigger if exists tree_credit_orders_grant_paid_credit on public.tree_credit_orders;
create trigger tree_credit_orders_grant_paid_credit
before insert or update of status on public.tree_credit_orders
for each row execute function private.grant_paid_tree_credit();

alter table public.family_trees enable row level security;
alter table public.tree_accounts enable row level security;
alter table public.tree_credit_orders enable row level security;
alter table public.tree_generations enable row level security;
alter table public.stripe_tree_events enable row level security;

drop policy if exists "family tree owner access" on public.family_trees;
drop policy if exists "family trees select own" on public.family_trees;
drop policy if exists "family trees insert own" on public.family_trees;
drop policy if exists "family trees update own" on public.family_trees;
drop policy if exists "family trees delete own" on public.family_trees;

create policy "family trees select own"
on public.family_trees for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "family trees insert own"
on public.family_trees for insert to authenticated
with check ((select auth.uid()) = owner_id);

create policy "family trees update own"
on public.family_trees for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "family trees delete own"
on public.family_trees for delete to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists "tree accounts select own" on public.tree_accounts;
create policy "tree accounts select own"
on public.tree_accounts for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "tree credit orders select own" on public.tree_credit_orders;
create policy "tree credit orders select own"
on public.tree_credit_orders for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "tree generations select own" on public.tree_generations;
create policy "tree generations select own"
on public.tree_generations for select to authenticated
using ((select auth.uid()) = owner_id);

revoke all on table public.family_trees from anon, authenticated;
revoke all on table public.tree_accounts from anon, authenticated;
revoke all on table public.tree_credit_orders from anon, authenticated;
revoke all on table public.tree_generations from anon, authenticated;
revoke all on table public.stripe_tree_events from anon, authenticated;

grant select, insert, update, delete on table public.family_trees to authenticated;
grant select on table public.tree_accounts to authenticated;
grant select on table public.tree_credit_orders to authenticated;
grant select on table public.tree_generations to authenticated;

-- Versioned, append-only clickwrap audit trail. Users may read and insert
-- their own acceptance rows, but cannot update or delete them.
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
