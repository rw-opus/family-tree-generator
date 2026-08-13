import { describe, expect, it } from "vitest";
import {
  advisoryCausaMortisCoverage,
  isCausaMortisCoverageActionRequired,
  visibleCausaMortisCoverage,
} from "../../src/domain/causaMortisPresentation.js";

describe("causa mortis coverage presentation", () => {
  it.each(["missing", "under", "mixed", "date-unknown", "allocation-unresolved"])(
    "treats %s coverage as action required",
    (status) => {
      expect(isCausaMortisCoverageActionRequired(status)).toBe(true);
      expect(isCausaMortisCoverageActionRequired({ status })).toBe(true);
    },
  );

  it.each(["complete", "over"])("does not treat %s coverage as action required", (status) => {
    expect(isCausaMortisCoverageActionRequired({ status })).toBe(false);
  });

  it("ignores absent coverage but fails closed for a malformed coverage row", () => {
    expect(isCausaMortisCoverageActionRequired()).toBe(false);
    expect(isCausaMortisCoverageActionRequired({})).toBe(true);
  });

  it("fails closed when a future coverage status is not recognised", () => {
    expect(isCausaMortisCoverageActionRequired({ status: "future-status" })).toBe(true);
  });

  it("hides excess-only rows while retaining complete and mixed coverage summaries", () => {
    const complete = { propertyId: "complete", status: "complete" };
    const mixed = { propertyId: "mixed", status: "mixed" };

    expect(
      visibleCausaMortisCoverage([complete, { propertyId: "over", status: "over" }, mixed]),
    ).toEqual([complete, mixed]);
  });

  it("identifies over-declaration advice without making it an action", () => {
    const over = { propertyId: "over", status: "over" };
    const mixed = { propertyId: "mixed", status: "mixed" };

    expect(
      advisoryCausaMortisCoverage([
        { propertyId: "complete", status: "complete" },
        over,
        mixed,
        { propertyId: "under", status: "under" },
      ]),
    ).toEqual([over, mixed]);
  });
});
