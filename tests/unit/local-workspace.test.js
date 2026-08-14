import { describe, expect, it } from "vitest";
import {
  LOCAL_WORKSPACE_KEY,
  loadLocalWorkspace,
  readLocalWorkspaceRecovery,
  saveLocalWorkspace,
  upsertWorkspaceTree,
} from "../../src/services/localWorkspace.js";
import { familyTreeRecord, hydrateFamilyTree } from "../../src/services/familyTrees.js";
import {
  CURRENT_TREE_SCHEMA_VERSION,
  LEGACY_TREE_SCHEMA_VERSION,
  TREE_SCHEMA_VERSION_FIELD,
} from "../../src/domain/treeData.js";

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};

const completeTree = {
  schemaVersion: 2,
  id: "tree-1",
  title: "Borg succession",
  people: [{ id: "person-1", fullName: "Joseph Borg" }],
  familyGroups: [
    {
      id: "group-1",
      title: "Borg succession",
      rootPersonId: "person-1",
      personIds: ["person-1"],
    },
  ],
  activeFamilyGroupId: "group-1",
  properties: [{ id: "property-1", address: "1 Republic Street" }],
  succession: { basis: "intestacy" },
  declarations: [{ id: "declaration-1" }],
  outsideParties: [{ id: "company-1", type: "company" }],
  transfers: [{ id: "transfer-1" }],
  saleLots: [{ id: "lot-1" }],
  settings: { shareDisplay: "fraction", activePropertyId: "property-1" },
};

const persistedCompleteTree = {
  ...completeTree,
  [TREE_SCHEMA_VERSION_FIELD]: CURRENT_TREE_SCHEMA_VERSION,
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
      trees: [
        persistedCompleteTree,
        { ...otherTree, [TREE_SCHEMA_VERSION_FIELD]: LEGACY_TREE_SCHEMA_VERSION },
      ],
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

  it("reports blocked browser storage without crashing during application startup", () => {
    const blockedStorage = {
      getItem: () => {
        throw new DOMException("Storage is blocked.", "SecurityError");
      },
    };

    expect(loadLocalWorkspace(blockedStorage)).toMatchObject({
      trees: [],
      activeTreeId: "",
      recoveryKey: "",
      loadError: expect.stringContaining("has not been overwritten"),
      recoveryCause: "Storage is blocked.",
    });
  });

  it("keeps readable families available when another stored family is malformed", () => {
    const storage = memoryStorage();
    storage.setItem(
      LOCAL_WORKSPACE_KEY,
      JSON.stringify({ trees: [completeTree, { id: "broken" }], activeTreeId: completeTree.id }),
    );
    const recovered = loadLocalWorkspace(storage);
    expect(recovered.trees).toEqual([
      { ...completeTree, [TREE_SCHEMA_VERSION_FIELD]: LEGACY_TREE_SCHEMA_VERSION },
    ]);
    expect(recovered.activeTreeId).toBe(completeTree.id);
    expect(recovered.loadError).toContain("not been overwritten");
  });

  it("quarantines a future tree and preserves the exact workspace for recovery", () => {
    const storage = memoryStorage();
    const raw = JSON.stringify({
      version: 1,
      activeTreeId: completeTree.id,
      trees: [
        completeTree,
        {
          ...completeTree,
          id: "future-tree",
          [TREE_SCHEMA_VERSION_FIELD]: CURRENT_TREE_SCHEMA_VERSION + 1,
        },
      ],
    });
    storage.setItem(LOCAL_WORKSPACE_KEY, raw);

    const recovered = loadLocalWorkspace(storage);

    expect(recovered).toMatchObject({
      activeTreeId: completeTree.id,
      loadError: expect.stringContaining("has not been overwritten"),
    });
    expect(recovered.trees).toEqual([
      { ...completeTree, [TREE_SCHEMA_VERSION_FIELD]: LEGACY_TREE_SCHEMA_VERSION },
    ]);
    expect(readLocalWorkspaceRecovery(recovered.recoveryKey, storage)).toBe(raw);
    expect(storage.getItem(LOCAL_WORKSPACE_KEY)).toBe(raw);
  });

  it("fails an invalid current write atomically without replacing prior browser data", () => {
    const storage = memoryStorage();
    const prior = '{"version":1,"activeTreeId":"prior","trees":[]}';
    storage.setItem(LOCAL_WORKSPACE_KEY, prior);
    const invalidCurrent = {
      ...persistedCompleteTree,
      people: [{ id: "person-1", fatherId: "missing-person" }],
    };

    expect(saveLocalWorkspace([invalidCurrent], invalidCurrent.id, storage)).toBe(false);
    expect(storage.getItem(LOCAL_WORKSPACE_KEY)).toBe(prior);
  });

  it("preserves an unopened legacy tree until that tree is normalised and activated", () => {
    const storage = memoryStorage();
    const unopenedLegacy = {
      ...completeTree,
      schemaVersion: 1,
      id: "legacy-tree",
      title: "Unopened legacy family",
    };

    expect(saveLocalWorkspace([completeTree, unopenedLegacy], completeTree.id, storage)).toBe(true);
    expect(loadLocalWorkspace(storage).trees).toEqual([
      persistedCompleteTree,
      {
        ...unopenedLegacy,
        [TREE_SCHEMA_VERSION_FIELD]: LEGACY_TREE_SCHEMA_VERSION,
      },
    ]);
  });

  it("does not filter an existing malformed record while updating another tree", () => {
    const malformed = { id: "keep-for-recovery", title: "Incomplete" };
    expect(upsertWorkspaceTree([malformed, completeTree], completeTree)).toEqual([
      completeTree,
      malformed,
    ]);
  });
});

describe("cloud family-tree serialization", () => {
  it("stores and hydrates the complete case instead of names only", () => {
    const record = familyTreeRecord(completeTree);
    expect(record.tree_data).toEqual(persistedCompleteTree);
    expect(
      hydrateFamilyTree({
        ...record,
        updated_at: "2026-07-29T00:00:00Z",
      }),
    ).toMatchObject(persistedCompleteTree);
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
