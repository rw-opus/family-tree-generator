export type TreeCheckoutAction = "fulfil" | "expire" | "ignore";

export function treeOrderWasAlreadyFulfilled(order: { status?: string | null } | null) {
  return order?.status === "paid";
}

export function treeCheckoutEventAction(eventType: string): TreeCheckoutAction {
  if (
    eventType === "checkout.session.completed" ||
    eventType === "checkout.session.async_payment_succeeded"
  ) {
    return "fulfil";
  }
  if (
    eventType === "checkout.session.expired" ||
    eventType === "checkout.session.async_payment_failed"
  ) {
    return "expire";
  }
  return "ignore";
}

export function paidTreeOrderUpdate(session: {
  amount_total?: number | null;
  currency?: string | null;
  payment_intent?: string | { id?: string } | null;
  payment_status?: string | null;
}) {
  if (session.payment_status !== "paid") throw new Error("tree checkout is not paid");
  if (session.amount_total !== 3000 || String(session.currency || "").toLowerCase() !== "eur") {
    throw new Error("tree checkout amount is invalid");
  }
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;
  return {
    status: "paid",
    stripe_payment_intent_id: paymentIntentId,
  };
}

export type WebhookRejection = { status: number; error: string } | null;

/**
 * E1 — the checks a request must pass before its body is ever parsed, in the
 * order they are applied. An unconfigured deployment refuses rather than
 * accepting unverifiable events.
 */
export function webhookRejection(input: {
  method: string;
  configured: boolean;
  signature: string | null;
}): WebhookRejection {
  if (input.method !== "POST") return { status: 405, error: "method not allowed" };
  if (!input.configured) return { status: 503, error: "webhook is not configured" };
  if (!input.signature) return { status: 400, error: "missing signature" };
  return null;
}

export type EventClaimOutcome = "claimed" | "duplicate" | "failed";

/**
 * E2 — the idempotency ledger is claimed by insert. A unique violation means
 * this event has already been seen, which is a successful no-op rather than an
 * error, so Stripe stops retrying it.
 */
export function eventClaimOutcome(error: { code?: string | null } | null): EventClaimOutcome {
  if (!error) return "claimed";
  return error.code === "23505" ? "duplicate" : "failed";
}

export type FulfilmentOutcome = "fulfilled" | "already-fulfilled" | "unmatched";

/**
 * E2/E3 — a fulfilment that updated no pending row is not automatically a
 * failure: a redelivered or out-of-order event may find the order already paid.
 * Only a genuinely unmatched order is an error worth retrying.
 */
export function treeOrderFulfilmentOutcome(input: {
  updatedOrder: { id?: string } | null;
  existingOrder: { status?: string | null } | null;
}): FulfilmentOutcome {
  if (input.updatedOrder) return "fulfilled";
  return treeOrderWasAlreadyFulfilled(input.existingOrder) ? "already-fulfilled" : "unmatched";
}

/**
 * E4 — the order and account a session refers to are taken from Stripe's own
 * signed payload, never from anything the browser supplied at checkout time.
 * A session that is not this product, or is missing either reference, is
 * refused rather than guessed at.
 */
export function treeCheckoutReference(session: {
  client_reference_id?: string | null;
  metadata?: Record<string, string | undefined> | null;
}): { orderId: string; userId: string } | null {
  const orderId = String(session.client_reference_id || session.metadata?.order_id || "");
  const userId = String(session.metadata?.user_id || "");
  if (!orderId || !userId) return null;
  if (session.metadata?.product !== "family_tree_credit") return null;
  return { orderId, userId };
}
