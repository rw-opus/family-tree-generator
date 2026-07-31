export type TreeCheckoutAction = "fulfil" | "expire" | "ignore";

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
