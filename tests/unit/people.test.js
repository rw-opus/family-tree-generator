import { describe, expect, it } from "vitest";
import { hasDesignation, personDesignations } from "../../src/domain/people.js";

describe("family tree people", () => {
  it("normalises old and new designation shapes", () => {
    expect(personDesignations({ designation: "Child" })).toEqual(["Child"]);
    expect(personDesignations({ designations: ["Child", "Child", ""] })).toEqual(["Child"]);
    expect(hasDesignation({ designations: ["Surviving Spouse"] }, "surviving spouse")).toBe(true);
  });
});

