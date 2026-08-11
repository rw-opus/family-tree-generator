import { describe, expect, it } from "vitest";
import { buildCausaMortisShareCoverage } from "../../src/domain/causaMortisCoverage.js";
import { previewPropertyTransferCapacity } from "../../src/domain/familyOwnership.js";
import {
  buildPropertyVendorTaxReport,
  ownerProvenanceTranches,
} from "../../src/domain/propertyVendorTax.js";

const ownersById = (report) =>
  Object.fromEntries(report.ledger.owners.map((owner) => [owner.id, owner.shareFraction]));

describe("transfers followed by succession", () => {
  it("previews the exact holding at the proposed transfer date rather than the later death balance", () => {
    const people = [
      {
        id: "owner",
        fullName: "Joseph Owner",
        isDeceased: true,
        dateOfDeath: "2022-01-01",
        inheritanceBasis: "intestacy",
        spouseIds: [],
      },
      { id: "child", fullName: "Maria Owner", fatherId: "owner", spouseIds: [] },
      { id: "buyer", fullName: "Paul Buyer" },
    ];
    const property = {
      id: "property",
      owners: [
        {
          id: "owner-title",
          personId: "owner",
          shareNumerator: 1,
          shareDenominator: 1,
        },
      ],
      transfers: [
        {
          id: "earlier-sale",
          kind: "sale",
          sellerId: "owner",
          buyerId: "buyer",
          numerator: 1,
          denominator: 2,
          amountType: "whole-property",
          date: "2018-01-01",
        },
      ],
    };

    const beforeSale = previewPropertyTransferCapacity(property, people, [], {
      sellerId: "owner",
      date: "2017-01-01",
    });
    const afterSale = previewPropertyTransferCapacity(property, people, [], {
      sellerId: "owner",
      date: "2019-01-01",
    });

    expect(beforeSale.error).toBe("");
    expect(beforeSale.holdingFraction).toEqual({ numerator: 1, denominator: 1 });
    expect(afterSale.error).toBe("");
    expect(afterSale.holdingFraction).toEqual({ numerator: 1, denominator: 2 });
  });

  it("previews each provenance held at the proposed date", () => {
    const people = [
      {
        id: "seller",
        fullName: "Maria Seller",
        isDeceased: true,
        dateOfDeath: "2022-01-01",
        inheritanceBasis: "intestacy",
        spouseIds: [],
      },
      { id: "seller-child", fullName: "Clara Seller", motherId: "seller", spouseIds: [] },
      { id: "source", fullName: "Joseph Source" },
    ];
    const property = {
      id: "property",
      owners: [
        {
          id: "seller-title",
          personId: "seller",
          shareNumerator: 1,
          shareDenominator: 2,
        },
        {
          id: "source-title",
          personId: "source",
          shareNumerator: 1,
          shareDenominator: 2,
        },
      ],
      transfers: [
        {
          id: "purchase",
          kind: "sale",
          sellerId: "source",
          buyerId: "seller",
          numerator: 1,
          denominator: 4,
          amountType: "whole-property",
          date: "2018-01-01",
        },
      ],
    };

    const preview = previewPropertyTransferCapacity(property, people, [], {
      sellerId: "seller",
      date: "2020-01-01",
    });

    expect(preview.error).toBe("");
    expect(preview.holdingFraction).toEqual({ numerator: 3, denominator: 4 });
    expect(preview.tranches.map((tranche) => tranche.trancheId).sort()).toEqual([
      "initial-seller-title",
      "transfer-purchase",
    ]);
    expect(preview.tranches.map((tranche) => tranche.fraction)).toEqual(
      expect.arrayContaining([
        { numerator: 1, denominator: 2 },
        { numerator: 1, denominator: 4 },
      ]),
    );
  });

  it.each([
    {
      basis: "intestacy",
      successionDetails: {},
    },
    {
      basis: "will",
      successionDetails: {
        willDate: "2019-01-01",
        willHeirs: [{ id: "will-heir", personId: "heir", sharePercent: 100 }],
      },
    },
  ])(
    "passes a share acquired from a living owner through the recipient's $basis succession",
    ({ basis, successionDetails }) => {
      const people = [
        { id: "original-owner", fullName: "Anna Owner" },
        {
          id: "recipient",
          fullName: "Bernard Recipient",
          isDeceased: true,
          dateOfDeath: "2020-01-01",
          inheritanceBasis: basis,
          spouseIds: [],
          ...successionDetails,
        },
        {
          id: "heir",
          fullName: "Clara Heir",
          fatherId: "recipient",
          spouseIds: [],
        },
      ];
      const property = {
        id: "property",
        owners: [
          {
            id: "original-title",
            personId: "original-owner",
            shareNumerator: 1,
            shareDenominator: 1,
          },
        ],
        transfers: [
          {
            id: "sale-to-recipient",
            kind: "sale",
            sellerId: "original-owner",
            buyerId: "recipient",
            numerator: 1,
            denominator: 4,
            amountType: "whole-property",
            date: "2018-01-01",
            provenance: [
              {
                trancheId: "initial-original-title",
                numerator: 1,
                denominator: 4,
              },
            ],
          },
        ],
      };

      const report = buildPropertyVendorTaxReport(property, people, []);
      const owners = ownersById(report);
      const recipientSuccession = report.ownership.transmissions.find(
        (transmission) => transmission.deceasedId === "recipient",
      );
      const recipientCoverage = buildCausaMortisShareCoverage(people, [property]).rows.find(
        (row) => row.personId === "recipient",
      );

      expect.soft(owners).toEqual({
        "original-owner": { numerator: 3, denominator: 4 },
        heir: { numerator: 1, denominator: 4 },
      });
      expect.soft(recipientSuccession?.amountFraction).toEqual({
        numerator: 1,
        denominator: 4,
      });
      expect.soft(recipientSuccession?.basis).toBe(basis);
      expect.soft(recipientCoverage?.requiredFraction).toEqual({
        numerator: 1,
        denominator: 4,
      });
    },
  );

  it("lets the recipient's heir transfer the inherited balance later", () => {
    const people = [
      { id: "original-owner", fullName: "Anna Owner" },
      {
        id: "recipient",
        fullName: "Bernard Recipient",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "intestacy",
        spouseIds: [],
      },
      { id: "heir", fullName: "Clara Heir", fatherId: "recipient", spouseIds: [] },
      { id: "later-buyer", fullName: "David Buyer", spouseIds: [] },
    ];
    const property = {
      id: "property",
      owners: [
        {
          id: "original-title",
          personId: "original-owner",
          shareNumerator: 1,
          shareDenominator: 1,
        },
      ],
      transfers: [
        {
          id: "sale-to-recipient",
          kind: "sale",
          sellerId: "original-owner",
          buyerId: "recipient",
          numerator: 1,
          denominator: 4,
          amountType: "whole-property",
          date: "2018-01-01",
          provenance: [{ trancheId: "initial-original-title", numerator: 1, denominator: 4 }],
        },
        {
          id: "heir-resale",
          kind: "sale",
          sellerId: "heir",
          buyerId: "later-buyer",
          numerator: 1,
          denominator: 8,
          amountType: "whole-property",
          date: "2022-01-01",
          provenance: [
            {
              trancheId: "inheritance-recipient",
              numerator: 1,
              denominator: 8,
              acquiredOn: "2020-01-01",
            },
          ],
        },
      ],
    };

    const report = buildPropertyVendorTaxReport(property, people, []);

    expect(ownersById(report)).toEqual({
      "original-owner": { numerator: 3, denominator: 4 },
      heir: { numerator: 1, denominator: 8 },
      "later-buyer": { numerator: 1, denominator: 8 },
    });
    expect(report.ledger.entries.every((entry) => !entry.error)).toBe(true);
  });

  it("applies a transfer on the date of death before distributing the remaining estate", () => {
    const people = [
      {
        id: "owner",
        fullName: "Owner",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "intestacy",
        spouseIds: [],
      },
      { id: "heir", fullName: "Heir", fatherId: "owner", spouseIds: [] },
      { id: "buyer", fullName: "Buyer", spouseIds: [] },
    ];
    const property = {
      id: "property",
      owners: [{ id: "title", personId: "owner", shareNumerator: 1, shareDenominator: 1 }],
      transfers: [
        {
          id: "same-day-sale",
          kind: "sale",
          sellerId: "owner",
          buyerId: "buyer",
          numerator: 1,
          denominator: 4,
          amountType: "whole-property",
          date: "2020-01-01",
          provenance: [{ trancheId: "initial-title", numerator: 1, denominator: 4 }],
        },
      ],
    };

    const report = buildPropertyVendorTaxReport(property, people, []);

    expect(ownersById(report)).toEqual({
      heir: { numerator: 3, denominator: 4 },
      buyer: { numerator: 1, denominator: 4 },
    });
  });

  it("rejects a transfer to a buyer who had already died", () => {
    const people = [
      { id: "owner", fullName: "Owner" },
      {
        id: "buyer",
        fullName: "Buyer",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        spouseIds: [],
      },
    ];
    const property = {
      id: "property",
      owners: [{ id: "title", personId: "owner", shareNumerator: 1, shareDenominator: 1 }],
      transfers: [
        {
          id: "late-purchase",
          kind: "sale",
          sellerId: "owner",
          buyerId: "buyer",
          numerator: 1,
          denominator: 4,
          amountType: "whole-property",
          date: "2021-01-01",
          provenance: [{ trancheId: "initial-title", numerator: 1, denominator: 4 }],
        },
      ],
    };

    const report = buildPropertyVendorTaxReport(property, people, []);

    expect(ownersById(report)).toEqual({ owner: { numerator: 1, denominator: 1 } });
    expect(report.ledger.entries[0].error).toMatch(/already died/i);
  });
});

