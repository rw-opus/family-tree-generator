import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseHarness = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("../../src/supabaseClient.js", () => ({
  supabase: { from: supabaseHarness.from, rpc: supabaseHarness.rpc },
}));

import {
  FamilyTreeListValidationError,
  TREE_SAVE_CONFLICT,
  familyTreeSaveFingerprint,
  familyTreeRecord,
  hydrateFamilyTree,
  isFamilyTreeListValidationError,
  isTreeSaveConflictError,
  listFamilyTrees,
  rebaseFamilyTreeListStorageRevision,
  rebaseFamilyTreeStorageRevision,
  saveFamilyTree,
} from "../../src/services/familyTrees.js";
import {
  CURRENT_TREE_SCHEMA_VERSION,
  TREE_SCHEMA_VERSION_FIELD,
} from "../../src/domain/treeData.js";

const currentTree = (overrides = {}) => ({
  [TREE_SCHEMA_VERSION_FIELD]: CURRENT_TREE_SCHEMA_VERSION,
  schemaVersion: 2,
  id: "tree-1",
  title: "Borg family",
  people: [{ id: "person-1" }],
  familyGroups: [
    {
      id: "group-1",
      rootPersonId: "person-1",
      personIds: ["person-1"],
    },
  ],
  activeFamilyGroupId: "group-1",
  properties: [{ id: "property-1" }],
  outsideParties: [],
  settings: { activePropertyId: "property-1" },
  ...overrides,
});

const savedRecord = (overrides = {}) => ({
  id: "tree-1",
  title: "Borg family",
  people: [{ id: "person-1" }],
  tree_data: currentTree(),
  revision: 8,
  created_at: "2026-08-14T03:00:00Z",
  updated_at: "2026-08-14T03:05:00Z",
  ...overrides,
});

const rpcQuery = (response) => {
  const query = {
    select: vi.fn(() => query),
    single: vi.fn(async () => response),
  };
  supabaseHarness.rpc.mockReturnValue(query);
  return query;
};

