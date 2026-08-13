import { describe, expect, it } from "vitest";
import {
  buildCausaMortisShareCoverage,
  validateCausaMortisDeclaration,
} from "../../src/domain/causaMortisCoverage.js";

const property = {
  id: "property-1",
  address: "1 Republic Street",
  owners: [
    { personId: "deceased", sharePercent: 50 },
    { personId: "co-owner", sharePercent: 50 },
  ],
};

const peopleWithDeclarations = (declarations = [], dateOfDeath = "2020-01-01") => [
  {
    id: "deceased",
    fullName: "Joseph Borg",
    isDeceased: true,
    dateOfDeath,
    inheritanceBasis: "will",
    willDate: "2010-01-01",
    willHeirs: [{ id: "heir-record", personId: "child", sharePercent: 100 }],
    causaMortisDeclarations: declarations.map((declaration) => ({
      date: "2020-02-01",
      declarantPersonIds: ["child"],
      ...declaration,
    })),
  },
  { id: "child", fullName: "Maria Borg" },
  { id: "co-owner", fullName: "Paul Vella" },
];

describe("buildCausaMortisShareCoverage", () => {
  it("requires declarations only for the share left after a lifetime transfer", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        willDate: "2010-01-01",
        willHeirs: [{ id: "heir-record", personId: "child", sharePercent: 100 }],
        causaMortisDeclarations: [
          {
            id: "cm",
            status: "complete",
            propertyId: "property-1",
            declaredShareNumerator: 3,
            declaredShareDenominator: 4,
            date: "2020-02-01",
            declarantPersonIds: ["child"],
          },
        ],
      },
      { id: "child", fullName: "Maria Borg" },
      { id: "buyer", fullName: "Paul Vella" },
    ];
    const transferredProperty = {
      id: "property-1",
      address: "1 Republic Street",
      owners: [{ id: "initial", personId: "deceased", sharePercent: 100 }],
      transfers: [
        {
          id: "gift",
          kind: "donation",
          sellerId: "deceased",
          buyerId: "buyer",
          numerator: 1,
          denominator: 4,
          amountType: "whole-property",
          date: "2019-01-01",
          provenance: [{ trancheId: "initial-initial", numerator: 1, denominator: 4 }],
        },
      ],
    };

    const result = buildCausaMortisShareCoverage(people, [transferredProperty]).rows[0];

    expect(result.requiredFraction).toEqual({ numerator: 3, denominator: 4 });
    expect(result.declaredFraction).toEqual({ numerator: 3, denominator: 4 });
    expect(result.status).toBe("complete");
  });

  it("marks missing, exact, and excess declaration shares", () => {
    const missing = buildCausaMortisShareCoverage(peopleWithDeclarations([]), [property]).rows[0];
    expect(missing).toMatchObject({
      requiredShare: 0.5,
      declaredShare: 0,
      status: "under",
    });

    const exact = buildCausaMortisShareCoverage(
      peopleWithDeclarations([
        {
          id: "cm-1",
          status: "complete",
          propertyId: "property-1",
          declaredShareNumerator: 1,
          declaredShareDenominator: 4,
        },
        {
          id: "cm-2",
          status: "complete",
          propertyId: "property-1",
          declaredShareNumerator: 1,
          declaredShareDenominator: 4,
        },
      ]),
      [property],
    ).rows[0];
    expect(exact).toMatchObject({
      requiredShare: 0.5,
      declaredShare: 0.5,
      status: "complete",
    });

    const excess = buildCausaMortisShareCoverage(
      peopleWithDeclarations([
        {
          id: "cm-1",
          status: "complete",
          propertyId: "property-1",
          declaredShareNumerator: 3,
          declaredShareDenominator: 4,
        },
      ]),
      [property],
    ).rows[0];
    expect(excess).toMatchObject({
      requiredShare: 0.5,
      declaredShare: 0.75,
      status: "over",
    });
  });

  it("keeps one declarant's excess separate from another heir's missing share", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        willDate: "2019-01-01",
        willHeirs: [
          { id: "a-share", personId: "a", shareNumerator: 1, shareDenominator: 2 },
          { id: "b-share", personId: "b", shareNumerator: 1, shareDenominator: 4 },
          { id: "c-share", personId: "c", shareNumerator: 1, shareDenominator: 4 },
        ],
        causaMortisDeclarations: [
          {
            id: "cm-ab",
            status: "complete",
            propertyId: "property-1",
            declaredShareNumerator: 1,
            declaredShareDenominator: 1,
            immovablePropertyValue: "1200",
            date: "2020-02-01",
            notaryName: "Maria Vella",
            declarantPersonIds: ["a", "b"],
          },
        ],
      },
      { id: "a", fullName: "Heir A" },
      { id: "b", fullName: "Heir B" },
      { id: "c", fullName: "Heir C" },
    ];
    const wholeProperty = {
      id: "property-1",
      address: "1 Republic Street",
      owners: [{ id: "initial", personId: "deceased", sharePercent: 100 }],
    };

    const row = buildCausaMortisShareCoverage(people, [wholeProperty]).rows[0];

    expect(row).toMatchObject({
      status: "mixed",
      requiredFraction: { numerator: 1, denominator: 1 },
      declaredFraction: { numerator: 1, denominator: 1 },
      missingFraction: { numerator: 1, denominator: 4 },
      excessFraction: { numerator: 1, denominator: 4 },
      underDeclaredRecipientIds: ["c"],
      overDeclaredRecipientIds: ["a", "b"],
    });
    expect(row.recipientCoverage).toEqual([
      expect.objectContaining({
        personId: "a",
        requiredFraction: { numerator: 1, denominator: 2 },
        declaredFraction: { numerator: 2, denominator: 3 },
        declaredValue: 800,
        status: "over",
      }),
      expect.objectContaining({
        personId: "b",
        requiredFraction: { numerator: 1, denominator: 4 },
        declaredFraction: { numerator: 1, denominator: 3 },
        declaredValue: 400,
        status: "over",
      }),
      expect.objectContaining({
        personId: "c",
        declaredFraction: { numerator: 0, denominator: 1 },
        declaredValue: 0,
        status: "under",
      }),
    ]);
  });

  it("treats a legacy unassigned declaration as belonging to the sole property", () => {
    const result = buildCausaMortisShareCoverage(
      peopleWithDeclarations([
        {
          id: "legacy-cm",
          status: "complete",
          declaredShareNumerator: 1,
          declaredShareDenominator: 2,
        },
      ]),
      [property],
    );
    expect(result.rows[0].status).toBe("complete");
  });

  it("does not require causa mortis share coverage before the cutoff", () => {
    const result = buildCausaMortisShareCoverage(peopleWithDeclarations([], "1990-01-01"), [
      property,
    ]);
    expect(result.rows).toEqual([]);
  });

  it("requires causa mortis coverage for a succession opening on 25 November 1992", () => {
    const result = buildCausaMortisShareCoverage(peopleWithDeclarations([], "1992-11-25"), [
      property,
    ]);

    expect(result.rows).toEqual([
      expect.objectContaining({ personId: "deceased", status: "under", requiredShare: 0.5 }),
    ]);
  });

  it("flags an approximate or missing death date instead of omitting coverage", () => {
    const people = peopleWithDeclarations([], "");
    people[0].gedcomDeathDate = "ABT 1990";

    const result = buildCausaMortisShareCoverage(people, [property]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      personId: "deceased",
      propertyId: "property-1",
      requiredShare: 0.5,
      status: "date-unknown",
      deathDateText: "ABT 1990",
    });
  });

  it("does not count an unfinished declaration toward declared coverage", () => {
    const result = buildCausaMortisShareCoverage(
      peopleWithDeclarations([
        {
          id: "draft-cm",
          status: "draft",
          propertyId: "property-1",
          declaredShareNumerator: 1,
          declaredShareDenominator: 2,
        },
      ]),
      [property],
    );

    expect(result.rows[0]).toMatchObject({
      requiredShare: 0.5,
      declaredShare: 0,
      status: "under",
    });
  });

  it("does not count a completed declaration dated on or before death", () => {
    const result = buildCausaMortisShareCoverage(
      peopleWithDeclarations([
        {
          id: "invalid-cm",
          status: "complete",
          propertyId: "property-1",
          declaredShareNumerator: 1,
          declaredShareDenominator: 2,
          date: "2020-01-01",
        },
      ]),
      [property],
    );

    expect(result.rows[0]).toMatchObject({ declaredShare: 0, status: "under" });
  });
});

