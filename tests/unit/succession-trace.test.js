import { describe, expect, it } from "vitest";
import { buildPropertyVendorTaxReport } from "../../src/domain/propertyVendorTax.js";
import { buildSuccessionTrace } from "../../src/domain/successionTrace.js";

describe("succession trace", () => {
  it("orders the initial title, deaths, recorded transfers, and proposed sale", () => {
    const people = [
      {
        id: "edgar",
        fullName: "Edgar Wadge",
        isDeceased: true,
        dateOfDeath: "1990-01-01",
        inheritanceBasis: "intestacy",
        intestateHeirs: [{ id: "heir", personId: "roland", sharePercent: 100 }],
        intestateHeirsConfirmed: true,
      },
      { id: "roland", fullName: "Roland Wadge", fatherId: "edgar" },
    ];
    const property = {
      id: "house",
      address: "24 St Mary Street",
      saleValue: 300000,
      owners: [{ id: "owner", personId: "edgar", sharePercent: 100 }],
      transfers: [
        {
          id: "sale",
          sellerId: "roland",
          buyerId: "buyer",
          numerator: 1,
          denominator: 2,
          amountType: "whole-property",
          date: "2020-04-10",
          consideration: 100000,
        },
      ],
    };
    const outsideParties = [{ id: "buyer", name: "Buyer Limited", type: "company" }];
    const propertyReport = buildPropertyVendorTaxReport(property, people, outsideParties);

    const events = buildSuccessionTrace({ property, people, outsideParties, propertyReport });

    expect(events.map((event) => event.type)).toEqual(["initial", "succession", "sale", "sale"]);
    expect(events[0]).toMatchObject({ personId: "edgar", title: "Initial ownership" });
    expect(events[0].ownershipSnapshot).toEqual({ edgar: 1 });
    expect(events[1]).toMatchObject({ personId: "edgar", date: "1990-01-01" });
    expect(events[1].ownershipSnapshot).toEqual({ edgar: 1 });
    expect(events[1].description).toContain("Roland Wadge receives 1/1 (100%)");
    expect(events[1].warnings.join(" ")).not.toContain("Historical law must be checked");
    expect(events[2].description).toContain("Buyer Limited");
    expect(events[2].ownershipSnapshot).toEqual({ buyer: 0.5, roland: 0.5 });
    expect(events.at(-1).ownershipSnapshot).toEqual({ buyer: 0.5, roland: 0.5 });
    expect(events.at(-1).description).toContain("€300,000.00");
    expect(events.at(-1).description).toContain("worth €150,000.00");
  });

  it("describes an unresolved succession without inventing recipients", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Unresolved Owner",
        isDeceased: true,
        dateOfDeath: "1980-01-01",
        inheritanceBasis: "intestacy",
      },
    ];
    const property = {
      id: "house",
      owners: [{ id: "owner", personId: "deceased", sharePercent: 100 }],
    };
    const propertyReport = buildPropertyVendorTaxReport(property, people, []);

    const events = buildSuccessionTrace({ property, people, propertyReport });

    expect(events[1].description).toContain("recipients are unresolved");
    expect(events[1].ownershipSnapshot).toEqual({ deceased: 1 });
  });

  it("shows each deceased owner holding the inherited share at their own trace step", () => {
    const people = [
      {
        id: "first",
        fullName: "First Owner",
        isDeceased: true,
        dateOfDeath: "1980-01-01",
        inheritanceBasis: "intestacy",
        intestateHeirs: [{ id: "first-heir", personId: "second", sharePercent: 100 }],
        intestateHeirsConfirmed: true,
      },
      {
        id: "second",
        fullName: "Second Owner",
        isDeceased: true,
        dateOfDeath: "2000-01-01",
        inheritanceBasis: "intestacy",
        fatherId: "first",
        intestateHeirs: [{ id: "second-heir", personId: "third", sharePercent: 100 }],
        intestateHeirsConfirmed: true,
      },
      { id: "third", fullName: "Current Owner", fatherId: "second" },
    ];
    const property = {
      id: "house",
      saleValue: 240000,
      owners: [{ id: "owner", personId: "first", sharePercent: 100 }],
    };
    const propertyReport = buildPropertyVendorTaxReport(property, people, []);

    const events = buildSuccessionTrace({ property, people, propertyReport });
    const successions = events.filter((event) => event.type === "succession");

    expect(successions).toHaveLength(2);
    expect(successions[0].ownershipSnapshot).toEqual({ first: 1 });
    expect(successions[1].ownershipSnapshot).toEqual({ second: 1 });
    expect(events.at(-1).ownershipSnapshot).toEqual({ third: 1 });
  });

  it("includes every valid or invalid recorded transfer without mutating title for an error", () => {
    const people = [{ id: "buyer", fullName: "Maria Vella" }];
    const outsideParties = [
      { id: "alpha", name: "Alpha Holdings Limited", type: "company" },
      { id: "beta", name: "Beta Holdings Limited", type: "company" },
    ];
    const property = {
      id: "house",
      address: "Mixed transfer property",
      owners: [{ id: "initial-alpha", personId: "alpha", shareNumerator: 1, shareDenominator: 1 }],
      transfers: [
        {
          id: "gift",
          kind: "donation",
          sellerId: "alpha",
          buyerId: "beta",
          numerator: 1,
          denominator: 2,
          amountType: "whole-property",
          date: "2020-01-01",
        },
        {
          id: "invalid-sale",
          kind: "sale",
          sellerId: "beta",
          buyerId: "buyer",
          numerator: 3,
          denominator: 4,
          amountType: "whole-property",
          date: "2021-01-01",
        },
        {
          id: "sale",
          kind: "sale",
          sellerId: "alpha",
          buyerId: "buyer",
          numerator: 1,
          denominator: 2,
          amountType: "whole-property",
          date: "2022-01-01",
        },
      ],
    };
    const propertyReport = buildPropertyVendorTaxReport(property, people, outsideParties);

    const transferEvents = buildSuccessionTrace({
      property,
      people,
      outsideParties,
      propertyReport,
    }).filter((event) => event.transferKind);

    expect(transferEvents.map((event) => event.id)).toEqual([
      "transfer-gift",
      "transfer-invalid-sale",
      "transfer-sale",
    ]);
    expect(transferEvents).toHaveLength(propertyReport.ledger.entries.length);
    expect(transferEvents[0]).toMatchObject({
      transferKind: "donation",
      title: "Property share donation",
      invalid: false,
      ownershipSnapshot: { alpha: 0.5, beta: 0.5 },
      participants: [
        { id: "alpha", role: "Donor", source: "outside" },
        { id: "beta", role: "Donee", source: "outside" },
      ],
    });
    expect(transferEvents[0].description).toContain("donates 1/2 (50%)");
    expect(transferEvents[1]).toMatchObject({
      invalid: true,
      ownershipSnapshot: { alpha: 0.5, beta: 0.5 },
    });
    expect(transferEvents[1].warnings.join(" ")).toContain("Recorded sale needs attention");
    expect(transferEvents[2].ownershipSnapshot).toEqual({ beta: 0.5, buyer: 0.5 });
  });

  it("uses the calculation engine's interleaved transfer-before-death order", () => {
    const people = [
      { id: "seller", fullName: "Original Seller" },
      {
        id: "buyer",
        fullName: "Later Deceased Buyer",
        isDeceased: true,
        dateOfDeath: "2000-01-01",
        inheritanceBasis: "intestacy",
        intestateHeirs: [{ id: "buyer-heir", personId: "heir", sharePercent: 100 }],
        intestateHeirsConfirmed: true,
      },
      { id: "heir", fullName: "Current Heir", fatherId: "buyer" },
    ];
    const property = {
      id: "house",
      owners: [{ id: "initial", personId: "seller", shareNumerator: 1, shareDenominator: 1 }],
      transfers: [
        {
          id: "lifetime-sale",
          kind: "sale",
          sellerId: "seller",
          buyerId: "buyer",
          numerator: 1,
          denominator: 1,
          amountType: "whole-property",
          date: "1990-01-01",
        },
      ],
    };
    const propertyReport = buildPropertyVendorTaxReport(property, people, []);

    const legalEvents = buildSuccessionTrace({ property, people, propertyReport }).filter(
      (event) => event.type !== "initial",
    );

    expect(legalEvents.map((event) => event.id)).toEqual([
      "transfer-lifetime-sale",
      "succession-buyer-0",
    ]);
    expect(legalEvents[0].ownershipSnapshot).toEqual({ buyer: 1 });
    expect(legalEvents[1].ownershipSnapshot).toEqual({ buyer: 1 });
  });

  it("shows the resolved whole-property fraction for a legacy seller-holding transfer", () => {
    const people = [
      { id: "other", fullName: "Other Owner" },
      { id: "buyer", fullName: "Buyer" },
    ];
    const outsideParties = [{ id: "company", name: "Legacy Company", type: "company" }];
    const property = {
      id: "house",
      address: "Legacy property",
      owners: [
        {
          id: "company-title",
          personId: "company",
          shareNumerator: 1,
          shareDenominator: 2,
        },
        { id: "other-title", personId: "other", shareNumerator: 1, shareDenominator: 2 },
      ],
      transfers: [
        {
          id: "legacy-sale",
          kind: "sale",
          sellerId: "company",
          buyerId: "buyer",
          numerator: 1,
          denominator: 2,
          date: "2020-01-01",
        },
      ],
    };
    const propertyReport = buildPropertyVendorTaxReport(property, people, outsideParties);

    const transfer = buildSuccessionTrace({
      property,
      people,
      outsideParties,
      propertyReport,
    }).find((event) => event.id === "transfer-legacy-sale");

    expect(transfer.description).toContain("1/4 (25%)");
    expect(transfer.ownershipFractionSnapshot.buyer).toEqual({ numerator: 1, denominator: 4 });
  });

  it("preserves a twelve-digit exact fraction in trace cards and printable descriptions", () => {
    const people = [{ id: "owner", fullName: "Exact Owner" }];
    const property = {
      id: "house",
      address: "Exact fraction property",
      owners: [
        {
          id: "initial-owner",
          personId: "owner",
          shareNumerator: 1,
          shareDenominator: 999999999983,
        },
      ],
    };
    const propertyReport = {
      ownership: { transmissions: [] },
      ledger: { entries: [], owners: [] },
    };

    const [event] = buildSuccessionTrace({ property, people, propertyReport });

    expect(event.ownershipFractionSnapshot).toEqual({
      owner: { numerator: 1, denominator: 999999999983 },
    });
    expect(event.description).toContain("1/999999999983");
  });

  it("uses cent-reconciled current-owner presentations for a proposed sale", () => {
    const people = [
      { id: "first", fullName: "First Owner" },
      { id: "second", fullName: "Second Owner" },
      { id: "third", fullName: "Third Owner" },
    ];
    const property = {
      id: "house",
      address: "Thirds property",
      saleValue: 1,
      owners: people.map((person, index) => ({
        id: `initial-${index}`,
        personId: person.id,
        shareNumerator: 1,
        shareDenominator: 3,
      })),
    };
    const propertyReport = buildPropertyVendorTaxReport(property, people, []);

    const proposedSale = buildSuccessionTrace({
      property,
      people,
      propertyReport,
      currentOwnerPresentationsById: {
        first: {
          id: "first",
          share: 1 / 3,
          shareFraction: { numerator: 1, denominator: 3 },
          value: 0.34,
        },
      },
    }).at(-1);

    expect(proposedSale.title).toBe("Proposed property sale");
    expect(proposedSale.description).toContain("First Owner 1/3 (33.33%), worth €0.34");
    expect(proposedSale.description).toContain("Second Owner 1/3 (33.33%), worth €0.33");
    expect(proposedSale.description).toContain("Third Owner 1/3 (33.33%), worth €0.33");
  });

  it("preserves an explicitly recorded zero selling price in the proposed-sale allocation", () => {
    const people = [{ id: "owner", fullName: "Owner" }];
    const property = {
      id: "house",
      saleValue: 0,
      owners: [
        {
          id: "initial-owner",
          personId: "owner",
          shareNumerator: 1,
          shareDenominator: 1,
        },
      ],
    };
    const propertyReport = buildPropertyVendorTaxReport(property, people, []);

    const events = buildSuccessionTrace({ property, people, propertyReport });

    expect(events[0].description).not.toContain("worth");
    expect(events.at(-1).title).toBe("Proposed property sale");
    expect(events.at(-1).description).toContain("sold for €0.00");
    expect(events.at(-1).description).toContain("worth €0.00");
  });
});
