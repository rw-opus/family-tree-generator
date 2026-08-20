import { describe, expect, it } from "vitest";
import {
  TREE_DRAFT_ERROR_CODES,
  TREE_DRAFT_RECOVERY_STATES,
  acknowledgeTreeDraftSave,
  clearTreeDraftDeletionTombstoneForRecreation,
  clearTreeDraft,
  compareTreeDraftToServer,
  dismissTreeDraft,
  isTreeDraftError,
  listTreeDrafts,
  markTreeDraftDeleted,
  readTreeDraft,
  recoverTreeDraftTree,
  treeDraftDeletionTombstoneKey,
  treeDraftDismissalKey,
  treeDraftFingerprint,
  treeDraftKey,
  writeTreeDraft,
} from "../../src/services/treeDraftJournal.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  get length() {
    return this.values.size;
  }

  key(index) {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key) {
    return this.values.get(String(key)) ?? null;
  }

  setItem(key, value) {
    this.values.set(String(key), String(value));
  }

  removeItem(key) {
    this.values.delete(String(key));
  }
}

const baseTree = (overrides = {}) => ({
  id: "tree-1",
  title: "Borg family",
  people: [{ id: "person-a", fullName: "Joseph Borg" }],
  properties: [{ id: "property-1", owners: [] }],
  outsideParties: [],
  storageRevision: 4,
  ...overrides,
});

const writeDraft = (storage, overrides = {}, options = {}) =>
  writeTreeDraft(
    "auth-user-1",
    { treeId: "tree-1", baseStorageRevision: 4, tree: baseTree(), ...overrides },
    { storage, now: new Date("2026-08-18T08:15:00.000Z"), ...options },
  );

