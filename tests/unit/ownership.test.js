import { describe, expect, it } from "vitest";
import { chronologicalTransfers } from "../../src/domain/ownership.js";

describe("chronologicalTransfers", () => {
  it("leaves fully undated transfers in array order", () => {
    const transfers = [{ id: "b" }, { id: "a" }];
    expect(chronologicalTransfers(transfers)).toBe(transfers);
  });

  it("applies dated transfers in date order regardless of entry order", () => {
    const transfers = [
      { id: "later", date: "2020-05-01" },
      { id: "earlier", date: "2010-01-15" },
    ];
    expect(chronologicalTransfers(transfers).map((transfer) => transfer.id)).toEqual([
      "earlier",
      "later",
    ]);
  });

  it("breaks same-day ties by entry order and sorts undated after dated", () => {
    const transfers = [
      { id: "undated" },
      { id: "same-day-second", date: "2020-05-01" },
      { id: "same-day-first", date: "2020-05-01" },
    ];
    expect(chronologicalTransfers(transfers).map((transfer) => transfer.id)).toEqual([
      "same-day-second",
      "same-day-first",
      "undated",
    ]);
  });

  it("ignores malformed dates rather than sorting on them", () => {
    const transfers = [
      { id: "bad-date", date: "01/05/2020" },
      { id: "dated", date: "2019-03-03" },
    ];
    expect(chronologicalTransfers(transfers).map((transfer) => transfer.id)).toEqual([
      "dated",
      "bad-date",
    ]);
  });
});
import {
  approximateFraction,
  buildOwnershipLedger,
  buildPropertyLedger,
  buildStarterOwnership,
  startingOwnershipIsUnset,
  startingOwnershipTotalPercent,
} from "../../src/domain/ownership.js";

