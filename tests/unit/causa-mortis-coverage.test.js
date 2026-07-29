import { describe, expect, it } from "vitest";
import { buildCausaMortisShareCoverage } from "../../src/domain/causaMortisCoverage.js";

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
          propertyId: "property-1",
          declaredShareNumerator: 1,
          declaredShareDenominator: 4,
        },
        {
          id: "cm-2",
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
});
