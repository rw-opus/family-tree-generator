export type TreeAccountAllowance = {
  free_tree_limit?: number | null;
  free_trees_used?: number | null;
  paid_tree_credits?: number | null;
  unlimited_trees?: boolean | null;
};

export type CheckoutGate = { allowed: true } | { allowed: false; status: number; reason: string };

export function normaliseAppUrl(rawUrl: string): string {
  try {
    const url = new URL(String(rawUrl || "").trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

export function isExpectedTreePrice(price: {
  active?: boolean;
  currency?: string;
  type?: string;
  unit_amount?: number | null;
}): boolean {
  return (
    price.active === true &&
    price.type === "one_time" &&
    price.unit_amount === 3000 &&
    String(price.currency || "").toLowerCase() === "eur"
  );
}

export function checkoutGate(account: TreeAccountAllowance | null | undefined): CheckoutGate {
  if (account?.unlimited_trees === true) {
    return { allowed: false, status: 409, reason: "account has unlimited tree creation" };
  }
  const freeLimit = Number(account?.free_tree_limit ?? 5);
  const freeUsed = Number(account?.free_trees_used ?? 0);
  const paidCredits = Number(account?.paid_tree_credits ?? 0);
  if (freeUsed < freeLimit) {
    return { allowed: false, status: 409, reason: "free tree generations remain" };
  }
  if (paidCredits > 0) {
    return { allowed: false, status: 409, reason: "an unused paid tree credit is available" };
  }
  return { allowed: true };
}

export function checkoutSessionParams(input: {
  appUrl: string;
  customerId: string;
  email: string;
  orderId: string;
  priceId: string;
  userId: string;
}) {
  return {
    mode: "payment" as const,
    line_items: [{ price: input.priceId, quantity: 1 }],
    ...(input.customerId
      ? { customer: input.customerId }
      : { customer_email: input.email, customer_creation: "always" as const }),
    client_reference_id: input.orderId,
    metadata: {
      order_id: input.orderId,
      product: "family_tree_credit",
      user_id: input.userId,
    },
    payment_intent_data: {
      metadata: {
        order_id: input.orderId,
        product: "family_tree_credit",
        user_id: input.userId,
      },
    },
    success_url: `${input.appUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.appUrl}/?checkout=cancelled`,
  };
}
