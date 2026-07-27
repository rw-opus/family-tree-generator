-- Family Tree Generator: run this in a new, separate Supabase project.
-- It deliberately does not share the Notarial Tracker's files or organisation data.
create table if not exists public.family_trees (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null default 'Untitled family tree' check (char_length(title) <= 200),
  people jsonb not null default '[]'::jsonb check (jsonb_typeof(people) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists family_trees_owner_updated_idx on public.family_trees (owner_id, updated_at desc);

create or replace function public.set_family_tree_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists family_trees_set_updated_at on public.family_trees;
create trigger family_trees_set_updated_at before update on public.family_trees for each row execute function public.set_family_tree_updated_at();

alter table public.family_trees enable row level security;
drop policy if exists "family tree owner access" on public.family_trees;
create policy "family tree owner access" on public.family_trees for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

