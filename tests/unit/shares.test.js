import { describe, expect, it } from "vitest";
import {
  fractionForShare,
  normalisePercentageInput,
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

  it("preserves a percentage-derived fraction whose denominator runs into the millions", () => {
    expect(shareFromPercentage((1 / 3000001) * 100)).toEqual({
      sharePercent: (1 / 3000001) * 100,
      shareNumerator: 1,
      shareDenominator: 3000001,
    });
  });

  it("accepts 12-digit components and rejects 13-digit components", () => {
    expect(shareFromFraction(1, "999999999999")).toEqual({
      shareNumerator: 1,
      shareDenominator: 999999999999,
      sharePercent: 100 / 999999999999,
    });
    expect(shareFromFraction(1, "1000000000000")).toEqual({
      shareNumerator: 1,
      shareDenominator: 0,
      sharePercent: 0,
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
      sharePercentInput: undefined,
    });
  });

  it("preserves a cleared percentage field while the user types a replacement", () => {
    expect(shareFromPercentageInput("")).toEqual({
      sharePercent: 0,
      shareNumerator: 0,
      shareDenominator: 1,
      sharePercentInput: "",
    });
  });

  it("stores a numeric percentage separately from its raw editing text", () => {
    expect(shareFromPercentageInput("45")).toEqual({
      sharePercent: 45,
      shareNumerator: 9,
      shareDenominator: 20,
      sharePercentInput: "45",
    });
  });

  it("rounds percentage input to at most two decimal places for display", () => {
    expect(normalisePercentageInput("33.333")).toBe("33.33");
    expect(normalisePercentageInput("33.335")).toBe("33.34");
    expect(normalisePercentageInput("8.045")).toBe("8.05");
    expect(normalisePercentageInput("50.00")).toBe("50");
  });

  it("preserves a cleared or temporarily unusable percentage input", () => {
    expect(normalisePercentageInput("")).toBe("");
    expect(normalisePercentageInput("not-a-number")).toBe("not-a-number");
  });
});
