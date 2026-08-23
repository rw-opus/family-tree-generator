import { describe, expect, it } from "vitest";
import { buildTreeRegisterRows } from "../../src/domain/treeRegister.js";

describe("Tree Register rows", () => {
  it("uses the same historical/current ownership and automatic values as person cards", () => {
    const people = [
      {
        id: "father",
        givenNames: "Joseph",
        surname: "Borg",
        fullName: "Joseph Borg",
        sex: "Male",
      },
      {
        id: "maria",
        givenNames: "Maria",
        surname: "Abela",
        fullName: "Maria Abela",
        sex: "Female",
        fatherId: "father",
        isDeceased: true,
        dateOfDeath: "2020-05-06",
        inheritanceBasis: "will",
        wills: [
          { id: "will-1", date: "2018-01-02", notaryName: "A. Vella", description: "First" },
          { id: "will-2", date: "2019-02-03", notaryName: "B. Borg", description: "Later" },
        ],
        causaMortisDeclarations: [
          { id: "cm-1", propertyId: "property", date: "2020-06-07", notaryName: "C. Calleja" },
        ],
      },
      {
        id: "anna",
        givenNames: "Anna",
        surname: "Borg",
        fullName: "Anna Borg",
      },
    ];

    const rows = buildTreeRegisterRows({
      people,
      property: { id: "property", saleValue: 200000 },
      ownershipByPerson: { maria: 0.25 },
      ownershipFractionsByPerson: { maria: { numerator: 1, denominator: 4 } },
      currentOwnerPresentationsByPerson: {
        anna: {
          share: 0.75,
          shareFraction: { numerator: 3, denominator: 4 },
          displayPercentageLabel: "75%",
          value: 150000,
        },
      },
    });

    const maria = rows.find((row) => row.personId === "maria");
    const anna = rows.find((row) => row.personId === "anna");
    expect(maria).toMatchObject({
      parentage: "Daughter of Joseph Borg",
      successionBasis: "will",
      fractionLabel: "1/4",
      percentageLabel: "25%",
      holdingValue: 50000,
      holdingValueKind: "Notional value",
    });
    expect(maria.wills).toHaveLength(2);
    expect(maria.causaMortisDeclarations).toHaveLength(1);
    expect(anna).toMatchObject({
      fractionLabel: "3/4",
      percentageLabel: "75%",
      holdingValue: 150000,
      holdingValueKind: "Current value",
    });
  });
});
