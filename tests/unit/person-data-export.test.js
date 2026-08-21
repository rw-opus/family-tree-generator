import { describe, expect, it } from "vitest";
import { buildPersonDataExport } from "../../src/domain/personDataExport.js";

describe("person data workbook export", () => {
  it("sorts surname first and reports available and missing person-card data", () => {
    const people = [
      {
        id: "father",
        givenNames: "Edgar",
        surname: "Wadge",
        fullName: "Edgar Wadge",
        sex: "Male",
        spouseIds: ["maria"],
        dateOfDeath: "2008-05-20",
        isDeceased: true,
      },
      {
        id: "mother",
        givenNames: "Carmela",
        surname: "Borg",
        fullName: "Carmela Borg",
        sex: "Female",
        surnameAtBirth: "Borg",
      },
      {
        id: "maria",
        givenNames: "Maria",
        surname: "Abela",
        fullName: "Maria Abela",
        surnameAtBirth: "Borg",
        sex: "Female",
        fatherId: "father",
        motherId: "mother",
        spouseIds: ["father"],
        dateOfBirth: "1940-01-02",
        dateOfDeathUnknown: true,
        isDeceased: true,
        inheritanceBasis: "will",
        wills: [
          {
            id: "will",
            date: "2007-04-03",
            notaryName: "Roland Wadge",
            description: "Public will",
          },
        ],
        willHeirs: [
          {
            id: "heir",
            personId: "mother",
            shareNumerator: 1,
            shareDenominator: 1,
          },
        ],
        causaMortisDeclarations: [
          {
            id: "cm",
            status: "complete",
            propertyId: "property",
            declaredShareNumerator: 1,
            declaredShareDenominator: 4,
            date: "2025-05-25",
            notaryName: "Roland J. Wadge",
            immovablePropertyValue: 20000,
            declarantPersonIds: ["mother"],
          },
        ],
      },
    ];

    const result = buildPersonDataExport({
      people,
      familyPersonIds: ["maria", "mother"],
      property: { id: "property", address: "Test property", owners: [], transfers: [] },
    });

    expect(result.rows.map((row) => `${row.surname}, ${row.name}`)).toEqual([
      "Abela, Maria",
      "Borg, Carmela",
      "Wadge, Edgar",
    ]);
    expect(result.rows[0]).toMatchObject({
      parents: "Father: Edgar Wadge; Mother: Carmela Borg",
      dateOfDeath: "Unknown (calculator assumes 20/05/2008 from spouse)",
      succession: "Testate",
      willDate: "03/04/2007",
      willNotary: "Roland Wadge",
    });
    expect(result.rows[0].causaMortis).toContain("share 1/4");
    expect(result.rows[0].causaMortis).toContain("EUR 20000");
    expect(result.rows[0].missingData).not.toContain("Date of death");
    expect(result.rows[0].availableData).toContain("Declaration Causa Mortis");
    expect(result.rows[2].familyTreeStatus).toContain("Retained legal / tax identity");
    expect(result.missingRows).toEqual(
      expect.arrayContaining([expect.objectContaining({ personId: "father", field: "Father" })]),
    );
    // The date of birth drives no succession or tax outcome, so it is carried
    // as recorded data and never reported as a gap.
    expect(result.missingRows).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "Date of birth" })]),
    );
  });

  it("lists a missing will notary and preserves an unknown death as available data", () => {
    const result = buildPersonDataExport({
      people: [
        {
          id: "person",
          givenNames: "Anna",
          surname: "Borg",
          fullName: "Anna Borg",
          surnameAtBirth: "Borg",
          sex: "Female",
          isDeceased: true,
          dateOfDeathUnknown: true,
          inheritanceBasis: "will",
          wills: [{ id: "will", date: "1900-01-01", notaryName: "" }],
        },
      ],
    });

    expect(result.rows[0].dateOfDeath).toBe("Unknown");
    expect(result.missingRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "Will notary", category: "Succession" }),
      ]),
    );
    expect(result.missingRows).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "Date of death" })]),
    );
  });
});
