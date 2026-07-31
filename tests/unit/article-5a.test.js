import { describe, expect, it } from "vitest";
import {
  ARTICLE_5A_SPECIAL_TREATMENTS,
  article5ATransferValue,
  assessArticle5ATransfer,
} from "../../src/domain/article5A.js";

const baseLot = {
  acquisitionType: "purchase",
  acquisitionDate: "2020-01-01",
  transferDate: "2026-07-31",
  shareNumerator: 1,
  shareDenominator: 1,
  consideration: 200000,
  marketValue: 200000,
};

describe("Income Tax Act Article 5A", () => {
  it("uses the higher of consideration and market value", () => {
    expect(article5ATransferValue({ consideration: 180000, marketValue: 200000 })).toMatchObject({
      consideration: 180000,
      marketValue: 200000,
      transferValue: 200000,
      marketValueOverrides: true,
    });
  });

  it("keeps the 12% increase method as the default for post-1992 inheritance", () => {
    const result = assessArticle5ATransfer({
      ...baseLot,
      acquisitionType: "inheritance",
      inheritanceDate: "2010-01-01",
      acquisitionValue: 150000,
      acquisitionValueBasis: "market-at-inheritance",
    });

    expect(result.methods.map((item) => item.key)).toEqual(["increase-12", "elected-whole-8"]);
    expect(result.defaultMethod).toBe("increase-12");
    expect(result.selected).toBe("increase-12");
    expect(result.methods[1]).toMatchObject({
      requiresElection: true,
      rule: "5A(5)(a)",
    });
  });

  it("applies 7% to a post-1992 inheritance sold by judicial auction", () => {
    const result = assessArticle5ATransfer({
      ...baseLot,
      acquisitionType: "inheritance",
      inheritanceDate: "2010-01-01",
      isJudicialSale: true,
    });

    expect(result.methods[0]).toMatchObject({
      key: "inheritance-7",
      rate: 0.07,
      rule: "5A(5)(c)(ii)",
    });
    expect(result.methods[0].tax).toBeCloseTo(14000);
  });

  it("treats a non-inheritance judicial sale as outside Article 5A", () => {
    const result = assessArticle5ATransfer({ ...baseLot, isJudicialSale: true });

    expect(result.status).toBe("out-of-scope");
    expect(result.requiresManualReview).toBe(true);
    expect(result.appliedRule).toBe("5A(3)(f)");
  });

  it("applies the ordinary 8% and pre-2004 10% whole-value rates", () => {
    const modern = assessArticle5ATransfer(baseLot);
    const old = assessArticle5ATransfer({
      ...baseLot,
      acquisitionDate: "2003-12-31",
    });

    expect(modern.methods[0]).toMatchObject({ key: "whole-8", tax: 16000 });
    expect(old.methods[0]).toMatchObject({ key: "whole-10", tax: 20000 });
  });

  it("applies the 5% five-year rate only after its facts are confirmed", () => {
    const result = assessArticle5ATransfer({
      ...baseLot,
      acquisitionDate: "2023-01-01",
      qualifiesFiveYearRate: true,
    });

    expect(result.methods[0]).toMatchObject({
      key: "five-year-5",
      rule: "5A(5)(e)",
      tax: 10000,
    });

    const project = assessArticle5ATransfer({
      ...baseLot,
      acquisitionDate: "2023-01-01",
      qualifiesFiveYearRate: true,
      isProject: true,
    });
    expect(project.methods).toEqual([]);
    expect(project.warning).toContain("project");
  });

  it("validates the conditions for the 2% sole-residence rate", () => {
    const result = assessArticle5ATransfer({
      ...baseLot,
      acquisitionDate: "2024-08-01",
      qualifyingRate: "sole-residence-2",
      acquiredForSoleResidence: true,
      ownsOtherResidentialProperty: false,
    });

    expect(result.methods[0]).toMatchObject({
      key: "sole-residence-2",
      rule: "5A(5)(g)",
      tax: 4000,
    });
  });

  it("traces a donation made within five years to the donor's preceding acquisition", () => {
    const result = assessArticle5ATransfer({
      ...baseLot,
      acquisitionType: "donation",
      acquisitionDate: "2024-01-01",
    });
    expect(result.methods).toEqual([]);
    expect(result.warning).toContain("donor's preceding acquisition date");

    const traced = assessArticle5ATransfer({
      ...baseLot,
      acquisitionType: "donation",
      acquisitionDate: "2024-01-01",
      previousAcquisitionDate: "2000-01-01",
    });
    expect(traced.methods[0]).toMatchObject({ key: "whole-10", rule: "5A(5)(f)" });
  });

  it("requires confirmation before applying a selected exemption", () => {
    const treatment = ARTICLE_5A_SPECIAL_TREATMENTS.find(
      (item) => item.key === "exempt-own-residence",
    );
    expect(treatment.rule).toBe("5A(4)(c)");

    const pending = assessArticle5ATransfer({
      ...baseLot,
      article5ASpecialTreatment: treatment.key,
    });
    expect(pending.methods).toEqual([]);
    expect(pending.warning).toContain("Confirm");

    const exempt = assessArticle5ATransfer({
      ...baseLot,
      article5ASpecialTreatment: treatment.key,
      specialTreatmentConfirmed: true,
    });
    expect(exempt.status).toBe("exempt");
    expect(exempt.methods[0].tax).toBe(0);
  });

  it("does not use a causa mortis figure until its prescribed eligibility is confirmed", () => {
    const pending = assessArticle5ATransfer({
      ...baseLot,
      acquisitionType: "inheritance",
      inheritanceDate: "2010-01-01",
      acquisitionValue: 150000,
      acquisitionValueBasis: "cm-declared",
    });
    expect(pending.methods).toEqual([]);
    expect(pending.warning).toContain("six-month");

    const confirmed = assessArticle5ATransfer({
      ...baseLot,
      acquisitionType: "inheritance",
      inheritanceDate: "2010-01-01",
      acquisitionValue: 150000,
      acquisitionValueBasis: "cm-declared",
      cmValueEligibilityConfirmed: true,
    });
    expect(confirmed.methods[0]).toMatchObject({
      key: "increase-12",
      basis: 50000,
      tax: 6000,
    });
  });

  it("calculates Housing Authority relief in statutory bands", () => {
    const result = assessArticle5ATransfer({
      ...baseLot,
      consideration: 250000,
      marketValue: 250000,
      qualifyingRate: "housing-tenant-10",
      housingCertificateConfirmed: true,
    });

    expect(result.methods[0]).toMatchObject({
      key: "housing-tenant-10",
      rule: "5A(5)(i)(i)",
      tax: 4000,
    });
  });

  it("covers Article 31C and deemed group-exit rates", () => {
    const article31C = assessArticle5ATransfer({
      ...baseLot,
      qualifyingRate: "article31c-10",
    });
    expect(article31C.methods[0]).toMatchObject({
      rule: "5A(5)(d)",
      rate: 0.1,
      tax: 20000,
    });

    const groupExit = assessArticle5ATransfer({
      ...baseLot,
      acquisitionDate: "2000-01-01",
      qualifyingRate: "group-exit",
    });
    expect(groupExit.methods[0]).toMatchObject({
      rule: "5A(12A)(e)",
      rate: 0.1,
      tax: 20000,
    });
  });

  it("flags the special partition deemed-transfer rule for manual review", () => {
    const result = assessArticle5ATransfer({
      ...baseLot,
      article5ASpecialTreatment: "review-partition-7a",
      specialTreatmentConfirmed: true,
    });
    expect(result).toMatchObject({
      status: "manual-review",
      requiresManualReview: true,
      appliedRule: "5A(7A)",
    });
    expect(result.methods).toEqual([]);
  });
});
