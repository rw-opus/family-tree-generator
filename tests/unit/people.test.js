import { describe, expect, it } from "vitest";
import {
  composeFullName,
  givenNamesFromFullName,
  hasDesignation,
  personAncestors,
  personDesignations,
  personDescendants,
  personDisplayName,
  personGivenNames,
  personIdentityIssues,
  personRelationshipCounts,
  personSurname,
  surnameFromFullName,
} from "../../src/domain/people.js";

describe("family tree people", () => {
  it("normalises old and new designation shapes", () => {
    expect(personDesignations({ designation: "Child" })).toEqual(["Child"]);
    expect(personDesignations({ designations: ["Child", "Child", ""] })).toEqual(["Child"]);
    expect(hasDesignation({ designations: ["Surviving Spouse"] }, "surviving spouse")).toBe(true);
  });

  it("derives a default surname from a full name", () => {
    expect(surnameFromFullName("Joseph Borg")).toBe("Borg");
    expect(surnameFromFullName("Joseph")).toBe("");
    expect(givenNamesFromFullName("Joseph Paul Borg")).toBe("Joseph Paul");
    expect(composeFullName("Joseph Paul", "Borg")).toBe("Joseph Paul Borg");
    expect(personGivenNames({ fullName: "Joseph Borg" })).toBe("Joseph");
    expect(personSurname({ fullName: "Joseph Borg" })).toBe("Borg");
  });

  it("counts reciprocal and parent-based relationships", () => {
    const people = [
      { id: "p", fatherId: "f", spouseIds: ["s"], siblingIds: ["b"] },
      { id: "s", spouseIds: ["p"] },
      { id: "b", siblingIds: ["p"] },
      { id: "c1", fatherId: "p" },
      { id: "c2", fatherId: "p" },
    ];
    expect(personRelationshipCounts(people, people[0])).toEqual({
      father: 1,
      mother: 0,
      spouse: 1,
      child: 2,
      sibling: 1,
    });
  });

  it("describes unnamed people by their relationship to a named person", () => {
    const people = [
      { id: "joseph", fullName: "Joseph Borg", fatherId: "father" },
      { id: "father", fullName: "", sex: "Male" },
      {
        id: "spouse",
        fullName: "",
        sex: "Female",
        spouseIds: ["joseph"],
      },
    ];
    expect(personDisplayName(people[1], people)).toBe("Father of Joseph Borg");
    expect(personDisplayName(people[2], people)).toBe("Partner of Joseph Borg");
  });

  it("requires names, surname, and a woman's surname at birth before relationships", () => {
    expect(personIdentityIssues({ fullName: "" })).toEqual(["Names", "Surname", "Sex"]);
    expect(
      personIdentityIssues({
        fullName: "Maria Borg",
        sex: "Female",
        surnameAtBirth: "",
      }),
    ).toEqual(["Surname at birth"]);
    expect(
      personIdentityIssues({
        fullName: "Maria Borg",
        sex: "Female",
        surnameAtBirth: "Vella",
      }),
    ).toEqual([]);
  });

  it("finds every generation of descendants without including the person", () => {
    const people = [
      { id: "ancestor" },
      { id: "child", fatherId: "ancestor" },
      { id: "grandchild", motherId: "child" },
      { id: "unrelated" },
    ];
    expect(personDescendants(people, "ancestor").map((person) => person.id)).toEqual([
      "child",
      "grandchild",
    ]);
  });

  it("finds every known ancestor without including the person", () => {
    const people = [
      { id: "grandfather" },
      { id: "father", fatherId: "grandfather" },
      { id: "child", fatherId: "father" },
      { id: "unrelated" },
    ];
    expect(personAncestors(people, "child").map((person) => person.id)).toEqual([
      "father",
      "grandfather",
    ]);
  });

});
