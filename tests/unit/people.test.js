import { describe, expect, it } from "vitest";
import { hasDesignation, personDesignations, personRelationshipCounts, surnameFromFullName } from "../../src/domain/people.js";

describe("family tree people", () => {
  it("normalises old and new designation shapes", () => {
    expect(personDesignations({ designation: "Child" })).toEqual(["Child"]);
    expect(personDesignations({ designations: ["Child", "Child", ""] })).toEqual(["Child"]);
    expect(hasDesignation({ designations: ["Surviving Spouse"] }, "surviving spouse")).toBe(true);
  });

  it("derives a default surname from a full name", () => {
    expect(surnameFromFullName("Joseph Borg")).toBe("Borg");
    expect(surnameFromFullName("Joseph")).toBe("");
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
});
