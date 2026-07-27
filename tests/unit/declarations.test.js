import { describe, expect, it } from "vitest";
import { declarationCoverage, validateDeclaration } from "../../src/domain/declarations.js";

describe("succession declarations", () => {
  it("allows separate and additional declarations by different heirs", () => {
    const heirs = [{ id: "a", name: "Anna" }, { id: "b", name: "Beppe" }, { id: "c", name: "Claire" }];
    const coverage = declarationCoverage(heirs, [
      { id: "one", type: "original", status: "published", participants: [{ heirId: "a", numerator: 1, denominator: 6, declaredValue: 100000 }, { heirId: "b", numerator: 1, denominator: 6, declaredValue: 100000 }] },
      { id: "two", type: "original", status: "published", participants: [{ heirId: "c", numerator: 1, denominator: 3, declaredValue: 200000 }] },
      { id: "three", type: "additional", status: "draft", participants: [{ heirId: "a", numerator: 1, denominator: 12, declaredValue: 50000 }] },
    ]);
    expect(coverage.find((item) => item.heirId === "a")).toMatchObject({ declarationCount: 2, publishedCount: 1, publishedFraction: 1 / 6, publishedValue: 100000 });
    expect(coverage.find((item) => item.heirId === "c")).toMatchObject({ declarationCount: 1, publishedCount: 1 });
  });
  it("requires a date and notary only when marked published", () => {
    const participants = [{ heirId: "a", numerator: 1, denominator: 2, declaredValue: 50000 }];
    expect(validateDeclaration({ status: "draft", participants })).toBe("");
    expect(validateDeclaration({ status: "published", participants, notaryName: "" })).toContain("publication date");
    expect(validateDeclaration({ status: "published", participants, date: "2026-01-01", notaryName: "" })).toContain("notary");
  });
});
