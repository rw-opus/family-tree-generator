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

  it("accepts 12-digit fraction components and calculates them exactly", () => {
    expect(
      calculateFraction(
        { numerator: "999999999999", denominator: "999999999999" },
        { numerator: "999999999999", denominator: "999999999999" },
        "add",
      ),
    ).toMatchObject({ numerator: 2, denominator: 1 });
  });

  it("rejects 13-digit inputs and reduced results", () => {
    expect(
      calculateFraction(
        { numerator: "1000000000000", denominator: 1 },
        { numerator: 1, denominator: 1 },
        "add",
      ).error,
    ).toContain("12 digits");
    expect(
      calculateFraction(
        { numerator: "999999999999", denominator: 1 },
        { numerator: 1, denominator: 1 },
        "add",
      ).error,
    ).toContain("12-digit limit");
  });
});
