import { describe, expect, it } from "vitest";
import {
  intestacyAllocationSignature,
  intestateAllocations,
} from "../../src/domain/familyOwnership.js";
import { buildPropertyVendorTaxReport } from "../../src/domain/propertyVendorTax.js";

describe("property vendor tax reports", () => {
  it("lists the living heir as vendor and excludes the deceased person's tax lot", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "intestacy",
        spouseIds: [],
        siblingIds: [],
      },
      {
        id: "child",
        fullName: "Maria Borg",
        fatherId: "deceased",
        spouseIds: [],
        siblingIds: [],
      },
    ];
    const property = {
      id: "property",
      owners: [
        {
          id: "starting-owner",
          personId: "deceased",
          sharePercent: 100,
        },
      ],
      declarations: [],
      transfers: [],
      saleLots: [
        {
          id: "deceased-lot",
          ownerId: "deceased",
          inheritanceDate: "2010-01-01",
          transferDate: "2026-07-31",
          shareNumerator: 1,
          shareDenominator: 1,
          acquisitionValue: 100,
          acquisitionValueBasis: "market-at-inheritance",
          transferValue: 200,
          useDeclaredValues: false,
          selectedTaxMethod: "increase-12",
        },
        {
          id: "living-lot",
          ownerId: "child",
          inheritanceDate: "2020-01-01",
          transferDate: "2026-07-31",
          shareNumerator: 1,
          shareDenominator: 1,
          acquisitionValue: 100,
          acquisitionValueBasis: "market-at-inheritance",
          transferValue: 120,
          useDeclaredValues: false,
          selectedTaxMethod: "increase-12",
        },
      ],
    };

    const report = buildPropertyVendorTaxReport(property, people, []);
    expect(report.livingVendors.map((vendor) => vendor.id)).toEqual(["child"]);
    expect(report.taxSummary.vendors).toHaveLength(1);
    expect(report.taxSummary.vendors[0]).toMatchObject({
      id: "child",
      lotCount: 1,
      tax: 2.4,
    });
    expect(report.taxSummary.total).toBeCloseTo(2.4);
    expect(report.taxSummary.excludedLotCount).toBe(1);
  });

  it("keeps an unconnected company inherited under a will in the owner and vendor ledger", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        willHeirs: [{ id: "legacy", personId: "company", sharePercent: 100 }],
        spouseIds: [],
      },
    ];
    const outsideParties = [{ id: "company", name: "Legacy Holdings Limited", type: "company" }];
    const property = {
      id: "property",
      owners: [{ personId: "deceased", sharePercent: 100 }],
      transfers: [],
      declarations: [],
      saleLots: [],
    };

    const report = buildPropertyVendorTaxReport(property, people, outsideParties);

    expect(report.declarationOwners).toEqual([
      { id: "company", name: "Legacy Holdings Limited", share: 1 },
    ]);
    expect(report.ledger.owners[0]).toMatchObject({
      id: "company",
      name: "Legacy Holdings Limited",
      type: "company",
      share: 1,
    });
    expect(report.livingVendors.map((vendor) => vendor.id)).toEqual(["company"]);
  });

  it("carries a confirmed outside intestate heir through CM values and the vendor tax total", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "intestacy",
        spouseIds: [],
      },
      { id: "child", fullName: "Maria Borg", fatherId: "deceased", spouseIds: [] },
    ];
    const calculated = intestateAllocations(people, "deceased");
    people[0] = {
      ...people[0],
      intestateHeirs: [{ id: "company-heir", personId: "company", sharePercent: 100 }],
      intestateHeirsConfirmed: true,
      intestateConfirmationBasis: intestacyAllocationSignature(people[0], calculated),
    };
    const outsideParties = [{ id: "company", name: "Legacy Holdings Limited", type: "company" }];
    const property = {
      id: "property",
      owners: [{ personId: "deceased", sharePercent: 100 }],
      declarations: [
        {
          id: "published-cm",
          status: "published",
          participants: [{ heirId: "company", numerator: 1, denominator: 1, declaredValue: 100 }],
        },
      ],
      transfers: [],
      saleLots: [
        {
          id: "company-sale",
          ownerId: "company",
          inheritanceDate: "2020-01-01",
          transferDate: "2026-07-31",
          shareNumerator: 1,
          shareDenominator: 1,
          acquisitionValue: 0,
          acquisitionValueBasis: "cm-declared",
          cmValueEligibilityConfirmed: true,
          transferValue: 200,
          useDeclaredValues: true,
          selectedTaxMethod: "increase-12",
        },
      ],
    };

    const report = buildPropertyVendorTaxReport(property, people, outsideParties);

    expect(report.ownership.ownershipByParty.company).toBeCloseTo(1);
    expect(report.saleRows[0]).toMatchObject({
      usePublishedValues: true,
      effectiveLot: { acquisitionValue: 100 },
      result: {
        selected: "increase-12",
        methods: expect.arrayContaining([expect.objectContaining({ key: "increase-12", tax: 12 })]),
      },
    });
    expect(report.taxSummary.vendors).toEqual([
      expect.objectContaining({ id: "company", lotCount: 1, tax: 12 }),
    ]);
    expect(report.taxSummary.total).toBeCloseTo(12);
  });

  it("keeps a manually selected company assessment in the vendor report", () => {
    const property = {
      id: "property",
      owners: [{ id: "owner-record", personId: "owner", sharePercent: 100 }],
      declarations: [],
      transfers: [
        {
          id: "sale",
          sellerId: "owner",
          buyerId: "company",
          numerator: 1,
          denominator: 1,
          amountType: "whole-property",
        },
      ],
      saleLots: [
        {
          id: "company-lot",
          ownerId: "company",
          taxTreatment: "manual",
          inheritanceDate: "2020-01-01",
          transferDate: "2026-07-31",
          shareNumerator: 1,
          shareDenominator: 1,
          acquisitionValue: 100,
          transferValue: 500,
          manualTaxAmount: 35,
          selectedTaxMethod: "manual",
          useDeclaredValues: false,
        },
      ],
    };

    const report = buildPropertyVendorTaxReport(
      property,
      [{ id: "owner", fullName: "Joseph Borg" }],
      [{ id: "company", name: "Buyer Limited", type: "company" }],
    );

    expect(report.saleRows[0].lot.taxTreatment).toBe("manual");
    expect(report.saleRows[0].result).toMatchObject({
      selected: "manual",
      methods: [{ key: "manual", tax: 35 }],
    });
    expect(report.taxSummary.vendors[0].tax).toBe(35);
  });

  it("does not replace a tax lot with zero values from a legacy published declaration", () => {
    const property = {
      id: "property",
      owners: [{ id: "owner-record", personId: "owner", sharePercent: 100 }],
      declarations: [{ id: "legacy", status: "published", heirIds: ["owner"] }],
      transfers: [],
      saleLots: [
        {
          id: "owner-lot",
          ownerId: "owner",
          inheritanceDate: "2020-01-01",
          transferDate: "2026-07-31",
          shareNumerator: 1,
          shareDenominator: 1,
          acquisitionValue: 80,
          acquisitionValueBasis: "market-at-inheritance",
          transferValue: 120,
          useDeclaredValues: true,
          selectedTaxMethod: "increase-12",
        },
      ],
    };

    const report = buildPropertyVendorTaxReport(
      property,
      [{ id: "owner", fullName: "Joseph Borg" }],
      [],
    );
    expect(report.saleRows[0]).toMatchObject({
      usePublishedValues: false,
      effectiveLot: {
        acquisitionValue: 80,
        shareNumerator: 1,
        shareDenominator: 1,
      },
      declaredCoverage: {
        status: "invalid",
        hasUsablePublishedValues: false,
      },
    });
    expect(report.saleRows[0].result.methods[0].tax).toBeCloseTo(4.8);
  });

  it("uses valid positive published declaration values for the matching tax lot", () => {
    const property = {
      id: "property",
      owners: [{ id: "owner-record", personId: "owner", sharePercent: 100 }],
      declarations: [
        {
          id: "published",
          status: "published",
          participants: [{ heirId: "owner", numerator: 1, denominator: 1, declaredValue: 100 }],
        },
      ],
      transfers: [],
      saleLots: [
        {
          id: "owner-lot",
          ownerId: "owner",
          inheritanceDate: "2020-01-01",
          transferDate: "2026-07-31",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionValue: 50,
          transferValue: 120,
          useDeclaredValues: true,
          selectedTaxMethod: "increase-12",
          cmValueEligibilityConfirmed: true,
        },
      ],
    };

    const report = buildPropertyVendorTaxReport(
      property,
      [{ id: "owner", fullName: "Joseph Borg" }],
      [],
    );
    expect(report.saleRows[0]).toMatchObject({
      usePublishedValues: true,
      effectiveLot: {
        acquisitionValue: 100,
        shareNumerator: 1,
        shareDenominator: 1,
      },
      declaredCoverage: {
        status: "complete",
        hasUsablePublishedValues: true,
      },
    });
    expect(report.saleRows[0].result.methods[0].tax).toBeCloseTo(2.4);
  });
});
