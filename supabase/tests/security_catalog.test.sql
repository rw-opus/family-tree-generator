begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

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
    'family_trees:DELETE',
    'family_trees:INSERT',
    'family_trees:SELECT',
    'terms_acceptances:INSERT',
    'terms_acceptances:SELECT',
    'tree_accounts:SELECT',
    'tree_credit_orders:SELECT',
    'tree_generations:SELECT'
  ]::text[],
  'authenticated table grants exclude direct family-tree updates'
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
  array['save_family_tree:authenticated']::text[],
  'only the owner-checked family-tree save RPC is executable by a browser role'
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

select * from finish();

rollback;
