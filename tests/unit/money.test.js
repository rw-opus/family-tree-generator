import { describe, expect, it } from "vitest";
import {
  allocateCents,
  allocateMoney,
  fromCents,
  roundMoney,
  sumMoney,
  toCents,
} from "../../src/domain/money.js";

describe("cent conversion", () => {
  it("converts euros to whole cents", () => {
    expect(toCents(20000)).toBe(2_000_000);
    expect(toCents("333333.33")).toBe(33_333_333);
    expect(toCents(0)).toBe(0);
    expect(toCents(-12.34)).toBe(-1234);
  });

  it("rounds a half cent up rather than losing it to binary drift", () => {
    // 8.045 is stored as 8.0449999..., which a naive round sends to 8.04.
    expect(toCents(8.045)).toBe(805);
    expect(toCents(1.005)).toBe(101);
    expect(roundMoney(26666.666666666664)).toBe(26666.67);
  });

  it("rejects values that are not usable numbers", () => {
    expect(toCents("")).toBeNull();
    expect(toCents(null)).toBeNull();
    expect(toCents(Number.NaN)).toBeNull();
    expect(toCents(Number.POSITIVE_INFINITY)).toBeNull();
    expect(fromCents("nope")).toBeNull();
  });
});

describe("largest remainder allocation", () => {
  it("splits a third three ways without losing a cent", () => {
    const portions = allocateCents(100_000_000, [1, 1, 1]);

    expect(portions.reduce((sum, value) => sum + value, 0)).toBe(100_000_000);
    expect(portions).toEqual([33_333_334, 33_333_333, 33_333_333]);
  });

  it("splits a seventh seven ways without losing a cent", () => {
    const portions = allocateCents(10_000_000, Array(7).fill(1));

    expect(portions.reduce((sum, value) => sum + value, 0)).toBe(10_000_000);
    // Three portions carry the extra cent each; the rest are equal.
    expect(new Set(portions).size).toBeLessThanOrEqual(2);
  });

  it("respects unequal weights", () => {
    const portions = allocateCents(72_500_000, [1 / 6, 1 / 6, 1 / 6, 1 / 2]);

    expect(portions.reduce((sum, value) => sum + value, 0)).toBe(72_500_000);
    expect(portions[3]).toBe(36_250_000);
  });

  it("is deterministic, so a re-render never reshuffles the pennies", () => {
    const first = allocateCents(100_000_000, [1, 1, 1]);
    const second = allocateCents(100_000_000, [1, 1, 1]);

    expect(first).toEqual(second);
  });

  it("hands cents back in the same order for a negative total", () => {
    const portions = allocateCents(-100, [1, 1, 1]);

    expect(portions.reduce((sum, value) => sum + value, 0)).toBe(-100);
  });

  it("keeps the total when every weight is zero or unusable", () => {
    expect(allocateCents(500, [0, 0])).toEqual([500, 0]);
    expect(allocateCents(500, ["x", null])).toEqual([500, 0]);
    expect(allocateCents(500, [])).toEqual([]);
  });

  it("allocates euro amounts that sum back exactly", () => {
    const portions = allocateMoney(1_000_000, [1, 1, 1]);

    expect(sumMoney(portions)).toBe(1_000_000);
    expect(portions).toEqual([333333.34, 333333.33, 333333.33]);
  });

  it("reports an unusable total rather than inventing zero", () => {
    expect(allocateMoney("", [1, 1])).toBeNull();
    expect(allocateMoney(null, [1])).toBeNull();
  });
});

describe("summing money", () => {
  it("adds through cents so the result carries no binary residue", () => {
    expect(sumMoney([26666.67, 26666.67, 26666.66])).toBe(80000);
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([])).toBe(0);
  });

  it("ignores values that are not numbers instead of poisoning the total", () => {
    expect(sumMoney([10, null, "", 5])).toBe(15);
  });
});

describe("column invariants across realistic estates", () => {
  const cases = [
    { label: "three heirs of EUR 1,000,000", total: 1_000_000, weights: [1, 1, 1] },
    { label: "seven heirs of EUR 100,000", total: 100_000, weights: Array(7).fill(1) },
    { label: "three heirs of EUR 250,000", total: 250_000, weights: [1, 1, 1] },
    { label: "sixths and a half of EUR 725,000", total: 725_000, weights: [1, 1, 1, 3] },
    { label: "nine heirs of EUR 333,333.33", total: 333_333.33, weights: Array(9).fill(1) },
    { label: "eleven heirs of EUR 1", total: 1, weights: Array(11).fill(1) },
  ];

  it.each(cases)("$label adds up to the printed total", ({ total, weights }) => {
    const portions = allocateMoney(total, weights);

    expect(sumMoney(portions)).toBe(total);
    // No portion may be more than a cent away from its exact share.
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
    portions.forEach((portion, index) => {
      const exact = (total * weights[index]) / weightSum;
      expect(Math.abs(portion - exact)).toBeLessThan(0.01);
    });
  });
});
