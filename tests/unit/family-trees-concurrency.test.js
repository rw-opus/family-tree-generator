import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseHarness = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("../../src/supabaseClient.js", () => ({
  supabase: { from: supabaseHarness.from, rpc: supabaseHarness.rpc },
}));

import {
  TREE_SAVE_CONFLICT,
  familyTreeRecord,
  hydrateFamilyTree,
  isTreeSaveConflictError,
  rebaseFamilyTreeListStorageRevision,
  rebaseFamilyTreeStorageRevision,
  saveFamilyTree,
} from "../../src/services/familyTrees.js";

const savedRecord = (overrides = {}) => ({
  id: "tree-1",
  title: "Borg family",
  people: [],
  tree_data: { id: "tree-1", title: "Borg family", people: [] },
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

  it("keeps database revision metadata outside the user-controlled JSON payload", () => {
    const record = familyTreeRecord({
      id: "tree-1",
      title: "Borg family",
      people: [],
      storageRevision: 7,
    });

    expect(record.tree_data).not.toHaveProperty("storageRevision");
    expect(hydrateFamilyTree(savedRecord())).toMatchObject({
      id: "tree-1",
      storageRevision: 8,
    });
  });

  it("saves through the server-enforced compare-and-swap RPC", async () => {
    const query = rpcQuery({ data: savedRecord(), error: null });

    const saved = await saveFamilyTree(
      { id: "tree-1", title: "Edited family", people: [], storageRevision: 7 },
      "owner-1",
    );

    expect(supabaseHarness.rpc).toHaveBeenCalledWith("save_family_tree", {
      p_tree_id: "tree-1",
      p_expected_revision: 7,
      p_title: "Edited family",
      p_people: [],
      p_tree_data: {
        id: "tree-1",
        title: "Edited family",
        people: [],
      },
    });
    expect(query.select).toHaveBeenCalledWith(
      "id,title,people,tree_data,revision,created_at,updated_at",
    );
    expect(saved.storageRevision).toBe(8);
  });

  it("maps the RPC's stale-revision response to a typed conflict", async () => {
    rpcQuery({
      data: null,
      error: { code: "PT409", message: "TREE_SAVE_CONFLICT" },
    });

    const operation = saveFamilyTree({
      id: "tree-1",
      title: "Stale edit",
      people: [],
      storageRevision: 7,
    });

    await expect(operation).rejects.toMatchObject({
      name: "TreeSaveConflictError",
      code: TREE_SAVE_CONFLICT,
      treeId: "tree-1",
      expectedRevision: 7,
    });
    await operation.catch((error) => expect(isTreeSaveConflictError(error)).toBe(true));
  });

  it("rebases only storage metadata and preserves newer local edits", () => {
    const local = {
      id: "tree-1",
      title: "Newer local title",
      people: [{ id: "new-local-person" }],
      storageRevision: 7,
    };

    expect(rebaseFamilyTreeStorageRevision(local, hydrateFamilyTree(savedRecord()))).toEqual({
      ...local,
      storageRevision: 8,
    });
  });

  it("keeps an acknowledged revision in the list for a later non-current rename", async () => {
    const list = [
      { id: "tree-1", title: "Locally edited A", people: [], storageRevision: 7 },
      { id: "tree-2", title: "Currently open B", people: [], storageRevision: 3 },
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
});