describe("family tree optimistic concurrency", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps database revision and trash metadata outside the user-controlled JSON payload", () => {
    const record = familyTreeRecord({
      ...currentTree(),
      storageRevision: 7,
      deletedAt: "2026-08-14T03:30:00Z",
    });

    expect(record.tree_data).not.toHaveProperty("storageRevision");
    expect(record.tree_data).not.toHaveProperty("deletedAt");
    expect(
      familyTreeSaveFingerprint({
        ...currentTree(),
        deletedAt: "2026-08-14T03:30:00Z",
      }),
    ).toBe(familyTreeSaveFingerprint(currentTree()));
    expect(hydrateFamilyTree(savedRecord())).toMatchObject({
      id: "tree-1",
      storageRevision: 8,
    });
  });

  it("saves through the server-enforced compare-and-swap RPC", async () => {
    const query = rpcQuery({ data: savedRecord(), error: null });

    const saved = await saveFamilyTree(
      currentTree({
        title: "Edited family",
        storageRevision: 7,
        deletedAt: "2026-08-14T03:30:00Z",
      }),
      "owner-1",
    );

    expect(supabaseHarness.rpc).toHaveBeenCalledWith("save_family_tree", {
      p_tree_id: "tree-1",
      p_expected_revision: 7,
      p_title: "Edited family",
      p_people: [{ id: "person-1" }],
      p_tree_data: {
        [TREE_SCHEMA_VERSION_FIELD]: CURRENT_TREE_SCHEMA_VERSION,
        schemaVersion: 2,
        id: "tree-1",
        title: "Edited family",
        people: [{ id: "person-1" }],
        familyGroups: [
          {
            id: "group-1",
            rootPersonId: "person-1",
            personIds: ["person-1"],
          },
        ],
        activeFamilyGroupId: "group-1",
        properties: [{ id: "property-1" }],
        outsideParties: [],
        settings: { activePropertyId: "property-1" },
      },
    });
    expect(query.select).toHaveBeenCalledWith(
      "id,title,people,tree_data,revision,created_at,updated_at,deleted_at",
    );
    expect(saved.storageRevision).toBe(8);
  });

  it("maps the RPC's stale-revision response to a typed conflict", async () => {
    rpcQuery({
      data: null,
      error: { code: "PT409", message: "TREE_SAVE_CONFLICT" },
    });

    const operation = saveFamilyTree(
      currentTree({
        title: "Stale edit",
        storageRevision: 7,
      }),
    );

    await expect(operation).rejects.toMatchObject({
      name: "TreeSaveConflictError",
      code: TREE_SAVE_CONFLICT,
      treeId: "tree-1",
      expectedRevision: 7,
    });
    await operation.catch((error) => expect(isTreeSaveConflictError(error)).toBe(true));
  });

  it("rebases only storage metadata and preserves newer local edits", () => {
    const local = currentTree({
      title: "Newer local title",
      people: [{ id: "new-local-person" }],
      storageRevision: 7,
    });

    expect(rebaseFamilyTreeStorageRevision(local, hydrateFamilyTree(savedRecord()))).toEqual({
      ...local,
      storageRevision: 8,
    });
  });

  it("keeps an acknowledged revision in the list for a later non-current rename", async () => {
    const list = [
      currentTree({ title: "Locally edited A", storageRevision: 7 }),
      currentTree({ id: "tree-2", title: "Currently open B", storageRevision: 3 }),
    ];
    const rebased = rebaseFamilyTreeListStorageRevision(list, hydrateFamilyTree(savedRecord()));
    rpcQuery({ data: savedRecord({ revision: 9 }), error: null });

    await saveFamilyTree({ ...rebased[0], title: "Renamed while B is open" }, "owner-1");

    expect(rebased[0]).toMatchObject({ title: "Locally edited A", storageRevision: 8 });
    expect(rebased[1]).toEqual(list[1]);
    expect(supabaseHarness.rpc).toHaveBeenCalledWith(
      "save_family_tree",
      expect.objectContaining({ p_tree_id: "tree-1", p_expected_revision: 8 }),
    );
  });

  // A save that only moves the revision on must not hand back fresh objects:
  // the workspace keys its layout, its person cards and the whole tax pipeline
  // off these identities, and rebuilding all of that on every save is what made
  // typing stall for seconds each time it paused.
  it("returns the very same snapshot when the revision has not moved", () => {
    const local = currentTree({ storageRevision: 8 });
    const saved = hydrateFamilyTree(savedRecord());
    expect(saved.storageRevision).toBe(8);
    expect(rebaseFamilyTreeStorageRevision(local, saved)).toBe(local);
  });

  it("keeps the people array identical when only the revision moves", () => {
    const local = currentTree({ people: [{ id: "person-1" }], storageRevision: 7 });
    const rebased = rebaseFamilyTreeStorageRevision(local, hydrateFamilyTree(savedRecord()));
    expect(rebased).not.toBe(local);
    expect(rebased.storageRevision).toBe(8);
    expect(rebased.people).toBe(local.people);
  });

  it("returns the same list when no tree in it moved", () => {
    const list = [currentTree({ storageRevision: 8 })];
    expect(rebaseFamilyTreeListStorageRevision(list, hydrateFamilyTree(savedRecord()))).toBe(list);
  });

  it("adopts the persisted tree schema marker when rebasing a legacy snapshot", () => {
    const legacy = {
      ...currentTree({ storageRevision: 7 }),
    };
    delete legacy[TREE_SCHEMA_VERSION_FIELD];

    expect(rebaseFamilyTreeStorageRevision(legacy, hydrateFamilyTree(savedRecord()))).toMatchObject(
      {
        [TREE_SCHEMA_VERSION_FIELD]: CURRENT_TREE_SCHEMA_VERSION,
        storageRevision: 8,
      },
    );
  });

  it("returns safe rows on a typed list error while quarantining a future row", async () => {
    const futureRecord = savedRecord({
      id: "future-tree",
      title: "Future family",
      tree_data: currentTree({
        id: "future-tree",
        title: "Future family",
        [TREE_SCHEMA_VERSION_FIELD]: CURRENT_TREE_SCHEMA_VERSION + 1,
      }),
    });
    const order = vi.fn(async () => ({ data: [savedRecord(), futureRecord], error: null }));
    const is = vi.fn(() => ({ order }));
    supabaseHarness.from.mockReturnValue({ select: vi.fn(() => ({ is })) });

    const operation = listFamilyTrees();
    await expect(operation).rejects.toBeInstanceOf(FamilyTreeListValidationError);
    await operation.catch((error) => {
      expect(isFamilyTreeListValidationError(error)).toBe(true);
      expect(error.trees).toHaveLength(1);
      expect(error.rejected).toEqual([
        expect.objectContaining({ id: "future-tree", code: "TREE_DATA_UNSUPPORTED_VERSION" }),
      ]);
    });
    expect(is).toHaveBeenCalledWith("deleted_at", null);
  });
});
