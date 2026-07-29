// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/App.jsx";
import { saveLocalWorkspace } from "../../src/services/localWorkspace.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("App local recovery", () => {
  let container;
  let root;

  beforeEach(() => {
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.localStorage.clear();
  });

  it("restores the active tree and lets the user reopen another saved tree", () => {
    const trees = [
      {
        id: "tree-1",
        title: "Borg succession",
        people: [{ id: "person-1", fullName: "Joseph Borg" }],
        properties: [
          {
            id: "property-1",
            address: "1 Republic Street",
            saleValue: "250000",
          },
        ],
      },
      {
        id: "tree-2",
        title: "Vella succession",
        people: [{ id: "person-2", fullName: "Maria Vella" }],
      },
    ];
    saveLocalWorkspace(trees, "tree-1", window.localStorage);

    act(() => root.render(<App />));

    const title = container.querySelector(".workbench-title input");
    const picker = container.querySelector(
      'select[aria-label="Saved family trees"]',
    );
    expect(title.value).toBe("Borg succession");
    expect(picker.value).toBe("tree-1");
    expect(picker.options).toHaveLength(2);
    expect(container.textContent).toContain("Joseph Borg");
    expect(
      container.querySelector('input[aria-label="Property address"]').value,
    ).toBe("1 Republic Street");
    expect(
      container.querySelector('input[aria-label="Property selling price"]').value,
    ).toBe("250000");
    expect(
      [...container.querySelectorAll(".dashboard-tabs button")].some(
        (button) => button.textContent === "Properties",
      ),
    ).toBe(false);
    expect(
      [...container.querySelectorAll(".dashboard-tabs button")].some(
        (button) => button.textContent === "Summary",
      ),
    ).toBe(false);

    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      ).set.call(picker, "tree-2");
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(title.value).toBe("Vella succession");
    expect(container.textContent).toContain("Maria Vella");
  });

  it("places the single property's tools under Property & tax", () => {
    saveLocalWorkspace(
      [
        {
          id: "tree",
          title: "Initial ownership",
          people: [
            { id: "person-1", fullName: "Joseph Borg" },
            { id: "person-2", fullName: "Maria Borg" },
          ],
          properties: [
            {
              id: "property",
              address: "1 Republic Street",
              owners: [],
            },
          ],
        },
      ],
      "tree",
      window.localStorage,
    );
    act(() => root.render(<App />));
    const caseButton = [...container.querySelectorAll(".dashboard-tabs button")]
      .find((button) => button.textContent.includes("Property & tax"));

    act(() => caseButton.click());

    expect(container.textContent).toContain("Initial owner/s of the property");
    expect(container.textContent).not.toContain("Who owns this property today");
    expect(container.textContent).not.toContain("Add property");
    expect(container.querySelector(".single-property-case")).not.toBeNull();

    const addOwner = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.includes("Add initial owner"),
    );
    act(() => addOwner.click());

    const ownerSelect = container.querySelector(".initial-owner-row select");
    expect(container.querySelectorAll(".initial-owner-row")).toHaveLength(1);
    expect([...ownerSelect.options].map((option) => option.textContent)).toEqual([
      "Choose person",
      "Joseph Borg",
      "Maria Borg",
    ]);

    const numerator = container.querySelector(
      'input[aria-label="Initial ownership numerator"]',
    );
    const denominator = container.querySelector(
      'input[aria-label="Initial ownership denominator"]',
    );
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(numerator, "1");
      numerator.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(denominator, "2");
      denominator.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      container.querySelector(
        'input[aria-label="Initial ownership percentage"]',
      ).value,
    ).toBe("50");
  });

  it("creates ownership only from initial owners entered for the property", () => {
    saveLocalWorkspace(
      [
        {
          id: "tree",
          title: "No assumed ownership",
          people: [
            { id: "father", fullName: "Joseph Borg", sex: "Male" },
            { id: "mother", fullName: "Maria Borg", sex: "Female" },
            {
              id: "child",
              fullName: "Paul Borg",
              fatherId: "father",
              motherId: "mother",
            },
            {
              id: "sibling-1",
              fullName: "Anna Borg",
              fatherId: "father",
              motherId: "mother",
            },
            {
              id: "sibling-2",
              fullName: "Mark Borg",
              fatherId: "father",
              motherId: "mother",
            },
            {
              id: "grandchild",
              fullName: "Luke Borg",
              fatherId: "child",
            },
          ],
          properties: [{ id: "property", owners: [] }],
        },
      ],
      "tree",
      window.localStorage,
    );
    act(() => root.render(<App />));

    expect(container.querySelectorAll(".family-node-ownership")).toHaveLength(0);
    expect(container.textContent).not.toContain("Starting property ownership");

    const caseButton = [...container.querySelectorAll(".dashboard-tabs button")]
      .find((button) => button.textContent.includes("Property & tax"));
    act(() => caseButton.click());
    const addOwner = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.includes("Add initial owner"),
    );
    act(() => addOwner.click());

    const ownerSelect = container.querySelector(
      'select[aria-label="Initial owner"]',
    );
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      ).set.call(ownerSelect, "father");
      ownerSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const percentage = container.querySelector(
      'input[aria-label="Initial ownership percentage"]',
    );
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(percentage, "100");
      percentage.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const ownershipBadges = container.querySelectorAll(
      ".family-node-ownership",
    );
    expect(ownershipBadges).toHaveLength(1);
    expect(ownershipBadges[0].textContent).toContain("100%");
    expect(
      ownershipBadges[0].closest("[data-person-id]").dataset.personId,
    ).toBe("father");
  });

  it("lets the tree zoom out to a 25% overview", () => {
    act(() => root.render(<App />));
    const zoomOut = container.querySelector('button[aria-label="Zoom out"]');

    for (let index = 0; index < 8; index += 1) {
      act(() => zoomOut.click());
    }

    expect(container.querySelector(".zoom-controls span").textContent).toBe(
      "25%",
    );
  });
});
