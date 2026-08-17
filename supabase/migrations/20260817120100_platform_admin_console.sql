-- Platform Super Administrator console (2026-08-17).
--
-- The product owner (a single auth account) reviews every account from
-- inside the app. Cross-account reads happen ONLY through the
-- security-definer function below, gated by is_platform_admin(): the browser
-- calls it with its own JWT and never receives the service-role key, and
-- non-admins are refused outright. RLS on the underlying tables is
-- unchanged.

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on table public.platform_admins from public, anon, authenticated;

-- Seed the product owner. Add more admins the same way (another insert row).
insert into public.platform_admins (user_id)
select id from auth.users where lower(email) = 'rolandwadge@gmail.com'
on conflict (user_id) do nothing;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins where user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

-- Every account at a glance: tree counts, allowance/credit state and last
-- activity. Adapted to this product's individual-account model (there are no
-- organisations/workspaces here, unlike the notarial tracker this pattern was
-- ported from).
create or replace function public.admin_platform_overview()
returns table (
  user_id uuid,
  email text,
  created_at timestamptz,
  trees_active bigint,
  trees_trashed bigint,
  total_trees_created integer,
  free_tree_limit smallint,
  free_trees_used smallint,
  paid_tree_credits integer,
  unlimited_trees boolean,
  stripe_customer_id text,
  last_activity timestamptz
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
  select
    acct.id,
    acct.email,
    acct.created_at,
    coalesce(tree_stats.active_total, 0) as trees_active,
    coalesce(tree_stats.trashed_total, 0) as trees_trashed,
    coalesce(ta.total_trees_created, 0) as total_trees_created,
    coalesce(ta.free_tree_limit, 3) as free_tree_limit,
    coalesce(ta.free_trees_used, 0) as free_trees_used,
    coalesce(ta.paid_tree_credits, 0) as paid_tree_credits,
    coalesce(ta.unlimited_trees, false) as unlimited_trees,
    ta.stripe_customer_id,
    tree_stats.last_activity
  from auth.users acct
  left join public.tree_accounts ta on ta.user_id = acct.id
  left join lateral (
    select
      count(*) filter (where t.deleted_at is null) as active_total,
      count(*) filter (where t.deleted_at is not null) as trashed_total,
      max(t.updated_at) as last_activity
    from public.family_trees t
    where t.owner_id = acct.id
  ) tree_stats on true
  order by acct.created_at desc;
end;
$$;
revoke all on function public.admin_platform_overview() from public, anon;
grant execute on function public.admin_platform_overview() to authenticated;

-- Operator-managed unlimited-tree grant, driven from the console instead of
-- a manual database edit. Mirrors the existing tree_accounts.unlimited_trees
-- column already used by the entitlement trigger.
create or replace function public.admin_set_unlimited_trees(target_user uuid, unlimited boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Not allowed';
  end if;

  insert into public.tree_accounts (user_id, unlimited_trees)
  values (target_user, coalesce(unlimited, false))
  on conflict (user_id) do update
  set unlimited_trees = coalesce(unlimited, false);
end;
$$;
revoke all on function public.admin_set_unlimited_trees(uuid, boolean) from public, anon;
grant execute on function public.admin_set_unlimited_trees(uuid, boolean) to authenticated;

-- Operator-managed paid-credit grant (comps, support gestures) without
-- touching Stripe. Adds to whatever credits the account already holds.
create or replace function public.admin_grant_tree_credits(target_user uuid, credits integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Not allowed';
  end if;
  if credits is null or credits <= 0 then
    raise exception 'Credits must be a positive number';
  end if;

  insert into public.tree_accounts (user_id, paid_tree_credits)
  values (target_user, credits)
  on conflict (user_id) do update
  set paid_tree_credits = public.tree_accounts.paid_tree_credits + credits;
end;
$$;
revoke all on function public.admin_grant_tree_credits(uuid, integer) from public, anon;
grant execute on function public.admin_grant_tree_credits(uuid, integer) to authenticated;
