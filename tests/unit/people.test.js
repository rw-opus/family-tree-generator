import { describe, expect, it } from "vitest";
import { hasDesignation, personDesignations, surnameFromFullName } from "../../src/domain/people.js";

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
});
