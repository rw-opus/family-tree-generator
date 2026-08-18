import { describe, expect, it } from "vitest";
import {
  intestacyAllocationSignature,
  intestateAllocations,
} from "../../src/domain/familyOwnership.js";
import {
  assignInitialOwnerPerson,
  buildPropertyVendorTaxReport,
  buildTaxCalculationReport,
  ownerProvenanceTranches,
  propertyStartingOwnershipStatus,
  provenanceLabel,
  remainingInitialOwnershipShare,
  setDonationAcquisitionValue,
  setLivingInitialOwnerAcquisitionDate,
} from "../../src/domain/propertyVendorTax.js";
import {
  appliedTaxMethodDescription,
  appliedTaxMethodDescriptions,
} from "../../src/domain/vendorSettlement.js";
import { addFractions, ZERO_FRACTION } from "../../src/domain/fractions.js";

describe("lifetime transfers before succession", () => {
  it("moves an inherited partial share to its buyer and passes only the balance to heirs", () => {
    const people = [
      {
        id: "ancestor",
        fullName: "Ancestor Borg",
        isDeceased: true,
        dateOfDeath: "2000-01-01",
        inheritanceBasis: "intestacy",
      },
      {
        id: "middle",
        fullName: "Middle Borg",
        fatherId: "ancestor",
        isDeceased: true,
        dateOfDeath: "2022-01-01",
        inheritanceBasis: "intestacy",
      },
      { id: "heir", fullName: "Heir Borg", fatherId: "middle" },
      { id: "buyer", fullName: "Buyer Vella" },
    ];
    const property = {
      id: "property",
      owners: [{ id: "initial", personId: "ancestor", sharePercent: 100 }],
      transfers: [
        {
          id: "sale",
          kind: "sale",
          sellerId: "middle",
          buyerId: "buyer",
          numerator: 1,
          denominator: 4,
          amountType: "whole-property",
          date: "2020-01-01",
          provenance: [
            {
              trancheId: "inheritance-ancestor",
              numerator: 1,
              denominator: 4,
              acquiredOn: "2000-01-01",
            },
          ],
        },
      ],
    };

    const report = buildPropertyVendorTaxReport(property, people, []);
    const owners = Object.fromEntries(
      report.ledger.owners.map((owner) => [owner.id, owner.shareFraction]),
    );
    const middleSuccession = report.ownership.transmissions.find(
      (transmission) => transmission.deceasedId === "middle",
    );

    expect(owners.buyer).toEqual({ numerator: 1, denominator: 4 });
    expect(owners.heir).toEqual({ numerator: 3, denominator: 4 });
    expect(middleSuccession.amountFraction).toEqual({ numerator: 3, denominator: 4 });
    expect(report.ledger.entries[0].error).toBeUndefined();
  });

  it("normalises a legacy relative transfer against the gross pre-death holding", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2022-01-01",
        inheritanceBasis: "intestacy",
      },
      { id: "heir", fullName: "Maria Borg", fatherId: "deceased" },
      { id: "buyer", fullName: "Paul Vella" },
    ];
    const property = {
      id: "property",
      owners: [{ id: "initial", personId: "deceased", sharePercent: 100 }],
      transfers: [
        {
          id: "legacy-sale",
          kind: "sale",
          sellerId: "deceased",
          buyerId: "buyer",
          numerator: 1,
          denominator: 2,
          amountType: "seller-holding",
          date: "2020-01-01",
        },
      ],
    };

    const report = buildPropertyVendorTaxReport(property, people, []);
    const owners = Object.fromEntries(report.ledger.owners.map((owner) => [owner.id, owner.share]));

    expect(owners.buyer).toBeCloseTo(0.5);
    expect(owners.heir).toBeCloseTo(0.5);
    expect(owners.deceased || 0).toBe(0);
  });
});

describe("tax calculation summary metadata", () => {
  it("does not report a completed zero total when there are no vendors", () => {
    const report = buildTaxCalculationReport(
      { id: "property", saleValue: 1000, owners: [], transfers: [], saleLots: [] },
      [],
      [],
    );

    expect(report).toMatchObject({
      vendors: [],
      totalSaleValue: null,
      totalTax: null,
      totalNet: null,
      totalsComplete: false,
      taxStatus: "pending",
    });
  });

  it("reports safe calculated subtotals without presenting an incomplete grand total", () => {
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 1000,
      owners: [
        {
          id: "first-title",
          personId: "first-owner",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2020-01-01",
        },
        {
          id: "second-title",
          personId: "second-owner",
          shareNumerator: 1,
          shareDenominator: 2,
        },
      ],
      transfers: [],
      declarations: [],
      saleLots: [],
    };
    const report = buildTaxCalculationReport(
      property,
      [
        { id: "first-owner", fullName: "Maria Borg", spouseIds: [] },
        { id: "second-owner", fullName: "Joseph Borg", spouseIds: [] },
      ],
      [],
    );
    const firstVendor = report.vendors.find((vendor) => vendor.id === "first-owner");
    const secondVendor = report.vendors.find((vendor) => vendor.id === "second-owner");

    expect(firstVendor).toMatchObject({
      taxStatus: "complete",
      completeSourceCount: 1,
      incompleteSourceCount: 0,
      calculatedSaleValueSubtotal: 500,
      calculatedTaxSubtotal: 40,
      calculatedNetSubtotal: 460,
      unassessedSaleValue: 0,
    });
    expect(secondVendor).toMatchObject({
      taxStatus: "pending",
      completeSourceCount: 0,
      incompleteSourceCount: 1,
      calculatedSaleValueSubtotal: 0,
      calculatedTaxSubtotal: 0,
      calculatedNetSubtotal: 0,
      unassessedSaleValue: 500,
    });
    expect(report).toMatchObject({
      taxStatus: "partial",
      totalSaleValue: 1000,
      totalTax: null,
      totalNet: null,
      totalsComplete: false,
      completeSourceCount: 1,
      incompleteSourceCount: 1,
      calculatedSaleValueSubtotal: 500,
      calculatedTaxSubtotal: 40,
      calculatedNetSubtotal: 460,
      unassessedSaleValue: 500,
    });
  });

  it("does not turn a missing selling value into an assessed zero-value source", () => {
    const report = buildTaxCalculationReport(
      {
        id: "property",
        saleValue: "",
        owners: [
          {
            id: "title",
            personId: "owner",
            sharePercent: 100,
            acquisitionDate: "2020-01-01",
          },
        ],
        transfers: [],
        declarations: [],
        saleLots: [],
      },
      [{ id: "owner", fullName: "Maria Borg", spouseIds: [] }],
      [],
    );

    expect(report).toMatchObject({
      taxStatus: "pending",
      completeSourceCount: 0,
      incompleteSourceCount: 1,
      calculatedSaleValueSubtotal: 0,
      calculatedTaxSubtotal: 0,
      calculatedNetSubtotal: 0,
      unassessedSaleValue: null,
      totalTax: null,
      totalNet: null,
    });
  });

  it("describes flat, blended, exempt and manual methods without inventing a rate", () => {
    const flat = { label: "8% of transfer value", rate: 0.08 };
    const blended = { label: "Housing relief: half rate on first €200,000", rate: null };
    const exempt = { label: "Exempt qualifying family donation", rate: null };
    const manual = { label: "Manual assessment", rate: null };

    expect(appliedTaxMethodDescription(flat)).toBe("8% of transfer value");
    expect(appliedTaxMethodDescription(blended)).toBe(
      "Housing relief: half rate on first €200,000",
    );
    expect(appliedTaxMethodDescription(exempt)).toBe("Exempt qualifying family donation");
    expect(appliedTaxMethodDescription(manual)).toBe("Manual assessment");
    expect(appliedTaxMethodDescription({ rule: "5A(4)(a)" })).toBe("Rule 5A(4)(a)");
    expect(
      appliedTaxMethodDescriptions([
        { selectedMethod: flat },
        { selectedMethod: flat },
        { selectedMethod: blended },
        { selectedMethod: null },
      ]),
    ).toEqual(["8% of transfer value", "Housing relief: half rate on first €200,000"]);
  });
});

describe("owner provenance tranches", () => {
  const report = {
    inheritanceSourcesByOwner: new Map([
      [
        "heir",
        [
          {
            deceasedId: "father",
            deceasedName: "Joseph Borg",
            inheritanceDate: "2015-03-01",
            shareFraction: { numerator: 1, denominator: 4 },
          },
        ],
      ],
    ]),
    ledger: {
      parties: [{ id: "aunt", name: "Carmen Vella" }],
      entries: [
        {
          id: "gift",
          kind: "donation",
          sellerId: "aunt",
          buyerId: "heir",
          date: "2020-06-01",
          amountFraction: { numerator: 1, denominator: 8 },
        },
      ],
    },
  };
  const property = {
    owners: [{ id: "row-1", personId: "heir", sharePercent: 50 }],
    transfers: [],
  };

  it("lists initial ownership, inheritances and incoming transfers as acquisitions", () => {
    const tranches = ownerProvenanceTranches(report, property, "heir");
    expect(tranches.map((tranche) => tranche.provenance)).toEqual([
      "Initial ownership",
      "Inherited from Joseph Borg",
      "Donated by Carmen Vella",
    ]);
    expect(tranches.map((tranche) => tranche.acquiredOn)).toEqual(["", "2015-03-01", "2020-06-01"]);
  });

  it("consumes acquisitions already sold with a recorded provenance", () => {
    const soldFirstInheritance = {
      ...property,
      transfers: [
        {
          id: "first-sale",
          sellerId: "heir",
          buyerId: "someone",
          provenance: [{ trancheId: "inheritance-father", numerator: 1, denominator: 4 }],
        },
      ],
    };
    const tranches = ownerProvenanceTranches(report, soldFirstInheritance, "heir");
    // The first sale exhausted the inheritance, so it is no longer offered.
    expect(tranches.map((tranche) => tranche.provenance)).toEqual([
      "Initial ownership",
      "Donated by Carmen Vella",
    ]);
  });

  it("renders an exact duplicate provenance once without changing its fraction", () => {
    const repeatedSuccession = {
      ...report,
      inheritanceSourcesByOwner: new Map([
        [
          "heir",
          [
            {
              deceasedId: "father",
              deceasedName: "Joseph Borg",
              inheritanceDate: "2015-03-01",
              shareFraction: { numerator: 1, denominator: 8 },
            },
            {
              deceasedId: "father",
              deceasedName: "Joseph Borg",
              inheritanceDate: "2015-03-01",
              shareFraction: { numerator: 1, denominator: 8 },
            },
            {
              deceasedId: "mother",
              deceasedName: "Maria Borg",
              inheritanceDate: "2018-04-02",
              shareFraction: { numerator: 1, denominator: 16 },
            },
            {
              deceasedId: "mother",
              deceasedName: "Maria Borg",
              inheritanceDate: "2018-04-02",
              shareFraction: { numerator: 1, denominator: 16 },
            },
          ],
        ],
      ]),
      ledger: { parties: [], entries: [] },
    };
    const inheritedOnlyProperty = { owners: [], transfers: [] };

    const tranches = ownerProvenanceTranches(repeatedSuccession, inheritedOnlyProperty, "heir");

    expect(tranches).toHaveLength(2);
    expect(tranches.filter((tranche) => tranche.trancheId === "inheritance-father")).toEqual([
      expect.objectContaining({ fraction: { numerator: 1, denominator: 8 } }),
    ]);
    expect(tranches.filter((tranche) => tranche.trancheId === "inheritance-mother")).toEqual([
      expect.objectContaining({ fraction: { numerator: 1, denominator: 16 } }),
    ]);
  });

  it("consumes a saved designation once after an exact duplicate is suppressed", () => {
    const repeatedSuccession = {
      ...report,
      inheritanceSourcesByOwner: new Map([
        [
          "heir",
          [
            {
              deceasedId: "father",
              deceasedName: "Joseph Borg",
              inheritanceDate: "2015-03-01",
              shareFraction: { numerator: 1, denominator: 2 },
            },
            {
              deceasedId: "father",
              deceasedName: "Joseph Borg",
              inheritanceDate: "2015-03-01",
              shareFraction: { numerator: 1, denominator: 2 },
            },
          ],
        ],
      ]),
    };
    const propertyAfterTransfer = {
      owners: [],
      transfers: [
        {
          sellerId: "heir",
          provenance: [{ trancheId: "inheritance-father", numerator: 1, denominator: 4 }],
        },
      ],
    };

    const tranches = ownerProvenanceTranches(repeatedSuccession, propertyAfterTransfer, "heir");

    expect(tranches).toEqual([
      expect.objectContaining({
        trancheId: "inheritance-father",
        fraction: { numerator: 1, denominator: 4 },
      }),
      expect.objectContaining({ trancheId: "transfer-gift" }),
    ]);
  });
});

