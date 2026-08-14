import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseHarness = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("../../src/supabaseClient.js", () => ({
  supabase: { from: supabaseHarness.from, rpc: supabaseHarness.rpc },
}));

import {
  TREE_PERMANENT_DELETE_CONFLICT,
  TREE_RESTORE_CONFLICT,
  TREE_RESTORE_EXPIRED,
  TREE_REVISION_REQUIRED,
  TREE_TRASH_CONFLICT,
  isFamilyTreeRestoreExpiredError,
  isFamilyTreeStateConflictError,
  listTrashedFamilyTrees,
  permanentlyDeleteFamilyTree,
  restoreFamilyTree,
  trashFamilyTree,
} from "../../src/services/familyTrees.js";
import {
  CURRENT_TREE_SCHEMA_VERSION,
  TREE_SCHEMA_VERSION_FIELD,
} from "../../src/domain/treeData.js";

const treeData = (overrides = {}) => ({
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

const record = (overrides = {}) => ({
  id: "tree-1",
  title: "Borg family",
  people: [{ id: "person-1" }],
  tree_data: treeData(),
  revision: 9,
  created_at: "2026-08-01T09:00:00Z",
  updated_at: "2026-08-14T09:00:00Z",
  deleted_at: "2026-08-14T09:00:00Z",
  ...overrides,
});

const mutationQuery = (response) => {
  const query = {
    select: vi.fn(() => query),
    single: vi.fn(async () => response),
  };
  supabaseHarness.rpc.mockReturnValue(query);
  return query;
};

describe("cloud family-tree Trash operations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists all owner trash returned by the protected RPC, including expired rows", async () => {
    const expiredAt = "2026-07-01T09:00:00Z";
    const query = {
      select: vi.fn(() => query),
      order: vi.fn(async () => ({
        data: [record({ deleted_at: expiredAt })],
        error: null,
      })),
    };
    supabaseHarness.rpc.mockReturnValue(query);

    const trashed = await listTrashedFamilyTrees();

    expect(supabaseHarness.rpc).toHaveBeenCalledWith("list_trashed_family_trees");
    expect(query.order).toHaveBeenCalledWith("deleted_at", { ascending: false });
    expect(trashed).toEqual([
      expect.objectContaining({
        id: "tree-1",
        storageRevision: 9,
        deletedAt: expiredAt,
      }),
    ]);
  });

  it("moves an exact tree revision to Trash and adopts the server revision", async () => {
    mutationQuery({ data: record(), error: null });

    const trashed = await trashFamilyTree(treeData({ storageRevision: 8 }));

    expect(supabaseHarness.rpc).toHaveBeenCalledWith("trash_family_tree", {
      p_tree_id: "tree-1",
      p_expected_revision: 8,
    });
    expect(trashed).toMatchObject({ storageRevision: 9, deletedAt: "2026-08-14T09:00:00Z" });
  });

  it("restores an exact trash revision and clears the deletion timestamp", async () => {
    mutationQuery({ data: record({ revision: 10, deleted_at: null }), error: null });

    const restored = await restoreFamilyTree(
      treeData({ storageRevision: 9, deletedAt: "2026-08-14T09:00:00Z" }),
    );

    expect(supabaseHarness.rpc).toHaveBeenCalledWith("restore_family_tree", {
      p_tree_id: "tree-1",
      p_expected_revision: 9,
    });
    expect(restored).toMatchObject({ storageRevision: 10 });
    expect(restored).not.toHaveProperty("deletedAt");
  });

  it.each([
    ["trash", trashFamilyTree, TREE_TRASH_CONFLICT],
    ["restore", restoreFamilyTree, TREE_RESTORE_CONFLICT],
  ])("maps a stale %s response to a typed state conflict", async (_label, operation, code) => {
    mutationQuery({ data: null, error: { code: "PT409", message: code } });

    const pending = operation(treeData({ storageRevision: 8 }));

    await expect(pending).rejects.toMatchObject({
      name: "FamilyTreeStateConflictError",
      code,
      treeId: "tree-1",
      expectedRevision: 8,
    });
    await pending.catch((error) => expect(isFamilyTreeStateConflictError(error)).toBe(true));
  });

  it("maps an expired restore to a typed 30-day expiry error", async () => {
    mutationQuery({
      data: null,
      error: { code: "PT410", message: TREE_RESTORE_EXPIRED },
    });

    const pending = restoreFamilyTree(treeData({ storageRevision: 9 }));

    await expect(pending).rejects.toMatchObject({
      name: "FamilyTreeRestoreExpiredError",
      code: TREE_RESTORE_EXPIRED,
      treeId: "tree-1",
    });
    await pending.catch((error) => expect(isFamilyTreeRestoreExpiredError(error)).toBe(true));
  });

  it("permanently deletes only an exact trashed revision", async () => {
    supabaseHarness.rpc.mockResolvedValue({ data: "tree-1", error: null });

    await expect(
      permanentlyDeleteFamilyTree(
        treeData({ storageRevision: 9, deletedAt: "2026-08-14T09:00:00Z" }),
      ),
    ).resolves.toBe("tree-1");
    expect(supabaseHarness.rpc).toHaveBeenCalledWith("permanently_delete_family_tree", {
      p_tree_id: "tree-1",
      p_expected_revision: 9,
    });
  });

  it("maps a stale permanent delete to a typed state conflict", async () => {
    supabaseHarness.rpc.mockResolvedValue({
      data: null,
      error: { code: "PT409", message: TREE_PERMANENT_DELETE_CONFLICT },
    });

    const pending = permanentlyDeleteFamilyTree(treeData({ storageRevision: 9 }));

    await expect(pending).rejects.toMatchObject({
      code: TREE_PERMANENT_DELETE_CONFLICT,
      expectedRevision: 9,
    });
  });

  it.each([trashFamilyTree, restoreFamilyTree, permanentlyDeleteFamilyTree])(
    "refuses a mutation without a real server revision before calling Supabase",
    async (operation) => {
      const pending = operation(treeData());

      await expect(pending).rejects.toMatchObject({ code: TREE_REVISION_REQUIRED });
      expect(supabaseHarness.rpc).not.toHaveBeenCalled();
    },
  );
});
