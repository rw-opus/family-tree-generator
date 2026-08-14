-- Process each verified Stripe event and its entitlement change in one
-- PostgreSQL transaction. The public location makes the RPC reachable through
-- PostgREST, but only the service_role used by the Edge Function may execute it.
create or replace function public.process_stripe_tree_event(
  p_event_id text,
  p_event_type text,
  p_order_id uuid,
  p_user_id uuid,
  p_checkout_session_id text,
  p_payment_status text,
  p_amount_total integer,
  p_currency text,
  p_payment_intent_id text,
  p_customer_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed boolean;
  tree_order public.tree_credit_orders%rowtype;
begin
  if nullif(btrim(p_event_id), '') is null or char_length(p_event_id) > 255 then
    raise exception using errcode = '22023', message = 'INVALID_STRIPE_EVENT_ID';
  end if;
  if nullif(btrim(p_event_type), '') is null or char_length(p_event_type) > 200 then
    raise exception using errcode = '22023', message = 'INVALID_STRIPE_EVENT_TYPE';
  end if;

  insert into public.stripe_tree_events (event_id, event_type)
  values (p_event_id, p_event_type)
  on conflict (event_id) do nothing
  returning true into claimed;

  if not coalesce(claimed, false) then
    return 'duplicate';
  end if;

  if p_event_type not in (
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.expired',
    'checkout.session.async_payment_failed'
  ) then
    return 'ignored';
  end if;

  if p_order_id is null or p_user_id is null or nullif(btrim(p_checkout_session_id), '') is null then
    raise exception using errcode = '22023', message = 'INCOMPLETE_TREE_CHECKOUT_REFERENCE';
  end if;

  select orders.* into tree_order
  from public.tree_credit_orders orders
  where orders.id = p_order_id
    and orders.user_id = p_user_id
    and orders.unit_amount_cents = 3000
    and orders.currency = 'eur'
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'TREE_CREDIT_ORDER_NOT_FOUND';
  end if;

  if tree_order.stripe_checkout_session_id is distinct from p_checkout_session_id then
    raise exception using errcode = 'P0001', message = 'TREE_CHECKOUT_SESSION_MISMATCH';
  end if;

  -- Checkout can complete before a delayed payment method settles. Record the
  -- event idempotently but leave the order pending for the later success/fail
  -- event.
  if p_event_type = 'checkout.session.completed'
    and p_payment_status is distinct from 'paid' then
    return 'awaiting_payment';
  end if;

  if p_event_type in ('checkout.session.expired', 'checkout.session.async_payment_failed') then
    if tree_order.status = 'pending' then
      update public.tree_credit_orders
      set status = 'expired'
      where id = tree_order.id;
      return 'expired';
    end if;

    -- A stale failure must never undo a successful, refunded or disputed
    -- payment state.
    return 'already_final';
  end if;

  if p_payment_status is distinct from 'paid'
    or p_amount_total is distinct from 3000
    or lower(coalesce(p_currency, '')) <> 'eur'
    or nullif(btrim(p_payment_intent_id), '') is null then
    raise exception using errcode = '22023', message = 'INVALID_PAID_TREE_CHECKOUT';
  end if;

  if tree_order.status in ('pending', 'expired') then
    update public.tree_credit_orders
    set
      status = 'paid',
      stripe_payment_intent_id = p_payment_intent_id
    where id = tree_order.id;
  elsif tree_order.status = 'paid' then
    if tree_order.stripe_payment_intent_id is distinct from p_payment_intent_id then
      raise exception using errcode = 'P0001', message = 'TREE_PAYMENT_INTENT_MISMATCH';
    end if;
  else
    -- Do not let an out-of-order paid event reverse a later refund/dispute.
    return 'already_final';
  end if;

  if nullif(btrim(p_customer_id), '') is not null then
    update public.tree_accounts
    set stripe_customer_id = p_customer_id
    where user_id = p_user_id;

    if not found then
      raise exception using errcode = 'P0001', message = 'TREE_ACCOUNT_NOT_FOUND';
    end if;
  end if;

  return case when tree_order.status = 'paid' then 'already_paid' else 'paid' end;
end;
$$;

revoke all on function public.process_stripe_tree_event(
  text, text, uuid, uuid, text, text, integer, text, text, text
) from public, anon, authenticated;
grant execute on function public.process_stripe_tree_event(
  text, text, uuid, uuid, text, text, integer, text, text, text
) to service_role;

comment on function public.process_stripe_tree_event(
  text, text, uuid, uuid, text, text, integer, text, text, text
) is 'Atomically processes a signature-verified Stripe tree-credit event; service_role only.';
