-- Lower the free lifetime tree allowance for new accounts from five to three
-- (2026-08-17). Deliberately does NOT rewrite free_tree_limit on existing
-- tree_accounts rows: an account already provisioned at five keeps its five,
-- so this cannot claw back an allowance someone was already given. Only
-- accounts created from now on default to three.

alter table public.tree_accounts
  alter column free_tree_limit set default 3;

-- The quota-consuming trigger's payment-required message hard-coded "five",
-- which would now be wrong for new three-tree accounts (and inconsistent for
-- any grandfathered five-tree account). Read the account's own limit instead.
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
      detail = format(
        'The %s free tree generation%s been used. Purchase one EUR 30 tree credit.',
        account.free_tree_limit,
        case when account.free_tree_limit = 1 then ' has' else 's have' end
      );
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
