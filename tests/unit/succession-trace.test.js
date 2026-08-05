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
});