describe("donation look-through", () => {
  const people = [
    {
      id: "grandfather",
      fullName: "Joseph Borg",
      isDeceased: true,
      dateOfDeath: "2001-05-10",
      inheritanceBasis: "intestacy",
      spouseIds: [],
    },
    { id: "donor", fullName: "Paul Borg", fatherId: "grandfather", spouseIds: [] },
    { id: "donee", fullName: "Maria Borg", spouseIds: [] },
  ];
  const property = {
    id: "property",
    saleValue: 300000,
    owners: [{ id: "o1", personId: "grandfather", sharePercent: 100 }],
    declarations: [],
    transfers: [
      {
        id: "gift",
        kind: "donation",
        sellerId: "donor",
        buyerId: "donee",
        numerator: 1,
        denominator: 1,
        amountType: "seller-holding",
        date: "2024-03-01",
      },
    ],
    saleLots: [
      {
        id: "resale",
        ownerId: "donee",
        transferDate: "2026-07-31",
        shareNumerator: 1,
        shareDenominator: 1,
        consideration: 300000,
        marketValue: 300000,
      },
    ],
  };

  it("derives the donor's acquisition date from the recorded donation", () => {
    const report = buildPropertyVendorTaxReport(property, people, []);
    const donations = report.donationSourcesByOwner.get("donee");
    expect(donations).toHaveLength(1);
    // The donor himself acquired on his father's death, so that is the look-through date.
    expect(donations[0]).toMatchObject({
      donorName: "Paul Borg",
      donationDate: "2024-03-01",
      donorAcquisitionDate: "2001-05-10",
    });

    const row = report.saleRows[0];
    expect(row.effectiveLot).toMatchObject({
      acquisitionType: "donation",
      acquisitionDate: "2024-03-01",
      previousAcquisitionDate: "2001-05-10",
    });
    expect(row.donationDatesDerived).toBe(true);
    // Donated in 2024 and sold in 2026 is inside five years, so the donor's pre-2004
    // acquisition sets the rate at 10% rather than the donation date's 8%.
    expect(row.result.methods[0]).toMatchObject({ key: "whole-10", rate: 0.1 });
  });

  it("leaves the date for the notary when the donor's own acquisition is ambiguous", () => {
    const twoWayDonor = {
      ...property,
      owners: [
        { id: "o1", personId: "grandfather", sharePercent: 50 },
        { id: "o2", personId: "donee", sharePercent: 50 },
      ],
      transfers: [
        // The donor buys a quarter from the donee in 2018, on top of what he inherited.
        {
          id: "bought",
          sellerId: "donee",
          buyerId: "donor",
          numerator: 1,
          denominator: 4,
          amountType: "whole-property",
          date: "2018-09-09",
        },
        ...property.transfers,
      ],
    };
    const report = buildPropertyVendorTaxReport(twoWayDonor, people, []);
    // The donor holds an inherited share and a purchased share, so no single date can be
    // relied upon and nothing is filled in automatically.
    expect(report.donationSourcesByOwner.get("donee")[0].donorAcquisitionDate).toBe("");
  });
});

describe("provenance labels", () => {
  const ledger = {
    parties: [{ id: "donor", name: "Joseph Borg" }],
    entries: [{ id: "gift", kind: "donation", sellerId: "donor", buyerId: "donee" }],
  };

  it("names the donor when the share arrived by donation", () => {
    expect(provenanceLabel(null, { ownerId: "donee" }, ledger)).toBe("Donated by Joseph Borg");
  });

  it("keeps the acquisition wording for ordinary transfers", () => {
    const saleLedger = {
      ...ledger,
      entries: [{ id: "sale", sellerId: "donor", buyerId: "donee" }],
    };
    expect(provenanceLabel(null, { ownerId: "donee" }, saleLedger)).toBe(
      "Acquired from Joseph Borg",
    );
  });
});

