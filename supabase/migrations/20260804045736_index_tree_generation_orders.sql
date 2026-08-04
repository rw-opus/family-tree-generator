create index if not exists tree_generations_order_idx
  on public.tree_generations (order_id)
  where order_id is not null;
