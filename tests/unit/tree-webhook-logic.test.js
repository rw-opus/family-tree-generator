import { describe, expect, it } from "vitest";
import {
  paidTreeOrderUpdate,
  treeCheckoutEventAction,
  treeOrderWasAlreadyFulfilled,
} from "../../supabase/functions/stripe-tree-webhook/logic.ts";

describe("Stripe tree-credit webhook decisions", () => {
  it("recognises a previously fulfilled order during a safe webhook retry", () => {
    expect(treeOrderWasAlreadyFulfilled({ status: "paid" })).toBe(true);
    expect(treeOrderWasAlreadyFulfilled({ status: "pending" })).toBe(false);
    expect(treeOrderWasAlreadyFulfilled(null)).toBe(false);
  });

  it("handles paid, delayed, expired and unrelated events explicitly", () => {
    expect(treeCheckoutEventAction("checkout.session.completed")).toBe("fulfil");
    expect(treeCheckoutEventAction("checkout.session.async_payment_succeeded")).toBe("fulfil");
    expect(treeCheckoutEventAction("checkout.session.expired")).toBe("expire");
    expect(treeCheckoutEventAction("checkout.session.async_payment_failed")).toBe("expire");
    expect(treeCheckoutEventAction("customer.updated")).toBe("ignore");
  });

  it("grants credit only for an exactly EUR 30 paid checkout", () => {
    expect(
      paidTreeOrderUpdate({
        amount_total: 3000,
        currency: "eur",
        payment_intent: "pi_1",
        payment_status: "paid",
      }),
    ).toEqual({ status: "paid", stripe_payment_intent_id: "pi_1" });

    expect(() =>
      paidTreeOrderUpdate({ amount_total: 2999, currency: "eur", payment_status: "paid" }),
    ).toThrow("amount is invalid");
    expect(() =>
      paidTreeOrderUpdate({ amount_total: 3000, currency: "eur", payment_status: "unpaid" }),
    ).toThrow("not paid");
  });
});
