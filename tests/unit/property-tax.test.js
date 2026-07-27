import { describe, expect, it } from "vitest";
import { allocateCurrentIntestacy, inheritanceDuty, saleTaxLot, successionRuleset, suggestedIntestacyShares } from "../../src/domain/propertyTax.js";

describe("Maltese inherited property estimates", () => {
  it("splits intestacy equally between spouse and descendants", () => {
    const heirs = suggestedIntestacyShares([{ id: "s", relationship: "Surviving spouse" }, { id: "a", relationship: "Child" }, { id: "b", relationship: "Child" }]);
    expect(heirs.map((heir) => heir.sharePercent)).toEqual([50, 25, 25]);
  });
  it("allocates a predeceased child's branch per stirpes", () => {
    const result = allocateCurrentIntestacy([
      { id: "a", relationship: "Child", status: "accepted" },
      { id: "b", relationship: "Child", status: "predeceased" },
      { id: "b1", relationship: "Descendant", branchId: "b", status: "accepted" },
      { id: "b2", relationship: "Descendant", branchId: "b", status: "accepted" },
    ]);
    expect(result.shares.get("a")).toBe(50);
    expect(result.shares.get("b1")).toBe(25);
    expect(result.shares.get("b2")).toBe(25);
  });
  it("continues representation through successive descendant generations", () => {
    const result = allocateCurrentIntestacy([
      { id: "a", relationship: "Child", status: "accepted" },
      { id: "b", relationship: "Child", status: "predeceased" },
      { id: "b1", relationship: "Descendant", branchId: "b", status: "predeceased" },
      { id: "b2", relationship: "Descendant", branchId: "b", status: "accepted" },
      { id: "b1a", relationship: "Descendant", branchId: "b1", status: "accepted" },
      { id: "b1b", relationship: "Descendant", branchId: "b1", status: "predeceased" },
      { id: "b1b1", relationship: "Descendant", branchId: "b1b", status: "accepted" },
      { id: "b1b2", relationship: "Descendant", branchId: "b1b", status: "accepted" },
    ]);
    expect(result.shares.get("a")).toBe(50);
    expect(result.shares.get("b2")).toBe(25);
    expect(result.shares.get("b1a")).toBe(12.5);
    expect(result.shares.get("b1b1")).toBe(6.25);
    expect(result.shares.get("b1b2")).toBe(6.25);
  });
  it("splits between nearest ascendants and sibling branches", () => {
    const result = allocateCurrentIntestacy([
      { id: "p", relationship: "Parent", status: "accepted" },
      { id: "s", relationship: "Sibling", status: "predeceased" },
      { id: "n1", relationship: "Sibling descendant", branchId: "s", status: "accepted" },
      { id: "n2", relationship: "Sibling descendant", branchId: "s", status: "accepted" },
    ]);
    expect(result.shares.get("p")).toBe(50);
    expect(result.shares.get("n1")).toBe(25);
    expect(result.shares.get("n2")).toBe(25);
  });
  it("does not represent a renouncing child", () => {
    const result = allocateCurrentIntestacy([
      { id: "a", relationship: "Child", status: "accepted" },
      { id: "b", relationship: "Child", status: "renounced" },
      { id: "b1", relationship: "Descendant", branchId: "b", status: "accepted" },
    ]);
    expect(result.shares.get("a")).toBe(100);
    expect(result.shares.get("b1")).toBe(0);
  });
  it("locks automatic allocation before the current-law boundary", () => {
    expect(successionRuleset("2005-02-28").supported).toBe(false);
    expect(successionRuleset("2005-03-01").supported).toBe(true);
  });
  it("calculates inherited value and standard duty", () => {
    const result = inheritanceDuty({ marketValueAtDeath: 600000, deceasedOwnershipPercent: 50, rightPercent: 100 }, { sharePercent: 100 / 3, soleResidence: false });
    expect(result.inheritedValue).toBeCloseTo(100000);
    expect(result.duty).toBeCloseTo(5000);
  });
  it("compares post-2003 sale methods", () => {
    const result = saleTaxLot({ inheritanceDate: "2010-01-01", acquisitionValue: 100000, transferValue: 150000 });
    expect(result.methods.map((item) => item.tax)).toEqual([6000, 12000]);
    expect(result.recommended).toBe("increase");
  });
});
