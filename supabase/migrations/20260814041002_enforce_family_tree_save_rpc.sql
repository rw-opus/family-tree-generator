-- Enforce optimistic concurrency inside PostgreSQL. Browser roles may create,
-- read and delete their own trees, but every update must pass through this
-- owner-checked compare-and-swap RPC.
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
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'TREE_SAVE_AUTH_REQUIRED';
  end if;

  select tree.revision
  into current_revision
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
    or current_revision <> p_expected_revision then
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
is 'Owner-checked compare-and-swap save for family_trees; raises TREE_SAVE_CONFLICT on stale revisions.';

drop policy if exists "family trees update own" on public.family_trees;
revoke update on table public.family_trees from authenticated;
