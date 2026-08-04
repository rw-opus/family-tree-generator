import { describe, expect, it } from "vitest";
import {
  LOCAL_WORKSPACE_KEY,
  loadLocalWorkspace,
  readLocalWorkspaceRecovery,
  saveLocalWorkspace,
  upsertWorkspaceTree,
} from "../../src/services/localWorkspace.js";
import { familyTreeRecord, hydrateFamilyTree } from "../../src/services/familyTrees.js";

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};

const completeTree = {
  id: "tree-1",
  title: "Borg succession",
  people: [{ id: "person-1", fullName: "Joseph Borg" }],
  properties: [{ id: "property-1", address: "1 Republic Street" }],
  succession: { basis: "intestacy" },
  declarations: [{ id: "declaration-1" }],
  outsideParties: [{ id: "company-1", type: "company" }],
  transfers: [{ id: "transfer-1" }],
  saleLots: [{ id: "lot-1" }],
  settings: { shareDisplay: "fraction" },
};

describe("local family-tree workspace", () => {
  it("restores the complete active tree after a browser restart", () => {
    const storage = memoryStorage();
    const otherTree = {
      id: "tree-2",
      title: "Vella succession",
      people: [{ id: "person-2" }],
    };
    const trees = upsertWorkspaceTree(upsertWorkspaceTree([], otherTree), completeTree);

    expect(saveLocalWorkspace(trees, completeTree.id, storage)).toBe(true);
    expect(loadLocalWorkspace(storage)).toEqual({
      trees: [completeTree, otherTree],
      activeTreeId: completeTree.id,
    });
  });

  it("keeps previous trees when a new tree becomes active", () => {
    const nextTree = {
      id: "tree-3",
      title: "New tree",
      people: [{ id: "person-3" }],
    };
    const trees = upsertWorkspaceTree([completeTree], nextTree);
    expect(trees.map((tree) => tree.id)).toEqual(["tree-3", "tree-1"]);
  });

  it("preserves corrupt browser data for recovery instead of silently replacing it", () => {
    const storage = memoryStorage();
    storage.setItem(LOCAL_WORKSPACE_KEY, "{not-json");
    const recovered = loadLocalWorkspace(storage);
    expect(recovered).toMatchObject({
      trees: [],
      activeTreeId: "",
      loadError: expect.stringContaining("has not been overwritten"),
    });
    expect(readLocalWorkspaceRecovery(recovered.recoveryKey, storage)).toBe("{not-json");
  });

  it("keeps readable families available when another stored family is malformed", () => {
    const storage = memoryStorage();
    storage.setItem(
      LOCAL_WORKSPACE_KEY,
      JSON.stringify({ trees: [completeTree, { id: "broken" }], activeTreeId: completeTree.id }),
    );
    const recovered = loadLocalWorkspace(storage);
    expect(recovered.trees).toEqual([completeTree]);
    expect(recovered.activeTreeId).toBe(completeTree.id);
    expect(recovered.loadError).toContain("not been overwritten");
  });
});

describe("cloud family-tree serialization", () => {
  it("stores and hydrates the complete case instead of names only", () => {
    const record = familyTreeRecord(completeTree);
    expect(record.tree_data).toEqual(completeTree);
    expect(
      hydrateFamilyTree({
        ...record,
        updated_at: "2026-07-29T00:00:00Z",
      }),
    ).toMatchObject(completeTree);
  });

  it("prefers the canonical version-two people registry over a stale mirror", () => {
    expect(
      hydrateFamilyTree({
        id: "case",
        title: "Case",
        people: [{ id: "stale", fullName: "Stale mirror" }],
        tree_data: {
          schemaVersion: 2,
          id: "case",
          people: [{ id: "canonical", fullName: "Canonical person" }],
          familyGroups: [],
        },
      }).people,
    ).toEqual([{ id: "canonical", fullName: "Canonical person" }]);
  });
});
