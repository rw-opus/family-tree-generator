import { describe, expect, it } from "vitest";
import {
  buildCurrentOwnerPresentations,
  formatOwnershipFraction,
  formatOwnershipPercentage,
  formatPercentageHundredths,
  ownershipShare,
  reconcileFractionPercentageDisplay,
} from "../../src/domain/ownershipPresentation.js";

const owner = (id, numerator, denominator, share = numerator / denominator) => ({
  id,
  personId: id,
  share,
  shareFraction: { numerator, denominator },
});

const fraction = (numerator, denominator) => ({ numerator, denominator });

const reconcile = (fractions) => reconcileFractionPercentageDisplay(fractions);

const displayedHundredths = (fractions) =>
  reconcile(fractions).rows.map((row) => row.displayPercentageHundredths);

describe("reconciled percentage display", () => {
  it("formats up to two decimal places from exact hundredths", () => {
    expect(formatPercentageHundredths(0)).toBe("0%");
    expect(formatPercentageHundredths(1)).toBe("0.01%");
    expect(formatPercentageHundredths(10)).toBe("0.1%");
    expect(formatPercentageHundredths(1_250)).toBe("12.5%");
    expect(formatPercentageHundredths(3_334)).toBe("33.34%");
    expect(formatPercentageHundredths(10_000)).toBe("100%");
    expect(formatPercentageHundredths(-1)).toBe("");
    expect(formatPercentageHundredths(1.5)).toBe("");
  });

  it("uses largest remainders to make thirds total exactly 100%", () => {
    const result = reconcile([fraction(1, 3), fraction(1, 3), fraction(1, 3)]);

    expect(result.valid).toBe(true);
    expect(result.isWhole).toBe(true);
    expect(result.totalDisplayPercentageHundredths).toBe(10_000);
    expect(result.totalDisplayPercentageLabel).toBe("100%");
    expect(result.rows.map((row) => row.displayPercentageLabel)).toEqual([
      "33.34%",
      "33.33%",
      "33.33%",
    ]);
  });

  it("reconciles sixths and sevenths without changing their exact shares", () => {
    expect(displayedHundredths(Array.from({ length: 6 }, () => fraction(1, 6)))).toEqual([
      1_667, 1_667, 1_667, 1_667, 1_666, 1_666,
    ]);
    expect(displayedHundredths(Array.from({ length: 7 }, () => fraction(1, 7)))).toEqual([
      1_429, 1_429, 1_429, 1_429, 1_428, 1_428, 1_428,
    ]);
  });

  it("preserves partial and overfull totals instead of disguising them as complete", () => {
    const partial = reconcile([fraction(1, 3), fraction(1, 3)]);
    expect(displayedHundredths([fraction(1, 3), fraction(1, 3)])).toEqual([3_334, 3_333]);
    expect(partial.isWhole).toBe(false);
    expect(partial.totalDisplayPercentageLabel).toBe("66.67%");

    const overfull = reconcile([fraction(2, 3), fraction(2, 3)]);
    expect(overfull.rows.map((row) => row.displayPercentageHundredths)).toEqual([6_667, 6_666]);
    expect(overfull.isWhole).toBe(false);
    expect(overfull.totalDisplayPercentageLabel).toBe("133.33%");
  });

  it("reserves a displayed 100% total for an exactly complete set", () => {
    const justUnder = reconcile([fraction(3_333, 10_000), fraction(1, 3), fraction(1, 3)]);
    expect(justUnder.isWhole).toBe(false);
    expect(justUnder.totalDisplayPercentageLabel).toBe("99.99%");
    expect(justUnder.rows.reduce((total, row) => total + row.displayPercentageHundredths, 0)).toBe(
      9_999,
    );

    const justOver = reconcile([fraction(6_667, 20_000), fraction(1, 3), fraction(1, 3)]);
    expect(justOver.isWhole).toBe(false);
    expect(justOver.totalDisplayPercentageLabel).toBe("100.01%");
    expect(justOver.rows.reduce((total, row) => total + row.displayPercentageHundredths, 0)).toBe(
      10_001,
    );
  });

  it("keeps zero shares visible and reports malformed or negative fractions", () => {
    const result = reconcile([
      fraction(0, 1),
      fraction(1, 2),
      fraction(1, 0),
      fraction(-1, 2),
      fraction(1, -2),
    ]);

    expect(result.valid).toBe(false);
    expect(result.totalDisplayPercentageHundredths).toBeNull();
    expect(result.rows[0]).toMatchObject({
      valid: true,
      displayPercentageHundredths: 0,
      displayPercentageLabel: "0%",
    });
    expect(result.rows[1]).toMatchObject({
      valid: true,
      displayPercentageHundredths: 5_000,
      displayPercentageLabel: "50%",
    });
    result.rows.slice(2).forEach((row) => {
      expect(row.valid).toBe(false);
      expect(row.displayPercentageHundredths).toBeNull();
      expect(row.displayPercentageLabel).toBe("");
      expect(row.error).not.toBe("");
    });
  });

  it("breaks equal-remainder ties by canonical input order deterministically", () => {
    const fractions = [fraction(1, 3), fraction(1, 3), fraction(1, 3)];

    expect(displayedHundredths(fractions)).toEqual([3_334, 3_333, 3_333]);
    expect(displayedHundredths(fractions)).toEqual([3_334, 3_333, 3_333]);
  });

  it("uses stable keys to assign equal-remainder adjustments across reordered views", () => {
    const fractions = [fraction(1, 3), fraction(1, 3), fraction(1, 3)];
    const forward = reconcileFractionPercentageDisplay(fractions, { keys: ["a", "b", "c"] });
    const reverse = reconcileFractionPercentageDisplay(fractions, { keys: ["c", "b", "a"] });

    expect(
      Object.fromEntries(
        ["a", "b", "c"].map((key, index) => [key, forward.rows[index].displayPercentageLabel]),
      ),
    ).toEqual(
      Object.fromEntries(
        ["c", "b", "a"].map((key, index) => [key, reverse.rows[index].displayPercentageLabel]),
      ),
    );
    expect(forward.rows.map((row) => row.displayPercentageLabel)).toEqual([
      "33.34%",
      "33.33%",
      "33.33%",
    ]);
  });

  it("handles more positive owners than available hundredths without losing the total", () => {
    const fractions = Array.from({ length: 10_001 }, () => fraction(1, 10_001));
    const result = reconcile(fractions);
    const units = result.rows.map((row) => row.displayPercentageHundredths);

    expect(result.isWhole).toBe(true);
    expect(units.reduce((total, value) => total + value, 0)).toBe(10_000);
    expect(units.filter((value) => value === 1)).toHaveLength(10_000);
    expect(units.filter((value) => value === 0)).toHaveLength(1);
    expect(units.at(-1)).toBe(0);
  });

  it("does not mutate exact fraction inputs", () => {
    const fractions = Object.freeze([Object.freeze(fraction(1, 3)), Object.freeze(fraction(2, 3))]);

    reconcile(fractions);

    expect(fractions).toEqual([fraction(1, 3), fraction(2, 3)]);
  });
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
    expect(presentations.map((entry) => entry.percentage)).toEqual([
      (1 / 3) * 100,
      (1 / 3) * 100,
      (1 / 3) * 100,
    ]);
    expect(presentations.map((entry) => entry.displayPercentageHundredths)).toEqual([
      3_334, 3_333, 3_333,
    ]);
    expect(presentations.map((entry) => entry.displayPercentage)).toEqual([33.34, 33.33, 33.33]);
    expect(presentations.map((entry) => entry.displayPercentageLabel)).toEqual([
      "33.34%",
      "33.33%",
      "33.33%",
    ]);
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
