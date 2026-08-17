begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

select is(
  (
    select array_agg(c.relname::text order by c.relname)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  ),
    array[
    'family_trees',
    'platform_admins',
    'platform_announcements',
    'site_feedback',
    'stripe_tree_events',
    'terms_acceptances',
    'tree_accounts',
    'tree_credit_orders',
    'tree_generations'
  ]::text[],
  'the reviewed public-table allow-list changes whenever a public table is added'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  ),
  0,
  'every public table has row-level security enabled'
);

select is(
  (
    select count(*)::integer
    from information_schema.table_privileges
    where table_schema = 'public'
      and grantee = 'anon'
  ),
  0,
  'the anonymous role has no public-table privileges'
);

select is(
  (
    select array_agg(
      format('%s:%s', table_name, privilege_type)
      order by table_name, privilege_type
    )
    from information_schema.table_privileges
    where table_schema = 'public'
      and grantee = 'authenticated'
  ),
  array[
    'family_trees:INSERT',
    'family_trees:SELECT',
    'terms_acceptances:INSERT',
    'terms_acceptances:SELECT',
    'tree_accounts:SELECT',
    'tree_credit_orders:SELECT',
    'tree_generations:SELECT'
  ]::text[],
  'authenticated table grants exclude direct family-tree updates and deletes'
);

select is(
  (
    select array_agg(
      format('%s:%s', routine_name, lower(grantee))
      order by routine_name, lower(grantee)
    )
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and lower(grantee) in ('public', 'anon', 'authenticated')
      and privilege_type = 'EXECUTE'
  ),
    array[
    'active_announcement:authenticated',
    'admin_grant_tree_credits:authenticated',
    'admin_platform_overview:authenticated',
    'admin_set_announcement:authenticated',
    'admin_set_unlimited_trees:authenticated',
    'is_platform_admin:authenticated',
    'list_site_feedback:authenticated',
    'list_trashed_family_trees:authenticated',
    'permanently_delete_family_tree:authenticated',
    'restore_family_tree:authenticated',
    'save_family_tree:authenticated',
    'set_site_feedback_handled:authenticated',
    'submit_site_feedback:authenticated',
    'trash_family_tree:authenticated'
  ]::text[],
  'only owner-checked family-tree RPCs are executable by a browser role'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_policy policy
    join pg_catalog.pg_class relation on relation.oid = policy.polrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'family_trees'
      and policy.polcmd = 'd'
  ),
  'family trees have no direct browser delete policy'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'family_trees'
      and policyname = 'family trees select active own'
      and qual like '%deleted_at IS NULL%'
  ),
  'the table SELECT policy exposes active family trees only'
);

select ok(
  not has_schema_privilege('anon', 'private', 'USAGE')
    and not has_schema_privilege('authenticated', 'private', 'USAGE'),
  'browser roles cannot use the private schema'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'family_trees'
      and t.tgname = 'family_trees_00_validate_payload'
      and t.tgenabled = 'O'
      and not t.tgisinternal
  ),
  'every family-tree write passes through the enabled payload validator trigger'
);

select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    pg_catalog.to_regprocedure('private.validate_family_tree_payload()'),
    'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      pg_catalog.to_regprocedure('private.validate_family_tree_payload()'),
      'EXECUTE'
    ),
  'browser roles cannot invoke the private tree-payload validator directly'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) setting
        where setting like 'search_path=%'
      )
  ),
  0,
  'every application SECURITY DEFINER function pins its search_path'
);

select ok(
  not exists (
    select 1
    from information_schema.table_privileges
    where table_schema = 'private'
      and lower(grantee) in ('public', 'anon', 'authenticated')
  ),
  'browser roles have no privileges on private audit or rate-limit tables'
);

select is(
  (
    select array_agg(c.relname::text order by c.relname)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private'
      and c.relname in ('admin_entitlement_audit', 'site_feedback_rate_limits')
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
  ),
  array['admin_entitlement_audit', 'site_feedback_rate_limits']::text[],
  'private audit and rate-limit tables exist with RLS enabled'
);

select ok(
  pg_catalog.to_regprocedure(
    'public.admin_grant_tree_credits(uuid,integer,uuid)'
  ) is not null
    and pg_catalog.to_regprocedure(
      'public.admin_set_unlimited_trees(uuid,boolean,uuid)'
    ) is not null
    and pg_catalog.to_regprocedure(
      'public.admin_grant_tree_credits(uuid,integer)'
    ) is null
    and pg_catalog.to_regprocedure(
      'public.admin_set_unlimited_trees(uuid,boolean)'
    ) is null,
  'only audited idempotent admin-entitlement RPC signatures remain'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class relation on relation.oid = t.tgrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = 'admin_entitlement_audit'
      and t.tgname = 'admin_entitlement_audit_immutable'
      and t.tgenabled = 'O'
      and not t.tgisinternal
  ),
  'the admin-entitlement audit ledger rejects updates and deletes'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'site_feedback'
      and column_name in ('user_id', 'owner_id', 'email')
  ),
  0,
  'anonymous feedback rows contain no account identity column'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'site_feedback_rate_limits'
      and column_name = 'updated_at'
  ),
  0,
  'the feedback rate limiter stores no exact request timestamp'
);

select * from finish();

rollback;
