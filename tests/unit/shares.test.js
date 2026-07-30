import { describe, expect, it } from "vitest";
import {
  fractionForShare,
  shareFromFraction,
  shareFromFractionInput,
  shareFromPercentage,
  shareFromPercentageInput,
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

  it("preserves a cleared fraction field while the user types a replacement", () => {
    expect(
      shareFromFractionInput(
        {
          shareNumerator: 1,
          shareDenominator: 2,
          sharePercent: 50,
        },
        { denominator: "" },
      ),
    ).toEqual({
      shareNumerator: 1,
      shareDenominator: "",
      sharePercent: 0,
    });
  });

  it("preserves a cleared percentage field while the user types a replacement", () => {
    expect(shareFromPercentageInput("")).toEqual({
      sharePercent: "",
      shareNumerator: 0,
      shareDenominator: 1,
    });
  });
});