describe("ownership transfer ledger", () => {
  it("shows useful fractional labels", () => {
    expect(approximateFraction(1 / 3)).toEqual({ numerator: 1, denominator: 3 });
  });
  it("preserves exact calculated fractions with denominators in the millions", () => {
    expect(approximateFraction(1 / 3000001)).toEqual({ numerator: 1, denominator: 3000001 });
    expect(approximateFraction((1 / 1000001) * (1 / 3))).toEqual({
      numerator: 1,
      denominator: 3000003,
    });
  });
  it("uses 12 digits as the automatic fraction ceiling", () => {
    expect(approximateFraction(1 / 999999999999)).toEqual({
      numerator: 1,
      denominator: 999999999999,
    });
    expect(approximateFraction(1 / 1000000000000).denominator).toBeLessThanOrEqual(999999999999);
  });
  it("ignores insignificant floating-point noise when recovering a fraction", () => {
    expect(approximateFraction(0.1 + 0.2)).toEqual({ numerator: 3, denominator: 10 });
  });
  it("leaves a lone first person without a displayed ownership share", () => {
    expect(buildStarterOwnership([{ id: "first" }])).toEqual({});
  });
  it("never infers starting ownership from family relationships", () => {
    expect(
      buildStarterOwnership([
        { id: "father" },
        { id: "mother" },
        { id: "child", fatherId: "father", motherId: "mother" },
      ]),
    ).toEqual({});
  });
  it("lets one top-level parent own the whole property", () => {
    expect(
      buildStarterOwnership([
        { id: "father", ownershipSharePercent: 100 },
        { id: "mother" },
        { id: "child", fatherId: "father", motherId: "mother" },
      ]),
    ).toEqual({ father: 1 });
  });
  it("reports whether explicit starting ownership is complete", () => {
    const unset = [{ id: "owner" }];
    const split = [
      { id: "one", ownershipSharePercent: 60 },
      { id: "two", ownershipSharePercent: 40 },
    ];
    const underAllocated = [{ id: "one", ownershipSharePercent: 60 }];

    expect(startingOwnershipIsUnset(unset)).toBe(true);
    expect(startingOwnershipTotalPercent(unset)).toBe(0);
    expect(startingOwnershipIsUnset(split)).toBe(false);
    expect(startingOwnershipTotalPercent(split)).toBe(100);
    expect(startingOwnershipTotalPercent(underAllocated)).toBe(60);
    expect(startingOwnershipIsUnset([{ id: "zero", ownershipSharePercent: 0 }])).toBe(false);
    expect(startingOwnershipIsUnset([{ id: "blank", ownershipSharePercent: "" }])).toBe(true);
  });
  it("transfers a fraction of a seller's holding to a company", () => {
    const ledger = buildOwnershipLedger(
      [
        { id: "heir", name: "Heir", sharePercent: 50 },
        { id: "coheir", name: "Co-heir", sharePercent: 50 },
      ],
      [{ id: "company", name: "Buyer Ltd", type: "company" }],
      [
        {
          id: "sale",
          sellerId: "heir",
          buyerId: "company",
          numerator: 1,
          denominator: 2,
          amountType: "seller-holding",
          date: "2020-01-01",
        },
      ],
    );
    expect(ledger.owners.find((owner) => owner.id === "heir").share).toBe(0.25);
    expect(ledger.owners.find((owner) => owner.id === "company").share).toBe(0.25);
    expect(ledger.total).toBe(1);
  });
  it("rejects transfer fractions with a 13-digit component", () => {
    const ledger = buildOwnershipLedger(
      [{ id: "seller", name: "Seller", sharePercent: 100 }],
      [{ id: "buyer", name: "Buyer", type: "individual" }],
      [
        {
          id: "sale",
          sellerId: "seller",
          buyerId: "buyer",
          numerator: 1,
          denominator: "1000000000000",
          amountType: "seller-holding",
          date: "2020-01-01",
        },
      ],
    );

    expect(ledger.entries[0].error).toContain("12 digits");
  });
  it("supports onward sales to an existing family member", () => {
    const ledger = buildOwnershipLedger(
      [
        { id: "a", name: "A", sharePercent: 50 },
        { id: "b", name: "B", sharePercent: 50 },
      ],
      [{ id: "outsider", name: "Outside buyer", type: "individual" }],
      [
        {
          id: "one",
          sellerId: "a",
          buyerId: "outsider",
          numerator: 1,
          denominator: 2,
          amountType: "seller-holding",
          date: "2020-01-01",
        },
        {
          id: "two",
          sellerId: "outsider",
          buyerId: "b",
          numerator: 1,
          denominator: 2,
          amountType: "seller-holding",
          date: "2020-01-02",
        },
      ],
    );
    expect(ledger.owners.find((owner) => owner.id === "b").share).toBe(0.625);
    expect(ledger.owners.find((owner) => owner.id === "outsider").share).toBe(0.125);
  });
  it("links holdings to family-tree people and allows a non-heir family member to buy", () => {
    const ledger = buildOwnershipLedger(
      [{ id: "heir-record", personId: "person-a", name: "A", sharePercent: 100 }],
      [],
      [
        {
          id: "sale",
          sellerId: "heir-record",
          buyerId: "person-b",
          numerator: 1,
          denominator: 4,
          amountType: "seller-holding",
          date: "2020-01-01",
        },
      ],
      [
        { id: "person-a", fullName: "A" },
        { id: "person-b", fullName: "B" },
      ],
    );
    expect(ledger.owners.find((owner) => owner.personId === "person-a").share).toBe(0.75);
    expect(ledger.owners.find((owner) => owner.personId === "person-b").share).toBe(0.25);
  });
  it("rejects a transfer greater than the seller's holding", () => {
    const ledger = buildOwnershipLedger(
      [
        { id: "a", sharePercent: 25 },
        { id: "b", sharePercent: 75 },
      ],
      [],
      [
        {
          id: "bad",
          sellerId: "a",
          buyerId: "b",
          numerator: 1,
          denominator: 2,
          amountType: "whole-property",
          date: "2020-01-01",
        },
      ],
    );
    expect(ledger.entries[0].error).toContain("does not own enough");
    expect(ledger.owners.find((owner) => owner.id === "a").share).toBe(0.25);
  });
  it("drops a stale stored error when a transfer later becomes valid", () => {
    const ledger = buildOwnershipLedger(
      [
        { id: "a", sharePercent: 100 },
        { id: "b", sharePercent: 0 },
      ],
      [],
      [
        {
          id: "sale",
          sellerId: "a",
          buyerId: "b",
          numerator: 1,
          denominator: 2,
          amountType: "seller-holding",
          error: "Old validation failure",
          date: "2020-01-01",
        },
      ],
    );

    expect(ledger.entries[0].error).toBeUndefined();
    expect(ledger.entries[0].amount).toBeCloseTo(0.5);
  });
});

