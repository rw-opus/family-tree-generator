-- Immutable, browser-inaccessible audit ledger for operator changes to tree
-- entitlements. UUID identifiers are retained as historical evidence without
-- foreign keys, so deleting an Auth account cannot rewrite or cascade an audit
-- row. Every browser-callable mutation below is idempotent by request_id.
create table if not exists private.admin_entitlement_audit (
  request_id uuid primary key,
  actor_user_id uuid not null,
  target_user_id uuid not null,
  operation text not null check (
    operation in ('grant_tree_credits', 'set_unlimited_trees')
  ),
  integer_value integer,
  boolean_value boolean,
  created_at timestamptz not null default now(),
  check (
    (
      operation = 'grant_tree_credits'
      and integer_value between 1 and 100
      and boolean_value is null
    )
    or
    (
      operation = 'set_unlimited_trees'
      and integer_value is null
      and boolean_value is not null
    )
  )
);

create index if not exists admin_entitlement_audit_target_created_idx
  on private.admin_entitlement_audit (target_user_id, created_at desc);

alter table private.admin_entitlement_audit enable row level security;
revoke all on table private.admin_entitlement_audit from public, anon, authenticated;

create or replace function private.reject_admin_entitlement_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Admin entitlement audit rows are immutable';
end;
$$;

revoke all on function private.reject_admin_entitlement_audit_mutation()
  from public, anon, authenticated;

drop trigger if exists admin_entitlement_audit_immutable
  on private.admin_entitlement_audit;
create trigger admin_entitlement_audit_immutable
before update or delete on private.admin_entitlement_audit
for each row execute function private.reject_admin_entitlement_audit_mutation();

create or replace function public.admin_grant_tree_credits(
  target_user uuid,
  credits integer,
  request_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target_account_id uuid := target_user;
  credit_delta integer := credits;
  requested_id uuid := request_id;
  inserted_request uuid;
  prior private.admin_entitlement_audit%rowtype;
begin
  if caller_id is null or not public.is_platform_admin() then
    raise exception 'Not allowed';
  end if;
  if requested_id is null then
    raise exception 'A request ID is required';
  end if;
  if credit_delta is null or credit_delta < 1 or credit_delta > 100 then
    raise exception 'Credits must be between 1 and 100';
  end if;
  if not exists (select 1 from auth.users account where account.id = target_account_id) then
    raise exception 'Target account does not exist';
  end if;

  insert into private.admin_entitlement_audit as inserted_audit (
    request_id,
    actor_user_id,
    target_user_id,
    operation,
    integer_value,
    boolean_value
  ) values (
    requested_id,
    caller_id,
    target_account_id,
    'grant_tree_credits',
    credit_delta,
    null
  )
  on conflict on constraint admin_entitlement_audit_pkey do nothing
  returning inserted_audit.request_id into inserted_request;

  if inserted_request is null then
    select * into prior
    from private.admin_entitlement_audit audit
    where audit.request_id = requested_id;

    if prior.actor_user_id is distinct from caller_id
      or prior.target_user_id is distinct from target_account_id
      or prior.operation is distinct from 'grant_tree_credits'
      or prior.integer_value is distinct from credit_delta
      or prior.boolean_value is not null then
      raise exception 'Request ID has already been used for a different admin operation';
    end if;
    return;
  end if;

  insert into public.tree_accounts (user_id, paid_tree_credits)
  values (target_account_id, credit_delta)
  on conflict (user_id) do update
  set paid_tree_credits = public.tree_accounts.paid_tree_credits + credit_delta;
end;
$$;

create or replace function public.admin_set_unlimited_trees(
  target_user uuid,
  enabled boolean,
  request_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target_account_id uuid := target_user;
  requested_enabled boolean := enabled;
  requested_id uuid := request_id;
  inserted_request uuid;
  prior private.admin_entitlement_audit%rowtype;
begin
  if caller_id is null or not public.is_platform_admin() then
    raise exception 'Not allowed';
  end if;
  if requested_id is null then
    raise exception 'A request ID is required';
  end if;
  if requested_enabled is null then
    raise exception 'Unlimited-tree state is required';
  end if;
  if not exists (select 1 from auth.users account where account.id = target_account_id) then
    raise exception 'Target account does not exist';
  end if;

  insert into private.admin_entitlement_audit as inserted_audit (
    request_id,
    actor_user_id,
    target_user_id,
    operation,
    integer_value,
    boolean_value
  ) values (
    requested_id,
    caller_id,
    target_account_id,
    'set_unlimited_trees',
    null,
    requested_enabled
  )
  on conflict on constraint admin_entitlement_audit_pkey do nothing
  returning inserted_audit.request_id into inserted_request;

  if inserted_request is null then
    select * into prior
    from private.admin_entitlement_audit audit
    where audit.request_id = requested_id;

    if prior.actor_user_id is distinct from caller_id
      or prior.target_user_id is distinct from target_account_id
      or prior.operation is distinct from 'set_unlimited_trees'
      or prior.integer_value is not null
      or prior.boolean_value is distinct from requested_enabled then
      raise exception 'Request ID has already been used for a different admin operation';
    end if;
    return;
  end if;

  insert into public.tree_accounts (user_id, unlimited_trees)
  values (target_account_id, requested_enabled)
  on conflict (user_id) do update
  set unlimited_trees = requested_enabled;
end;
$$;

-- Remove the unaudited overloads so browser code cannot accidentally bypass
-- request idempotency or the immutable audit ledger.
revoke all on function public.admin_grant_tree_credits(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.admin_set_unlimited_trees(uuid, boolean)
  from public, anon, authenticated;
drop function public.admin_grant_tree_credits(uuid, integer);
drop function public.admin_set_unlimited_trees(uuid, boolean);

revoke all on function public.admin_grant_tree_credits(uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_grant_tree_credits(uuid, integer, uuid)
  to authenticated;

revoke all on function public.admin_set_unlimited_trees(uuid, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_set_unlimited_trees(uuid, boolean, uuid)
  to authenticated;
