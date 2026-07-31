// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, caseActivationState } from "../../src/App.jsx";
import { saveLocalWorkspace } from "../../src/services/localWorkspace.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("case activation and legacy persistence", () => {
  it("resolves an invalid active group to the hydrated case's first family view", () => {
    const activation = caseActivationState({
      schemaVersion: 2,
      id: "cloud-case",
      title: "Hydrated cloud case",
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
      activeFamilyGroupId: "missing-tree",
      settings: { treeZoom: 55 },
    });

    expect(activation).toMatchObject({
      activeFamilyGroupId: "borg-tree",
      activeView: "family:borg-tree",
      selectedPersonId: "borg",
      zoom: 55,
    });
    expect(activation.caseData.activeFamilyGroupId).toBe("borg-tree");
  });

  it("moves root-level legacy ownership records into the generated property", () => {
    const input = {
      id: "legacy-case",
      title: "Legacy property",
      people: [{ id: "owner", fullName: "Joseph Borg" }],
      property: { address: "1 Republic Street", saleValue: "500000" },
      owners: [{ id: "owner-record", personId: "owner", sharePercent: 100 }],
      declarations: [{ id: "declaration" }],
      transfers: [{ id: "transfer", sellerId: "owner", buyerId: "buyer" }],
      saleLots: [{ id: "sale-lot", ownerId: "buyer" }],
    };
    const snapshot = structuredClone(input);

    const property = caseActivationState(input).caseData.properties[0];

    expect(property).toMatchObject({
      id: "legacy-property",
      address: "1 Republic Street",
      saleValue: "500000",
      owners: input.owners,
      declarations: input.declarations,
      transfers: input.transfers,
      saleLots: input.saleLots,
    });
    expect(input).toEqual(snapshot);
  });

  it("gives property-level legacy collections precedence even when they are empty", () => {
    const property = caseActivationState({
      id: "legacy-precedence",
      people: [{ id: "owner", fullName: "Joseph Borg" }],
      property: {
        address: "2 Republic Street",
        owners: [],
        declarations: [{ id: "property-declaration" }],
        transfers: [],
        saleLots: [{ id: "property-lot" }],
      },
      owners: [{ id: "root-owner" }],
      declarations: [{ id: "root-declaration" }],
      transfers: [{ id: "root-transfer" }],
      saleLots: [{ id: "root-lot" }],
    }).caseData.properties[0];

    expect(property.owners).toEqual([]);
    expect(property.declarations).toEqual([{ id: "property-declaration" }]);
    expect(property.transfers).toEqual([]);
    expect(property.saleLots).toEqual([{ id: "property-lot" }]);
  });
});

describe("App local recovery", () => {
  let container;
  let root;

  const openCurrentFamily = () => {
    const openButton = container.querySelector(".family-name-button");
    expect(openButton).not.toBeNull();
    act(() => openButton.click());
  };

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
    openCurrentFamily();

    const title = container.querySelector('input[aria-label="Tree name"]');
    expect(title.value).toBe("Borg succession");
    expect(container.textContent).toContain("Joseph Borg");
    expect(container.querySelector(".case-view-tabs")).toBeNull();
    expect(container.querySelector('input[aria-label="Property address"]')).toBeNull();
    expect(container.querySelector('input[aria-label="Property selling price"]')).toBeNull();
    expect(
      [...container.querySelectorAll(".dashboard-tabs button")].some(
        (button) => button.textContent === "Property",
      ),
    ).toBe(false);
    expect(
      [...container.querySelectorAll(".dashboard-tabs button")].some(
        (button) => button.textContent === "Summary",
      ),
    ).toBe(false);
    expect(container.querySelector(".dashboard-topline").textContent).toContain("Person Details");

    const personCard = container.querySelector('[data-person-id="person-1"]');
    act(() => personCard.click());
    expect(container.querySelector(".context-dashboard").classList.contains("open")).toBe(true);

    const backToTree = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Back to Tree",
    );
    act(() => backToTree.click());
    expect(container.querySelector(".context-dashboard").classList.contains("open")).toBe(false);

    const home = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Back to Home"),
    );
    act(() => home.click());
    const vella = [...container.querySelectorAll(".family-name-button")].find((button) =>
      button.textContent.includes("Vella succession"),
    );
    act(() => vella.click());

    expect(container.querySelector('input[aria-label="Tree name"]').value).toBe(
      "Vella succession",
    );
    expect(container.textContent).toContain("Maria Vella");
  });

  it("keeps family creation and deletion on Home instead of the tree canvas", () => {
    saveLocalWorkspace(
      [
        {
          id: "tree",
          title: "Borg family",
          people: [{ id: "person-1", fullName: "Joseph Borg" }],
        },
      ],
      "tree",
      window.localStorage,
    );
    act(() => root.render(<App />));

    expect(container.textContent).toContain("Create new family");
    expect(container.querySelector('button[aria-label="Delete Borg family"]')).not.toBeNull();
    openCurrentFamily();
    expect(container.textContent).not.toContain("Create new family");
    expect(container.querySelector(".add-family-view")).toBeNull();
    expect(container.querySelector(".case-view-tabs")).toBeNull();
  });

  it("does not infer property ownership from family relationships", () => {
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
    openCurrentFamily();

    expect(container.querySelectorAll(".family-node-ownership")).toHaveLength(0);
    expect(container.textContent).not.toContain("Starting property ownership");
    expect(container.textContent).not.toContain("Owners & transfers");
  });

  it("lets the tree zoom out to a 25% overview", () => {
    act(() => root.render(<App />));
    const create = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Create new family"),
    );
    act(() => create.click());
    const slider = container.querySelector('input[aria-label="Tree zoom"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(slider, "25");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.querySelector(".tree-zoom-slider output").textContent).toBe("25%");
  });

  it("opens one focused tree without exposing nested family tabs", () => {
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
    openCurrentFamily();
    expect(container.querySelectorAll('[data-person-id="borg"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-person-id="vella"]')).toHaveLength(0);
    expect(container.querySelector(".case-view-tabs")).toBeNull();
    expect(container.textContent).not.toContain("Owners & transfers");
    expect(container.textContent).not.toContain("Vendors & tax");
  });

  it("does not create a replacement family after the last family is deleted", () => {
    act(() => root.render(<App />));
    expect(container.querySelectorAll(".family-name-button")).toHaveLength(0);

    const create = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Create new family"),
    );
    act(() => create.click());
    const home = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Back to Home"),
    );
    act(() => home.click());
    expect(container.querySelectorAll(".family-name-button")).toHaveLength(1);

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const remove = container.querySelector('button[aria-label="Delete New family"]');
    act(() => remove.click());

    expect(confirm).toHaveBeenCalledOnce();
    expect(container.querySelectorAll(".family-name-button")).toHaveLength(0);
    expect(container.textContent).toContain("No families yet");
    confirm.mockRestore();
  });
});
