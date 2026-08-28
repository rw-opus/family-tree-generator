import { describe, expect, it } from "vitest";
import {
  defaultTreeEntitlement,
  isTreePaymentRequiredError,
  normaliseTreeEntitlement,
} from "../../src/services/treeBilling.js";

describe("subscription tree access", () => {
  it("keeps legacy allowance counters informational while permitting creation", () => {
    expect(defaultTreeEntitlement).toMatchObject({
      freeTreeLimit: 3,
      freeTreesUsed: 0,
      freeTreesRemaining: 3,
      paidTreeCredits: 0,
      unlimitedTrees: false,
      canCreate: true,
    });
    expect(normaliseTreeEntitlement()).toEqual(defaultTreeEntitlement);
  });

  it("allows an operator-granted unlimited account without consuming credits", () => {
    expect(
      normaliseTreeEntitlement({
        free_tree_limit: 5,
        free_trees_used: 5,
        paid_tree_credits: 0,
        total_trees_created: 20,
        unlimited_trees: true,
      }),
    ).toMatchObject({
      freeTreesRemaining: 0,
      paidTreeCredits: 0,
      totalTreesCreated: 20,
      unlimitedTrees: true,
      canCreate: true,
    });
  });

  it("normalises the legacy unlimited flag without using it as a payment wall", () => {
    for (const unlimited_trees of ["true", 1]) {
      expect(
        normaliseTreeEntitlement({
          free_tree_limit: 5,
          free_trees_used: 5,
          paid_tree_credits: 0,
          unlimited_trees,
        }),
      ).toMatchObject({ unlimitedTrees: false, canCreate: true });
    }
  });

  it("does not block subscription access when legacy credits are exhausted", () => {
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
    ).toBe(true);
  });

  it("recognises the database payment-required signal", () => {
    expect(isTreePaymentRequiredError({ message: "TREE_PAYMENT_REQUIRED" })).toBe(true);
    expect(isTreePaymentRequiredError({ details: "TREE_PAYMENT_REQUIRED: buy a credit" })).toBe(
      true,
    );
    expect(isTreePaymentRequiredError({ message: "network unavailable" })).toBe(false);
  });
});
