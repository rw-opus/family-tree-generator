import { describe, expect, it } from "vitest";
import {
  approximateFraction,
  buildOwnershipLedger,
  buildPropertyLedger,
  buildStarterOwnership,
} from "../../src/domain/ownership.js";

describe("ownership transfer ledger", () => {
  it("shows useful fractional labels", () => {
    expect(approximateFraction(1 / 3)).toEqual({ numerator: 1, denominator: 3 });
  });
  it("leaves a lone first person without a displayed ownership share", () => {
    expect(buildStarterOwnership([{ id: "first" }])).toEqual({});
  });
  it("defaults two top-level parents to one half each", () => {
    expect(
      buildStarterOwnership([
        { id: "father" },
        { id: "mother" },
        { id: "child", fatherId: "father", motherId: "mother" },
      ]),
    ).toEqual({ father: 0.5, mother: 0.5 });
  });
  it("lets one top-level parent own the whole property", () => {
    expect(
      buildStarterOwnership([
        { id: "father", ownershipSharePercent: 100 },
        { id: "mother" },
        { id: "child", fatherId: "father", motherId: "mother" },
      ]),
    ).toEqual({ father: 1, mother: 0 });
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
});