describe("tree draft journal", () => {
  it("stores a compact whole-tree snapshot keyed by user, tree and browser tab", () => {
    const storage = new MemoryStorage();
    const draft = writeDraft(storage, {
      tree: baseTree({
        people: [
          { id: "person-a", fullName: "Joseph Borg" },
          { id: "person-b", fullName: "Maria Borg" },
        ],
      }),
    });

    expect(draft).toMatchObject({
      version: 1,
      userId: "auth-user-1",
      treeId: "tree-1",
      writerId: "default-writer",
      baseStorageRevision: 4,
    });
    expect(draft.tree.people).toHaveLength(2);
    expect(draft.treeFingerprint).toBe(treeDraftFingerprint(draft.tree));

    const raw = storage.getItem(treeDraftKey("auth-user-1", "tree-1"));
    expect(raw).not.toBeNull();
    expect(readTreeDraft("auth-user-1", "tree-1", { storage })).toEqual(draft);
  });

  it("does not rewrite storage when the same edit is journaled twice", () => {
    const storage = new MemoryStorage();
    writeDraft(storage);
    const firstRaw = storage.getItem(treeDraftKey("auth-user-1", "tree-1"));
    const second = writeDraft(storage);
    expect(storage.getItem(treeDraftKey("auth-user-1", "tree-1"))).toBe(firstRaw);
    expect(second.recordFingerprint).toBe(second.recordFingerprint);
  });

  it("overwrites this tab's draft with the latest snapshot on further edits", () => {
    const storage = new MemoryStorage();
    writeDraft(storage);
    const second = writeDraft(storage, {
      tree: baseTree({ title: "Borg succession" }),
    });
    expect(second.tree.title).toBe("Borg succession");
    expect(readTreeDraft("auth-user-1", "tree-1", { storage })).toMatchObject({
      tree: expect.objectContaining({ title: "Borg succession" }),
    });
  });

  it("keeps separate drafts per browser tab", () => {
    const storage = new MemoryStorage();
    writeDraft(storage, {}, { writerId: "tab-a" });
    writeDraft(storage, { tree: baseTree({ title: "Tab B copy" }) }, { writerId: "tab-b" });
    const { drafts } = listTreeDrafts("auth-user-1", { storage });
    expect(drafts).toHaveLength(2);
    expect(drafts.map((draft) => draft.writerId).sort()).toEqual(["tab-a", "tab-b"]);
  });

  it("rejects a tree that exceeds the compact recovery size limit", () => {
    const storage = new MemoryStorage();
    const hugePeople = Array.from({ length: 100_000 }, (_, index) => ({
      id: `person-${index}`,
      fullName: "x".repeat(200),
    }));
    expect(() => writeDraft(storage, { tree: baseTree({ people: hugePeople }) })).toThrow(
      /too large/i,
    );
    try {
      writeDraft(storage, { tree: baseTree({ people: hugePeople }) });
    } catch (error) {
      expect(isTreeDraftError(error)).toBe(true);
      expect(error.code).toBe(TREE_DRAFT_ERROR_CODES.TOO_LARGE);
    }
  });

  it("isolates a tampered record instead of trusting it", () => {
    const storage = new MemoryStorage();
    writeDraft(storage);
    const key = treeDraftKey("auth-user-1", "tree-1");
    const envelope = JSON.parse(storage.getItem(key));
    envelope.tree.title = "Tampered";
    storage.setItem(key, JSON.stringify(envelope));

    expect(() => readTreeDraft("auth-user-1", "tree-1", { storage })).toThrow(/invalid/i);
    const { drafts, invalidRecords } = listTreeDrafts("auth-user-1", { storage });
    expect(drafts).toHaveLength(0);
    expect(invalidRecords).toHaveLength(1);
  });

  it("dismisses a draft so it stops being listed until it changes again", () => {
    const storage = new MemoryStorage();
    const draft = writeDraft(storage);
    expect(dismissTreeDraft("auth-user-1", "tree-1", draft.recordFingerprint, { storage })).toBe(
      true,
    );
    expect(listTreeDrafts("auth-user-1", { storage }).drafts).toHaveLength(0);
    expect(storage.getItem(treeDraftDismissalKey("auth-user-1", "tree-1"))).not.toBeNull();

    writeDraft(storage, { tree: baseTree({ title: "New edit" }) });
    expect(listTreeDrafts("auth-user-1", { storage }).drafts).toHaveLength(1);
  });

  it("clears a draft outright given its exact fingerprint", () => {
    const storage = new MemoryStorage();
    const draft = writeDraft(storage);
    expect(
      clearTreeDraft("auth-user-1", "tree-1", "fnv1a64:0:0000000000000000", {
        storage,
      }),
    ).toBe(false);
    expect(clearTreeDraft("auth-user-1", "tree-1", draft.recordFingerprint, { storage })).toBe(
      true,
    );
    expect(readTreeDraft("auth-user-1", "tree-1", { storage })).toBeNull();
  });

  describe("compareTreeDraftToServer", () => {
    it("reports IDENTICAL when the server already has this exact content", () => {
      const draft = writeDraft(new MemoryStorage());
      const server = { ...draft.tree, storageRevision: 4 };
      expect(compareTreeDraftToServer(draft, server).state).toBe(
        TREE_DRAFT_RECOVERY_STATES.IDENTICAL,
      );
    });

    it("reports SAFE_TO_RESTORE only when the server is still exactly at the draft's base revision", () => {
      const draft = writeDraft(new MemoryStorage());
      const server = baseTree({ storageRevision: 4, title: "Different from draft" });
      expect(compareTreeDraftToServer(draft, server).state).toBe(
        TREE_DRAFT_RECOVERY_STATES.SAFE_TO_RESTORE,
      );
    });

    it("reports CONFLICT once the server has moved past the draft's base revision", () => {
      const draft = writeDraft(new MemoryStorage());
      const server = baseTree({ storageRevision: 5, title: "Saved from elsewhere" });
      expect(compareTreeDraftToServer(draft, server).state).toBe(
        TREE_DRAFT_RECOVERY_STATES.CONFLICT,
      );
    });
  });

  it("restores a safe draft's tree onto the current server revision", () => {
    const draft = writeDraft(new MemoryStorage(), {
      tree: baseTree({ title: "Recovered title" }),
    });
    const server = baseTree({ storageRevision: 4 });
    const recovered = recoverTreeDraftTree(draft, server);
    expect(recovered.title).toBe("Recovered title");
    expect(recovered.storageRevision).toBe(4);
  });

  it("refuses to blindly restore over a conflicting server tree", () => {
    const draft = writeDraft(new MemoryStorage());
    const server = baseTree({ storageRevision: 9, title: "Saved elsewhere" });
    expect(() => recoverTreeDraftTree(draft, server)).toThrow(/changed elsewhere/i);
  });

  describe("acknowledgeTreeDraftSave", () => {
    it("clears the draft once the exact saved snapshot matches it", () => {
      const storage = new MemoryStorage();
      const draft = writeDraft(storage, { tree: baseTree({ title: "Saved now" }) });
      const result = acknowledgeTreeDraftSave(
        "auth-user-1",
        "tree-1",
        treeDraftFingerprint(draft.tree),
        { storage },
      );
      expect(result.action).toBe("cleared");
      expect(readTreeDraft("auth-user-1", "tree-1", { storage })).toBeNull();
    });

    it("keeps a newer draft untouched when the acknowledged save is already stale", () => {
      const storage = new MemoryStorage();
      const firstDraft = writeDraft(storage, { tree: baseTree({ title: "First edit" }) });
      writeDraft(storage, { tree: baseTree({ title: "Second edit, still unsaved" }) });
      const result = acknowledgeTreeDraftSave(
        "auth-user-1",
        "tree-1",
        treeDraftFingerprint(firstDraft.tree),
        { storage },
      );
      expect(result.action).toBe("kept");
      expect(readTreeDraft("auth-user-1", "tree-1", { storage }).tree.title).toBe(
        "Second edit, still unsaved",
      );
    });
  });

  describe("permanent deletion", () => {
    it("blocks further writes and clears existing drafts once a tree is marked deleted", () => {
      const storage = new MemoryStorage();
      writeDraft(storage, {}, { writerId: "tab-a" });
      writeDraft(storage, {}, { writerId: "tab-b" });
      const { tombstone } = markTreeDraftDeleted("auth-user-1", "tree-1", { storage });

      expect(storage.getItem(treeDraftKey("auth-user-1", "tree-1", "tab-a"))).toBeNull();
      expect(storage.getItem(treeDraftKey("auth-user-1", "tree-1", "tab-b"))).toBeNull();
      expect(() => writeDraft(storage)).toThrow(/permanently deleted/i);
      expect(storage.getItem(treeDraftDeletionTombstoneKey("auth-user-1", "tree-1"))).toContain(
        tombstone.tombstoneId,
      );
    });

    it("allows writes again once the tombstone is deliberately cleared for recreation", () => {
      const storage = new MemoryStorage();
      const { tombstone } = markTreeDraftDeleted("auth-user-1", "tree-1", { storage });
      expect(() => writeDraft(storage)).toThrow();
      expect(
        clearTreeDraftDeletionTombstoneForRecreation(
          "auth-user-1",
          "tree-1",
          tombstone.tombstoneId,
          { storage },
        ),
      ).toBe(true);
      expect(() => writeDraft(storage)).not.toThrow();
    });
  });
});
