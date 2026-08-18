import { describe, expect, it } from "vitest";
import { normaliseCase } from "../../src/domain/caseModel.js";
import {
  DEFAULT_NEW_TREE_WORKSPACE_MODE,
  TREE_WORKSPACE_MODES,
  normaliseTreeWorkspaceMode,
  propertyTaxWorkspaceEnabled,
  treeHasRecordedPropertyTaxData,
} from "../../src/domain/treeWorkspaceMode.js";

describe("tree workspace mode", () => {
  it("keeps existing unmarked trees in the legal workspace", () => {
    expect(normaliseTreeWorkspaceMode()).toBe(TREE_WORKSPACE_MODES.PROPERTY_TAX);
    expect(normaliseTreeWorkspaceMode("unknown")).toBe(TREE_WORKSPACE_MODES.PROPERTY_TAX);
    expect(propertyTaxWorkspaceEnabled(undefined)).toBe(true);
  });

  it("lets new trees explicitly start as a pure family tree", () => {
    expect(DEFAULT_NEW_TREE_WORKSPACE_MODE).toBe(TREE_WORKSPACE_MODES.FAMILY_TREE);
    expect(normaliseTreeWorkspaceMode(undefined, DEFAULT_NEW_TREE_WORKSPACE_MODE)).toBe(
      TREE_WORKSPACE_MODES.FAMILY_TREE,
    );
    expect(propertyTaxWorkspaceEnabled(TREE_WORKSPACE_MODES.FAMILY_TREE)).toBe(false);
  });

  it("does not manufacture legal marital or survivorship state in a pure tree", () => {
    const person = {
      id: "deceased",
      fullName: "Unknown ancestor",
      isDeceased: true,
      designations: ["Deceased"],
      spouseIds: [],
    };
    const pure = normaliseCase({
      id: "pure",
      settings: { workspaceMode: TREE_WORKSPACE_MODES.FAMILY_TREE },
      people: [person],
    });
    const legacy = normaliseCase({ id: "legacy", people: [person] });

    expect(pure.people[0]).not.toHaveProperty("unmarriedOrWidowedAtDeath");
    expect(pure.people[0]).not.toHaveProperty("unmarriedOrWidowedAtDeathSource");
    expect(legacy.people[0]).toMatchObject({
      unmarriedOrWidowedAtDeath: true,
      unmarriedOrWidowedAtDeathSource: "automatic",
    });
  });

  it("does not turn pure-tree co-parents into spouses when legal tools are enabled later", () => {
    const people = [
      { id: "father", fullName: "Joseph Borg", sex: "Male", spouseIds: [] },
      { id: "mother", fullName: "Maria Vella", sex: "Female", spouseIds: [] },
      {
        id: "child",
        fullName: "Paul Borg",
        sex: "Male",
        fatherId: "father",
        motherId: "mother",
        spouseIds: [],
      },
    ];
    const pure = normaliseCase({
      id: "pure",
      settings: { workspaceMode: TREE_WORKSPACE_MODES.FAMILY_TREE },
      people,
    });

    expect(pure.people.find((person) => person.id === "father").spouseIds).toEqual([]);
    expect(pure.people.find((person) => person.id === "mother").spouseIds).toEqual([]);
    expect(pure.people.find((person) => person.id === "child")).toMatchObject({
      coParentRelationshipExplicitOnly: true,
    });

    const enabledLater = normaliseCase({
      ...pure,
      settings: { ...pure.settings, workspaceMode: TREE_WORKSPACE_MODES.PROPERTY_TAX },
    });
    expect(enabledLater.people.find((person) => person.id === "father").spouseIds).toEqual([]);
    expect(enabledLater.people.find((person) => person.id === "mother").spouseIds).toEqual([]);

    const legacy = normaliseCase({ id: "legacy", people });
    expect(legacy.people.find((person) => person.id === "father").spouseIds).toEqual(["mother"]);
  });

  it("detects retained title records without running an ownership calculation", () => {
    expect(treeHasRecordedPropertyTaxData({ properties: [{ owners: [] }], people: [] })).toBe(
      false,
    );
    expect(
      treeHasRecordedPropertyTaxData({
        properties: [{ owners: [{ personId: "owner" }] }],
        people: [],
      }),
    ).toBe(true);
    expect(
      treeHasRecordedPropertyTaxData({
        properties: [{ owners: [] }],
        people: [{ id: "deceased", wills: [{ id: "will" }] }],
      }),
    ).toBe(true);
    expect(
      treeHasRecordedPropertyTaxData({
        properties: [{ owners: [] }],
        people: [],
        statusToggleSessions: [{ personId: "deceased", type: "deceased" }],
      }),
    ).toBe(true);
  });
});
