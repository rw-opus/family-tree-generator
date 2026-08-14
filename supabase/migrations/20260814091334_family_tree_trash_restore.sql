-- Recoverable family-tree deletion. Browser roles can only see active rows
-- through the table; trashed rows and every state transition are exposed
-- through owner-checked, revision-aware RPCs.
alter table public.family_trees
  add column if not exists deleted_at timestamptz;

comment on column public.family_trees.deleted_at
is 'Soft-deletion timestamp; null rows are active and non-null rows are in Trash.';

drop index if exists public.family_trees_owner_updated_idx;

create index if not exists family_trees_owner_active_updated_idx
  on public.family_trees (owner_id, updated_at desc)
  where deleted_at is null;

create index if not exists family_trees_owner_trash_deleted_idx
  on public.family_trees (owner_id, deleted_at desc)
  where deleted_at is not null;

-- A trashed row still exists and still owns its original entitlement. Saving
-- it would otherwise make invisible edits, so the normal CAS endpoint treats
-- the deleted state as a conflict.
create or replace function public.save_family_tree(
  p_tree_id uuid,
  p_expected_revision bigint,
  p_title text,
  p_people jsonb,
  p_tree_data jsonb
)
returns setof public.family_trees
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  current_revision bigint;
  current_deleted_at timestamptz;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'TREE_SAVE_AUTH_REQUIRED';
  end if;

  select tree.revision, tree.deleted_at
  into current_revision, current_deleted_at
  from public.family_trees as tree
  where tree.id = p_tree_id
    and tree.owner_id = caller_id
  for update;

  if not found then
    -- Missing and cross-owner identifiers deliberately produce the same error
    -- so the RPC cannot be used to discover another account's tree UUIDs.
    raise exception using
      errcode = '42501',
      message = 'TREE_SAVE_FORBIDDEN';
  end if;

  if p_expected_revision is null
    or p_expected_revision <= 0
    or current_revision <> p_expected_revision
    or current_deleted_at is not null then
    raise sqlstate 'PT409' using
      message = 'TREE_SAVE_CONFLICT';
  end if;

  return query
  update public.family_trees as tree
  set
    title = p_title,
    people = p_people,
    tree_data = p_tree_data
  where tree.id = p_tree_id
    and tree.owner_id = caller_id
  returning tree.*;
end;
$$;

revoke all on function public.save_family_tree(uuid, bigint, text, jsonb, jsonb)
from public, anon, authenticated;
grant execute on function public.save_family_tree(uuid, bigint, text, jsonb, jsonb)
to authenticated;

comment on function public.save_family_tree(uuid, bigint, text, jsonb, jsonb)
is 'Owner-checked compare-and-swap save for active family_trees; raises TREE_SAVE_CONFLICT on a stale revision or trashed row.';

create or replace function public.trash_family_tree(
  p_tree_id uuid,
  p_expected_revision bigint
)
returns setof public.family_trees
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  current_revision bigint;
  current_deleted_at timestamptz;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'TREE_TRASH_AUTH_REQUIRED';
  end if;

  select tree.revision, tree.deleted_at
  into current_revision, current_deleted_at
  from public.family_trees as tree
  where tree.id = p_tree_id
    and tree.owner_id = caller_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'TREE_TRASH_FORBIDDEN';
  end if;

  if p_expected_revision is null
    or p_expected_revision <= 0
    or current_revision <> p_expected_revision
    or current_deleted_at is not null then
    raise sqlstate 'PT409' using
      message = 'TREE_TRASH_CONFLICT';
  end if;

  return query
  update public.family_trees as tree
  set deleted_at = now()
  where tree.id = p_tree_id
    and tree.owner_id = caller_id
  returning tree.*;
end;
$$;

revoke all on function public.trash_family_tree(uuid, bigint)
from public, anon, authenticated;
grant execute on function public.trash_family_tree(uuid, bigint)
to authenticated;

