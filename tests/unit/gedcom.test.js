import { describe, expect, it } from "vitest";
import { parseGedcom } from "../../src/domain/gedcom.js";

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
    expect(joseph).toMatchObject({ givenNames: "Joseph", surname: "Borg", dateOfBirth: "1940-02-02", dateOfDeath: "2020-10-10", isDeceased: true, surnameAtBirth: "Borg" });
    expect(anna).toMatchObject({ fatherId: joseph.id, motherId: maria.id, dateOfBirth: "1970-03-12", surnameAtBirth: "Borg" });
    expect(joseph.spouseIds).toContain(maria.id);
  });
  it("returns an empty tree for content without individual records", () => {
    expect(parseGedcom("0 HEAD\n0 TRLR").people).toEqual([]);
  });
});
