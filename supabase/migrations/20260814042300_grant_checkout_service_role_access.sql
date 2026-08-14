-- The authenticated checkout Edge Function uses its service-role client to
-- read the user's allowance and create/update the pending Stripe order. Keep
-- these grants narrower than full table access; webhook fulfilment continues
-- through the dedicated atomic RPC.
grant select on table public.tree_accounts to service_role;
grant select, insert, update on table public.tree_credit_orders to service_role;
