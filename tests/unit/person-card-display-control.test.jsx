// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonCardDisplayControl } from "../../src/components/PersonCardDisplayControl.jsx";
import { DEFAULT_PERSON_CARD_FIELDS } from "../../src/domain/personCardDisplay.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("PersonCardDisplayControl", () => {
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

  it("updates the selected card field from its checkbox", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        <PersonCardDisplayControl fields={DEFAULT_PERSON_CARD_FIELDS} onChange={onChange} />,
      ),
    );

    const labels = [...container.querySelectorAll(".person-card-display-menu label")].map((label) =>
      label.textContent.trim(),
    );
    expect(labels).toEqual([
      "Fractions",
      "Percentages",
      "Current holding value",
      "Testate / intestate",
      "Will details",
      "Causa mortis details",
      "Dates of death",
    ]);

    const willCheckbox = [...container.querySelectorAll('input[type="checkbox"]')].find((input) =>
      input.parentElement.textContent.includes("Will details"),
    );
    act(() => willCheckbox.click());

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_PERSON_CARD_FIELDS,
      willDetails: true,
    });
  });
});
