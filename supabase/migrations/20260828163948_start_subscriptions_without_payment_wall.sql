-- Access now begins with the invited account's subscription. Tree creation is
-- not blocked by the former free-tree / paid-credit checkout mechanism.
alter table public.tree_accounts
  alter column unlimited_trees set default true;

update public.tree_accounts
set unlimited_trees = true
where unlimited_trees is distinct from true;

comment on column public.tree_accounts.unlimited_trees is
  'Subscription access flag. Defaults to enabled while subscription fees are administered outside the application.';
