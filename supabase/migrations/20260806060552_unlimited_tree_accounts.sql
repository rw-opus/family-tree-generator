-- Operator-managed entitlement for accounts that may create trees without
-- consuming either the five-tree allowance or a paid tree credit.
alter table public.tree_accounts
  add column if not exists unlimited_trees boolean not null default false;

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
