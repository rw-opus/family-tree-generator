-- Repair the first platform-admin rollout without reducing an existing limit
-- or rewriting any usage, credit, lifetime-total, or unlimited entitlement.
--
-- Production evidence records 2026-08-17 14:40:52.119201+00 as the instant
-- the three-tree default was introduced (the seeded platform-admin row was
-- created by that rollout). Auth accounts created before that instant were
-- already promised five lifetime tree generations, even if they had not yet
-- created their first tree and therefore had no tree_accounts row.
insert into public.tree_accounts as entitlement (
  user_id,
  free_tree_limit,
  free_trees_used,
  paid_tree_credits,
  total_trees_created,
  unlimited_trees
)
select
  account.id,
  5,
  0,
  0,
  0,
  false
from auth.users account
where account.created_at < timestamptz '2026-08-17 14:40:52.119201+00'
on conflict (user_id) do update
set free_tree_limit = greatest(
  entitlement.free_tree_limit,
  excluded.free_tree_limit
)
where entitlement.free_tree_limit < excluded.free_tree_limit;

-- The initial function declared the allowance columns as smallint but its
-- COALESCE fallbacks were bare integer literals. PL/pgSQL checks the returned
-- tuple at execution time and rejects that integer/smallint mismatch. Cast all
-- values whose source type can differ from the public RPC contract explicitly.
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
    account.id::uuid,
    account.email::text,
    account.created_at::timestamptz,
    coalesce(tree_stats.active_total, 0)::bigint,
    coalesce(tree_stats.trashed_total, 0)::bigint,
    coalesce(entitlement.total_trees_created, 0)::integer,
    coalesce(entitlement.free_tree_limit, 3::smallint)::smallint,
    coalesce(entitlement.free_trees_used, 0::smallint)::smallint,
    coalesce(entitlement.paid_tree_credits, 0)::integer,
    coalesce(entitlement.unlimited_trees, false)::boolean,
    entitlement.stripe_customer_id::text,
    tree_stats.last_activity::timestamptz
  from auth.users account
  left join public.tree_accounts entitlement on entitlement.user_id = account.id
  left join lateral (
    select
      count(*) filter (where tree.deleted_at is null) as active_total,
      count(*) filter (where tree.deleted_at is not null) as trashed_total,
      max(tree.updated_at) as last_activity
    from public.family_trees tree
    where tree.owner_id = account.id
  ) tree_stats on true
  order by account.created_at desc;
end;
$$;

revoke all on function public.admin_platform_overview() from public, anon, authenticated;
grant execute on function public.admin_platform_overview() to authenticated;
