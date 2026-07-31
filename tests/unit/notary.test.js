import { describe, expect, it } from "vitest";
import { displayNotaryName } from "../../src/domain/notary.js";

describe("displayNotaryName", () => {
  it("adds the requested Not. prefix to an entered notary name", () => {
    expect(displayNotaryName("Maria Vella")).toBe("Not. Maria Vella");
  });

  it("does not duplicate an existing Not. prefix", () => {
    expect(displayNotaryName("Not. Maria Vella")).toBe("Not. Maria Vella");
  });
});
