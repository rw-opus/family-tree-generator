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
    willHeirs: [{ id: "heir-record", personId: "child", sharePercent: 100 }],
    causaMortisDeclarations: declarations,
  },
  { id: "child", fullName: "Maria Borg" },
  { id: "co-owner", fullName: "Paul Vella" },
];

describe("buildCausaMortisShareCoverage", () => {
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

  it("rejects a fraction larger than the remaining share", () => {
    expect(
      validateCausaMortisDeclaration(completeDeclaration, {
        availableShare: 0.2,
      }),
    ).toBe("The declared fraction is greater than the deceased's remaining share.");
  });
});
