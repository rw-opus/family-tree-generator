import { describe, expect, it } from "vitest";
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
        },
      ],
    );
    expect(ledger.owners.find((owner) => owner.id === "heir").share).toBe(0.25);
    expect(ledger.owners.find((owner) => owner.id === "company").share).toBe(0.25);
    expect(ledger.total).toBe(1);
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
        },
        {
          id: "two",
          sellerId: "outsider",
          buyerId: "b",
          numerator: 1,
          denominator: 2,
          amountType: "seller-holding",
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
        },
      ],
      { owner: 1 },
    );
    expect(ledger.owners.find((owner) => owner.id === "owner").share).toBe(0.75);
    expect(ledger.owners.find((owner) => owner.id === "company").share).toBe(0.25);
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
