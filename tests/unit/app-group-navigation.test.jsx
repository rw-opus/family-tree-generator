// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/App.jsx";
import { LOCAL_WORKSPACE_KEY, saveLocalWorkspace } from "../../src/services/localWorkspace.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("family-group navigation", () => {
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

  it("persists a cross-group person selection as the active family tree", () => {
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
    const vellaResult = [...container.querySelectorAll(".inspector-results button")].find(
      (button) => button.textContent.includes("Maria Vella"),
    );

    act(() => vellaResult.click());

    expect(container.querySelectorAll('[data-person-id="vella"]')).toHaveLength(1);
    const savedWorkspace = JSON.parse(window.localStorage.getItem(LOCAL_WORKSPACE_KEY));
    expect(savedWorkspace.trees.find((item) => item.id === "case").activeFamilyGroupId).toBe(
      "vella-tree",
    );
  });
});
