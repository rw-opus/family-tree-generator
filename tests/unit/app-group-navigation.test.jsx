// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/App.jsx";
import { LOCAL_WORKSPACE_KEY, saveLocalWorkspace } from "../../src/services/localWorkspace.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("focused family workspace", () => {
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

  it("persists the editable tree name and keeps family management on Home", () => {
    saveLocalWorkspace(
      [
        {
          schemaVersion: 2,
          id: "case",
          title: "Two families",
          people: [
            { id: "borg", fullName: "Joseph Borg" },
            { id: "vella", fullName: "Maria Vella" },
          ],
          familyGroups: [
            {
              id: "borg-tree",
              title: "Borg family",
              rootPersonId: "borg",
              personIds: ["borg"],
            },
            {
              id: "vella-tree",
              title: "Vella family",
              rootPersonId: "vella",
              personIds: ["vella"],
            },
          ],
          activeFamilyGroupId: "borg-tree",
          properties: [{ id: "property", owners: [] }],
        },
      ],
      "case",
      window.localStorage,
    );

    act(() => root.render(<App />));
    const openButton = container.querySelector(".family-name-button");
    expect(openButton).not.toBeNull();
    act(() => openButton.click());
    expect(container.querySelector(".case-view-tabs")).toBeNull();
    expect(container.querySelector(".add-family-view")).toBeNull();

    const treeName = container.querySelector('input[aria-label="Tree name"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        treeName,
        "Renamed family",
      );
      treeName.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const home = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Back to Home"),
    );
    act(() => home.click());

    expect(container.textContent).toContain("Renamed family");
    const savedWorkspace = JSON.parse(window.localStorage.getItem(LOCAL_WORKSPACE_KEY));
    expect(savedWorkspace.trees.find((item) => item.id === "case").title).toBe("Renamed family");
  });
});
