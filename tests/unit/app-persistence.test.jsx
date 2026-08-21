// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, caseActivationState } from "../../src/App.jsx";
import { GEDCOM_LIMITS } from "../../src/domain/gedcom.js";
import { TREE_DATA_LIMITS } from "../../src/domain/treeData.js";
import { LOCAL_WORKSPACE_KEY, saveLocalWorkspace } from "../../src/services/localWorkspace.js";

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

  const createFamily = async () => {
    const create = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Create new family"),
    );
    act(() => create.click());
    const dialog = container.querySelector('[role="dialog"]');
    const write = (labelText, value) => {
      const label = [...dialog.querySelectorAll("label")].find((entry) =>
        entry.textContent.includes(labelText),
      );
      const input = label.querySelector("input");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    act(() => {
      write("Family name", "New family");
      write("Given name", "First");
      write("Surname", "Person");
      dialog.querySelector('input[value="Other"]').click();
    });
    await act(async () => {
      dialog.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
  };

  const saveTestateFamily = ({ willHeirs = [] } = {}) => {
    saveLocalWorkspace(
      [
        {
          id: "testate-tree",
          title: "Testate family",
          people: [
            {
              id: "testator",
              fullName: "Joseph Borg",
              sex: "Male",
              dateOfDeath: "2020-01-01",
              inheritanceBasis: "will",
              wills: [{ id: "will", date: "2019-01-01" }],
              willHeirs,
            },
            { id: "child", fullName: "Maria Borg", sex: "Female", fatherId: "testator" },
          ],
          familyGroups: [
            {
              id: "family",
              title: "Testate family",
              rootPersonId: "testator",
              personIds: ["testator", "child"],
            },
          ],
          activeFamilyGroupId: "family",
          properties: [{ id: "property", owners: [] }],
          outsideParties: [],
          settings: {
            activePropertyId: "property",
            shareDisplay: "both",
            workspaceMode: "property-tax",
          },
        },
      ],
      "testate-tree",
      window.localStorage,
    );
  };

  const setInputValue = (input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
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
    vi.restoreAllMocks();
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

    const title = container.querySelector('button[aria-label^="Edit tree name:"]');
    expect(title.textContent).toContain("Borg succession");
    expect(container.querySelector('input[aria-label="Tree name"]')).toBeNull();
    expect(
      container.querySelector('[data-person-id="person-1"] .family-node-name').textContent,
    ).toBe("Joseph");
    expect(
      container.querySelector('[data-person-id="person-1"] .family-node-surname').textContent,
    ).toBe("Borg");
    expect(container.querySelector(".case-view-tabs")).toBeNull();
    expect(container.querySelector('input[aria-label="Property address"]')).toBeNull();
    expect(container.querySelector('input[aria-label="Property selling price"]')).toBeNull();
    expect(container.querySelector(".dashboard-tabs")).toBeNull();
    expect(container.querySelector(".dashboard-topline")).toBeNull();

    const personCard = container.querySelector('[data-person-id="person-1"]');
    act(() => personCard.click());
    expect(container.querySelector(".context-dashboard").classList.contains("open")).toBe(true);

    const backToTree = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Back to Tree",
    );
    act(() => backToTree.click());
    expect(container.querySelector(".context-dashboard")).toBeNull();
    expect(container.querySelector(".family-node.selected")).toBeNull();

    const home = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Back to Home"),
    );
    act(() => home.click());
    const vella = [...container.querySelectorAll(".family-name-button")].find((button) =>
      button.textContent.includes("Vella succession"),
    );
    act(() => vella.click());

    expect(container.querySelector('button[aria-label^="Edit tree name:"]').textContent).toContain(
      "Vella succession",
    );
    expect(
      container.querySelector('[data-person-id="person-2"] .family-node-name').textContent,
    ).toBe("Maria");
    expect(
      container.querySelector('[data-person-id="person-2"] .family-node-surname').textContent,
    ).toBe("Vella");
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
    expect(
      container.querySelector('button[aria-label="Move Borg family to Trash"]'),
    ).not.toBeNull();
    openCurrentFamily();
    expect(container.textContent).not.toContain("Create new family");
    expect(container.querySelector(".add-family-view")).toBeNull();
    expect(container.querySelector(".case-view-tabs")).toBeNull();
  });

  it("persists automatic expiry pruning when Trash is the only local content", () => {
    window.localStorage.setItem(
      LOCAL_WORKSPACE_KEY,
      JSON.stringify({
        version: 2,
        activeTreeId: "",
        trees: [],
        trashedTrees: [
          {
            id: "expired-tree",
            title: "Expired family",
            people: [{ id: "person-1", fullName: "Fictional Person" }],
            deletedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          },
        ],
      }),
    );

    act(() => root.render(<App />));

    expect(JSON.parse(window.localStorage.getItem(LOCAL_WORKSPACE_KEY))).toMatchObject({
      version: 2,
      trees: [],
      trashedTrees: [],
    });
  });

  it("keeps an unreadable workspace blocked when an oversized GEDCOM import fails", async () => {
    const unreadableWorkspace = "{not-json";
    window.localStorage.setItem(LOCAL_WORKSPACE_KEY, unreadableWorkspace);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    act(() => root.render(<App />));

    const file = {
      name: "oversized.ged",
      size: GEDCOM_LIMITS.maxFileBytes + 1,
      text: vi.fn(),
    };
    const input = container.querySelector('input[aria-label="Import GEDCOM"]');
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(confirm).toHaveBeenCalledOnce();
    expect(file.text).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(LOCAL_WORKSPACE_KEY)).toBe(unreadableWorkspace);
    expect(container.textContent).toContain("GEDCOM file is too large");
    confirm.mockRestore();
  });

  it("rejects a GEDCOM that cannot fit the persisted tree before replacing recovery data", async () => {
    const unreadableWorkspace = "{not-json";
    window.localStorage.setItem(LOCAL_WORKSPACE_KEY, unreadableWorkspace);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const content = Array.from(
      { length: TREE_DATA_LIMITS.maxPeople + 1 },
      (_, index) => `0 @I${index}@ INDI\n1 NAME Person${index} /Test/`,
    ).join("\n");

    act(() => root.render(<App />));

    const file = {
      name: "too-many-people.ged",
      size: new TextEncoder().encode(content).byteLength,
      text: vi.fn(async () => content),
    };
    const input = container.querySelector('input[aria-label="Import GEDCOM"]');
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(file.text).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem(LOCAL_WORKSPACE_KEY)).toBe(unreadableWorkspace);
    expect(container.textContent).toContain("Could not import GEDCOM");
    confirm.mockRestore();
  });

  it("imports approximate GEDCOM dates into a pure tree without a visible legal review", async () => {
    const content = `0 HEAD
0 @I1@ INDI
1 NAME Maria /Borg/
1 SEX F
1 DEAT
2 DATE ABT 1900
0 TRLR`;
    const file = {
      name: "Borg-family.ged",
      size: new TextEncoder().encode(content).byteLength,
      text: vi.fn(async () => content),
    };

    act(() => root.render(<App />));
    const input = container.querySelector('input[aria-label="Import GEDCOM"]');
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const stored = JSON.parse(window.localStorage.getItem(LOCAL_WORKSPACE_KEY));
    expect(stored.trees[0]).toMatchObject({
      settings: { workspaceMode: "family-tree" },
      importWarnings: [],
    });
    expect(stored.trees[0].legalImportWarnings.join(" ")).toMatch(
      /not used as an exact legal date/i,
    );
    expect(stored.trees[0].people[0]).toMatchObject({
      gedcomDeathDate: "ABT 1900",
      dateOfDeath: "",
    });
    expect(container.textContent).not.toContain("need manual review");
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

  it("shows the current property value as notional on a deceased initial owner's tree card", () => {
    saveLocalWorkspace(
      [
        {
          id: "tree",
          title: "Deceased initial owner",
          people: [
            {
              id: "owner",
              fullName: "Joseph Borg",
              sex: "Male",
              isDeceased: true,
              dateOfDeath: "1900-01-01",
            },
          ],
          familyGroups: [
            {
              id: "family",
              title: "Borg family",
              rootPersonId: "owner",
              personIds: ["owner"],
            },
          ],
          activeFamilyGroupId: "family",
          properties: [
            {
              id: "property",
              saleValue: "7000000",
              owners: [
                {
                  id: "initial-owner",
                  personId: "owner",
                  shareNumerator: 1,
                  shareDenominator: 1,
                },
              ],
            },
          ],
          settings: {
            activePropertyId: "property",
            workspaceMode: "property-tax",
            personCardFields: {
              ownershipFraction: true,
              ownershipPercentage: true,
              ownershipValue: true,
            },
          },
        },
      ],
      "tree",
      window.localStorage,
    );

    act(() => root.render(<App />));
    openCurrentFamily();

    expect(container.querySelector('[data-person-id="owner"]').textContent).toContain(
      "Notional value €7,000,000.00",
    );
  });

  it("shows a selected initial owner's share on the tree before title reaches 100%", () => {
    saveLocalWorkspace(
      [
        {
          id: "tree",
          title: "Tree-selected ownership",
          people: [
            { id: "person-1", fullName: "Joseph Borg", sex: "Male" },
            {
              id: "person-2",
              fullName: "Maria Borg",
              sex: "Female",
              fatherId: "person-1",
            },
          ],
          familyGroups: [
            {
              id: "family",
              title: "Borg family",
              rootPersonId: "person-1",
              personIds: ["person-1", "person-2"],
            },
          ],
          activeFamilyGroupId: "family",
          properties: [
            {
              id: "property",
              owners: [
                {
                  id: "initial-owner",
                  personId: "",
                  shareNumerator: 1,
                  shareDenominator: 2,
                  sharePercent: 50,
                },
              ],
            },
          ],
          settings: { activePropertyId: "property" },
        },
      ],
      "tree",
      window.localStorage,
    );
    act(() => root.render(<App />));
    openCurrentFamily();

    act(() => container.querySelector(".ownership-tax-button").click());
    const pickFromTree = container.querySelector(
      'button[aria-label="Select initial owner from tree"]',
    );
    expect(pickFromTree.textContent.trim()).toBe("Tree");
    expect(pickFromTree.querySelector("svg")).toBeNull();
    act(() => pickFromTree.click());

    expect(container.querySelector(".initial-owner-tree-picker")).not.toBeNull();
    expect(container.querySelector(".ownership-tax-button")).not.toBeNull();
    expect(container.querySelector(".context-dashboard")).toBeNull();

    // Opening the property workspace cancels tree-pick mode instead of leaving a silent
    // selection armed for the next person tapped after returning to the tree.
    act(() => container.querySelector(".ownership-tax-button").click());
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Back to Tree"))
        .click(),
    );
    act(() => container.querySelector('[data-person-id="person-2"]').click());
    expect(container.querySelector(".context-dashboard")).not.toBeNull();
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.trim() === "Back to Tree")
        .click(),
    );

    act(() => container.querySelector(".ownership-tax-button").click());
    act(() =>
      container.querySelector('button[aria-label="Select initial owner from tree"]').click(),
    );
    act(() => container.querySelector('[data-person-id="person-2"]').click());

    expect(container.querySelector(".initial-owner-tree-picker")).toBeNull();
    expect(container.querySelector(".property-workspace-page")).not.toBeNull();
    expect(container.querySelector(".context-dashboard")).toBeNull();
    expect(container.querySelector('select[aria-label="Initial owner"]').value).toBe("person-2");
    expect(container.querySelector(".share-status").textContent).toContain("must equal 100%");

    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Back to Tree"))
        .click(),
    );
    expect(
      container.querySelector('[data-person-id="person-2"] .family-node-ownership').textContent,
    ).toContain("1/2");
  });

  it("lets the tree zoom out to a 25% overview", async () => {
    act(() => root.render(<App />));
    await createFamily();
    const slider = container.querySelector('input[aria-label="Tree zoom"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(slider, "25");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.querySelector(".tree-zoom-slider output").textContent).toBe("25%");
  });

  it("starts new families as printable pure trees and enables legal tools later", async () => {
    act(() => root.render(<App />));
    await createFamily();

    expect(container.querySelector(".tree-workspace-mode-control summary").textContent).toContain(
      "Tree only",
    );
    expect(container.querySelector(".ownership-tax-button")).toBeNull();
    expect(container.textContent).toContain("legal and tax checks are off");
    expect(
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent.includes("Print preview"),
      ).disabled,
    ).toBe(false);

    const chooseMode = (labelText) => {
      const label = [...container.querySelectorAll(".tree-workspace-mode-menu label")].find(
        (candidate) => candidate.textContent.includes(labelText),
      );
      expect(label).not.toBeNull();
      act(() => label.querySelector("input").click());
    };

    chooseMode("Property, succession & tax");

    expect(container.querySelector(".ownership-tax-button")).not.toBeNull();
    expect(container.querySelector(".tree-workspace-mode-control summary").textContent).toContain(
      "Legal workspace",
    );

    chooseMode("Family tree only");

    expect(container.querySelector(".ownership-tax-button")).toBeNull();
    const stored = JSON.parse(window.localStorage.getItem(LOCAL_WORKSPACE_KEY));
    expect(stored.trees[0].settings.workspaceMode).toBe("family-tree");
    expect(stored.trees[0].properties).toHaveLength(1);
  });

  it("keeps a just-flushed will share when changing its display mode", () => {
    saveTestateFamily({
      willHeirs: [
        {
          id: "will-heir",
          personId: "child",
          shareNumerator: 1,
          shareDenominator: 1,
          sharePercent: 100,
        },
      ],
    });
    act(() => root.render(<App />));
    openCurrentFamily();
    act(() => container.querySelector('[data-person-id="testator"]').click());

    const percentage = container.querySelector('input[aria-label="Will share percentage"]');
    expect(percentage).not.toBeNull();
    act(() => setInputValue(percentage, "33.335"));

    const fraction = [...container.querySelectorAll(".person-share-toggle button")].find(
      (button) => button.textContent.trim() === "Fraction",
    );
    act(() => fraction.click());

    const stored = JSON.parse(window.localStorage.getItem(LOCAL_WORKSPACE_KEY));
    const savedTestator = stored.trees[0].people.find((person) => person.id === "testator");
    expect(stored.trees[0].settings.shareDisplay).toBe("fraction");
    expect(savedTestator.willHeirs[0].sharePercent).toBe(33.335);
  });

  it("keeps an unconnected will beneficiary together with its outside-party record", () => {
    saveTestateFamily();
    act(() => root.render(<App />));
    openCurrentFamily();
    act(() => container.querySelector('[data-person-id="testator"]').click());

    const addUnconnected = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Add unconnected heir",
    );
    act(() => addUnconnected.click());
    const outsideName = container.querySelector('input[aria-label="Unconnected heir name"]');
    act(() => setInputValue(outsideName, "Anthony Outside"));
    act(() =>
      outsideName
        .closest("form")
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );

    const stored = JSON.parse(window.localStorage.getItem(LOCAL_WORKSPACE_KEY));
    const savedTree = stored.trees[0];
    const outsideParty = savedTree.outsideParties.find((party) => party.name === "Anthony Outside");
    const savedTestator = savedTree.people.find((person) => person.id === "testator");
    expect(outsideParty).toBeTruthy();
    expect(savedTestator.willHeirs).toContainEqual(
      expect.objectContaining({ personId: outsideParty.id, sharePercent: 100 }),
    );
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

  it("reaches the property and tax workspace from the tree screen and returns", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    saveLocalWorkspace(
      [
        {
          id: "tree",
          title: "Borg family",
          people: [{ id: "person-1", fullName: "Joseph Borg" }],
          properties: [{ id: "property-1", address: "1 Republic Street", saleValue: "250000" }],
        },
      ],
      "tree",
      window.localStorage,
    );
    act(() => root.render(<App />));
    openCurrentFamily();

    expect(container.querySelector(".ownership-tax-button").textContent).toContain(
      "Property & Tax",
    );
    act(() => container.querySelector('[data-person-id="person-1"]').click());
    expect(container.querySelector(".context-dashboard")).not.toBeNull();
    act(() => container.querySelector(".ownership-tax-button").click());
    expect(container.querySelector(".property-workspace-page")).not.toBeNull();
    const setupLink = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Property & initial ownership",
    );
    expect(setupLink.className).toContain("active");
    expect(container.textContent).toContain("Current ownership & history");
    expect(container.textContent).toContain("Tax Calculation");
    expect(container.textContent).not.toContain("Record a sale or transfer");
    const propertyPrint = container.querySelector(
      'button[aria-label="Print current generator screen"]',
    );
    expect(propertyPrint).not.toBeNull();
    act(() => propertyPrint.click());
    expect(print).toHaveBeenCalledOnce();

    const backToTree = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Back to Tree"),
    );
    act(() => backToTree.click());
    expect(container.querySelector(".property-workspace-page")).toBeNull();
    expect(container.querySelector(".ownership-tax-button")).not.toBeNull();
    expect(container.querySelector(".context-dashboard")).toBeNull();
    expect(container.querySelector(".family-node.selected")).toBeNull();
    print.mockRestore();
  });

  it("opens an outside provenance owner from a family recipient's tax details", () => {
    saveLocalWorkspace(
      [
        {
          id: "outside-source-tree",
          title: "Outside source family",
          people: [{ id: "donee", fullName: "Maria Borg", spouseIds: [] }],
          outsideParties: [{ id: "company", name: "Harbour Holdings Limited", type: "company" }],
          properties: [
            {
              id: "property",
              saleDate: "2026-08-13",
              saleValue: "250000",
              owners: [
                {
                  id: "company-title",
                  personId: "company",
                  shareNumerator: 1,
                  shareDenominator: 1,
                },
              ],
              transfers: [
                {
                  id: "company-gift",
                  kind: "donation",
                  sellerId: "company",
                  buyerId: "donee",
                  numerator: 1,
                  denominator: 1,
                  amountType: "whole-property",
                  date: "2025-01-01",
                },
              ],
              declarations: [],
              saleLots: [],
            },
          ],
        },
      ],
      "outside-source-tree",
      window.localStorage,
    );
    act(() => root.render(<App />));
    openCurrentFamily();
    act(() => container.querySelector('[data-person-id="donee"]').click());

    const sourceButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Open Harbour Holdings Limited original acquisition details"),
    );
    expect(sourceButton).toBeTruthy();
    act(() => sourceButton.click());

    expect(container.querySelector(".property-workspace-page")).not.toBeNull();
    expect(container.querySelector(".property-workspace-menu button.active").textContent).toContain(
      "Current ownership & history",
    );
    expect(container.querySelector("#outside-owner-title").textContent).toBe(
      "Harbour Holdings Limited",
    );
    expect(container.querySelector('input[aria-label="Original acquisition date"]')).not.toBeNull();
  });

  it("does not create a replacement family after the last family is deleted", async () => {
    act(() => root.render(<App />));
    expect(container.querySelectorAll(".family-name-button")).toHaveLength(0);

    await createFamily();
    const home = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Back to Home"),
    );
    act(() => home.click());
    expect(container.querySelectorAll(".family-name-button")).toHaveLength(1);

    const remove = container.querySelector('button[aria-label="Move New family to Trash"]');
    act(() => remove.click());
    const confirm = [...container.querySelectorAll('[role="alertdialog"] button')].find((button) =>
      button.textContent.includes("Move to Trash"),
    );
    await act(async () => confirm.click());

    expect(container.querySelectorAll(".family-name-button")).toHaveLength(0);
    expect(container.textContent).toContain("No families yet");
    expect(container.textContent).toContain("Trash (1)");
  });
});
