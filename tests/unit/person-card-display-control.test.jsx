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

    const valueCheckbox = [...container.querySelectorAll('input[type="checkbox"]')].find((input) =>
      input.parentElement.textContent.includes("Ownership value"),
    );
    act(() => valueCheckbox.click());

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_PERSON_CARD_FIELDS,
      ownershipValue: true,
    });
  });
});