describe("property vendor tax reports", () => {
  it("accepts an original acquisition date for an outside company owner", () => {
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 250000,
      owners: [
        {
          id: "company-title",
          personId: "company",
          shareNumerator: 1,
          shareDenominator: 1,
        },
      ],
      transfers: [],
      saleLots: [],
    };
    const outsideParties = [{ id: "company", name: "Harbour Holdings Limited", type: "company" }];

    const updated = setLivingInitialOwnerAcquisitionDate(
      property,
      [],
      "company",
      "2010-01-01",
      outsideParties,
      "company-title",
    );

    expect(updated.error).toBe("");
    expect(updated.property.owners[0].acquisitionDate).toBe("2010-01-01");
    const vendor = buildTaxCalculationReport(updated.property, [], outsideParties).vendors[0];
    expect(vendor).toMatchObject({ id: "company", tax: 20000 });
  });

  it("resolves a living original owner's exact initial fraction from its acquisition date", () => {
    const people = [{ id: "owner", fullName: "Maria Borg" }];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 250000,
      owners: [
        {
          id: "original-title",
          personId: "owner",
          shareNumerator: 5,
          shareDenominator: 12,
        },
      ],
      transfers: [],
      saleLots: [],
    };

    const pending = buildTaxCalculationReport(property, people, []).vendors[0].rows[0];
    expect(pending).toMatchObject({
      provenance: "Initial ownership",
      shareFraction: { numerator: 5, denominator: 12 },
      acquisitionDate: "",
      requiresOriginalAcquisitionDate: true,
      selectedMethod: null,
    });
    expect(pending.warning).toBe("Enter the acquisition date.");

    const updated = setLivingInitialOwnerAcquisitionDate(property, people, "owner", "2010-01-01");
    expect(updated.error).toBe("");
    expect(updated.property.owners[0].acquisitionDate).toBe("2010-01-01");

    const vendor = buildTaxCalculationReport(updated.property, people, []).vendors[0];
    expect(vendor.rows[0]).toMatchObject({
      provenance: "Initial ownership",
      shareFraction: { numerator: 5, denominator: 12 },
      acquisitionDate: "2010-01-01",
      requiresOriginalAcquisitionDate: false,
      selectedMethod: { key: "whole-8" },
    });
    expect(vendor.tax).toBeCloseTo((250000 * 5 * 0.08) / 12);
  });

  it("calculates a current buyer's purchased tranche from the recorded transfer date", () => {
    const people = [
      { id: "seller", fullName: "Joseph Borg" },
      { id: "buyer", fullName: "Maria Vella" },
    ];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 200000,
      owners: [{ id: "original-title", personId: "seller", sharePercent: 100 }],
      transfers: [
        {
          id: "purchase",
          kind: "sale",
          sellerId: "seller",
          buyerId: "buyer",
          numerator: 1,
          denominator: 1,
          amountType: "seller-holding",
          date: "2020-01-01",
        },
      ],
      saleLots: [],
    };

    const vendor = buildTaxCalculationReport(property, people, []).vendors.find(
      (candidate) => candidate.id === "buyer",
    );

    expect(vendor.rows).toHaveLength(1);
    expect(vendor.rows[0]).toMatchObject({
      provenance: "Acquired from Joseph Borg",
      provenancePersonId: "seller",
      provenancePersonName: "Joseph Borg",
      sourceKind: "purchase",
      acquisitionDate: "2020-01-01",
      shareFraction: { numerator: 1, denominator: 1 },
      selectedMethod: { key: "whole-8" },
    });
    expect(vendor.incompleteRowCount).toBe(0);
    expect(vendor.tax).toBeCloseTo(16000);
  });

  it("resolves a donee's pending look-through after the former original owner enters a date", () => {
    const people = [
      { id: "donor", fullName: "Joseph Borg" },
      { id: "donee", fullName: "Maria Vella" },
    ];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 200000,
      owners: [{ id: "original-title", personId: "donor", sharePercent: 100 }],
      transfers: [
        {
          id: "gift",
          kind: "donation",
          sellerId: "donor",
          buyerId: "donee",
          numerator: 1,
          denominator: 1,
          amountType: "seller-holding",
          date: "2024-01-01",
        },
      ],
      saleLots: [],
    };

    const pendingVendor = buildTaxCalculationReport(property, people, []).vendors.find(
      (candidate) => candidate.id === "donee",
    );
    expect(pendingVendor.rows[0]).toMatchObject({
      provenance: "Donated by Joseph Borg",
      provenancePersonId: "donor",
      provenancePersonName: "Joseph Borg",
      sourceKind: "donation",
      originalOwnerRecordId: "original-title",
      acquisitionDate: "2024-01-01",
      donorAcquisitionDate: "",
      requiresDonorAcquisitionDate: true,
      selectedMethod: null,
    });
    expect(pendingVendor.rows[0].warning).toMatch(/donor's preceding acquisition date/i);

    const storedProperty = {
      ...property,
      saleLots: [
        {
          id: "stored-recent-gift",
          ownerId: "donee",
          acquisitionType: "donation",
          acquisitionDate: "",
          previousAcquisitionDate: "",
          transferDate: "2026-08-13",
          shareNumerator: 1,
          shareDenominator: 1,
          transferValue: 200000,
        },
      ],
    };
    const storedPendingRow = buildTaxCalculationReport(storedProperty, people, []).vendors.find(
      (candidate) => candidate.id === "donee",
    ).rows[0];
    expect(storedPendingRow).toMatchObject({
      id: "stored-recent-gift",
      sourceKind: "donation",
      sourceTransferId: "gift",
      originalOwnerRecordId: "original-title",
      provenancePersonId: "donor",
      requiresDonorAcquisitionDate: true,
      selectedMethod: null,
    });

    const updated = setLivingInitialOwnerAcquisitionDate(
      property,
      people,
      "donor",
      "2000-01-01",
      [],
      "original-title",
    );
    expect(updated.error).toBe("");
    expect(updated.property.owners[0].acquisitionDate).toBe("2000-01-01");

    const resolvedVendor = buildTaxCalculationReport(updated.property, people, []).vendors.find(
      (candidate) => candidate.id === "donee",
    );
    expect(resolvedVendor.rows[0]).toMatchObject({
      sourceKind: "donation",
      donorAcquisitionDate: "2000-01-01",
      donorAcquisitionDateDerived: true,
      requiresDonorAcquisitionDate: false,
      selectedMethod: { key: "whole-10" },
    });
    expect(resolvedVendor.incompleteRowCount).toBe(0);
    expect(resolvedVendor.tax).toBeCloseTo(20000);
    const storedResolvedRow = buildTaxCalculationReport(
      { ...updated.property, saleLots: storedProperty.saleLots },
      people,
      [],
    ).vendors.find((candidate) => candidate.id === "donee").rows[0];
    expect(storedResolvedRow).toMatchObject({
      requiresDonorAcquisitionDate: false,
      donorAcquisitionDate: "2000-01-01",
      selectedMethod: { key: "whole-10" },
    });
  });

  it("requires and then applies a donation-date acquisition value after five years", () => {
    const people = [
      { id: "donor", fullName: "Joseph Borg" },
      { id: "donee", fullName: "Maria Vella" },
    ];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 200000,
      owners: [
        {
          id: "title",
          personId: "donor",
          sharePercent: 100,
          acquisitionDate: "2000-01-01",
        },
      ],
      transfers: [
        {
          id: "gift",
          kind: "donation",
          sellerId: "donor",
          buyerId: "donee",
          numerator: 1,
          denominator: 1,
          amountType: "seller-holding",
          date: "2020-01-01",
        },
      ],
      saleLots: [],
    };

    const pending = buildTaxCalculationReport(property, people, []).vendors[0];
    expect(pending.rows[0]).toMatchObject({
      sourceKind: "donation",
      sourceTransferId: "gift",
      requiresDonationAcquisitionValue: true,
      requiresDonorAcquisitionDate: false,
      selectedMethod: null,
    });
    expect(pending.rows[0].warning).toMatch(/Donation Value stated in the contract/i);

    const storedProperty = {
      ...property,
      saleLots: [
        {
          id: "stored-old-gift",
          ownerId: "donee",
          acquisitionType: "donation",
          acquisitionDate: "",
          previousAcquisitionDate: "",
          transferDate: "2026-08-13",
          shareNumerator: 1,
          shareDenominator: 1,
          acquisitionValue: "",
          acquisitionValueBasis: "",
          transferValue: 200000,
        },
      ],
    };
    const storedPendingRow = buildTaxCalculationReport(storedProperty, people, []).vendors[0]
      .rows[0];
    expect(storedPendingRow).toMatchObject({
      id: "stored-old-gift",
      sourceKind: "donation",
      sourceTransferId: "gift",
      requiresDonationAcquisitionValue: true,
      requiresDonorAcquisitionDate: false,
      selectedMethod: null,
    });

    for (const blankValue of ["", null]) {
      const blankProperty = {
        ...property,
        transfers: [
          {
            ...property.transfers[0],
            acquisitionValue: blankValue,
            acquisitionValueBasis: "",
          },
        ],
      };
      const blankRow = buildTaxCalculationReport(blankProperty, people, []).vendors[0].rows[0];
      expect(blankRow).toMatchObject({
        requiresDonationAcquisitionValue: true,
        selectedMethod: null,
      });
    }

    const zeroWithoutBasis = {
      ...property,
      transfers: [{ ...property.transfers[0], acquisitionValue: 0 }],
    };
    expect(
      buildTaxCalculationReport(zeroWithoutBasis, people, []).vendors[0].rows[0],
    ).toMatchObject({
      declaredValue: 0,
      requiresDonationAcquisitionValue: true,
      selectedMethod: null,
    });

    const zeroWithBasis = {
      ...property,
      transfers: [
        {
          ...property.transfers[0],
          acquisitionValue: 0,
          acquisitionValueBasis: "market-at-donation",
        },
      ],
    };
    expect(buildTaxCalculationReport(zeroWithBasis, people, []).vendors[0].rows[0]).toMatchObject({
      declaredValue: 0,
      requiresDonationAcquisitionValue: false,
      selectedMethod: { key: "elected-whole-10" },
    });

    const updated = setDonationAcquisitionValue(
      property,
      "donee",
      "gift",
      100000,
      "market-at-donation",
    );
    expect(updated.error).toBe("");
    expect(updated.property.transfers[0]).toMatchObject({
      acquisitionValue: 100000,
      acquisitionValueBasis: "market-at-donation",
    });
    const resolved = buildTaxCalculationReport(updated.property, people, []).vendors[0];
    expect(resolved.rows[0]).toMatchObject({
      sourceTransferId: "gift",
      declaredValue: 100000,
      requiresDonationAcquisitionValue: false,
      selectedMethod: { key: "increase-12" },
    });
    expect(resolved.rows[0].tax).toBeCloseTo(12000);
    const storedResolvedRow = buildTaxCalculationReport(
      {
        ...updated.property,
        saleLots: storedProperty.saleLots,
      },
      people,
      [],
    ).vendors[0].rows[0];
    expect(storedResolvedRow).toMatchObject({
      requiresDonationAcquisitionValue: false,
      selectedMethod: { key: "increase-12" },
    });
  });

  it("does not require a donation acquisition value within five years", () => {
    const people = [
      {
        id: "donor",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2025-01-01",
      },
      { id: "donee", fullName: "Maria Vella" },
    ];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 200000,
      owners: [
        {
          id: "title",
          personId: "donor",
          sharePercent: 100,
          acquisitionDate: "2000-01-01",
        },
      ],
      transfers: [
        {
          id: "gift",
          kind: "donation",
          sellerId: "donor",
          buyerId: "donee",
          numerator: 1,
          denominator: 1,
          amountType: "seller-holding",
          date: "2024-01-01",
        },
      ],
      saleLots: [],
    };

    const row = buildTaxCalculationReport(property, people, []).vendors[0].rows[0];
    expect(row).toMatchObject({
      sourceTransferId: "gift",
      provenancePersonDeceased: true,
      requiresDonationAcquisitionValue: false,
      declaredValue: "",
      selectedMethod: { key: "whole-10" },
    });
  });

  it("apportions one donation value to the exact current remainder", () => {
    const people = [
      { id: "donor", fullName: "Joseph Borg" },
      { id: "donee", fullName: "Maria Vella" },
      { id: "buyer", fullName: "Paul Galea" },
    ];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 300000,
      owners: [
        {
          id: "title",
          personId: "donor",
          sharePercent: 100,
          acquisitionDate: "2000-01-01",
        },
      ],
      transfers: [
        {
          id: "gift",
          kind: "donation",
          sellerId: "donor",
          buyerId: "donee",
          numerator: 1,
          denominator: 1,
          amountType: "seller-holding",
          date: "2019-01-01",
          acquisitionValue: 120000,
          acquisitionValueBasis: "deed-value",
        },
        {
          id: "partial-sale",
          kind: "sale",
          sellerId: "donee",
          buyerId: "buyer",
          numerator: 1,
          denominator: 4,
          amountType: "whole-property",
          date: "2022-01-01",
        },
      ],
      saleLots: [],
    };

    const donee = buildTaxCalculationReport(property, people, []).vendors.find(
      (candidate) => candidate.id === "donee",
    );
    expect(donee.shareFraction).toEqual({ numerator: 3, denominator: 4 });
    expect(donee.rows[0]).toMatchObject({
      sourceTransferId: "gift",
      shareFraction: { numerator: 3, denominator: 4 },
      declaredValue: 90000,
      selectedMethod: { key: "increase-12" },
    });
  });

  it("updates only the targeted donation and rejects sales or the wrong donee", () => {
    const property = {
      transfers: [
        { id: "first", kind: "donation", buyerId: "donee-a" },
        { id: "second", kind: "donation", buyerId: "donee-b" },
        { id: "sale", kind: "sale", buyerId: "donee-a" },
      ],
    };

    const updated = setDonationAcquisitionValue(
      property,
      "donee-b",
      "second",
      45000,
      "final-assessment",
    );
    expect(updated.error).toBe("");
    expect(updated.property.transfers).toEqual([
      property.transfers[0],
      expect.objectContaining({
        id: "second",
        acquisitionValue: 45000,
        acquisitionValueBasis: "final-assessment",
      }),
      property.transfers[2],
    ]);
    expect(
      setDonationAcquisitionValue(property, "donee-a", "sale", 100, "deed-value").error,
    ).toMatch(/only.*donation/i);
    expect(
      setDonationAcquisitionValue(property, "donee-a", "second", 100, "deed-value").error,
    ).toMatch(/could not be found/i);
    expect(
      setDonationAcquisitionValue(property, "donee-a", "first", -1, "deed-value").error,
    ).toMatch(/valid donation acquisition value/i);
    expect(
      setDonationAcquisitionValue(property, "donee-a", "first", 100, "cm-declared").error,
    ).toMatch(/market value.*deed value.*final assessment/i);
  });

  it("keeps a living owner's initial and inherited fractions as separate tax sources", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        willDate: "2019-12-01",
        willHeirs: [{ id: "legacy", personId: "owner", sharePercent: 100 }],
        spouseIds: [],
      },
      { id: "owner", fullName: "Maria Borg" },
    ];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 240000,
      owners: [
        {
          id: "living-half",
          personId: "owner",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2010-01-01",
        },
        {
          id: "deceased-half",
          personId: "deceased",
          shareNumerator: 1,
          shareDenominator: 2,
        },
      ],
      transfers: [],
      saleLots: [],
    };

    const vendor = buildTaxCalculationReport(property, people, []).vendors[0];

    expect(vendor.shareFraction).toEqual({ numerator: 1, denominator: 1 });
    expect(vendor.rows).toHaveLength(2);
    expect(vendor.rows[0]).toMatchObject({
      provenance: "Initial ownership",
      shareFraction: { numerator: 1, denominator: 2 },
      acquisitionDate: "2010-01-01",
      selectedMethod: { key: "whole-8" },
    });
    expect(vendor.rows[1]).toMatchObject({
      provenance: "Inherited from Joseph Borg",
      provenancePersonId: "deceased",
      shareFraction: { numerator: 1, denominator: 2 },
      inheritanceDate: "2020-01-01",
      selectedMethod: null,
    });
    expect(vendor.incompleteRowCount).toBe(1);
    expect(vendor.tax).toBeNull();
  });

  it("synthesizes exact residual initial and inherited fractions beside a stored legacy lot", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "1990-01-01",
        inheritanceBasis: "will",
        willDate: "1989-12-01",
        willHeirs: [{ id: "legacy", personId: "vendor", sharePercent: 100 }],
        spouseIds: [],
      },
      { id: "vendor", fullName: "Maria Borg" },
    ];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 240000,
      owners: [
        {
          id: "living-half",
          personId: "vendor",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2010-01-01",
        },
        {
          id: "deceased-half",
          personId: "deceased",
          shareNumerator: 1,
          shareDenominator: 2,
        },
      ],
      transfers: [],
      saleLots: [
        {
          id: "legacy-inherited-quarter",
          ownerId: "vendor",
          acquisitionType: "inheritance",
          inheritanceSourceDeceasedId: "deceased",
          transferDate: "2026-08-13",
          shareNumerator: 1,
          shareDenominator: 4,
          transferValue: 60000,
        },
      ],
    };

    const vendor = buildTaxCalculationReport(property, people, []).vendors[0];
    const fractions = vendor.rows.map((row) => row.shareFraction);

    expect(vendor.rows).toHaveLength(3);
    expect(fractions).toEqual([
      { numerator: 1, denominator: 4 },
      { numerator: 1, denominator: 2 },
      { numerator: 1, denominator: 4 },
    ]);
    expect(
      fractions.reduce((total, fraction) => addFractions(total, fraction), ZERO_FRACTION),
    ).toEqual({ numerator: 1, denominator: 1 });
    expect(vendor.rows.map((row) => row.provenance)).toEqual([
      "Inherited from Joseph Borg",
      "Initial ownership",
      "Inherited from Joseph Borg",
    ]);
    expect(vendor.rows.map((row) => row.selectedMethod?.key)).toEqual([
      "inheritance-7",
      "whole-8",
      "inheritance-7",
    ]);
    expect(vendor.incompleteRowCount).toBe(0);
  });

  it("clamps an oversized stored inherited lot to its exact current provenance fraction", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "1990-01-01",
        inheritanceBasis: "will",
        willDate: "1989-12-01",
        willHeirs: [{ id: "legacy", personId: "vendor", sharePercent: 100 }],
        spouseIds: [],
      },
      { id: "vendor", fullName: "Maria Borg" },
    ];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 240000,
      owners: [
        {
          id: "living-half",
          personId: "vendor",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2010-01-01",
        },
        {
          id: "deceased-half",
          personId: "deceased",
          shareNumerator: 1,
          shareDenominator: 2,
        },
      ],
      transfers: [],
      saleLots: [
        {
          id: "oversized-inherited-lot",
          ownerId: "vendor",
          acquisitionType: "inheritance",
          inheritanceSourceDeceasedId: "deceased",
          transferDate: "2026-08-13",
          shareNumerator: 3,
          shareDenominator: 4,
          transferValue: 180000,
        },
      ],
    };

    const vendor = buildTaxCalculationReport(property, people, []).vendors[0];

    expect(vendor.rows).toHaveLength(2);
    expect(vendor.rows[0]).toMatchObject({
      shareFraction: { numerator: 1, denominator: 2 },
      selectedMethod: null,
      tax: null,
      net: null,
    });
    expect(vendor.rows[0].warning).toMatch(/records 3\/4.*only 1\/2.*Correct/i);
    expect(vendor.rows[1]).toMatchObject({
      provenance: "Initial ownership",
      shareFraction: { numerator: 1, denominator: 2 },
      selectedMethod: { key: "whole-8" },
    });
    expect(
      vendor.rows.reduce((total, row) => addFractions(total, row.shareFraction), ZERO_FRACTION),
    ).toEqual({ numerator: 1, denominator: 1 });
    expect(vendor.incompleteRowCount).toBe(1);
    expect(vendor.tax).toBeNull();
    expect(vendor).toMatchObject({
      taxStatus: "partial",
      completeSourceCount: 1,
      incompleteSourceCount: 1,
      calculatedSaleValueSubtotal: 120000,
      calculatedTaxSubtotal: 9600,
      calculatedNetSubtotal: 110400,
      unassessedSaleValue: 120000,
    });
  });

  it("fills a matched legacy purchase lot from the saved original-owner acquisition date", () => {
    const people = [{ id: "owner", fullName: "Maria Borg" }];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 200000,
      owners: [{ id: "title", personId: "owner", sharePercent: 100 }],
      transfers: [],
      saleLots: [
        {
          id: "legacy-purchase",
          ownerId: "owner",
          acquisitionType: "purchase",
          acquisitionDate: "",
          transferDate: "2026-08-13",
          shareNumerator: 1,
          shareDenominator: 1,
          transferValue: 200000,
        },
      ],
    };

    const pending = buildTaxCalculationReport(property, people, []).vendors[0];
    expect(pending.rows[0]).toMatchObject({
      sourceKind: "initial",
      originalOwnerId: "owner",
      originalOwnerRecordId: "title",
      requiresOriginalAcquisitionDate: true,
      selectedMethod: null,
    });
    expect(pending.rows[0].warning).toBe("Enter the acquisition date.");

    const updated = setLivingInitialOwnerAcquisitionDate(
      property,
      people,
      "owner",
      "2010-01-01",
      [],
      "title",
    );
    const resolved = buildTaxCalculationReport(updated.property, people, []).vendors[0];

    expect(resolved.rows).toHaveLength(1);
    expect(resolved.rows[0]).toMatchObject({
      shareFraction: { numerator: 1, denominator: 1 },
      acquisitionDate: "2010-01-01",
      requiresOriginalAcquisitionDate: false,
      selectedMethod: { key: "whole-8" },
    });
    expect(resolved.incompleteRowCount).toBe(0);
    expect(resolved.tax).toBeCloseTo(16000);
  });

  it("records separate acquisition dates for separate original-title fractions", () => {
    const people = [{ id: "owner", fullName: "Maria Borg" }];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 200000,
      owners: [
        {
          id: "first-title",
          personId: "owner",
          shareNumerator: 1,
          shareDenominator: 2,
        },
        {
          id: "second-title",
          personId: "owner",
          shareNumerator: 1,
          shareDenominator: 2,
        },
      ],
      transfers: [],
      saleLots: [],
    };

    const updated = setLivingInitialOwnerAcquisitionDate(
      property,
      people,
      "owner",
      "2010-01-01",
      [],
      "first-title",
    );

    expect(updated.error).toBe("");
    expect(updated.property.owners).toEqual([
      expect.objectContaining({ id: "first-title", acquisitionDate: "2010-01-01" }),
      expect.not.objectContaining({ acquisitionDate: expect.anything() }),
    ]);
    const vendor = buildTaxCalculationReport(updated.property, people, []).vendors[0];
    expect(vendor.rows).toHaveLength(2);
    expect(vendor.rows.map((row) => row.originalOwnerRecordId)).toEqual([
      "first-title",
      "second-title",
    ]);
    expect(vendor.rows.map((row) => row.selectedMethod?.key || null)).toEqual(["whole-8", null]);
  });

  it("does not accept an original acquisition date for a deceased or non-original owner", () => {
    const property = {
      id: "property",
      owners: [{ id: "title", personId: "deceased", sharePercent: 100 }],
      transfers: [],
    };
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "intestacy",
        unmarriedOrWidowedAtDeath: true,
        spouseIds: [],
      },
      { id: "heir", fullName: "Maria Borg", fatherId: "deceased" },
    ];

    expect(
      setLivingInitialOwnerAcquisitionDate(property, people, "deceased", "2010-01-01"),
    ).toMatchObject({ error: expect.stringMatching(/date of death.*CM/i) });
    expect(
      setLivingInitialOwnerAcquisitionDate(property, people, "heir", "2010-01-01"),
    ).toMatchObject({ error: expect.stringMatching(/not recorded as an original owner/i) });

    const inheritedRow = buildTaxCalculationReport(property, people, []).vendors[0].rows[0];
    expect(inheritedRow).toMatchObject({
      provenance: "Inherited from Joseph Borg",
      provenancePersonId: "deceased",
      inheritanceDate: "2020-01-01",
    });
    expect(inheritedRow).not.toHaveProperty("requiresOriginalAcquisitionDate", true);
  });

  it("accepts a deceased original donor's historic acquisition date only for their recorded lifetime gift", () => {
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      owners: [{ id: "donor-title", personId: "donor", sharePercent: 100 }],
      transfers: [
        {
          id: "gift",
          kind: "donation",
          sellerId: "donor",
          buyerId: "donee",
          date: "2018-01-01",
          sharePercent: 100,
        },
      ],
    };
    const people = [
      {
        id: "donor",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
      },
      { id: "donee", fullName: "Maria Borg" },
    ];

    const updated = setLivingInitialOwnerAcquisitionDate(
      property,
      people,
      "donor",
      "2010-01-01",
      [],
      "donor-title",
      "gift",
    );
    expect(updated.error).toBe("");
    expect(updated.property.owners[0].acquisitionDate).toBe("2010-01-01");

    expect(
      setLivingInitialOwnerAcquisitionDate(
        property,
        people,
        "donor",
        "2019-01-01",
        [],
        "donor-title",
        "gift",
      ),
    ).toMatchObject({ error: expect.stringMatching(/after the donation date/i) });
    expect(
      setLivingInitialOwnerAcquisitionDate(
        property,
        people,
        "donor",
        "2010-01-01",
        [],
        "donor-title",
        "missing-gift",
      ),
    ).toMatchObject({ error: expect.stringMatching(/date of death.*CM/i) });
  });

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
        willDate: "2019-12-01",
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
            status: "complete",
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
            status: "complete",
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

  it("allocates a joint CM value proportionately and confines its excess to its declarants", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        willDate: "2019-12-01",
        willHeirs: [
          { id: "a-share", personId: "a", shareNumerator: 1, shareDenominator: 2 },
          { id: "b-share", personId: "b", shareNumerator: 1, shareDenominator: 4 },
          { id: "c-share", personId: "c", shareNumerator: 1, shareDenominator: 4 },
        ],
        spouseIds: [],
        causaMortisDeclarations: [
          {
            id: "cm-ab",
            status: "complete",
            propertyId: "property",
            declaredShareNumerator: 1,
            declaredShareDenominator: 1,
            immovablePropertyValue: "1200",
            date: "2020-04-01",
            notaryName: "Maria Vella",
            declarantPersonIds: ["a", "b"],
          },
          {
            id: "filled-draft-c",
            status: "draft",
            propertyId: "property",
            declaredShareNumerator: 1,
            declaredShareDenominator: 4,
            immovablePropertyValue: "300",
            date: "2020-05-01",
            notaryName: "Paul Galea",
            declarantPersonIds: ["c"],
          },
        ],
      },
      { id: "a", fullName: "Heir A" },
      { id: "b", fullName: "Heir B" },
      { id: "c", fullName: "Heir C" },
    ];
    const property = {
      id: "property",
      saleValue: 120000,
      owners: [{ id: "initial", personId: "deceased", sharePercent: 100 }],
      transfers: [],
      declarations: [],
      saleLots: [
        {
          id: "stale-c-lot",
          ownerId: "c",
          acquisitionType: "inheritance",
          inheritanceDate: "",
          transferDate: "2026-08-11",
          shareNumerator: 1,
          shareDenominator: 4,
          acquisitionValue: 999,
          acquisitionValueBasis: "cm-declared",
          cmValueEligibilityConfirmed: true,
          useDeclaredValues: true,
          selectedTaxMethod: "increase-12",
        },
      ],
    };

    const report = buildTaxCalculationReport(property, people, []);
    const vendorA = report.vendors.find((vendor) => vendor.id === "a");
    const vendorB = report.vendors.find((vendor) => vendor.id === "b");
    const vendorC = report.vendors.find((vendor) => vendor.id === "c");

    expect(vendorA.rows[0]).toMatchObject({
      declaredValue: 600,
      declarations: [
        {
          id: "cm-ab",
          recordedDeclaredShare: 2 / 3,
          recordedDeclaredValue: 800,
          declaredShare: 1 / 2,
          declaredShareFraction: { numerator: 1, denominator: 2 },
          declaredValue: 600,
          assessmentFactor: 3 / 4,
        },
      ],
    });
    expect(vendorB.rows[0]).toMatchObject({
      declaredValue: 300,
      declarations: [
        {
          id: "cm-ab",
          recordedDeclaredShare: 1 / 3,
          recordedDeclaredValue: 400,
          declaredShare: 1 / 4,
          declaredShareFraction: { numerator: 1, denominator: 4 },
          declaredValue: 300,
          assessmentFactor: 3 / 4,
        },
      ],
    });
    expect(vendorC.rows[0]).toMatchObject({
      declaredValue: "",
      declarations: [],
      methods: [],
      selectedMethod: null,
    });
    expect(vendorC.tax).toBeNull();
  });

  it("proportionately caps each modern deed when several deeds exceed one inherited share", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        dateOfDeath: "2020-01-01",
        causaMortisDeclarations: [
          {
            id: "cm-first",
            status: "complete",
            propertyId: "property",
            declaredShareNumerator: 1,
            declaredShareDenominator: 2,
            immovablePropertyValue: "600",
            date: "2020-02-01",
            notaryName: "Notary One",
            declarantPersonIds: ["child"],
          },
          {
            id: "cm-additional",
            status: "complete",
            propertyId: "property",
            declaredShareNumerator: 1,
            declaredShareDenominator: 4,
            immovablePropertyValue: "300",
            date: "2020-03-01",
            notaryName: "Notary Two",
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
      share: 0.5,
      shareFraction: { numerator: 1, denominator: 2 },
      allocationShare: 1,
    };
    const vendorReport = {
      livingVendors: [
        {
          id: "child",
          name: "Maria Borg",
          share: 0.5,
          shareFraction: { numerator: 1, denominator: 2 },
        },
      ],
      saleRows: [],
      inheritanceSourcesByOwner: new Map([["child", [source]]]),
      ledger: { entries: [], parties: [] },
      taxSummary: { excludedLotCount: 0 },
    };

    const report = buildTaxCalculationReport(
      { id: "property", saleValue: 2000 },
      people,
      [],
      vendorReport,
    );
    const declarations = report.vendors[0].rows[0].declarations;

    expect(declarations).toEqual([
      expect.objectContaining({
        id: "cm-first",
        recordedDeclaredValue: 600,
        declaredShareFraction: { numerator: 1, denominator: 3 },
        declaredValue: 400,
        assessmentFactor: 2 / 3,
      }),
      expect.objectContaining({
        id: "cm-additional",
        recordedDeclaredValue: 300,
        declaredShareFraction: { numerator: 1, denominator: 6 },
        declaredValue: 200,
        assessmentFactor: 2 / 3,
      }),
    ]);
    expect(report.vendors[0].rows[0].declaredValue).toBe(600);
    expect(report.vendors[0].rows[0]).toMatchObject({
      attributedSaleValue: 1000,
      selectedMethod: { key: "increase-12", tax: 48 },
      tax: 48,
    });
  });

  it("uses only the CM value attributable to stored rows sold from an inherited source", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        dateOfDeath: "2020-01-01",
        causaMortisDeclarations: [
          {
            id: "cm",
            status: "complete",
            propertyId: "property",
            declaredShareNumerator: 1,
            declaredShareDenominator: 2,
            immovablePropertyValue: "100000",
            date: "2020-02-01",
            notaryName: "Notary One",
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
      share: 0.5,
      shareFraction: { numerator: 1, denominator: 2 },
    };
    const storedRow = (id) => ({
      lot: {
        id,
        ownerId: "child",
        inheritanceSourceDeceasedId: "deceased",
        shareNumerator: 1,
        shareDenominator: 4,
      },
      effectiveLot: {
        id,
        ownerId: "child",
        acquisitionType: "inheritance",
        inheritanceDate: "2020-01-01",
        transferDate: "2026-08-01",
        shareNumerator: 1,
        shareDenominator: 4,
      },
      result: { share: 0.25 },
      selectedInheritanceSource: source,
    });
    const vendorReport = (rows, share) => ({
      livingVendors: [
        {
          id: "child",
          name: "Maria Borg",
          share,
          shareFraction: share === 0.5 ? { numerator: 1, denominator: 2 } : undefined,
        },
      ],
      saleRows: rows,
      inheritanceSourcesByOwner: new Map([["child", [source]]]),
      ledger: { entries: [], parties: [] },
      taxSummary: { excludedLotCount: 0 },
    });

    const partialReport = buildTaxCalculationReport(
      { id: "property", saleValue: 200000 },
      people,
      [],
      vendorReport([storedRow("partial")], 0.25),
    );
    expect(partialReport.vendors[0].rows[0]).toMatchObject({
      shareFraction: { numerator: 1, denominator: 4 },
      declaredValue: 50000,
      declarations: [
        {
          recordedDeclaredValue: 100000,
          declaredShareFraction: { numerator: 1, denominator: 4 },
          declaredValue: 50000,
          assessmentFactor: 0.5,
        },
      ],
    });

    const splitReport = buildTaxCalculationReport(
      { id: "property", saleValue: 200000 },
      people,
      [],
      vendorReport([storedRow("first-quarter"), storedRow("second-quarter")], 0.5),
    );
    expect(splitReport.vendors[0].rows.map((row) => row.declaredValue)).toEqual([50000, 50000]);
    expect(splitReport.vendors[0].rows.reduce((total, row) => total + row.declaredValue, 0)).toBe(
      100000,
    );

    const underDeclaredPeople = [
      {
        ...people[0],
        causaMortisDeclarations: [
          {
            ...people[0].causaMortisDeclarations[0],
            declaredShareNumerator: 1,
            declaredShareDenominator: 4,
            immovablePropertyValue: "50000",
          },
        ],
      },
      people[1],
    ];
    const underDeclaredReport = buildTaxCalculationReport(
      { id: "property", saleValue: 200000 },
      underDeclaredPeople,
      [],
      vendorReport([storedRow("under-first"), storedRow("under-second")], 0.5),
    );
    expect(underDeclaredReport.vendors[0].rows.map((row) => row.declaredValue)).toEqual([
      25000, 25000,
    ]);
    expect(
      underDeclaredReport.vendors[0].rows.reduce((total, row) => total + row.declaredValue, 0),
    ).toBe(50000);
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
        willDate: "2019-12-01",
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
          date: "2021-01-01",
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

  it("keeps a legacy excess declaration with its named heir without expanding ownership", () => {
    const property = {
      id: "property",
      owners: [
        { id: "owner-a", personId: "a", shareNumerator: 1, shareDenominator: 2 },
        { id: "owner-b", personId: "b", shareNumerator: 1, shareDenominator: 2 },
      ],
      declarations: [
        {
          id: "excess-a",
          participants: [{ heirId: "a", numerator: 3, denominator: 4, declaredValue: 300 }],
        },
      ],
      transfers: [],
      saleLots: [
        {
          id: "a-lot",
          ownerId: "a",
          inheritanceDate: "2020-01-01",
          transferDate: "2026-08-11",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionValue: 0,
          transferValue: 500,
          useDeclaredValues: true,
          cmValueEligibilityConfirmed: true,
        },
        {
          id: "b-lot",
          ownerId: "b",
          inheritanceDate: "2020-01-01",
          transferDate: "2026-08-11",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionValue: 0,
          useDeclaredValues: true,
          cmValueEligibilityConfirmed: true,
        },
      ],
    };

    const report = buildPropertyVendorTaxReport(
      property,
      [
        { id: "a", fullName: "Heir A" },
        { id: "b", fullName: "Heir B" },
      ],
      [],
    );
    const rowA = report.saleRows.find((row) => row.lot.ownerId === "a");
    const rowB = report.saleRows.find((row) => row.lot.ownerId === "b");

    expect(rowA).toMatchObject({
      useDeclarationValues: true,
      declaredCoverage: { status: "over", hasUsableDeclaredValues: true },
      assessedDeclaredFraction: { numerator: 1, denominator: 2 },
      assessedDeclaredValue: 200,
      declarationAssessmentFactor: 2 / 3,
      effectiveLot: {
        acquisitionValue: 200,
        shareNumerator: 1,
        shareDenominator: 2,
      },
    });
    expect(rowB).toMatchObject({
      useDeclarationValues: false,
      declaredCoverage: { status: "under", declaredValue: "" },
    });
    expect(rowA.result).toMatchObject({
      selected: "increase-12",
      methods: expect.arrayContaining([expect.objectContaining({ key: "increase-12", tax: 36 })]),
    });
  });

  it("keeps a completed CM fraction with no value while leaving its tax pending", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        willDate: "2019-12-01",
        willHeirs: [{ id: "share", personId: "child", sharePercent: 100 }],
        causaMortisDeclarations: [
          {
            id: "cm-without-value",
            propertyId: "property",
            status: "complete",
            declaredShareNumerator: 1,
            declaredShareDenominator: 1,
            immovablePropertyValue: "",
            date: "2020-04-01",
            notaryName: "Maria Notary",
            declarantPersonIds: ["child"],
          },
        ],
        spouseIds: [],
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
    const vendor = report.vendors[0];
    const row = vendor.rows[0];

    expect(vendor).toMatchObject({ id: "child", share: 1, tax: null, net: null });
    expect(row).toMatchObject({
      share: 1,
      declaredValue: "",
      requiresCausaMortisAcquisitionValue: true,
      difference: null,
      selectedMethod: null,
      tax: null,
      net: null,
    });
    expect(row.declarations[0]).toMatchObject({
      id: "cm-without-value",
      declaredShare: 1,
      declaredValue: "",
      hasDeclaredValue: false,
    });
    expect(row.warning).toMatch(/causa mortis acquisition value/i);
    expect(report).toMatchObject({ totalTax: null, totalNet: null, totalsComplete: false });

    const storedProperty = {
      ...property,
      saleLots: [
        {
          id: "stored-inherited-lot",
          ownerId: "child",
          acquisitionType: "inheritance",
          inheritanceSourceDeceasedId: "deceased",
          transferDate: "2026-08-13",
          shareNumerator: 1,
          shareDenominator: 1,
          acquisitionValue: "",
          acquisitionValueBasis: "cm-declared",
          cmValueEligibilityConfirmed: true,
          transferValue: 120000,
        },
      ],
    };
    const storedRow = buildTaxCalculationReport(storedProperty, people, []).vendors[0].rows[0];
    expect(storedRow).toMatchObject({
      id: "stored-inherited-lot",
      sourceKind: "inheritance",
      provenancePersonId: "deceased",
      requiresCausaMortisAcquisitionValue: true,
      selectedMethod: null,
    });

    const noSellingValueRow = buildTaxCalculationReport({ ...property, saleValue: "" }, people, [])
      .vendors[0].rows[0];
    expect(noSellingValueRow.warning).toMatch(/consideration or market value/i);
    expect(noSellingValueRow.requiresCausaMortisAcquisitionValue).toBe(true);

    people[0].causaMortisDeclarations[0].immovablePropertyValue = "0";
    const zeroValueRow = buildTaxCalculationReport(property, people, []).vendors[0].rows[0];
    expect(zeroValueRow).toMatchObject({
      declaredValue: 0,
      requiresCausaMortisAcquisitionValue: false,
    });
    const storedZeroValueRow = buildTaxCalculationReport(storedProperty, people, []).vendors[0]
      .rows[0];
    expect(storedZeroValueRow).toMatchObject({
      requiresCausaMortisAcquisitionValue: false,
    });
  });

  it("keeps gift source requirements visible while the selling value is blank", () => {
    const people = [
      { id: "donor", fullName: "Joseph Borg" },
      { id: "donee", fullName: "Maria Vella" },
    ];
    const oldGift = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: "",
      owners: [
        {
          id: "donor-title",
          personId: "donor",
          sharePercent: 100,
          acquisitionDate: "2000-01-01",
        },
      ],
      transfers: [
        {
          id: "old-gift",
          kind: "donation",
          sellerId: "donor",
          buyerId: "donee",
          numerator: 1,
          denominator: 1,
          amountType: "seller-holding",
          date: "2020-01-01",
          acquisitionValue: "",
          acquisitionValueBasis: "",
        },
      ],
      declarations: [],
      saleLots: [],
    };
    const oldGiftRow = buildTaxCalculationReport(oldGift, people, []).vendors[0].rows[0];

    expect(oldGiftRow.warning).toMatch(/consideration or market value/i);
    expect(oldGiftRow).toMatchObject({
      sourceKind: "donation",
      requiresDonationAcquisitionValue: true,
      requiresDonorAcquisitionDate: false,
    });

    const recentGift = {
      ...oldGift,
      owners: [{ ...oldGift.owners[0], acquisitionDate: "" }],
      transfers: [{ ...oldGift.transfers[0], id: "recent-gift", date: "2024-01-01" }],
    };
    const recentGiftRow = buildTaxCalculationReport(recentGift, people, []).vendors[0].rows[0];

    expect(recentGiftRow.warning).toMatch(/consideration or market value/i);
    expect(recentGiftRow).toMatchObject({
      sourceKind: "donation",
      requiresDonationAcquisitionValue: false,
      requiresDonorAcquisitionDate: true,
    });
  });

  it("apportions one recorded Donation Value across split stored lots", () => {
    const people = [
      { id: "donor", fullName: "Joseph Borg" },
      { id: "donee", fullName: "Maria Vella" },
    ];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 200000,
      owners: [
        {
          id: "title",
          personId: "donor",
          sharePercent: 100,
          acquisitionDate: "2000-01-01",
        },
      ],
      transfers: [
        {
          id: "gift",
          kind: "donation",
          sellerId: "donor",
          buyerId: "donee",
          numerator: 1,
          denominator: 1,
          amountType: "seller-holding",
          date: "2020-01-01",
          acquisitionValue: 100000,
          acquisitionValueBasis: "deed-value",
        },
      ],
      saleLots: ["first", "second"].map((id) => ({
        id,
        ownerId: "donee",
        acquisitionType: "donation",
        acquisitionDate: "2020-01-01",
        previousAcquisitionDate: "2000-01-01",
        transferDate: "2026-08-13",
        shareNumerator: 1,
        shareDenominator: 2,
      })),
    };

    const vendor = buildTaxCalculationReport(property, people, []).vendors[0];

    expect(vendor.rows.map((row) => row.declaredValue)).toEqual([50000, 50000]);
    expect(vendor.rows.map((row) => row.tax)).toEqual([6000, 6000]);
    expect(vendor.tax).toBe(12000);
  });

  it("assesses different donor acquisition tranches separately from one aggregate legacy lot", () => {
    const people = [
      { id: "donor", fullName: "Joseph Borg" },
      { id: "donee", fullName: "Maria Vella" },
    ];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 200000,
      owners: [
        {
          id: "title-old",
          personId: "donor",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2000-01-01",
        },
        {
          id: "title-new",
          personId: "donor",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2010-01-01",
        },
      ],
      transfers: [
        {
          id: "gift",
          kind: "donation",
          sellerId: "donor",
          buyerId: "donee",
          numerator: 1,
          denominator: 1,
          amountType: "seller-holding",
          date: "2024-01-01",
          acquisitionValue: 100000,
          acquisitionValueBasis: "deed-value",
        },
      ],
      saleLots: [
        {
          id: "legacy-aggregate",
          ownerId: "donee",
          acquisitionType: "donation",
          acquisitionDate: "2024-01-01",
          transferDate: "2026-08-13",
          shareNumerator: 1,
          shareDenominator: 1,
          acquisitionValue: 100000,
          acquisitionValueBasis: "deed-value",
          transferValue: 200000,
        },
      ],
    };

    const report = buildTaxCalculationReport(property, people, []);
    const vendor = report.vendors[0];

    expect(report.ignoredStoredTaxLotCount).toBe(1);
    expect(vendor.ignoredStoredTaxLots).toEqual([
      expect.objectContaining({
        id: "legacy-aggregate",
        reason: expect.stringMatching(/preceding/),
      }),
    ]);
    expect(vendor.rows).toHaveLength(2);
    expect(vendor.rows.map((row) => row.donorAcquisitionDate)).toEqual([
      "2000-01-01",
      "2010-01-01",
    ]);
    expect(vendor.rows.map((row) => row.tax)).toEqual([10000, 8000]);
    expect(vendor.tax).toBe(18000);
  });

  it("preserves confirmed treatment when an aggregate gift designates each donor tranche", () => {
    const people = [
      { id: "donor", fullName: "Joseph Borg" },
      { id: "donee", fullName: "Maria Vella" },
    ];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 200000,
      owners: [
        {
          id: "title-old",
          personId: "donor",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2000-01-01",
        },
        {
          id: "title-new",
          personId: "donor",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2010-01-01",
        },
      ],
      transfers: [
        {
          id: "gift",
          kind: "donation",
          sellerId: "donor",
          buyerId: "donee",
          numerator: 1,
          denominator: 1,
          amountType: "seller-holding",
          date: "2024-01-01",
          acquisitionValue: 100000,
          acquisitionValueBasis: "deed-value",
          provenance: [
            {
              trancheId: "initial-title-old",
              acquiredOn: "2000-01-01",
              numerator: 1,
              denominator: 2,
            },
            {
              trancheId: "initial-title-new",
              acquiredOn: "2010-01-01",
              numerator: 1,
              denominator: 2,
            },
          ],
        },
      ],
      saleLots: [
        {
          id: "legacy-aggregate",
          ownerId: "donee",
          acquisitionType: "donation",
          acquisitionDate: "2024-01-01",
          transferDate: "2026-08-13",
          shareNumerator: 1,
          shareDenominator: 1,
          acquisitionValue: 100000,
          acquisitionValueBasis: "deed-value",
          transferValue: 200000,
          article5ASpecialTreatment: "exempt-own-residence",
          specialTreatmentConfirmed: true,
        },
      ],
    };

    const report = buildTaxCalculationReport(property, people, []);
    const vendor = report.vendors[0];

    expect(report.ignoredStoredTaxLotCount).toBe(0);
    expect(vendor.rows).toHaveLength(2);
    expect(vendor.rows.map((row) => row.originalOwnerRecordId)).toEqual(["title-old", "title-new"]);
    expect(vendor.rows.map((row) => row.donorAcquisitionDate)).toEqual([
      "2000-01-01",
      "2010-01-01",
    ]);
    expect(vendor.rows.map((row) => row.selectedMethod?.key)).toEqual([
      "exempt-own-residence",
      "exempt-own-residence",
    ]);
    expect(vendor.tax).toBe(0);
    expect(report.totalsComplete).toBe(true);
  });

  it("never spreads an explicitly sourced donation lot across unrelated gifts", () => {
    const people = [
      { id: "donor-a", fullName: "Donor A" },
      { id: "donor-b", fullName: "Donor B" },
      { id: "vendor", fullName: "Vendor" },
    ];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 200000,
      owners: [
        {
          id: "title-a",
          personId: "donor-a",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2000-01-01",
        },
        {
          id: "title-b",
          personId: "donor-b",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2001-01-01",
        },
      ],
      transfers: [
        {
          id: "gift-a",
          kind: "donation",
          sellerId: "donor-a",
          buyerId: "vendor",
          numerator: 1,
          denominator: 2,
          amountType: "whole-property",
          date: "2020-01-01",
          acquisitionValue: 50000,
          acquisitionValueBasis: "deed-value",
        },
        {
          id: "gift-b",
          kind: "donation",
          sellerId: "donor-b",
          buyerId: "vendor",
          numerator: 1,
          denominator: 2,
          amountType: "whole-property",
          date: "2021-01-01",
          acquisitionValue: 50000,
          acquisitionValueBasis: "deed-value",
        },
      ],
      saleLots: [
        {
          id: "gift-a-only",
          ownerId: "vendor",
          acquisitionType: "donation",
          donationSourceKey: "gift-a:",
          acquisitionDate: "2020-01-01",
          transferDate: "2026-08-13",
          shareNumerator: 1,
          shareDenominator: 1,
          acquisitionValue: 100000,
          acquisitionValueBasis: "deed-value",
          article5ASpecialTreatment: "exempt-own-residence",
          specialTreatmentConfirmed: true,
        },
      ],
    };

    const report = buildTaxCalculationReport(property, people, []);
    const vendor = report.vendors[0];
    const explicitGift = vendor.rows.find((row) => row.id === "gift-a-only");
    const otherGift = vendor.rows.find((row) => row.sourceTransferId === "gift-b");

    expect(vendor.rows).toHaveLength(2);
    expect(explicitGift).toMatchObject({
      sourceTransferId: "gift-a",
      selectedMethod: null,
      tax: null,
      warning: expect.stringMatching(/only 1\/2 is supported/i),
    });
    expect(otherGift).toMatchObject({
      sourceTransferId: "gift-b",
      tax: 6000,
    });
    expect(otherGift.selectedMethod?.key).not.toBe("exempt-own-residence");
    expect(report.totalTax).toBeNull();
  });

  it("apportions every deed value when one legacy donation lot expands by source", () => {
    const people = [
      { id: "donor-a", fullName: "Donor A" },
      { id: "donor-b", fullName: "Donor B" },
      { id: "vendor", fullName: "Vendor" },
    ];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: "",
      owners: [
        {
          id: "title-a",
          personId: "donor-a",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2000-01-01",
        },
        {
          id: "title-b",
          personId: "donor-b",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2001-01-01",
        },
      ],
      transfers: [
        {
          id: "gift-a",
          kind: "donation",
          sellerId: "donor-a",
          buyerId: "vendor",
          numerator: 1,
          denominator: 2,
          amountType: "whole-property",
          date: "2020-01-01",
          acquisitionValue: 50000,
          acquisitionValueBasis: "deed-value",
        },
        {
          id: "gift-b",
          kind: "donation",
          sellerId: "donor-b",
          buyerId: "vendor",
          numerator: 1,
          denominator: 2,
          amountType: "whole-property",
          date: "2021-01-01",
          acquisitionValue: 50000,
          acquisitionValueBasis: "deed-value",
        },
      ],
      saleLots: [
        {
          id: "legacy-combined",
          ownerId: "vendor",
          acquisitionType: "donation",
          transferDate: "2026-08-13",
          shareNumerator: 1,
          shareDenominator: 1,
          consideration: 200000,
          marketValue: 200000,
          acquisitionValue: 100000,
          acquisitionValueBasis: "deed-value",
        },
      ],
    };

    const report = buildTaxCalculationReport(property, people, []);

    expect(report.vendors[0].rows.map((row) => row.attributedSaleValue)).toEqual([100000, 100000]);
    expect(report.totalSaleValue).toBe(200000);
    expect(report.totalTax).toBe(12000);
  });

  it("keeps missing deed values blank when an aggregate donation lot expands by source", () => {
    const people = [
      { id: "donor-a", fullName: "Donor A" },
      { id: "donor-b", fullName: "Donor B" },
      { id: "vendor", fullName: "Vendor" },
    ];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: "",
      owners: [
        {
          id: "title-a",
          personId: "donor-a",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2000-01-01",
        },
        {
          id: "title-b",
          personId: "donor-b",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2001-01-01",
        },
      ],
      transfers: [
        {
          id: "gift-a",
          kind: "donation",
          sellerId: "donor-a",
          buyerId: "vendor",
          numerator: 1,
          denominator: 2,
          amountType: "whole-property",
          date: "2020-01-01",
          acquisitionValue: 50000,
          acquisitionValueBasis: "deed-value",
        },
        {
          id: "gift-b",
          kind: "donation",
          sellerId: "donor-b",
          buyerId: "vendor",
          numerator: 1,
          denominator: 2,
          amountType: "whole-property",
          date: "2021-01-01",
          acquisitionValue: 50000,
          acquisitionValueBasis: "deed-value",
        },
      ],
      saleLots: [
        {
          id: "legacy-combined",
          ownerId: "vendor",
          acquisitionType: "donation",
          transferDate: "2026-08-13",
          shareNumerator: 1,
          shareDenominator: 1,
          transferValue: "",
          consideration: "",
          marketValue: "",
          acquisitionValue: 100000,
          acquisitionValueBasis: "deed-value",
        },
      ],
    };

    const report = buildTaxCalculationReport(property, people, []);

    expect(report.vendors[0].rows.map((row) => row.attributedSaleValue)).toEqual([null, null]);
    expect(report.vendors[0].rows.map((row) => row.tax)).toEqual([null, null]);
    expect(report.totalSaleValue).toBeNull();
    expect(report.totalTax).toBeNull();
    expect(report.totalNet).toBeNull();
  });

  it("uses corrected transfer and donor dates instead of stale stored donation dates", () => {
    const people = [
      { id: "donor", fullName: "Joseph Borg" },
      { id: "donee", fullName: "Maria Vella" },
    ];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 200000,
      owners: [
        {
          id: "title",
          personId: "donor",
          sharePercent: 100,
          acquisitionDate: "2000-01-01",
        },
      ],
      transfers: [
        {
          id: "gift",
          kind: "donation",
          sellerId: "donor",
          buyerId: "donee",
          numerator: 1,
          denominator: 1,
          amountType: "seller-holding",
          date: "2020-01-01",
          acquisitionValue: 100000,
          acquisitionValueBasis: "deed-value",
        },
      ],
      saleLots: [
        {
          id: "stale-gift",
          ownerId: "donee",
          acquisitionType: "donation",
          acquisitionDate: "2024-01-01",
          previousAcquisitionDate: "2015-01-01",
          transferDate: "2026-08-13",
          shareNumerator: 1,
          shareDenominator: 1,
        },
      ],
    };

    const row = buildTaxCalculationReport(property, people, []).vendors[0].rows[0];

    expect(row).toMatchObject({
      acquisitionDate: "2020-01-01",
      donorAcquisitionDate: "2000-01-01",
      declaredValue: 100000,
      selectedMethod: { key: "increase-12" },
      tax: 12000,
    });
  });

  it("treats a cleared current Donation Value as authoritative over a stale stored lot", () => {
    const people = [
      { id: "donor", fullName: "Joseph Borg" },
      { id: "donee", fullName: "Maria Vella" },
    ];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 200000,
      owners: [
        {
          id: "title",
          personId: "donor",
          sharePercent: 100,
          acquisitionDate: "2000-01-01",
        },
      ],
      transfers: [
        {
          id: "gift",
          kind: "donation",
          sellerId: "donor",
          buyerId: "donee",
          numerator: 1,
          denominator: 1,
          amountType: "seller-holding",
          date: "2020-01-01",
          acquisitionValue: "",
          acquisitionValueBasis: "",
        },
      ],
      saleLots: [
        {
          id: "stale-gift-value",
          ownerId: "donee",
          acquisitionType: "donation",
          acquisitionDate: "2020-01-01",
          previousAcquisitionDate: "2000-01-01",
          acquisitionValue: 100000,
          acquisitionValueBasis: "deed-value",
          transferDate: "2026-08-13",
          shareNumerator: 1,
          shareDenominator: 1,
        },
      ],
    };

    const report = buildTaxCalculationReport(property, people, []);
    const row = report.vendors[0].rows[0];

    expect(row).toMatchObject({
      declaredValue: "",
      requiresDonationAcquisitionValue: true,
      selectedMethod: null,
      tax: null,
    });
    expect(report).toMatchObject({ totalTax: null, totalsComplete: false });
  });

  it("uses the corrected initial-title date instead of a stale stored purchase date", () => {
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 200000,
      owners: [
        {
          id: "title",
          personId: "owner",
          sharePercent: 100,
          acquisitionDate: "2010-01-01",
        },
      ],
      transfers: [],
      saleLots: [
        {
          id: "stale-purchase",
          ownerId: "owner",
          acquisitionType: "purchase",
          acquisitionDate: "2020-01-01",
          transferDate: "2026-08-13",
          shareNumerator: 1,
          shareDenominator: 1,
        },
      ],
    };

    const row = buildTaxCalculationReport(property, [{ id: "owner", fullName: "Maria Borg" }], [])
      .vendors[0].rows[0];

    expect(row).toMatchObject({
      sourceKind: "initial",
      originalOwnerRecordId: "title",
      acquisitionDate: "2010-01-01",
      requiresOriginalAcquisitionDate: false,
    });
  });

  it("treats a cleared current initial-title date as authoritative over a stale stored lot", () => {
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 200000,
      owners: [
        {
          id: "title",
          personId: "owner",
          sharePercent: 100,
          acquisitionDate: "",
        },
      ],
      transfers: [],
      saleLots: [
        {
          id: "stale-purchase-date",
          ownerId: "owner",
          acquisitionType: "purchase",
          acquisitionDate: "2010-01-01",
          transferDate: "2026-08-13",
          shareNumerator: 1,
          shareDenominator: 1,
        },
      ],
    };

    const report = buildTaxCalculationReport(
      property,
      [{ id: "owner", fullName: "Maria Borg" }],
      [],
    );
    const row = report.vendors[0].rows[0];

    expect(row).toMatchObject({
      sourceKind: "initial",
      originalOwnerRecordId: "title",
      acquisitionDate: "",
      requiresOriginalAcquisitionDate: true,
      selectedMethod: null,
      tax: null,
    });
    expect(report).toMatchObject({ totalTax: null, totalsComplete: false });
  });

  it("ignores an ambiguous legacy tax lot and assesses the current title sources instead", () => {
    const people = [
      { id: "a", fullName: "Maria Borg" },
      { id: "b", fullName: "Joseph Borg" },
    ];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 200000,
      owners: [
        {
          id: "a-title",
          personId: "a",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2000-01-01",
        },
        {
          id: "b-title",
          personId: "b",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2010-01-01",
        },
      ],
      transfers: [
        {
          id: "b-to-a",
          kind: "sale",
          sellerId: "b",
          buyerId: "a",
          numerator: 1,
          denominator: 2,
          amountType: "whole-property",
          date: "2020-01-01",
        },
      ],
      declarations: [],
      saleLots: [
        {
          id: "ambiguous-legacy-lot",
          ownerId: "a",
          transferDate: "2026-08-13",
          shareNumerator: 1,
          shareDenominator: 1,
          transferValue: 200000,
        },
      ],
    };

    const report = buildTaxCalculationReport(property, people, []);
    const vendor = report.vendors.find((candidate) => candidate.id === "a");

    expect(vendor.ignoredStoredTaxLots).toEqual([
      expect.objectContaining({ id: "ambiguous-legacy-lot" }),
    ]);
    expect(vendor.rows).toHaveLength(2);
    expect(vendor.rows.map((row) => row.sourceKind).sort()).toEqual(["initial", "purchase"]);
    expect(vendor.rows.map((row) => row.shareFraction)).toEqual([
      { numerator: 1, denominator: 2 },
      { numerator: 1, denominator: 2 },
    ]);
    expect(vendor.incompleteSourceCount).toBe(0);
    expect(report.ignoredStoredTaxLotCount).toBe(1);
    expect(report.totalsComplete).toBe(true);
    expect(property.saleLots).toHaveLength(1);
  });

  it("matches a purchase-typed legacy lot to an exact initial-title date before later purchases", () => {
    const people = [
      { id: "a", fullName: "Maria Borg" },
      { id: "b", fullName: "Joseph Borg" },
    ];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 200000,
      owners: [
        {
          id: "a-title",
          personId: "a",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2000-01-01",
        },
        {
          id: "b-title",
          personId: "b",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2010-01-01",
        },
      ],
      transfers: [
        {
          id: "b-to-a",
          kind: "sale",
          sellerId: "b",
          buyerId: "a",
          numerator: 1,
          denominator: 2,
          amountType: "whole-property",
          date: "2020-01-01",
        },
      ],
      declarations: [],
      saleLots: [
        {
          id: "legacy-initial-half",
          ownerId: "a",
          acquisitionType: "purchase",
          acquisitionDate: "2000-01-01",
          transferDate: "2026-08-13",
          shareNumerator: 1,
          shareDenominator: 2,
          transferValue: 100000,
          article5ASpecialTreatment: "exempt-own-residence",
          specialTreatmentConfirmed: true,
        },
      ],
    };

    const report = buildTaxCalculationReport(property, people, []);
    const vendor = report.vendors.find((candidate) => candidate.id === "a");
    const initialRow = vendor.rows.find((row) => row.sourceKind === "initial");
    const purchaseRow = vendor.rows.find((row) => row.sourceKind === "purchase");

    expect(vendor.ignoredStoredTaxLots).toEqual([]);
    expect(initialRow).toMatchObject({
      id: "legacy-initial-half",
      originalOwnerRecordId: "a-title",
      provenance: "Initial ownership",
      selectedMethod: { key: "exempt-own-residence" },
    });
    expect(purchaseRow).toMatchObject({
      acquisitionDate: "2020-01-01",
      provenance: "Acquired from Joseph Borg",
    });
  });

  it("uses the matched purchase tranche for a stored lot's source label and transfer id", () => {
    const people = [
      { id: "alice", fullName: "Alice Borg" },
      { id: "bob", fullName: "Bob Borg" },
      { id: "vendor", fullName: "Vendor Vella" },
    ];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 400000,
      owners: [
        {
          id: "alice-title",
          personId: "alice",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2000-01-01",
        },
        {
          id: "bob-title",
          personId: "bob",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2001-01-01",
        },
      ],
      transfers: [
        {
          id: "sale-1",
          kind: "sale",
          sellerId: "alice",
          buyerId: "vendor",
          numerator: 1,
          denominator: 2,
          amountType: "whole-property",
          date: "2010-01-01",
        },
        {
          id: "sale-2",
          kind: "sale",
          sellerId: "bob",
          buyerId: "vendor",
          numerator: 1,
          denominator: 2,
          amountType: "whole-property",
          date: "2020-01-01",
        },
      ],
      declarations: [],
      saleLots: [
        {
          id: "stored-first-purchase",
          ownerId: "vendor",
          acquisitionType: "purchase",
          acquisitionDate: "2010-01-01",
          transferDate: "2026-08-13",
          shareNumerator: 1,
          shareDenominator: 2,
          transferValue: 200000,
        },
      ],
    };

    const report = buildTaxCalculationReport(property, people, []);
    const vendor = report.vendors.find((candidate) => candidate.id === "vendor");
    const stored = vendor.rows.find((row) => row.id === "stored-first-purchase");
    const remaining = vendor.rows.find((row) => row.id !== "stored-first-purchase");

    expect(vendor.ignoredStoredTaxLots).toEqual([]);
    expect(stored).toMatchObject({
      sourceKind: "purchase",
      sourceTransferId: "sale-1",
      provenance: "Acquired from Alice Borg",
      provenancePersonId: "alice",
    });
    expect(remaining).toMatchObject({
      sourceKind: "purchase",
      sourceTransferId: "sale-2",
      provenance: "Acquired from Bob Borg",
      provenancePersonId: "bob",
    });
  });

  it("assesses an untyped stored lot from its matched purchase provenance", () => {
    const people = [
      { id: "seller", fullName: "Seller One" },
      { id: "vendor", fullName: "Vendor Vella" },
    ];
    const baseProperty = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 200000,
      owners: [
        {
          id: "seller-title",
          personId: "seller",
          shareNumerator: 1,
          shareDenominator: 1,
          acquisitionDate: "2000-01-01",
        },
      ],
      transfers: [
        {
          id: "sale",
          kind: "sale",
          sellerId: "seller",
          buyerId: "vendor",
          numerator: 1,
          denominator: 1,
          amountType: "whole-property",
          date: "2010-01-01",
        },
      ],
      declarations: [],
    };
    const control = buildTaxCalculationReport({ ...baseProperty, saleLots: [] }, people, []);
    const report = buildTaxCalculationReport(
      {
        ...baseProperty,
        saleLots: [
          {
            id: "legacy-no-type",
            ownerId: "vendor",
            acquisitionDate: "2010-01-01",
            inheritanceDate: "2010-01-01",
            transferDate: "2026-08-13",
            shareNumerator: 1,
            shareDenominator: 1,
            acquisitionValue: 100000,
            acquisitionValueBasis: "cm-declared",
            cmValueEligibilityConfirmed: true,
            transferValue: 200000,
          },
        ],
      },
      people,
      [],
    );
    const row = report.vendors[0].rows[0];

    expect(report.ignoredStoredTaxLotCount).toBe(0);
    expect(report.totalTax).toBe(control.totalTax);
    expect(row).toMatchObject({
      id: "legacy-no-type",
      sourceKind: "purchase",
      sourceTransferId: "sale",
      selectedMethod: { key: "whole-8", rule: "5A(5)(a)" },
      tax: 16000,
    });
    expect(row.methods.some((method) => method.rule === "5A(5)(b)(i)")).toBe(false);
  });

  it("matches an untyped dated lot to a purchase instead of an unrelated sole inheritance", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Deceased Owner",
        isDeceased: true,
        dateOfDeath: "2020-06-01",
        inheritanceBasis: "will",
        willDate: "2019-01-01",
        willHeirs: [{ id: "heir", personId: "vendor", sharePercent: 100 }],
        spouseIds: [],
        causaMortisDeclarations: [
          {
            id: "cm",
            propertyId: "property",
            status: "complete",
            declaredShareNumerator: 1,
            declaredShareDenominator: 2,
            date: "2020-07-01",
            notaryName: "N",
            declarantPersonIds: ["vendor"],
            immovablePropertyValue: 50000,
          },
        ],
      },
      { id: "seller", fullName: "Seller Borg" },
      { id: "vendor", fullName: "Vendor Vella" },
    ];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 200000,
      owners: [
        {
          id: "deceased-title",
          personId: "deceased",
          shareNumerator: 1,
          shareDenominator: 2,
        },
        {
          id: "seller-title",
          personId: "seller",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2000-01-01",
        },
      ],
      transfers: [
        {
          id: "seller-to-vendor",
          kind: "sale",
          sellerId: "seller",
          buyerId: "vendor",
          numerator: 1,
          denominator: 2,
          amountType: "whole-property",
          date: "2010-01-01",
        },
      ],
      declarations: [],
      saleLots: [
        {
          id: "legacy-no-type",
          ownerId: "vendor",
          acquisitionDate: "2010-01-01",
          transferDate: "2026-08-13",
          shareNumerator: 1,
          shareDenominator: 2,
          transferValue: 100000,
          article5ASpecialTreatment: "exempt-own-residence",
          specialTreatmentConfirmed: true,
        },
      ],
    };

    const report = buildTaxCalculationReport(property, people, []);
    const stored = report.vendors[0].rows.find((row) => row.id === "legacy-no-type");
    const inherited = report.vendors[0].rows.find((row) => row.sourceKind === "inheritance");

    expect(report.ignoredStoredTaxLotCount).toBe(0);
    expect(stored).toMatchObject({
      sourceKind: "purchase",
      sourceTransferId: "seller-to-vendor",
      provenance: "Acquired from Seller Borg",
      acquisitionDate: "2010-01-01",
      selectedMethod: { key: "exempt-own-residence" },
    });
    expect(inherited).toMatchObject({
      sourceKind: "inheritance",
      provenance: "Inherited from Deceased Owner",
    });
    expect(inherited.selectedMethod?.key).not.toBe("exempt-own-residence");

    const inheritedLegacyReport = buildTaxCalculationReport(
      {
        ...property,
        saleLots: [
          {
            id: "legacy-inheritance-no-type",
            ownerId: "vendor",
            acquisitionDate: "2020-06-01",
            transferDate: "2026-08-13",
            shareNumerator: 1,
            shareDenominator: 2,
            acquisitionValue: 1,
            acquisitionValueBasis: "cm-declared",
            cmValueEligibilityConfirmed: true,
            transferValue: 100000,
          },
        ],
      },
      people,
      [],
    );
    const canonicalInheritance = inheritedLegacyReport.vendors[0].rows.find(
      (row) => row.id === "legacy-inheritance-no-type",
    );
    expect(inheritedLegacyReport.totalTax).toBe(14000);
    expect(canonicalInheritance).toMatchObject({
      sourceKind: "inheritance",
      provenance: "Inherited from Deceased Owner",
      declaredValue: 50000,
      tax: 6000,
    });
  });

  it("derives a uniquely dated untyped donation from its matched canonical tranche", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Deceased Owner",
        isDeceased: true,
        dateOfDeath: "2020-06-01",
        inheritanceBasis: "will",
        willDate: "2019-01-01",
        willHeirs: [{ id: "heir", personId: "vendor", sharePercent: 100 }],
        spouseIds: [],
        causaMortisDeclarations: [
          {
            id: "cm",
            propertyId: "property",
            status: "complete",
            declaredShareNumerator: 1,
            declaredShareDenominator: 2,
            date: "2020-07-01",
            notaryName: "N",
            declarantPersonIds: ["vendor"],
            immovablePropertyValue: 50000,
          },
        ],
      },
      { id: "donor", fullName: "Donor Borg" },
      { id: "vendor", fullName: "Vendor Vella" },
    ];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 200000,
      owners: [
        {
          id: "deceased-title",
          personId: "deceased",
          shareNumerator: 1,
          shareDenominator: 2,
        },
        {
          id: "donor-title",
          personId: "donor",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2000-01-01",
        },
      ],
      transfers: [
        {
          id: "gift",
          kind: "donation",
          sellerId: "donor",
          buyerId: "vendor",
          numerator: 1,
          denominator: 2,
          amountType: "whole-property",
          date: "2010-01-01",
          acquisitionValue: 40000,
          acquisitionValueBasis: "deed-value",
        },
      ],
      declarations: [],
      saleLots: [
        {
          id: "legacy-donation-no-type",
          ownerId: "vendor",
          acquisitionDate: "2010-01-01",
          transferDate: "2026-08-13",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionValue: 1,
          acquisitionValueBasis: "cm-declared",
          transferValue: 100000,
        },
      ],
    };

    const report = buildTaxCalculationReport(property, people, []);
    const row = report.vendors[0].rows.find(
      (candidate) => candidate.id === "legacy-donation-no-type",
    );

    expect(report.totalTax).toBe(13200);
    expect(row).toMatchObject({
      sourceKind: "donation",
      sourceTransferId: "gift",
      provenance: "Donated by Donor Borg",
      declaredValue: 40000,
      tax: 7200,
    });
  });

  it("excludes ignored stored lots from the deed-wide Housing Authority band", () => {
    const people = [{ id: "vendor", fullName: "Vendor" }];
    const baseProperty = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: "",
      owners: [
        {
          id: "vendor-title",
          personId: "vendor",
          shareNumerator: 1,
          shareDenominator: 1,
          acquisitionDate: "2010-01-01",
        },
      ],
      transfers: [],
      declarations: [],
    };
    const validLot = {
      id: "valid",
      ownerId: "vendor",
      acquisitionType: "purchase",
      acquisitionDate: "2010-01-01",
      transferDate: "2026-08-13",
      shareNumerator: 1,
      shareDenominator: 1,
      transferValue: 100000,
      qualifyingRate: "housing-other-10",
      housingCertificateConfirmed: true,
    };
    const ignoredLot = {
      id: "stale",
      ownerId: "vendor",
      acquisitionType: "inheritance",
      inheritanceSourceDeceasedId: "removed",
      acquisitionDate: "2020-01-01",
      inheritanceDate: "2020-01-01",
      transferDate: "2026-08-13",
      shareNumerator: 1,
      shareDenominator: 1,
      transferValue: 1000000,
      acquisitionValue: 1,
      acquisitionValueBasis: "cm-declared",
      cmValueEligibilityConfirmed: true,
    };
    const control = buildTaxCalculationReport(
      { ...baseProperty, saleLots: [validLot] },
      people,
      [],
    );
    const report = buildTaxCalculationReport(
      { ...baseProperty, saleLots: [validLot, ignoredLot] },
      people,
      [],
    );

    expect(report.ignoredStoredTaxLotCount).toBe(1);
    expect(report.vendors[0].ignoredStoredTaxLots).toEqual([
      expect.objectContaining({ id: "stale" }),
    ]);
    expect(report.totalTax).toBe(control.totalTax);
    expect(report.vendors[0].rows).toEqual([
      expect.objectContaining({
        id: "valid",
        attributedSaleValue: 100000,
        selectedMethod: expect.objectContaining({ key: "housing-other-10", tax: 4000 }),
        tax: 4000,
      }),
    ]);
  });

  it.each([
    { label: "the property selling price", saleValue: 100000 },
    { label: "the stored consideration", saleValue: "" },
  ])(
    "uses the higher recorded market value for the deed-wide Housing band when proceeds use $label",
    ({ saleValue }) => {
      const people = [{ id: "vendor", fullName: "Vendor" }];
      const property = {
        id: "property",
        saleDate: "2026-08-13",
        saleValue,
        owners: [
          {
            id: "vendor-title",
            personId: "vendor",
            shareNumerator: 1,
            shareDenominator: 1,
            acquisitionDate: "2010-01-01",
          },
        ],
        transfers: [],
        declarations: [],
        saleLots: [
          {
            id: "housing-sale",
            ownerId: "vendor",
            acquisitionType: "purchase",
            acquisitionDate: "2010-01-01",
            transferDate: "2026-08-13",
            shareNumerator: 1,
            shareDenominator: 1,
            consideration: 100000,
            marketValue: 300000,
            qualifyingRate: "housing-other-10",
            housingCertificateConfirmed: true,
          },
        ],
      };

      const report = buildTaxCalculationReport(property, people, []);

      expect(report.vendors[0].rows).toEqual([
        expect.objectContaining({
          id: "housing-sale",
          attributedSaleValue: 100000,
          selectedMethod: expect.objectContaining({ key: "housing-other-10", tax: 16000 }),
          tax: 16000,
        }),
      ]);
      expect(report.totalSaleValue).toBe(100000);
      expect(report.totalTax).toBe(16000);
      expect(report.totalNet).toBe(84000);
    },
  );

  it("never lets explicit zero stored values shrink the deed band below displayed sale bases", () => {
    const people = [{ id: "vendor", fullName: "Vendor" }];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 300000,
      owners: [
        {
          id: "title-one",
          personId: "vendor",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2010-01-01",
        },
        {
          id: "title-two",
          personId: "vendor",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2011-01-01",
        },
      ],
      transfers: [],
      declarations: [],
      saleLots: [
        {
          id: "housing-one",
          ownerId: "vendor",
          acquisitionType: "purchase",
          acquisitionDate: "2010-01-01",
          transferDate: "2026-08-13",
          shareNumerator: 1,
          shareDenominator: 2,
          consideration: 0,
          transferValue: 0,
          marketValue: "",
          qualifyingRate: "housing-other-10",
          housingCertificateConfirmed: true,
        },
        {
          id: "housing-two",
          ownerId: "vendor",
          acquisitionType: "purchase",
          acquisitionDate: "2011-01-01",
          transferDate: "2026-08-13",
          shareNumerator: 1,
          shareDenominator: 2,
          consideration: "",
          transferValue: "",
          marketValue: "",
          qualifyingRate: "housing-other-10",
          housingCertificateConfirmed: true,
        },
      ],
    };

    const report = buildTaxCalculationReport(property, people, []);

    expect(report.vendors[0].rows.map((row) => row.attributedSaleValue)).toEqual([150000, 150000]);
    expect(report.vendors[0].rows.map((row) => row.tax)).toEqual([8000, 8000]);
    expect(report.totalSaleValue).toBe(300000);
    expect(report.totalTax).toBe(16000);
  });

  it("does not let legacy transfer values inflate the deed band above displayed sale bases", () => {
    const people = [{ id: "vendor", fullName: "Vendor" }];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 300000,
      owners: [
        {
          id: "title-one",
          personId: "vendor",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2010-01-01",
        },
        {
          id: "title-two",
          personId: "vendor",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2011-01-01",
        },
      ],
      transfers: [],
      declarations: [],
      saleLots: ["one", "two"].map((id, index) => ({
        id: `housing-${id}`,
        ownerId: "vendor",
        acquisitionType: "purchase",
        acquisitionDate: index === 0 ? "2010-01-01" : "2011-01-01",
        transferDate: "2026-08-13",
        shareNumerator: 1,
        shareDenominator: 2,
        transferValue: 200000,
        qualifyingRate: "housing-other-10",
        housingCertificateConfirmed: true,
      })),
    };

    const report = buildTaxCalculationReport(property, people, []);

    expect(report.vendors[0].rows.map((row) => row.attributedSaleValue)).toEqual([150000, 150000]);
    expect(report.vendors[0].rows.map((row) => row.selectedMethod?.basis)).toEqual([
      150000, 150000,
    ]);
    expect(report.vendors[0].rows.map((row) => row.tax)).toEqual([8000, 8000]);
    expect(report.totalSaleValue).toBe(300000);
    expect(report.totalTax).toBe(16000);
  });

  it("ignores a non-positive stored fraction before calculating the Housing Authority band", () => {
    const people = [{ id: "vendor", fullName: "Vendor" }];
    const baseProperty = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: "",
      owners: [
        {
          id: "vendor-title",
          personId: "vendor",
          shareNumerator: 1,
          shareDenominator: 1,
          acquisitionDate: "2010-01-01",
        },
      ],
      transfers: [],
      declarations: [],
    };
    const validLot = {
      id: "valid",
      ownerId: "vendor",
      acquisitionType: "purchase",
      acquisitionDate: "2010-01-01",
      transferDate: "2026-08-13",
      shareNumerator: 1,
      shareDenominator: 1,
      transferValue: 100000,
      qualifyingRate: "housing-other-10",
      housingCertificateConfirmed: true,
    };
    const zeroShareLot = {
      id: "zero-share",
      ownerId: "vendor",
      acquisitionType: "purchase",
      acquisitionDate: "2010-01-01",
      transferDate: "2026-08-13",
      shareNumerator: 0,
      shareDenominator: 1,
      transferValue: 1000000,
    };
    const control = buildTaxCalculationReport(
      { ...baseProperty, saleLots: [validLot] },
      people,
      [],
    );
    const report = buildTaxCalculationReport(
      { ...baseProperty, saleLots: [zeroShareLot, validLot] },
      people,
      [],
    );

    expect(report.ignoredStoredTaxLotCount).toBe(1);
    expect(report.vendors[0].ignoredStoredTaxLots).toEqual([
      expect.objectContaining({ id: "zero-share", reason: expect.stringMatching(/fraction/i) }),
    ]);
    expect(report.totalTax).toBe(control.totalTax);
    expect(report.vendors[0].rows).toEqual([
      expect.objectContaining({
        id: "valid",
        selectedMethod: expect.objectContaining({ key: "housing-other-10", tax: 4000 }),
        tax: 4000,
      }),
    ]);
  });

  it("does not replace a sole zero-share stored lot with the vendor's whole share", () => {
    const people = [{ id: "vendor", fullName: "Vendor" }];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: "",
      owners: [
        {
          id: "vendor-title",
          personId: "vendor",
          shareNumerator: 1,
          shareDenominator: 1,
          acquisitionDate: "2010-01-01",
        },
      ],
      transfers: [],
      declarations: [],
      saleLots: [
        {
          id: "zero-share",
          ownerId: "vendor",
          acquisitionType: "purchase",
          acquisitionDate: "2010-01-01",
          transferDate: "2026-08-13",
          shareNumerator: 0,
          shareDenominator: 1,
          transferValue: 1000000,
          qualifyingRate: "housing-other-10",
          housingCertificateConfirmed: true,
        },
      ],
    };

    const report = buildTaxCalculationReport(property, people, []);

    expect(report.ignoredStoredTaxLotCount).toBe(1);
    expect(report.vendors[0].ignoredStoredTaxLots).toEqual([
      expect.objectContaining({ id: "zero-share", reason: expect.stringMatching(/fraction/i) }),
    ]);
    expect(report.vendors[0].rows).toEqual([
      expect.objectContaining({
        sourceKind: "initial",
        originalOwnerRecordId: "vendor-title",
        share: 1,
      }),
    ]);
  });

  it("ignores inheritance lots that do not resolve to their canonical deceased source", () => {
    const deceased = (id, deathDate, declarationDate, value) => ({
      id,
      fullName: id,
      isDeceased: true,
      dateOfDeath: deathDate,
      inheritanceBasis: "will",
      willDate: "2019-01-01",
      willHeirs: [{ id: `heir-${id}`, personId: "vendor", sharePercent: 100 }],
      spouseIds: [],
      causaMortisDeclarations: [
        {
          id: `cm-${id}`,
          propertyId: "property",
          status: "complete",
          declaredShareNumerator: 1,
          declaredShareDenominator: 2,
          date: declarationDate,
          notaryName: "N",
          declarantPersonIds: ["vendor"],
          immovablePropertyValue: value,
        },
      ],
    });
    const people = [
      deceased("d1", "2020-06-01", "2020-07-01", 100000),
      deceased("d2", "2021-06-01", "2021-07-01", 120000),
      { id: "vendor", fullName: "Vendor" },
    ];
    const baseProperty = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 400000,
      owners: [
        { id: "title-1", personId: "d1", shareNumerator: 1, shareDenominator: 2 },
        { id: "title-2", personId: "d2", shareNumerator: 1, shareDenominator: 2 },
      ],
      transfers: [],
      declarations: [],
    };
    const staleLot = {
      id: "stale-inheritance",
      ownerId: "vendor",
      acquisitionType: "inheritance",
      inheritanceSourceDeceasedId: "removed-source",
      acquisitionDate: "2020-06-01",
      transferDate: "2026-08-13",
      shareNumerator: 1,
      shareDenominator: 2,
      acquisitionValue: 1,
      acquisitionValueBasis: "cm-declared",
      cmValueEligibilityConfirmed: true,
      transferValue: 200000,
    };
    const control = buildTaxCalculationReport({ ...baseProperty, saleLots: [] }, people, []);

    for (const lot of [staleLot, { ...staleLot, inheritanceSourceDeceasedId: "" }]) {
      const report = buildTaxCalculationReport({ ...baseProperty, saleLots: [lot] }, people, []);
      expect(report.totalTax).toBe(control.totalTax);
      expect(report.ignoredStoredTaxLotCount).toBe(1);
      expect(report.vendors[0].ignoredStoredTaxLots).toEqual([
        expect.objectContaining({ id: "stale-inheritance" }),
      ]);
      expect(report.vendors[0].rows).toHaveLength(2);
      expect(report.vendors[0].rows.every((row) => row.sourceKind === "inheritance")).toBe(true);
      expect(report.vendors[0].rows.some((row) => row.id === "stale-inheritance")).toBe(false);
    }
  });

  it("ignores donation lots that do not resolve to their canonical transfer source", () => {
    const people = [
      { id: "donor-1", fullName: "Donor One" },
      { id: "donor-2", fullName: "Donor Two" },
      { id: "vendor", fullName: "Vendor" },
    ];
    const baseProperty = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: 400000,
      owners: [
        {
          id: "title-1",
          personId: "donor-1",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2000-01-01",
        },
        {
          id: "title-2",
          personId: "donor-2",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2001-01-01",
        },
      ],
      transfers: [
        {
          id: "gift-1",
          kind: "donation",
          sellerId: "donor-1",
          buyerId: "vendor",
          numerator: 1,
          denominator: 2,
          amountType: "whole-property",
          date: "2020-01-01",
          acquisitionValue: 100000,
          acquisitionValueBasis: "deed-value",
        },
        {
          id: "gift-2",
          kind: "donation",
          sellerId: "donor-2",
          buyerId: "vendor",
          numerator: 1,
          denominator: 2,
          amountType: "whole-property",
          date: "2021-01-01",
          acquisitionValue: 120000,
          acquisitionValueBasis: "deed-value",
        },
      ],
      declarations: [],
    };
    const staleLot = {
      id: "stale-donation",
      ownerId: "vendor",
      acquisitionType: "donation",
      donationSourceKey: "removed:source",
      acquisitionDate: "2020-01-01",
      previousAcquisitionDate: "2000-01-01",
      transferDate: "2026-08-13",
      shareNumerator: 1,
      shareDenominator: 2,
      acquisitionValue: 1,
      acquisitionValueBasis: "deed-value",
      transferValue: 200000,
    };
    const control = buildTaxCalculationReport({ ...baseProperty, saleLots: [] }, people, []);

    for (const lot of [staleLot, { ...staleLot, donationSourceKey: "" }]) {
      const report = buildTaxCalculationReport({ ...baseProperty, saleLots: [lot] }, people, []);
      expect(report.totalTax).toBe(control.totalTax);
      expect(report.ignoredStoredTaxLotCount).toBe(1);
      expect(report.vendors[0].ignoredStoredTaxLots).toEqual([
        expect.objectContaining({ id: "stale-donation" }),
      ]);
      expect(report.vendors[0].rows).toHaveLength(2);
      expect(report.vendors[0].rows.every((row) => row.sourceKind === "donation")).toBe(true);
      expect(report.vendors[0].rows.some((row) => row.id === "stale-donation")).toBe(false);
    }
  });

  it("keeps invalid imported Donation Values pending instead of clamping them to zero", () => {
    const people = [
      { id: "donor", fullName: "Joseph Borg" },
      { id: "donee", fullName: "Maria Borg" },
    ];
    const baseProperty = {
      id: "property",
      saleDate: "2026-08-13",
      owners: [
        {
          id: "donor-title",
          personId: "donor",
          shareNumerator: 1,
          shareDenominator: 1,
          acquisitionDate: "2000-01-01",
        },
      ],
      transfers: [
        {
          id: "gift",
          kind: "donation",
          sellerId: "donor",
          buyerId: "donee",
          numerator: 1,
          denominator: 1,
          amountType: "seller-holding",
          date: "2020-01-01",
          acquisitionValue: -1,
          acquisitionValueBasis: "deed-value",
        },
      ],
      declarations: [],
      saleLots: [],
    };

    ["", 200000].forEach((saleValue) => {
      const report = buildTaxCalculationReport({ ...baseProperty, saleValue }, people, []);
      const row = report.vendors[0].rows[0];
      expect(row).toMatchObject({
        sourceKind: "donation",
        declaredValue: "",
        requiresDonationAcquisitionValue: true,
        selectedMethod: null,
        tax: null,
      });
    });
  });

  it("marks a future initial-title date as an actionable source correction", () => {
    const report = buildTaxCalculationReport(
      {
        id: "property",
        saleDate: "2026-08-13",
        saleValue: "",
        owners: [
          {
            id: "title",
            personId: "owner",
            shareNumerator: 1,
            shareDenominator: 1,
            acquisitionDate: "2027-01-01",
          },
        ],
        transfers: [],
        declarations: [],
        saleLots: [],
      },
      [{ id: "owner", fullName: "Maria Borg" }],
      [],
    );

    expect(report.vendors[0].rows[0]).toMatchObject({
      acquisitionDate: "2027-01-01",
      requiresOriginalAcquisitionDate: true,
      selectedMethod: null,
    });
  });

  it("keeps ownership available when the selling value is omitted and leaves tax totals blank", () => {
    const property = {
      id: "property",
      saleValue: "",
      owners: [
        {
          id: "title",
          personId: "owner",
          sharePercent: 100,
          acquisitionDate: "2020-01-01",
        },
      ],
      transfers: [],
      declarations: [],
      saleLots: [],
    };

    const report = buildTaxCalculationReport(
      property,
      [{ id: "owner", fullName: "Maria Borg", spouseIds: [] }],
      [],
    );

    expect(report.vendors[0]).toMatchObject({
      id: "owner",
      share: 1,
      attributedSaleValue: null,
      tax: null,
      net: null,
    });
    expect(report.vendors[0].rows[0]).toMatchObject({
      share: 1,
      attributedSaleValue: null,
      selectedMethod: null,
      tax: null,
    });
    expect(report).toMatchObject({
      totalSaleValue: null,
      totalTax: null,
      totalNet: null,
      totalsComplete: false,
    });
  });

  it("retains an explicit stored transfer value when the property selling value is blank", () => {
    const property = {
      id: "property",
      saleValue: "",
      owners: [
        {
          id: "title",
          personId: "owner",
          sharePercent: 100,
          acquisitionDate: "2000-01-01",
        },
      ],
      transfers: [],
      declarations: [],
      saleLots: [
        {
          id: "stored-lot",
          ownerId: "owner",
          acquisitionType: "purchase",
          acquisitionDate: "2000-01-01",
          transferDate: "2026-08-13",
          shareNumerator: 1,
          shareDenominator: 1,
          transferValue: 200,
        },
      ],
    };

    const report = buildTaxCalculationReport(
      property,
      [{ id: "owner", fullName: "Maria Borg", spouseIds: [] }],
      [],
    );

    expect(report.vendors[0].rows[0]).toMatchObject({
      attributedSaleValue: 200,
      selectedMethod: { key: "whole-10" },
      tax: 20,
    });
    expect(report).toMatchObject({
      totalSaleValue: 200,
      totalTax: 20,
      totalNet: 180,
      totalsComplete: true,
    });
  });

  it("shares one vendor's €200,000 band across split acquisitions", () => {
    const lot = (id) => ({
      id,
      ownerId: "seller",
      acquisitionType: "purchase",
      acquisitionDate: "2020-01-01",
      transferDate: "2026-07-31",
      shareNumerator: 1,
      shareDenominator: 2,
      acquisitionValue: 50000,
      consideration: 150000,
      marketValue: 150000,
      transferValue: 150000,
      qualifyingRate: "housing-other-10",
      housingCertificateConfirmed: true,
    });
    const property = {
      id: "property",
      saleValue: 300000,
      owners: [{ personId: "seller", sharePercent: 100 }],
      declarations: [],
      transfers: [],
      saleLots: [lot("first-half"), lot("second-half")],
    };

    const report = buildPropertyVendorTaxReport(
      property,
      [{ id: "seller", fullName: "Joseph Borg", spouseIds: [] }],
      [],
    );
    const taxes = report.saleRows.map(
      (row) => row.result.methods.find((method) => method.key === "housing-other-10").tax,
    );

    // Each half draws half of the band: €100,000 at 4% plus €50,000 at 8%. Assessed alone,
    // each half would claim a full €200,000 band and pay €6,000.
    expect(taxes).toEqual([8000, 8000]);
  });
});
