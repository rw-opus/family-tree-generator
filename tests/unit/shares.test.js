import { describe, expect, it } from "vitest";
import {
  fractionForShare,
  shareFromFraction,
  shareFromPercentage,
} from "../../src/domain/shares.js";

describe("inheritance share conversion", () => {
  it("converts a fraction to a synchronized percentage", () => {
    expect(shareFromFraction(1, 3)).toEqual({
      shareNumerator: 1,
      shareDenominator: 3,
      sharePercent: 100 / 3,
    });
  });

  it("converts a percentage to a practical fraction", () => {
    expect(shareFromPercentage(12.5)).toEqual({
      sharePercent: 12.5,
      shareNumerator: 1,
      shareDenominator: 8,
    });
  });

  it("derives a fraction for older saved heirs", () => {
    expect(fractionForShare({ sharePercent: 25 })).toEqual({
      numerator: 1,
      denominator: 4,
    });
  });
});
