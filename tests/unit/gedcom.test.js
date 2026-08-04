import { describe, expect, it } from "vitest";
import { parseGedcom } from "../../src/domain/gedcom.js";
import { findPartnerRelationship } from "../../src/domain/partnerRelationships.js";

const SAMPLE = `0 HEAD
1 SOUR TEST
0 @I1@ INDI
1 NAME Joseph /Borg/
1 SEX M
1 BIRT
2 DATE 2 FEB 1940
1 DEAT
2 DATE 10 OCT 2020
0 @I2@ INDI
1 NAME Maria /Borg/
1 SEX F
0 @I3@ INDI
1 NAME Anna /Borg/
1 SEX F
1 BIRT
2 DATE 12 MAR 1970
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
0 TRLR`;

describe("GEDCOM import", () => {
  it("imports individuals, dates and parent links", () => {
    let id = 0;
    const result = parseGedcom(SAMPLE, () => `person-${++id}`);
    expect(result).toMatchObject({ individualCount: 3, familyCount: 1 });
    const joseph = result.people.find((person) => person.fullName === "Joseph Borg");
    const maria = result.people.find((person) => person.fullName === "Maria Borg");
    const anna = result.people.find((person) => person.fullName === "Anna Borg");
    expect(joseph).toMatchObject({
      givenNames: "Joseph",
      surname: "Borg",
      dateOfBirth: "1940-02-02",
      dateOfDeath: "2020-10-10",
      isDeceased: true,
      surnameAtBirth: "Borg",
    });
    expect(anna).toMatchObject({
      fatherId: joseph.id,
      motherId: maria.id,
      dateOfBirth: "1970-03-12",
      surnameAtBirth: "Borg",
    });
    expect(joseph.spouseIds).toContain(maria.id);
    expect(findPartnerRelationship(result.people, joseph.id, maria.id)).toMatchObject({
      type: "marriage",
      startDate: "",
      inferredFromLegacySpouseIds: false,
    });
  });

  it("imports one canonical dated marriage when GEDCOM repeats a family pair", () => {
    const gedcom = `0 HEAD
0 @I1@ INDI
1 NAME Joseph /Borg/
1 SEX M
0 @I2@ INDI
1 NAME Maria /Vella/
1 SEX F
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
0 @F2@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 3 FEB 2014
0 TRLR`;
    let id = 0;

    const result = parseGedcom(gedcom, () => `person-${++id}`);
    const joseph = result.people.find((person) => person.gedcomId === "@I1@");
    const maria = result.people.find((person) => person.gedcomId === "@I2@");
    const relationship = findPartnerRelationship(result.people, maria.id, joseph.id);
    const metadataEntries = result.people.flatMap((person) => person.partnerRelationships || []);

    expect(result.familyCount).toBe(2);
    expect(joseph.spouseIds).toEqual([maria.id]);
    expect(maria.spouseIds).toEqual([joseph.id]);
    expect(metadataEntries).toHaveLength(1);
    expect(metadataEntries[0]).toMatchObject({
      personId: maria.id,
      type: "marriage",
      startDate: "2014-02-03",
    });
    expect(relationship).toMatchObject({
      type: "marriage",
      startDate: "2014-02-03",
      startYear: "2014",
      inferredFromLegacySpouseIds: false,
    });
  });
  it("returns an empty tree for content without individual records", () => {
    expect(parseGedcom("0 HEAD\n0 TRLR").people).toEqual([]);
  });

  it("keeps a compound GEDCOM surname out of the given-name field", () => {
    const result = parseGedcom(
      `0 HEAD
0 @I1@ INDI
1 NAME Pandolfo /Testaferrata de Noto/
1 SEX M
0 TRLR`,
      () => "pandolfo",
    );

    expect(result.people[0]).toMatchObject({
      fullName: "Pandolfo Testaferrata de Noto",
      givenNames: "Pandolfo",
      surname: "Testaferrata de Noto",
    });
  });

  it("fills only missing descendant surnames from the GEDCOM father", () => {
    const gedcom = `0 HEAD
0 @I1@ INDI
1 NAME Joseph /Borg/
1 SEX M
0 @I2@ INDI
1 NAME Maria
1 SEX F
0 @I3@ INDI
1 NAME Anna /Vella/
1 SEX F
0 @F1@ FAM
1 HUSB @I1@
1 CHIL @I2@
1 CHIL @I3@
0 TRLR`;
    let id = 0;

    const result = parseGedcom(gedcom, () => `person-${++id}`);
    const maria = result.people.find((person) => person.gedcomId === "@I2@");
    const anna = result.people.find((person) => person.gedcomId === "@I3@");

    expect(maria).toMatchObject({
      fullName: "Maria Borg",
      surname: "Borg",
      surnameAtBirth: "Borg",
    });
    expect(anna).toMatchObject({
      fullName: "Anna Vella",
      surname: "Vella",
      surnameAtBirth: "Vella",
    });
  });

  it("retains the first parent relationship and reports conflicting families and approximate dates", () => {
    const gedcom = `0 HEAD
0 @I1@ INDI
1 NAME First /Father/
0 @I2@ INDI
1 NAME Second /Father/
0 @I3@ INDI
1 NAME Child /Person/
1 BIRT
2 DATE ABT 2000
0 @F1@ FAM
1 HUSB @I1@
1 CHIL @I3@
0 @F2@ FAM
1 HUSB @I2@
1 CHIL @I3@
0 TRLR`;
    let id = 0;
    const result = parseGedcom(gedcom, () => `person-${++id}`);
    const child = result.people.find((person) => person.gedcomId === "@I3@");
    const firstFather = result.people.find((person) => person.gedcomId === "@I1@");

    expect(child.fatherId).toBe(firstFather.id);
    expect(child.dateOfBirth).toBe("");
    expect(child.gedcomBirthDate).toBe("ABT 2000");
    expect(result.warnings.join(" ")).toMatch(/more than one father/i);
    expect(result.warnings.join(" ")).toMatch(/not used as an exact legal date/i);
  });
});