comment on function public.trash_family_tree(uuid, bigint)
is 'Owner-checked compare-and-swap soft delete for an active family tree.';

create or replace function public.restore_family_tree(
  p_tree_id uuid,
  p_expected_revision bigint
)
returns setof public.family_trees
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  current_revision bigint;
  current_deleted_at timestamptz;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'TREE_RESTORE_AUTH_REQUIRED';
  end if;

  select tree.revision, tree.deleted_at
  into current_revision, current_deleted_at
  from public.family_trees as tree
  where tree.id = p_tree_id
    and tree.owner_id = caller_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'TREE_RESTORE_FORBIDDEN';
  end if;

  if p_expected_revision is null
    or p_expected_revision <= 0
    or current_revision <> p_expected_revision
    or current_deleted_at is null then
    raise sqlstate 'PT409' using
      message = 'TREE_RESTORE_CONFLICT';
  end if;

  if current_deleted_at <= now() - interval '30 days' then
    raise sqlstate 'PT410' using
      message = 'TREE_RESTORE_EXPIRED';
  end if;

  return query
  update public.family_trees as tree
  set deleted_at = null
  where tree.id = p_tree_id
    and tree.owner_id = caller_id
  returning tree.*;
end;
$$;

revoke all on function public.restore_family_tree(uuid, bigint)
from public, anon, authenticated;
grant execute on function public.restore_family_tree(uuid, bigint)
to authenticated;

comment on function public.restore_family_tree(uuid, bigint)
is 'Owner-checked compare-and-swap restore within 30 days of soft deletion.';

create or replace function public.permanently_delete_family_tree(
  p_tree_id uuid,
  p_expected_revision bigint
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  current_revision bigint;
  current_deleted_at timestamptz;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'TREE_PERMANENT_DELETE_AUTH_REQUIRED';
  end if;

  select tree.revision, tree.deleted_at
  into current_revision, current_deleted_at
  from public.family_trees as tree
  where tree.id = p_tree_id
    and tree.owner_id = caller_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'TREE_PERMANENT_DELETE_FORBIDDEN';
  end if;

  if p_expected_revision is null
    or p_expected_revision <= 0
    or current_revision <> p_expected_revision
    or current_deleted_at is null then
    raise sqlstate 'PT409' using
      message = 'TREE_PERMANENT_DELETE_CONFLICT';
  end if;

  delete from public.family_trees as tree
  where tree.id = p_tree_id
    and tree.owner_id = caller_id;

  return p_tree_id;
end;
$$;

revoke all on function public.permanently_delete_family_tree(uuid, bigint)
from public, anon, authenticated;
grant execute on function public.permanently_delete_family_tree(uuid, bigint)
to authenticated;

comment on function public.permanently_delete_family_tree(uuid, bigint)
is 'Owner-checked compare-and-swap permanent deletion of an already trashed family tree.';

create or replace function public.list_trashed_family_trees()
returns setof public.family_trees
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'TREE_TRASH_LIST_AUTH_REQUIRED';
  end if;

  return query
  select tree.*
  from public.family_trees as tree
  where tree.owner_id = caller_id
    and tree.deleted_at is not null
  order by tree.deleted_at desc, tree.id;
end;
$$;

revoke all on function public.list_trashed_family_trees()
from public, anon, authenticated;
grant execute on function public.list_trashed_family_trees()
to authenticated;

comment on function public.list_trashed_family_trees()
is 'Lists every trashed family tree owned by the authenticated caller, including rows past the restore window.';

drop policy if exists "family trees select own" on public.family_trees;
drop policy if exists "family trees insert own" on public.family_trees;
drop policy if exists "family trees delete own" on public.family_trees;

create policy "family trees select active own"
on public.family_trees for select to authenticated
using (
  (select auth.uid()) = owner_id
  and deleted_at is null
);

create policy "family trees insert active own"
on public.family_trees for insert to authenticated
with check (
  (select auth.uid()) = owner_id
  and deleted_at is null
);

revoke delete on table public.family_trees from authenticated;