describe("validateCausaMortisDeclaration", () => {
  const completeDeclaration = {
    propertyId: "property-1",
    declaredShareNumerator: 1,
    declaredShareDenominator: 4,
    date: "2020-06-01",
    notaryName: "Dr Maria Vella",
    immovablePropertyValue: "100000",
    declarantPersonIds: ["child"],
  };

  it("requires every non-optional field before completion", () => {
    expect(validateCausaMortisDeclaration(completeDeclaration)).toBe("");
    expect(validateCausaMortisDeclaration({ ...completeDeclaration, date: "" })).toBe(
      "Enter the date of the Declaration Causa Mortis.",
    );
    expect(validateCausaMortisDeclaration({ ...completeDeclaration, notaryName: "" })).toBe(
      "Enter the notary's name.",
    );
    expect(
      validateCausaMortisDeclaration({
        ...completeDeclaration,
        declarantPersonIds: [],
      }),
    ).toBe("Select at least one declarant or heir.");
  });

  it("allows an omitted value only when it is explicitly optional", () => {
    const withoutValue = { ...completeDeclaration, immovablePropertyValue: "" };
    expect(validateCausaMortisDeclaration(withoutValue)).toBe(
      "Enter the immovable-property value declared.",
    );
    expect(validateCausaMortisDeclaration(withoutValue, { valueRequired: false })).toBe("");
  });

  it("accepts a recorded fraction larger than the inherited share", () => {
    expect(
      validateCausaMortisDeclaration(completeDeclaration, {
        availableShare: 0.2,
      }),
    ).toBe("");
  });

  it("requires the declaration date to be after a known death", () => {
    expect(
      validateCausaMortisDeclaration(completeDeclaration, {
        dateOfDeath: "2020-06-01",
      }),
    ).toBe("Declaration causa mortis date must be after the date of death.");
    expect(
      validateCausaMortisDeclaration(completeDeclaration, {
        dateOfDeath: "2020-05-31",
      }),
    ).toBe("");
  });
});
