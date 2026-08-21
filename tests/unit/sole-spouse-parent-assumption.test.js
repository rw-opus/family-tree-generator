import { describe, expect, it } from "vitest";
import { normaliseCase } from "../../src/domain/caseModel.js";
import { buildPersonDataExport } from "../../src/domain/personDataExport.js";

const person = (id, extra = {}) => ({
  id,
  fullName: `${id} Borg`,
  spouseIds: [],
  siblingIds: [],
  designations: [],
  ...extra,
});

const caseWith = (people) => normaliseCase({ id: "case-1", title: "Borg", people });

describe("sole spouse parent assumption", () => {
  it("assumes the other parent when the recorded parent has exactly one spouse", () => {
    const { people } = caseWith([
      person("father", { spouseIds: ["mother"], sex: "Male" }),
      person("mother", { spouseIds: ["father"], sex: "Female" }),
      person("child", { fatherId: "father" }),
    ]);
    expect(people.find((entry) => entry.id === "child").motherId).toBe("mother");
  });

  it("works in the other direction, from a recorded mother", () => {
    const { people } = caseWith([
      person("father", { spouseIds: ["mother"], sex: "Male" }),
      person("mother", { spouseIds: ["father"], sex: "Female" }),
      person("child", { motherId: "mother" }),
    ]);
    expect(people.find((entry) => entry.id === "child").fatherId).toBe("father");
  });

  it("asks rather than guesses when the recorded parent married twice", () => {
    const { people } = caseWith([
      person("father", { spouseIds: ["first", "second"], sex: "Male" }),
      person("first", { spouseIds: ["father"], sex: "Female" }),
      person("second", { spouseIds: ["father"], sex: "Female" }),
      person("child", { fatherId: "father" }),
    ]);
    expect(people.find((entry) => entry.id === "child").motherId).toBeFalsy();
  });

  it("never re-fills a parent the user deliberately cleared", () => {
    const { people } = caseWith([
      person("father", { spouseIds: ["mother"], sex: "Male" }),
      person("mother", { spouseIds: ["father"], sex: "Female" }),
      person("child", { fatherId: "father", motherExplicitlyUnassigned: true }),
    ]);
    expect(people.find((entry) => entry.id === "child").motherId).toBeFalsy();
  });

  it("leaves an already recorded parent alone", () => {
    const { people } = caseWith([
      person("father", { spouseIds: ["mother"], sex: "Male" }),
      person("mother", { spouseIds: ["father"], sex: "Female" }),
      person("other", { sex: "Female" }),
      person("child", { fatherId: "father", motherId: "other" }),
    ]);
    expect(people.find((entry) => entry.id === "child").motherId).toBe("other");
  });
});

describe("imported birth dates and the missing-data list", () => {
  const rowsFor = (people) => {
    const caseData = caseWith(people);
    return buildPersonDataExport({
      people: caseData.people,
      property: caseData.properties?.[0] || {},
      outsideParties: [],
    });
  };

  it("does not report a date of birth as missing when the GEDCOM recorded one", () => {
    const { rows } = rowsFor([person("p1", { gedcomBirthDate: "ABT 1875", dateOfBirth: "" })]);
    const row = rows.find((entry) => entry.personId === "p1");
    expect(row.missingData).not.toMatch(/Date of birth/);
    expect(row.availableData).toMatch(/Date of birth as recorded \(ABT 1875\)/);
  });

  it("still reports it when nothing at all was recorded", () => {
    const { rows } = rowsFor([person("p2", { gedcomBirthDate: "", dateOfBirth: "" })]);
    expect(rows.find((entry) => entry.personId === "p2").missingData).toMatch(/Date of birth/);
  });
});
