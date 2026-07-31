import { describe, expect, it } from "vitest";
import {
  familyGenerationById,
  widestFamilyGeneration,
} from "../../src/components/familyTree/generationRows.js";

describe("family generation rows", () => {
  it("places partners, siblings and cousins at their shared genealogical depth", () => {
    const people = [
      { id: "grandfather", spouseIds: ["grandmother"] },
      { id: "grandmother", spouseIds: ["grandfather"] },
      {
        id: "first-child",
        fatherId: "grandfather",
        motherId: "grandmother",
        siblingIds: ["second-child"],
        spouseIds: ["first-partner"],
      },
      {
        id: "second-child",
        fatherId: "grandfather",
        motherId: "grandmother",
        siblingIds: ["first-child"],
        spouseIds: ["second-partner"],
      },
      { id: "first-partner", spouseIds: ["first-child"] },
      { id: "second-partner", spouseIds: ["second-child"] },
      { id: "first-grandchild", fatherId: "first-child", motherId: "first-partner" },
      { id: "second-grandchild", fatherId: "second-child", motherId: "second-partner" },
      { id: "great-grandchild", fatherId: "first-grandchild" },
    ];

    const generations = familyGenerationById(people);

    expect(generations.get("grandfather")).toBe(0);
    expect(generations.get("grandmother")).toBe(0);
    expect(generations.get("first-child")).toBe(1);
    expect(generations.get("second-child")).toBe(1);
    expect(generations.get("first-partner")).toBe(1);
    expect(generations.get("second-partner")).toBe(1);
    expect(generations.get("first-grandchild")).toBe(2);
    expect(generations.get("second-grandchild")).toBe(2);
    expect(generations.get("great-grandchild")).toBe(3);
    expect(widestFamilyGeneration(generations)).toBe(1);
  });

  it("starts disconnected family components on the same top row", () => {
    const generations = familyGenerationById([
      { id: "first-root" },
      { id: "first-child", fatherId: "first-root" },
      { id: "second-root" },
      { id: "second-child", motherId: "second-root" },
    ]);

    expect(generations.get("first-root")).toBe(0);
    expect(generations.get("second-root")).toBe(0);
    expect(generations.get("first-child")).toBe(1);
    expect(generations.get("second-child")).toBe(1);
  });
});
