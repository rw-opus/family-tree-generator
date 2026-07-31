// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GenerationRowFamilyTree } from "../../src/components/familyTree/GenerationRowFamilyTree.jsx";
import {
  familyGenerationById,
  widestFamilyGeneration,
} from "../../src/components/familyTree/generationRows.js";

describe("generation row family tree", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("places every member of the widest generation in one continuous row", () => {
    const people = [
      { id: "parent", fullName: "Parent" },
      ...Array.from({ length: 79 }, (_, index) => ({
        id: `child-${index + 1}`,
        fullName: `Child ${index + 1}`,
        fatherId: "parent",
      })),
    ];
    const generations = familyGenerationById(people);
    const widestGeneration = widestFamilyGeneration(generations);

    act(() =>
      root.render(
        <GenerationRowFamilyTree
          people={people}
          generationByPerson={generations}
          widestGeneration={widestGeneration}
          renderCard={(person) => (
            <button data-person-id={person.id} type="button">
              {person.fullName}
            </button>
          )}
        />,
      ),
    );

    const widestRow = container.querySelector(".family-generation-row.widest-generation");
    expect(widestRow.dataset.generation).toBe("1");
    expect(widestRow.querySelectorAll(":scope > .family-generation-person")).toHaveLength(79);
    expect(widestRow.querySelectorAll("[data-person-id]")).toHaveLength(79);
  });
});
