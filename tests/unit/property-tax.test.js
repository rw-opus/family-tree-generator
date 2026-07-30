import { describe, expect, it } from "vitest";
import {
  allocateCurrentIntestacy,
  inheritanceDuty,
  saleTaxLot,
  saleTaxLotsTotal,
  successionRuleset,
  suggestedIntestacyShares,
  vendorTaxSummary,
} from "../../src/domain/propertyTax.js";

describe("Maltese inherited property estimates", () => {
  it("splits intestacy equally between spouse and descendants", () => {
    const heirs = suggestedIntestacyShares(
      [
        { id: "s", relationship: "Surviving spouse" },
        { id: "a", relationship: "Child" },
        { id: "b", relationship: "Child" },
      ],
      "2020-01-01",
    );
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
  it("does not apply current intestacy rules when the death date is missing", () => {
    const heirs = [
      { id: "s", relationship: "Surviving spouse" },
      { id: "a", relationship: "Child" },
    ];

    expect(suggestedIntestacyShares(heirs)).toEqual(heirs);
  });
  it("warns when an orphaned representative is provisionally promoted to root level", () => {
    const result = allocateCurrentIntestacy([
      { id: "a", name: "Anna", relationship: "Child", status: "accepted" },
      {
        id: "orphan",
        name: "Carlo",
        relationship: "Descendant",
        branchId: "missing-parent",
        status: "accepted",
      },
    ]);

    expect(result.warnings.join(" ")).toContain("Carlo");
    expect(result.warnings.join(" ")).toContain("no valid parent branch");
  });
  it("calculates inherited value and standard duty", () => {
    const result = inheritanceDuty(
      { marketValueAtDeath: 600000, deceasedOwnershipPercent: 50, rightPercent: 100 },
      { sharePercent: 100 / 3, soleResidence: false },
    );
    expect(result.inheritedValue).toBeCloseTo(100000);
    expect(result.duty).toBeCloseTo(5000);
  });
  it("applies the €250 rebate only when duty is strictly below €2,300", () => {
    const propertyForValue = (marketValueAtDeath) => ({
      marketValueAtDeath,
      deceasedOwnershipPercent: 100,
      rightPercent: 100,
    });
    const heir = { sharePercent: 100, soleResidence: false };

    expect(
      inheritanceDuty(propertyForValue(45980), heir, { deedWithinSixMonths: true }),
    ).toMatchObject({
      duty: 2049,
      rebate: 250,
    });
    expect(
      inheritanceDuty(propertyForValue(46000), heir, { deedWithinSixMonths: true }),
    ).toMatchObject({
      duty: 2300,
      rebate: 0,
    });
  });
  it("compares post-2003 sale methods", () => {
    const result = saleTaxLot({
      inheritanceDate: "2010-01-01",
      shareNumerator: 1,
      shareDenominator: 1,
      acquisitionValue: 100000,
      transferValue: 150000,
    });
    expect(result.methods.map((item) => item.tax)).toEqual([6000, 12000]);
    expect(result.recommended).toBe("increase");
  });

  it("charges 7% of the share sale price for pre-25 November 1992 inheritance", () => {
    const result = saleTaxLot({
      inheritanceDate: "1992-11-24",
      shareNumerator: 1,
      shareDenominator: 4,
      acquisitionValue: 100,
      transferValue: 120,
    });
    expect(result.methods).toHaveLength(1);
    expect(result.methods[0]).toMatchObject({
      key: "pre1992",
      basis: 120,
      tax: 8.4,
    });
  });

  it("compares each inherited fraction against that fraction's declared value", () => {
    const lots = [
      {
        inheritanceDate: "2010-01-01",
        shareNumerator: 1,
        shareDenominator: 4,
        acquisitionValue: 100,
        transferValue: 120,
        selectedTaxMethod: "increase",
      },
      {
        inheritanceDate: "2010-01-01",
        shareNumerator: 1,
        shareDenominator: 4,
        acquisitionValue: 110,
        transferValue: 120,
        selectedTaxMethod: "increase",
      },
    ];
    expect(saleTaxLot(lots[0]).methods[0].tax).toBeCloseTo(2.4);
    expect(saleTaxLot(lots[1]).methods[0].tax).toBeCloseTo(1.2);
    expect(saleTaxLotsTotal(lots)).toBeCloseTo(3.6);
  });

  it("offers 10% before 2004 and 8% from 2004 onward", () => {
    const pre2004 = saleTaxLot({
      inheritanceDate: "2003-12-31",
      shareNumerator: 1,
      shareDenominator: 4,
      acquisitionValue: 100,
      transferValue: 120,
    });
    const post2004 = saleTaxLot({
      inheritanceDate: "2004-01-01",
      shareNumerator: 1,
      shareDenominator: 4,
      acquisitionValue: 100,
      transferValue: 120,
      selectedTaxMethod: "whole",
    });
    expect(pre2004.methods.find((method) => method.key === "whole")).toMatchObject({
      rate: 0.1,
      tax: 12,
    });
    expect(post2004.methods.find((method) => method.key === "whole")).toMatchObject({
      rate: 0.08,
      tax: 9.6,
    });
    expect(post2004.selected).toBe("whole");
  });

  it("does not calculate until the inherited fraction is entered", () => {
    const result = saleTaxLot({
      inheritanceDate: "2010-01-01",
      acquisitionValue: 100,
      transferValue: 120,
    });
    expect(result.methods).toEqual([]);
    expect(result.warning).toContain("inherited fraction");
  });

  it("includes a manually assessed vendor where inherited-property methods do not apply", () => {
    const result = saleTaxLot({
      taxTreatment: "manual",
      manualTaxAmount: 4500,
      transferValue: 100000,
      shareNumerator: 1,
      shareDenominator: 4,
    });

    expect(result.selected).toBe("manual");
    expect(result.methods[0]).toMatchObject({
      key: "manual",
      basis: 100000,
      tax: 4500,
    });
  });

  it("summarises each living vendor and excludes deceased vendors and their taxes", () => {
    const livingLot = {
      ownerId: "living",
      inheritanceDate: "2010-01-01",
      shareNumerator: 1,
      shareDenominator: 2,
      acquisitionValue: 100,
      transferValue: 120,
      selectedTaxMethod: "increase",
    };
    const deceasedLot = {
      ownerId: "deceased",
      inheritanceDate: "2010-01-01",
      shareNumerator: 1,
      shareDenominator: 2,
      acquisitionValue: 50,
      transferValue: 100,
      selectedTaxMethod: "increase",
    };
    const summary = vendorTaxSummary(
      [
        { id: "living", name: "Maria Borg", share: 0.5 },
        { id: "deceased", name: "Joseph Borg", share: 0.5 },
      ],
      [
        { lot: livingLot, result: saleTaxLot(livingLot) },
        { lot: deceasedLot, result: saleTaxLot(deceasedLot) },
      ],
      ["deceased"],
    );
    expect(summary.vendors).toHaveLength(1);
    expect(summary.vendors[0]).toMatchObject({
      id: "living",
      lotCount: 1,
      saleValue: 120,
      tax: 2.4,
    });
    expect(summary.total).toBeCloseTo(2.4);
    expect(summary.excludedLotCount).toBe(1);
  });
});
