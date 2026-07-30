// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

    const title = container.querySelector(".workbench-title input");
    const picker = container.querySelector('select[aria-label="Saved property cases"]');
    expect(title.value).toBe("Borg succession");
    expect(picker.value).toBe("tree-1");
    expect(picker.options).toHaveLength(2);
    expect(container.textContent).toContain("Joseph Borg");
    expect(container.querySelector('input[aria-label="Property address"]').value).toBe(
      "1 Republic Street",
    );
    expect(container.querySelector('input[aria-label="Property selling price"]').value).toBe(
      "250000",
    );
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

    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        picker,
        "tree-2",
      );
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(title.value).toBe("Vella succession");
    expect(container.textContent).toContain("Maria Vella");
  });

  it("keeps initial owner tools in Owners & transfers after removing the Property panel", () => {
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
    openCurrentFamily();
    const ownersButton = [...container.querySelectorAll(".case-view-tabs button")].find((button) =>
      button.textContent.includes("Owners & transfers"),
    );

    act(() => ownersButton.click());

    expect(container.textContent).toContain("Initial owner/s of the property");
    expect(container.textContent).not.toContain("Who owns this property today");
    expect(container.textContent).not.toContain("Add property");
    expect(container.querySelector(".single-property-case")).not.toBeNull();

    const addOwner = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Add initial owner"),
    );
    act(() => addOwner.click());

    const ownerSelect = container.querySelector(".initial-owner-row select");
    expect(container.querySelectorAll(".initial-owner-row")).toHaveLength(1);
    expect([...ownerSelect.options].map((option) => option.textContent)).toEqual([
      "Choose person",
      "Joseph Borg",
      "Maria Borg",
    ]);

    const numerator = container.querySelector('input[aria-label="Initial ownership numerator"]');
    const denominator = container.querySelector(
      'input[aria-label="Initial ownership denominator"]',
    );
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(numerator, "1");
      numerator.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        denominator,
        "2",
      );
      denominator.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector('input[aria-label="Initial ownership percentage"]').value).toBe(
      "50",
    );
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
    openCurrentFamily();

    expect(container.querySelectorAll(".family-node-ownership")).toHaveLength(0);
    expect(container.textContent).not.toContain("Starting property ownership");

    const ownersButton = [...container.querySelectorAll(".case-view-tabs button")].find((button) =>
      button.textContent.includes("Owners & transfers"),
    );
    act(() => ownersButton.click());
    const addOwner = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Add initial owner"),
    );
    act(() => addOwner.click());

    const ownerSelect = container.querySelector('select[aria-label="Initial owner"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        ownerSelect,
        "father",
      );
      ownerSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const percentage = container.querySelector('input[aria-label="Initial ownership percentage"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        percentage,
        "100",
      );
      percentage.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const familyButton = container.querySelector(".family-view-tabs button:not(.add-family-view)");
    act(() => familyButton.click());

    const ownershipBadges = container.querySelectorAll(".family-node-ownership");
    expect(ownershipBadges).toHaveLength(1);
    expect(ownershipBadges[0].textContent).toContain("100%");
    expect(ownershipBadges[0].closest("[data-person-id]").dataset.personId).toBe("father");
  });

  it("lets the tree zoom out to a 25% overview", () => {
    act(() => root.render(<App />));
    openCurrentFamily();
    const zoomOut = container.querySelector('button[aria-label="Zoom out"]');

    for (let index = 0; index < 8; index += 1) {
      act(() => zoomOut.click());
    }

    expect(container.querySelector(".zoom-controls span").textContent).toBe("25%");
  });

  it("switches between family-tree tabs while keeping one case-wide person registry", () => {
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

    const vellaTab = [...container.querySelectorAll(".case-view-tabs button")].find(
      (button) => button.textContent === "Vella family",
    );
    act(() => vellaTab.click());

    expect(container.querySelectorAll('[data-person-id="borg"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-person-id="vella"]')).toHaveLength(1);
  });

  it("promotes an outside individual into a separate family tree without losing case ownership", () => {
    saveLocalWorkspace(
      [
        {
          id: "case",
          title: "Transferred property",
          people: [{ id: "owner", fullName: "Joseph Borg" }],
          outsideParties: [
            { id: "buyer", name: "Anna Vella", type: "individual" },
            {
              id: "company",
              name: "Buyer Limited",
              type: "company",
              registrationNumber: "C 123",
            },
          ],
          properties: [
            {
              id: "property",
              owners: [{ id: "initial", personId: "owner", sharePercent: 100 }],
              declarations: [],
              transfers: [
                {
                  id: "sale-one",
                  sellerId: "owner",
                  buyerId: "buyer",
                  numerator: 1,
                  denominator: 4,
                  amountType: "whole-property",
                },
                {
                  id: "sale-two",
                  sellerId: "owner",
                  buyerId: "company",
                  numerator: 1,
                  denominator: 4,
                  amountType: "whole-property",
                },
              ],
              saleLots: [],
            },
          ],
        },
      ],
      "case",
      window.localStorage,
    );

    act(() => root.render(<App />));
    openCurrentFamily();
    const ownersTab = [...container.querySelectorAll(".case-view-tabs button")].find((button) =>
      button.textContent.includes("Owners & transfers"),
    );
    act(() => ownersTab.click());

    expect(container.textContent).toContain("Anna Vella");
    expect(container.textContent).toContain("Buyer Limited");
    const createTreeButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Create family tree"),
    );
    act(() => createTreeButton.click());

    expect(
      [...container.querySelectorAll(".case-view-tabs button")].some(
        (button) => button.textContent === "Anna Vella family",
      ),
    ).toBe(true);
    expect(container.querySelectorAll('[data-person-id="buyer"]')).toHaveLength(1);

    const vendorTab = [...container.querySelectorAll(".case-view-tabs button")].find((button) =>
      button.textContent.includes("Vendors & tax"),
    );
    act(() => vendorTab.click());
    expect(container.textContent).toContain("Anna Vella");
    expect(container.textContent).toContain("Buyer Limited");
  });
});
