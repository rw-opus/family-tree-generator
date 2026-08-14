-- Reject stale browser writes instead of silently overwriting a newer save.
-- The browser supplies the revision it last read as an UPDATE filter; this
-- trigger owns the increment so a client cannot choose the next revision.
alter table public.family_trees
  add column if not exists revision bigint not null default 1;

alter table public.family_trees
  drop constraint if exists family_trees_revision_positive;

alter table public.family_trees
  add constraint family_trees_revision_positive check (revision > 0);

create or replace function private.increment_family_tree_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.revision := old.revision + 1;
  return new;
end;
$$;

revoke all on function private.increment_family_tree_revision() from public, anon, authenticated;

drop trigger if exists family_trees_increment_revision on public.family_trees;
create trigger family_trees_increment_revision
before update on public.family_trees
for each row execute function private.increment_family_tree_revision();
