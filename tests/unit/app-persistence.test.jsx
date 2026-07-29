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
        properties: [{ id: "property-1", address: "1 Republic Street" }],
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
});
