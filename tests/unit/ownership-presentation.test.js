import { describe, expect, it } from "vitest";
import {
  buildCurrentOwnerPresentations,
  formatOwnershipFraction,
  formatOwnershipPercentage,
  ownershipShare,
} from "../../src/domain/ownershipPresentation.js";

const owner = (id, numerator, denominator, share = numerator / denominator) => ({
  id,
  personId: id,
  share,
  shareFraction: { numerator, denominator },
});

describe("current-owner presentation", () => {
  it("derives the numeric share and percentage from the exact fraction", () => {
    const exact = { numerator: 1, denominator: 2 };

    expect(ownershipShare(0.49, exact)).toBe(0.5);
    expect(formatOwnershipFraction(0.49, exact)).toBe("1/2");
    expect(formatOwnershipPercentage(0.49, exact)).toBe("50%");
  });

  it("reconciles thirds to the recorded value when no tax report is needed", () => {
    const presentations = buildCurrentOwnerPresentations(
      [owner("first", 1, 3), owner("second", 1, 3), owner("third", 1, 3)],
      "1",
    );

    expect(presentations.map((entry) => entry.value)).toEqual([0.34, 0.33, 0.33]);
    expect(presentations.reduce((total, entry) => total + entry.value, 0)).toBe(1);
  });

  it("uses tax owner totals after acquisition-source cent allocation", () => {
    const presentations = buildCurrentOwnerPresentations(
      [owner("owner-a", 5, 6), owner("owner-b", 1, 6)],
      "1000000",
      {
        vendors: [
          { id: "owner-a", attributedSaleValue: 833333.34 },
          { id: "owner-b", attributedSaleValue: 166666.66 },
        ],
      },
    );

    expect(presentations.map((entry) => entry.value)).toEqual([833333.34, 166666.66]);
  });

  it("allocates only the residual cents to current owners absent from tax", () => {
    const presentations = buildCurrentOwnerPresentations(
      [owner("living", 1, 2), owner("unresolved-deceased", 1, 2)],
      "0.01",
      { vendors: [{ id: "living", attributedSaleValue: 0.01 }] },
    );

    expect(presentations.map((entry) => entry.value)).toEqual([0.01, 0]);
  });

  it("preserves an explicit zero and leaves missing or invalid values absent", () => {
    expect(buildCurrentOwnerPresentations([owner("owner", 1, 1)], 0)[0].value).toBe(0);
    for (const value of ["", null, undefined, "not-a-number", -1]) {
      expect(buildCurrentOwnerPresentations([owner("owner", 1, 1)], value)[0].value).toBeNull();
    }
  });
});
