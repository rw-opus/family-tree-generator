import { describe, expect, it } from "vitest";
import { calculateFraction } from "../../src/domain/fractions.js";

describe("fraction calculator", () => {
  it("adds and simplifies fractions", () => {
    expect(
      calculateFraction({ numerator: 1, denominator: 2 }, { numerator: 1, denominator: 3 }, "add"),
    ).toMatchObject({ numerator: 5, denominator: 6 });
  });
  it("handles multiplication and division", () => {
    expect(
      calculateFraction(
        { numerator: 2, denominator: 3 },
        { numerator: 9, denominator: 4 },
        "multiply",
      ),
    ).toMatchObject({ numerator: 3, denominator: 2 });
    expect(
      calculateFraction(
        { numerator: 2, denominator: 3 },
        { numerator: 4, denominator: 5 },
        "divide",
      ),
    ).toMatchObject({ numerator: 5, denominator: 6 });
  });
  it("rejects zero denominators", () => {
    expect(
      calculateFraction({ numerator: 1, denominator: 0 }, { numerator: 1, denominator: 2 }, "add")
        .error,
    ).toBeTruthy();
  });
  it("rejects decimals and partially numeric text instead of truncating them", () => {
    expect(
      calculateFraction(
        { numerator: "3.5", denominator: 4 },
        { numerator: 1, denominator: 2 },
        "add",
      ).error,
    ).toBe("Enter four whole numbers.");
    expect(
      calculateFraction(
        { numerator: "5abc", denominator: 4 },
        { numerator: 1, denominator: 2 },
        "add",
      ).error,
    ).toBe("Enter four whole numbers.");
  });
});
