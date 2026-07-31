import { describe, expect, it } from "vitest";
import {
  defaultTreeEntitlement,
  isTreePaymentRequiredError,
  normaliseTreeEntitlement,
} from "../../src/services/treeBilling.js";

describe("commercial tree entitlements", () => {
  it("gives a new account five free tree generations", () => {
    expect(defaultTreeEntitlement).toMatchObject({
      freeTreeLimit: 5,
      freeTreesUsed: 0,
      freeTreesRemaining: 5,
      paidTreeCredits: 0,
      canCreate: true,
    });
    expect(normaliseTreeEntitlement()).toEqual(defaultTreeEntitlement);
  });

  it("allows paid credits only after the free allowance is exhausted", () => {
    expect(
      normaliseTreeEntitlement({
        free_tree_limit: 5,
        free_trees_used: 5,
        paid_tree_credits: 1,
        total_trees_created: 5,
      }),
    ).toMatchObject({ freeTreesRemaining: 0, paidTreeCredits: 1, canCreate: true });
    expect(
      normaliseTreeEntitlement({
        free_tree_limit: 5,
        free_trees_used: 5,
        paid_tree_credits: 0,
      }).canCreate,
    ).toBe(false);
  });

  it("recognises the database payment-required signal", () => {
    expect(isTreePaymentRequiredError({ message: "TREE_PAYMENT_REQUIRED" })).toBe(true);
    expect(isTreePaymentRequiredError({ details: "TREE_PAYMENT_REQUIRED: buy a credit" })).toBe(
      true,
    );
    expect(isTreePaymentRequiredError({ message: "network unavailable" })).toBe(false);
  });
});
