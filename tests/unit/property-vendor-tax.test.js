import { describe, expect, it } from "vitest";
import {
  intestacyAllocationSignature,
  intestateAllocations,
} from "../../src/domain/familyOwnership.js";
import { buildPropertyVendorTaxReport } from "../../src/domain/propertyVendorTax.js";

describe("property vendor tax reports", () => {
  it("automatically applies 7% when a child sells a share inherited before 25 November 1992", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "1992-11-24",
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
    const calculated = intestateAllocations(people, "deceased");
    people[0] = {
      ...people[0],
      intestateHeirs: [{ id: "child-share", personId: "child", sharePercent: 100 }],
      intestateHeirsConfirmed: true,
      intestateConfirmationBasis: intestacyAllocationSignature(people[0], calculated),
    };
    const property = {
      id: "property",
      owners: [{ personId: "deceased", sharePercent: 100 }],
      declarations: [
        {
          id: "invalid-pre-cutoff-cm",
          status: "published",
          participants: [{ heirId: "child", numerator: 1, denominator: 1, declaredValue: 100 }],
        },
      ],
      transfers: [],
      saleLots: [
        {
          id: "child-sale",
          ownerId: "child",
          acquisitionType: "inheritance",
          inheritanceDate: "",
          transferDate: "2026-07-31",
          shareNumerator: 1,
          shareDenominator: 1,
          acquisitionValue: 100,
          acquisitionValueBasis: "cm-declared",
          transferValue: 200,
          useDeclaredValues: true,
        },
      ],
    };

    const report = buildPropertyVendorTaxReport(property, people, []);
    const row = report.saleRows[0];

    expect(row).toMatchObject({
      inheritanceDateInferred: true,
      preCausaMortisCutoff: true,
      usePublishedValues: false,
      selectedInheritanceSource: {
        deceasedId: "deceased",
        inheritanceDate: "1992-11-24",
        immediateDescendant: true,
      },
      effectiveLot: {
        inheritanceDate: "1992-11-24",
        acquisitionValue: "",
        useDeclaredValues: false,
      },
      result: {
        selected: "inheritance-7",
        methods: [expect.objectContaining({ rate: 0.07, basis: 200 })],
      },
    });
    expect(row.result.methods[0].tax).toBeCloseTo(14);
    expect(report.causaMortisDeclarationOwners).toEqual([]);
    expect(report.taxSummary.total).toBeCloseTo(14);
  });

  it("does not carry the pre-1992 treatment through a later second succession", () => {
    const people = [
      {
        id: "grandparent",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "1992-11-24",
        inheritanceBasis: "intestacy",
        spouseIds: [],
      },
      {
        id: "child",
        fullName: "Paul Borg",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        fatherId: "grandparent",
        inheritanceBasis: "intestacy",
        spouseIds: [],
      },
      { id: "grandchild", fullName: "Maria Borg", fatherId: "child", spouseIds: [] },
    ];
    const calculated = intestateAllocations(people, "grandparent");
    people[0] = {
      ...people[0],
      intestateHeirs: [{ id: "child-share", personId: "child", sharePercent: 100 }],
      intestateHeirsConfirmed: true,
      intestateConfirmationBasis: intestacyAllocationSignature(people[0], calculated),
    };
    const property = {
      id: "property",
      owners: [{ personId: "grandparent", sharePercent: 100 }],
      declarations: [],
      transfers: [],
      saleLots: [
        {
          id: "grandchild-sale",
          ownerId: "grandchild",
          acquisitionType: "inheritance",
          inheritanceDate: "",
          transferDate: "2026-07-31",
          shareNumerator: 1,
          shareDenominator: 1,
          acquisitionValue: 100,
          acquisitionValueBasis: "market-at-inheritance",
          transferValue: 120,
          useDeclaredValues: false,
        },
      ],
    };

    const report = buildPropertyVendorTaxReport(property, people, []);

    expect(report.saleRows[0]).toMatchObject({
      preCausaMortisCutoff: false,
      selectedInheritanceSource: { deceasedId: "child", inheritanceDate: "2020-01-01" },
      effectiveLot: { inheritanceDate: "2020-01-01" },
    });
    expect(report.saleRows[0].result.methods.map((method) => method.key)).not.toContain(
      "inheritance-7",
    );
    expect(report.taxSummary.total).toBeCloseTo(2.4);
  });

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