describe("designated provenance before succession", () => {
  const people = [
    {
      id: "source-a",
      fullName: "Source Alpha",
      isDeceased: true,
      dateOfDeath: "2010-01-01",
      inheritanceBasis: "will",
      willDate: "2009-01-01",
      willHeirs: [{ id: "alpha-heir", personId: "middle", sharePercent: 100 }],
      spouseIds: [],
    },
    {
      id: "source-b",
      fullName: "Source Beta",
      isDeceased: true,
      dateOfDeath: "2012-01-01",
      inheritanceBasis: "will",
      willDate: "2011-01-01",
      willHeirs: [{ id: "beta-heir", personId: "middle", sharePercent: 100 }],
      spouseIds: [],
    },
    {
      id: "middle",
      fullName: "Middle Donor",
      isDeceased: true,
      dateOfDeath: "2020-01-01",
      inheritanceBasis: "will",
      willDate: "2019-01-01",
      willHeirs: [{ id: "middle-heir", personId: "heir", sharePercent: 100 }],
      spouseIds: [],
      causaMortisDeclarations: [
        {
          id: "middle-cm",
          status: "complete",
          propertyId: "property",
          declaredShareNumerator: 3,
          declaredShareDenominator: 4,
          date: "2020-02-01",
          notaryName: "Notary Example",
          declarantPersonIds: ["heir"],
          immovablePropertyValue: 750000,
        },
      ],
    },
    { id: "heir", fullName: "Helen Heir", fatherId: "middle", spouseIds: [] },
    { id: "donee", fullName: "Daniel Donee", spouseIds: [] },
  ];
  const property = {
    id: "property",
    saleDate: "2026-01-01",
    saleValue: 1000000,
    owners: [
      {
        id: "alpha-title",
        personId: "source-a",
        shareNumerator: 1,
        shareDenominator: 2,
      },
      {
        id: "beta-title",
        personId: "source-b",
        shareNumerator: 1,
        shareDenominator: 2,
      },
    ],
    transfers: [
      {
        id: "gift-from-beta-source",
        kind: "donation",
        sellerId: "middle",
        buyerId: "donee",
        numerator: 1,
        denominator: 4,
        amountType: "whole-property",
        date: "2018-01-01",
        provenance: [
          {
            trancheId: "inheritance-source-b",
            numerator: 1,
            denominator: 4,
            acquiredOn: "2012-01-01",
          },
        ],
      },
    ],
    saleLots: [
      {
        id: "donee-sale",
        ownerId: "donee",
        acquisitionType: "donation",
        acquisitionDate: "2018-01-01",
        transferDate: "2026-01-01",
        shareNumerator: 1,
        shareDenominator: 4,
        acquisitionValue: 0,
        transferValue: 250000,
        useDeclaredValues: false,
      },
    ],
  };

  it("removes the designated part from source B, not source A, before succession and CM", () => {
    const report = buildPropertyVendorTaxReport(property, people, []);
    const remainingBySource = Object.fromEntries(
      ownerProvenanceTranches(report, property, "middle").map((tranche) => [
        tranche.trancheId,
        tranche.fraction,
      ]),
    );
    const middleSuccessionFractions = report.ownership.transmissions
      .filter((transmission) => transmission.deceasedId === "middle")
      .map((transmission) => transmission.amountFraction);
    const middleCoverage = buildCausaMortisShareCoverage(people, [property]).rows.find(
      (row) => row.personId === "middle",
    );

    expect(remainingBySource["inheritance-source-a"]).toEqual({ numerator: 1, denominator: 2 });
    expect(remainingBySource["inheritance-source-b"]).toEqual({ numerator: 1, denominator: 4 });
    // Starting-owner order is source A then source B. Keeping these as separate
    // transmissions proves that the designated quarter came out of B, not A.
    expect(middleSuccessionFractions).toEqual([
      { numerator: 1, denominator: 2 },
      { numerator: 1, denominator: 4 },
    ]);
    expect(middleCoverage).toMatchObject({
      requiredFraction: { numerator: 3, denominator: 4 },
      declaredFraction: { numerator: 3, denominator: 4 },
      status: "complete",
    });
  });

  it("carries source B's designated acquisition date into the donee's tax provenance", () => {
    const report = buildPropertyVendorTaxReport(property, people, []);
    const donationSource = report.donationSourcesByOwner.get("donee")?.[0];
    const saleRow = report.saleRows.find((row) => row.lot.id === "donee-sale");

    expect.soft(donationSource?.donorAcquisitionDate).toBe("2012-01-01");
    expect.soft(saleRow?.effectiveLot.previousAcquisitionDate).toBe("2012-01-01");
    expect.soft(saleRow?.donationDatesDerived).toBe(true);
  });

  it("keeps separate tax lots when one donation uses two acquisition sources", () => {
    const multiSourceProperty = {
      ...property,
      transfers: [
        {
          ...property.transfers[0],
          numerator: 1,
          denominator: 2,
          provenance: [
            {
              trancheId: "inheritance-source-a",
              numerator: 1,
              denominator: 4,
              acquiredOn: "2010-01-01",
            },
            {
              trancheId: "inheritance-source-b",
              numerator: 1,
              denominator: 4,
              acquiredOn: "2012-01-01",
            },
          ],
        },
      ],
      saleLots: [
        {
          ...property.saleLots[0],
          shareNumerator: 1,
          shareDenominator: 2,
          transferValue: 500000,
        },
      ],
    };

    const report = buildPropertyVendorTaxReport(multiSourceProperty, people, []);
    const sources = report.donationSourcesByOwner.get("donee") || [];
    const doneeRows = report.saleRows.filter((row) => row.lot.ownerId === "donee");

    expect(sources.map((source) => source.donorAcquisitionDate).sort()).toEqual([
      "2010-01-01",
      "2012-01-01",
    ]);
    expect(doneeRows).toHaveLength(2);
    expect(doneeRows.map((row) => row.effectiveLot.previousAcquisitionDate).sort()).toEqual([
      "2010-01-01",
      "2012-01-01",
    ]);
    expect(doneeRows.map((row) => row.effectiveLot.shareNumerator)).toEqual([1, 1]);
    expect(doneeRows.map((row) => row.effectiveLot.shareDenominator)).toEqual([4, 4]);
  });
});
