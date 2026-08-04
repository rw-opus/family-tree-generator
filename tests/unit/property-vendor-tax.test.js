import { describe, expect, it } from "vitest";
import {
  intestacyAllocationSignature,
  intestateAllocations,
} from "../../src/domain/familyOwnership.js";
import {
  assignInitialOwnerPerson,
  buildPropertyVendorTaxReport,
  buildTaxCalculationReport,
  propertyStartingOwnershipStatus,
  remainingInitialOwnershipShare,
} from "../../src/domain/propertyVendorTax.js";

describe("property vendor tax reports", () => {
  it("defaults a selected initial owner to the exact unallocated title", () => {
    const owners = [
      {
        id: "first",
        personId: "person-a",
        shareNumerator: 1,
        shareDenominator: 3,
        sharePercent: 100 / 3,
      },
      {
        id: "second",
        personId: "",
        shareNumerator: 0,
        shareDenominator: 1,
        sharePercent: 0,
      },
    ];

    expect(remainingInitialOwnershipShare(owners, "second")).toMatchObject({
      shareNumerator: 2,
      shareDenominator: 3,
    });
    expect(assignInitialOwnerPerson(owners, "second", "person-b")[1]).toMatchObject({
      personId: "person-b",
      shareNumerator: 2,
      shareDenominator: 3,
    });
    expect(remainingInitialOwnershipShare([])).toMatchObject({
      shareNumerator: 1,
      shareDenominator: 1,
      sharePercent: 100,
    });
  });

  it("preserves an explicitly entered initial share when choosing its owner", () => {
    const owners = [
      {
        id: "owner",
        personId: "",
        shareNumerator: 1,
        shareDenominator: 4,
        sharePercent: 25,
      },
    ];

    expect(assignInitialOwnerPerson(owners, "owner", "person-a")[0]).toMatchObject({
      personId: "person-a",
      shareNumerator: 1,
      shareDenominator: 4,
      sharePercent: 25,
    });
  });

  it("requires exact full ownership rather than accepting a rounded near-total", () => {
    expect(
      propertyStartingOwnershipStatus({
        owners: [
          { personId: "a", shareNumerator: 1, shareDenominator: 3 },
          { personId: "b", shareNumerator: 2, shareDenominator: 3 },
        ],
      }).isComplete,
    ).toBe(true);
    expect(
      propertyStartingOwnershipStatus({
        owners: [
          { personId: "a", shareNumerator: 1, shareDenominator: 3 },
          { personId: "b", shareNumerator: 666666666665, shareDenominator: 999999999999 },
        ],
      }).isComplete,
    ).toBe(false);
  });

  it("distinguishes fractions entered from shares assigned to a named owner", () => {
    const status = propertyStartingOwnershipStatus({
      owners: [
        { personId: "a", shareNumerator: 11, shareDenominator: 12 },
        { personId: "", shareNumerator: 1, shareDenominator: 12 },
      ],
    });

    expect(status.totalFraction).toEqual({ numerator: 11, denominator: 12 });
    expect(status.enteredTotalFraction).toEqual({ numerator: 1, denominator: 1 });
    expect(status.enteredTotalPercent).toBe(100);
    expect(status.unassignedFraction).toEqual({ numerator: 1, denominator: 12 });
    expect(status.missingOwnerCount).toBe(1);
    expect(status.hasUnassignedOwners).toBe(true);
    expect(status.isComplete).toBe(false);
  });

  it("builds a read-only vendor row from the person-card CM declaration", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        willHeirs: [{ id: "share", personId: "child", sharePercent: 100 }],
        spouseIds: [],
        causaMortisDeclarations: [
          {
            id: "cm",
            propertyId: "property",
            status: "complete",
            declaredShareNumerator: 1,
            declaredShareDenominator: 1,
            immovablePropertyValue: "100000",
            date: "2020-04-01",
            notaryName: "Maria Notary",
            declarantPersonIds: ["child"],
          },
        ],
      },
      { id: "child", fullName: "Maria Borg", fatherId: "deceased", spouseIds: [] },
    ];
    const property = {
      id: "property",
      saleValue: "120000",
      owners: [{ personId: "deceased", sharePercent: 100 }],
      transfers: [],
      declarations: [],
      saleLots: [],
    };

    const report = buildTaxCalculationReport(property, people, []);

    expect(report.vendors[0]).toMatchObject({
      name: "Maria Borg",
      share: 1,
      attributedSaleValue: 120000,
      tax: 2400,
      net: 117600,
    });
    expect(report.vendors[0].rows[0]).toMatchObject({
      provenance: "Inherited from Joseph Borg",
      provenancePersonId: "deceased",
      declaredValue: 100000,
      difference: 20000,
      selectedMethod: { key: "increase-12" },
      tax: 2400,
    });
    expect(report.vendors[0].rows[0].methods.map((method) => method.key)).toEqual([
      "increase-12",
      "elected-whole-8",
    ]);
  });

  it("does not use an incomplete person-card CM declaration as a tax basis", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        dateOfDeath: "2020-01-01",
        causaMortisDeclarations: [
          {
            id: "unfinished",
            propertyId: "property",
            status: "draft",
            declaredShareNumerator: 1,
            declaredShareDenominator: 1,
            immovablePropertyValue: "",
            declarantPersonIds: ["child"],
          },
        ],
      },
      { id: "child", fullName: "Maria Borg" },
    ];
    const source = {
      deceasedId: "deceased",
      deceasedName: "Joseph Borg",
      ownerId: "child",
      inheritanceDate: "2020-01-01",
      share: 1,
      allocationShare: 1,
    };
    const vendorReport = {
      livingVendors: [{ id: "child", name: "Maria Borg", share: 1 }],
      saleRows: [],
      inheritanceSourcesByOwner: new Map([["child", [source]]]),
      ledger: { entries: [], parties: [] },
      taxSummary: { excludedLotCount: 0 },
    };

    const report = buildTaxCalculationReport(
      { id: "property", saleValue: 100000 },
      people,
      [],
      vendorReport,
    );
    const row = report.vendors[0].rows[0];

    expect(row.declarations).toEqual([]);
    expect(row.methods).toEqual([]);
    expect(row.warning).toMatch(/value.*needed|causa mortis/i);
    expect(report.vendors[0].tax).toBeNull();
    expect(report.vendors[0].net).toBeNull();
    expect(report.totalTax).toBeNull();
    expect(report.totalNet).toBeNull();
  });

  it("treats an explicit zero CM value as zero rather than falling back to a stored value", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        dateOfDeath: "2020-01-01",
        causaMortisDeclarations: [
          {
            id: "cm-zero",
            propertyId: "property",
            status: "complete",
            declaredShareNumerator: 1,
            declaredShareDenominator: 1,
            immovablePropertyValue: "0",
            date: "2020-02-01",
            notaryName: "Notary Zero",
            declarantPersonIds: ["child"],
          },
        ],
      },
      { id: "child", fullName: "Maria Borg" },
    ];
    const source = {
      deceasedId: "deceased",
      deceasedName: "Joseph Borg",
      ownerId: "child",
      inheritanceDate: "2020-01-01",
      share: 1,
      shareFraction: { numerator: 1, denominator: 1 },
      allocationShare: 1,
    };
    const vendorReport = {
      livingVendors: [
        {
          id: "child",
          name: "Maria Borg",
          share: 1,
          shareFraction: { numerator: 1, denominator: 1 },
        },
      ],
      saleRows: [
        {
          lot: { id: "lot", ownerId: "child", inheritanceSourceDeceasedId: "deceased" },
          effectiveLot: {
            shareNumerator: 1,
            shareDenominator: 1,
            acquisitionValue: 80000,
            inheritanceDate: "2020-01-01",
          },
          result: { share: 1 },
          selectedInheritanceSource: source,
        },
      ],
      inheritanceSourcesByOwner: new Map([["child", [source]]]),
      ledger: { entries: [], parties: [] },
      taxSummary: { excludedLotCount: 0 },
    };

    const report = buildTaxCalculationReport(
      { id: "property", saleValue: 100000 },
      people,
      [],
      vendorReport,
    );
    expect(report.vendors[0].rows[0].declaredValue).toBe(0);
  });

  it("attributes separate CM declarations only to their named declarants", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        dateOfDeath: "2020-01-01",
        causaMortisDeclarations: [
          {
            id: "cm-a",
            propertyId: "property",
            declaredShareNumerator: 1,
            declaredShareDenominator: 2,
            immovablePropertyValue: 100,
            date: "2020-02-01",
            notaryName: "Notary A",
            declarantPersonIds: ["a"],
          },
          {
            id: "cm-b",
            propertyId: "property",
            declaredShareNumerator: 1,
            declaredShareDenominator: 2,
            immovablePropertyValue: 200,
            date: "2020-03-01",
            notaryName: "Notary B",
            declarantPersonIds: ["b"],
          },
        ],
      },
      { id: "a", fullName: "Heir A" },
      { id: "b", fullName: "Heir B" },
    ];
    const sourceA = {
      deceasedId: "deceased",
      deceasedName: "Joseph Borg",
      ownerId: "a",
      inheritanceDate: "2020-01-01",
      share: 0.5,
      allocationShare: 0.5,
    };
    const sourceB = { ...sourceA, ownerId: "b" };
    const inheritanceSourcesByOwner = new Map([
      ["a", [sourceA]],
      ["b", [sourceB]],
    ]);
    const vendorReport = {
      livingVendors: [
        { id: "a", name: "Heir A", share: 0.5 },
        { id: "b", name: "Heir B", share: 0.5 },
      ],
      saleRows: [],
      inheritanceSourcesByOwner,
      ledger: { entries: [], parties: [] },
      taxSummary: { excludedLotCount: 0 },
    };

    const report = buildTaxCalculationReport(
      { id: "property", saleValue: 1000 },
      people,
      [],
      vendorReport,
    );

    expect(report.vendors[0].rows[0]).toMatchObject({
      declaredValue: 100,
      declarations: [{ id: "cm-a", declaredShare: 0.5, declaredValue: 100 }],
    });
    expect(report.vendors[1].rows[0]).toMatchObject({
      declaredValue: 200,
      declarations: [{ id: "cm-b", declaredShare: 0.5, declaredValue: 200 }],
    });
  });

  it("recalculates a legacy zero-share row after assigning the vendor's sole share", () => {
    const vendorReport = {
      livingVendors: [{ id: "vendor", name: "Vendor", share: 1 }],
      saleRows: [
        {
          lot: { id: "lot", ownerId: "vendor", acquisitionType: "inheritance" },
          effectiveLot: {
            id: "lot",
            ownerId: "vendor",
            acquisitionType: "inheritance",
            inheritanceDate: "2020-01-01",
            transferDate: "2026-08-01",
            shareNumerator: 0,
            shareDenominator: 1,
            acquisitionValue: 50000,
            transferValue: 0,
            cmValueEligibilityConfirmed: true,
          },
          result: { share: 0, transferValue: 0 },
          selectedInheritanceSource: null,
        },
      ],
      inheritanceSourcesByOwner: new Map(),
      ledger: { entries: [], parties: [] },
      taxSummary: { excludedLotCount: 0 },
    };

    const vendor = buildTaxCalculationReport(
      { id: "property", saleValue: 100000 },
      [],
      [],
      vendorReport,
    ).vendors[0];

    expect(vendor.rows[0]).toMatchObject({
      share: 1,
      attributedSaleValue: 100000,
      difference: 50000,
      tax: 6000,
      net: 94000,
    });
    expect(vendor).toMatchObject({ attributedSaleValue: 100000, tax: 6000, net: 94000 });
  });

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
    const deceasedWithRows = {
      ...people[0],
      intestateHeirs: [{ id: "child-share", personId: "child", sharePercent: 100 }],
    };
    people[0] = {
      ...deceasedWithRows,
      intestateHeirsConfirmed: true,
      intestateConfirmationBasis: intestacyAllocationSignature(deceasedWithRows, calculated),
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
    const grandparentWithRows = {
      ...people[0],
      intestateHeirs: [{ id: "child-share", personId: "child", sharePercent: 100 }],
    };
    people[0] = {
      ...grandparentWithRows,
      intestateHeirsConfirmed: true,
      intestateConfirmationBasis: intestacyAllocationSignature(grandparentWithRows, calculated),
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
      {
        id: "company",
        name: "Legacy Holdings Limited",
        share: 1,
        shareFraction: { numerator: 1, denominator: 1 },
      },
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
    const deceasedWithRows = {
      ...people[0],
      intestateHeirs: [{ id: "company-heir", personId: "company", sharePercent: 100 }],
    };
    people[0] = {
      ...deceasedWithRows,
      intestateHeirsConfirmed: true,
      intestateConfirmationBasis: intestacyAllocationSignature(deceasedWithRows, calculated),
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

  it("uses valid positive declaration values regardless of draft or published status", () => {
    const property = {
      id: "property",
      owners: [{ id: "owner-record", personId: "owner", sharePercent: 100 }],
      declarations: [
        {
          id: "recorded-dcm",
          status: "draft",
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
        hasUsableDeclaredValues: true,
        hasUsablePublishedValues: true,
      },
    });
    expect(report.saleRows[0].result.methods[0].tax).toBeCloseTo(2.4);
  });
});