describe("per-property ownership ledger", () => {
  it("starts from a property's automatic ownership instead of a manual heir list", () => {
    const ledger = buildPropertyLedger(
      [
        { id: "child-a", fullName: "Child A" },
        { id: "child-b", fullName: "Child B" },
      ],
      [],
      [],
      { "child-a": 0.5, "child-b": 0.5 },
    );
    expect(ledger.owners.find((owner) => owner.id === "child-a").share).toBe(0.5);
    expect(ledger.owners.find((owner) => owner.id === "child-b").share).toBe(0.5);
    expect(ledger.total).toBe(1);
  });

  it("lets a property owner sell a fraction to an outside company", () => {
    const ledger = buildPropertyLedger(
      [{ id: "owner", fullName: "Owner" }],
      [{ id: "company", name: "Buyer Ltd", type: "company" }],
      [
        {
          id: "sale",
          sellerId: "owner",
          buyerId: "company",
          numerator: 1,
          denominator: 4,
          amountType: "seller-holding",
          date: "2020-01-01",
        },
      ],
      { owner: 1 },
    );
    expect(ledger.owners.find((owner) => owner.id === "owner").share).toBe(0.75);
    expect(ledger.owners.find((owner) => owner.id === "company").share).toBe(0.25);
  });

  it("moves ownership on a donation to a person outside the family branch", () => {
    const ledger = buildPropertyLedger(
      [
        { id: "donor", fullName: "Joseph Borg" },
        { id: "donee", fullName: "Carmen Vella" },
      ],
      [],
      [
        {
          id: "gift",
          kind: "donation",
          sellerId: "donor",
          buyerId: "donee",
          date: "2024-06-01",
          numerator: 1,
          denominator: 4,
          amountType: "seller-holding",
        },
      ],
      { donor: 1 },
    );
    expect(ledger.owners.find((owner) => owner.id === "donor").share).toBe(0.75);
    expect(ledger.owners.find((owner) => owner.id === "donee").share).toBe(0.25);
    // The kind survives into the ledger entry so history and provenance can name it a donation.
    expect(ledger.entries[0].kind).toBe("donation");
  });

  it("rejects a transfer before acquisition or after a known seller death", () => {
    const beforeAcquisition = buildPropertyLedger(
      [
        { id: "owner", fullName: "Owner" },
        { id: "buyer", fullName: "Buyer" },
      ],
      [],
      [
        {
          id: "sale",
          sellerId: "owner",
          buyerId: "buyer",
          numerator: 1,
          denominator: 2,
          amountType: "seller-holding",
          date: "2020-01-01",
          provenance: [{ acquiredOn: "2020-01-01" }],
        },
      ],
      { owner: 1 },
    );
    expect(beforeAcquisition.entries[0].error).toContain("after every known acquisition date");

    const afterDeath = buildPropertyLedger(
      [
        { id: "owner", fullName: "Owner", dateOfDeath: "2020-01-01" },
        { id: "buyer", fullName: "Buyer" },
      ],
      [],
      [
        {
          id: "sale",
          sellerId: "owner",
          buyerId: "buyer",
          numerator: 1,
          denominator: 2,
          amountType: "seller-holding",
          date: "2020-01-02",
        },
      ],
      { owner: 1 },
    );
    expect(afterDeath.entries[0].error).toContain("on or before the seller's date of death");
  });

  it("keeps ledgers for two different properties independent", () => {
    const people = [
      { id: "a", fullName: "A" },
      { id: "b", fullName: "B" },
    ];
    const ledgerA = buildPropertyLedger(people, [], [], { a: 1 });
    const ledgerB = buildPropertyLedger(people, [], [], { b: 1 });
    expect(ledgerA.owners.map((owner) => owner.id)).toEqual(["a"]);
    expect(ledgerB.owners.map((owner) => owner.id)).toEqual(["b"]);
  });

  it("keeps one canonical party when an outside individual is promoted to a tree person", () => {
    const ledger = buildPropertyLedger(
      [{ id: "buyer", fullName: "Maria Vella" }],
      [{ id: "buyer", name: "Maria Vella", type: "individual" }],
      [],
      { buyer: 1 },
    );

    expect(ledger.parties.filter((party) => party.id === "buyer")).toHaveLength(1);
    expect(ledger.owners).toHaveLength(1);
    expect(ledger.total).toBe(1);
  });
});
