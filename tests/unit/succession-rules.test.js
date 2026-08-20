import { describe, expect, it } from "vitest";
import {
  isLegacyHistoricalLawWarning,
  legacyHistoricalLawReview,
  legacyHistoricalLawWarning,
} from "../../src/domain/successionRules.js";

describe("section-specific historical-law warnings", () => {
  it("warns only when the death predates a verified change to an applicable section", () => {
    const review = legacyHistoricalLawReview("1990-04-02", ["808", "809", "826"]);

    expect(review.required).toBe(true);
    expect(review.articles).toEqual(["826"]);
    expect(review.warning).toContain("article 826");
    expect(review.warning).toContain("01-12-1993");
  });

  it("does not turn a broad range or unchanged sections into a warning", () => {
    expect(legacyHistoricalLawWarning("1990-04-02", ["788–830"])).toBe("");
    expect(legacyHistoricalLawWarning("1990-04-02", ["808", "809"])).toBe("");
    expect(legacyHistoricalLawWarning("1990-04-02", ["825"])).toBe("");
  });

  it("does not warn once the verified amendment was already in force", () => {
    expect(legacyHistoricalLawWarning("1993-12-01", ["825"])).toBe("");
  });

  it("recognises only the dedicated historical-law warning prefix", () => {
    expect(isLegacyHistoricalLawWarning(legacyHistoricalLawWarning("1990-04-02", ["826"]))).toBe(
      true,
    );
    expect(isLegacyHistoricalLawWarning("Enter a missing death date.")).toBe(false);
  });
});
