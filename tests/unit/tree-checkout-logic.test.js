import { describe, expect, it } from "vitest";
import {
  checkoutGate,
  checkoutSessionParams,
  isExpectedTreePrice,
  normaliseAppUrl,
} from "../../supabase/functions/create-tree-checkout/logic.ts";

describe("tree credit checkout", () => {
  it("only opens checkout once free and purchased credits are exhausted", () => {
    expect(checkoutGate(null)).toMatchObject({
      allowed: false,
      reason: "free tree generations remain",
    });
    expect(
      checkoutGate({ free_tree_limit: 5, free_trees_used: 5, paid_tree_credits: 1 }),
    ).toMatchObject({ allowed: false, reason: "an unused paid tree credit is available" });
    expect(checkoutGate({ free_tree_limit: 5, free_trees_used: 5, paid_tree_credits: 0 })).toEqual({
      allowed: true,
    });
  });

  it("creates a one-time server-priced checkout tied to the account and order", () => {
    const params = checkoutSessionParams({
      appUrl: "https://family.example",
      customerId: "",
      email: "owner@example.com",
      orderId: "order-1",
      priceId: "price_30_eur",
      userId: "user-1",
    });

    expect(params).toMatchObject({
      mode: "payment",
      line_items: [{ price: "price_30_eur", quantity: 1 }],
      customer_email: "owner@example.com",
      customer_creation: "always",
      client_reference_id: "order-1",
      metadata: {
        order_id: "order-1",
        product: "family_tree_credit",
        user_id: "user-1",
      },
    });
    expect(params.success_url).toContain("checkout=success");
  });

  it("accepts only an HTTP or HTTPS application origin", () => {
    expect(normaliseAppUrl("https://family.example/path?q=1")).toBe("https://family.example");
    expect(normaliseAppUrl("javascript:alert(1)")).toBe("");
    expect(normaliseAppUrl("not a url")).toBe("");
  });

  it("accepts only the active one-time EUR 30 Stripe price", () => {
    expect(
      isExpectedTreePrice({ active: true, currency: "eur", type: "one_time", unit_amount: 3000 }),
    ).toBe(true);
    expect(
      isExpectedTreePrice({ active: true, currency: "eur", type: "one_time", unit_amount: 2999 }),
    ).toBe(false);
    expect(
      isExpectedTreePrice({ active: false, currency: "eur", type: "one_time", unit_amount: 3000 }),
    ).toBe(false);
  });
});
