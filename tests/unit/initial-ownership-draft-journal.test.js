import { describe, expect, it } from "vitest";
import {
  INITIAL_OWNERSHIP_DRAFT_ERROR_CODES,
  INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES,
  acknowledgeInitialOwnershipDraftSave,
  clearInitialOwnershipDeletionTombstoneForRecreation,
  clearInitialOwnershipDraft,
  compareInitialOwnershipDraftToTree,
  dismissInitialOwnershipDraft,
  initialOwnershipDeletionTombstoneKey,
  initialOwnershipDraftDismissalKey,
  initialOwnershipDraftKey,
  initialOwnershipOwnersFingerprint,
  listInitialOwnershipDrafts,
  markInitialOwnershipDraftSubmitted,
  markInitialOwnershipTreeDeleted,
  readInitialOwnershipDeletionTombstone,
  readInitialOwnershipDraft,
  recoverInitialOwnershipDraftTree,
  writeInitialOwnershipDraft,
} from "../../src/services/initialOwnershipDraftJournal.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
    this.afterSet = null;
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
    this.afterSet?.(String(key), String(value), this);
  }

  removeItem(key) {
    this.values.delete(String(key));
  }
}

const baseOwners = [
  {
    id: "owner-a",
    personId: "person-a",
    shareNumerator: 1,
    shareDenominator: 1,
    acquisitionDate: "1980-01-02",
  },
];

const editedOwners = [
  {
    id: "owner-a",
    personId: "person-a",
    shareNumerator: 3,
    shareDenominator: 5,
    acquisitionDate: "1980-01-02",
    futureTaxField: { preserveMe: true },
  },
  {
    id: "owner-b",
    personId: "person-b",
    shareNumerator: 2,
    shareDenominator: 5,
    acquisitionDate: "1980-01-02",
  },
];

const serverTree = ({
  owners = baseOwners,
  revision = 7,
  properties,
  outsideParties = [],
} = {}) => ({
  id: "tree-1",
  storageRevision: revision,
  people: [
    { id: "person-a", fullName: "Joseph Borg" },
    { id: "person-b", fullName: "Maria Borg" },
  ],
  outsideParties,
  properties: properties || [{ id: "property-1", owners }],
});

const writeDraft = (storage, overrides = {}, options = {}) =>
  writeInitialOwnershipDraft(
    "auth-user-1",
    {
      treeId: "tree-1",
      propertyId: "property-1",
      baseStorageRevision: 7,
      baseOwners,
      owners: editedOwners,
      ...overrides,
    },
    {
      storage,
      now: new Date("2026-08-18T08:15:00.000Z"),
      ...options,
    },
  );

describe("initial-ownership draft journal", () => {
  it("stores only compact ownership data while preserving complete rows and row order", () => {
    const storage = new MemoryStorage();
    const outsideParty = {
      id: "company-new",
      name: "New Holdings Limited",
      type: "company",
      unknownRegistryField: { number: "C 12345" },
    };
    const owners = [{ ...editedOwners[1] }, { ...editedOwners[0], personId: "company-new" }];
    const draft = writeDraft(storage, {
      owners,
      baseOutsideParties: [{ id: "company-old", name: "Old Holdings" }],
      outsideParties: [
        { id: "company-old", name: "Old Holdings" },
        outsideParty,
        { id: "unused-new", name: "Not an owner" },
      ],
    });

    expect(draft).toMatchObject({
      version: 1,
      userId: "auth-user-1",
      treeId: "tree-1",
      propertyId: "property-1",
      baseStorageRevision: 7,
      owners,
      outsideParties: [outsideParty],
    });
    expect(draft.owners[1].futureTaxField).toEqual({ preserveMe: true });
    expect(draft.baseOwnersFingerprint).toBe(initialOwnershipOwnersFingerprint(baseOwners));
    expect(draft.ownersFingerprint).toBe(initialOwnershipOwnersFingerprint(owners));
    expect(draft.recordFingerprint.length).toBeLessThan(64);

    const raw = storage.getItem(initialOwnershipDraftKey("auth-user-1", "tree-1", "property-1"));
    expect(raw.length).toBeLessThan(4_000);
    expect(raw).not.toContain('"tree"');
    expect(raw).not.toContain('"people"');
    expect(raw).not.toContain("Joseph Borg");

    owners[0].shareNumerator = 99;
    outsideParty.name = "Mutated";
    expect(readInitialOwnershipDraft("auth-user-1", "tree-1", "property-1", { storage })).toEqual(
      draft,
    );
  });

  it("rejects email-shaped account keys and invalid JSON values", () => {
    const storage = new MemoryStorage();
    expect(() =>
      writeInitialOwnershipDraft(
        "owner@example.com",
        {
          treeId: "tree-1",
          propertyId: "property-1",
          baseStorageRevision: 7,
          baseOwners,
          owners: editedOwners,
        },
        { storage },
      ),
    ).toThrowError(
      expect.objectContaining({ code: INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.INVALID_ID }),
    );
    expect(() =>
      writeDraft(storage, {
        owners: [{ id: "owner", personId: "person-a", future: Number.NaN }],
      }),
    ).toThrowError(expect.objectContaining({ code: INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.INVALID }));
  });

  it("enumerates different writers and isolates malformed records without hiding valid drafts", () => {
    const storage = new MemoryStorage();
    writeDraft(storage, {}, { writerId: "tab-a" });
    writeDraft(storage, { owners: [editedOwners[0]] }, { writerId: "tab-b" });
    const malformedKey = initialOwnershipDraftKey(
      "auth-user-1",
      "tree-broken",
      "property-broken",
      "tab-c",
    );
    storage.setItem(malformedKey, "{not json");
    storage.setItem(
      initialOwnershipDraftKey("another-user", "tree-2", "property-2", "tab-d"),
      "{also broken",
    );

    const result = listInitialOwnershipDrafts("auth-user-1", { storage });
    expect(result.drafts.map((draft) => draft.writerId)).toEqual(["tab-a", "tab-b"]);
    expect(result.invalidRecords).toHaveLength(1);
    expect(result.invalidRecords[0]).toMatchObject({ key: malformedKey, raw: "{not json" });
    expect(result.invalidRecords[0].error.code).toBe(INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.INVALID);
  });

  it("uses exact owner fingerprints rather than an unrelated tree revision to decide safety", () => {
    const storage = new MemoryStorage();
    const draft = writeDraft(storage);

    expect(compareInitialOwnershipDraftToTree(draft, serverTree({ revision: 99 }))).toMatchObject({
      state: INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES.SAFE_TO_REPLAY,
      reason: "base-owners-match",
    });
    expect(
      compareInitialOwnershipDraftToTree(draft, serverTree({ owners: editedOwners, revision: 8 })),
    ).toMatchObject({
      state: INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES.IDENTICAL,
      ownersIdentical: true,
    });
    expect(
      compareInitialOwnershipDraftToTree(
        draft,
        serverTree({
          owners: [{ id: "other", personId: "person-a", shareNumerator: 1, shareDenominator: 1 }],
          revision: 8,
        }),
      ),
    ).toMatchObject({
      state: INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES.CONFLICT,
      reason: "owners-diverged",
    });
    expect(
      compareInitialOwnershipDraftToTree(
        draft,
        serverTree({ properties: [{ id: "another-property", owners: baseOwners }] }),
      ),
    ).toMatchObject({
      state: INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES.CONFLICT,
      reason: "missing-property",
    });
  });

  it("recognises a submitted owner snapshot as a safe ancestor of a later edit", () => {
    const storage = new MemoryStorage();
    const submittedOwners = [
      { ...editedOwners[0], shareNumerator: 1, shareDenominator: 2 },
      { ...editedOwners[1], shareNumerator: 1, shareDenominator: 2 },
    ];
    let draft = writeDraft(storage, { owners: submittedOwners });
    draft = markInitialOwnershipDraftSubmitted(
      "auth-user-1",
      "tree-1",
      "property-1",
      draft.ownersFingerprint,
      { storage },
    );
    draft = writeDraft(storage, { owners: editedOwners });

    expect(draft.submittedOwnerFingerprints).toEqual([
      initialOwnershipOwnersFingerprint(submittedOwners),
    ]);
    expect(
      compareInitialOwnershipDraftToTree(
        draft,
        serverTree({ owners: submittedOwners, revision: 8 }),
      ),
    ).toMatchObject({
      state: INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES.SAFE_TO_REPLAY,
      reason: "submitted-owner-ancestor-match",
    });
  });

  it("keeps an in-flight recovered snapshot as a safe ancestor of a later edit", () => {
    const storage = new MemoryStorage();
    const recoveredOwners = [
      { ...editedOwners[0], shareNumerator: 1, shareDenominator: 2 },
      { ...editedOwners[1], shareNumerator: 1, shareDenominator: 2 },
    ];
    const draft = writeDraft(storage, {
      owners: editedOwners,
      knownAncestorOwnerFingerprints: [initialOwnershipOwnersFingerprint(recoveredOwners)],
    });

    expect(draft).toMatchObject({
      baseOwnersFingerprint: initialOwnershipOwnersFingerprint(baseOwners),
      ownersFingerprint: initialOwnershipOwnersFingerprint(editedOwners),
      submittedOwnerFingerprints: [initialOwnershipOwnersFingerprint(recoveredOwners)],
    });
    expect(
      compareInitialOwnershipDraftToTree(
        draft,
        serverTree({ owners: recoveredOwners, revision: 8 }),
      ),
    ).toMatchObject({
      state: INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES.SAFE_TO_REPLAY,
      reason: "submitted-owner-ancestor-match",
    });

    const acknowledgement = acknowledgeInitialOwnershipDraftSave(
      "auth-user-1",
      "tree-1",
      "property-1",
      initialOwnershipOwnersFingerprint(recoveredOwners),
      7,
      8,
      { storage },
    );
    expect(acknowledgement).toMatchObject({
      action: "rebased",
      draft: {
        baseStorageRevision: 8,
        baseOwnersFingerprint: initialOwnershipOwnersFingerprint(recoveredOwners),
        ownersFingerprint: initialOwnershipOwnersFingerprint(editedOwners),
        submittedOwnerFingerprints: [],
      },
    });
  });

  it("keeps the original server base and a new outside party across sequential edits", () => {
    const storage = new MemoryStorage();
    const company = {
      id: "company-new",
      name: "New Holdings Limited",
      type: "company",
      registry: { number: "C 12345" },
    };
    const ownersA = [
      { id: "owner-a", personId: "person-a", shareNumerator: 1, shareDenominator: 2 },
      { id: "owner-company", personId: company.id, shareNumerator: 1, shareDenominator: 2 },
    ];
    const ownersB = [
      { id: "owner-a", personId: "person-a", shareNumerator: 3, shareDenominator: 5 },
      { id: "owner-company", personId: company.id, shareNumerator: 2, shareDenominator: 5 },
    ];
    const first = writeDraft(storage, {
      baseOwners,
      owners: ownersA,
      baseOutsideParties: [],
      outsideParties: [company],
    });
    const second = writeDraft(storage, {
      // The live tree now contains A and the newly created party, but neither
      // has reached the server at revision 7.
      baseOwners: ownersA,
      owners: ownersB,
      baseOutsideParties: [company],
      outsideParties: [company],
    });

    expect(second).toMatchObject({
      baseStorageRevision: 7,
      baseOwnersFingerprint: initialOwnershipOwnersFingerprint(baseOwners),
      ownersFingerprint: initialOwnershipOwnersFingerprint(ownersB),
      outsideParties: [company],
    });
    expect(second.recordFingerprint).not.toBe(first.recordFingerprint);
    expect(compareInitialOwnershipDraftToTree(second, serverTree())).toMatchObject({
      state: INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES.SAFE_TO_REPLAY,
      reason: "base-owners-match",
      outsidePartiesToAdd: [company],
    });
  });

  it("clears an exactly saved target and rebases only a marked newer same-writer descendant", () => {
    const exactStorage = new MemoryStorage();
    let exact = writeDraft(exactStorage);
    exact = markInitialOwnershipDraftSubmitted(
      "auth-user-1",
      "tree-1",
      "property-1",
      exact.ownersFingerprint,
      { storage: exactStorage },
    );
    expect(
      acknowledgeInitialOwnershipDraftSave(
        "auth-user-1",
        "tree-1",
        "property-1",
        exact.ownersFingerprint,
        7,
        8,
        { storage: exactStorage },
      ),
    ).toEqual({ action: "cleared", draft: null });
    expect(
      readInitialOwnershipDraft("auth-user-1", "tree-1", "property-1", {
        storage: exactStorage,
      }),
    ).toBeNull();

    const descendantStorage = new MemoryStorage();
    const submittedOwners = [editedOwners[0]];
    let descendant = writeDraft(descendantStorage, { owners: submittedOwners });
    const savedFingerprint = descendant.ownersFingerprint;
    descendant = markInitialOwnershipDraftSubmitted(
      "auth-user-1",
      "tree-1",
      "property-1",
      savedFingerprint,
      { storage: descendantStorage },
    );
    descendant = writeDraft(descendantStorage, { owners: editedOwners });
    const acknowledged = acknowledgeInitialOwnershipDraftSave(
      "auth-user-1",
      "tree-1",
      "property-1",
      savedFingerprint,
      7,
      8,
      { storage: descendantStorage },
    );
    expect(acknowledged).toMatchObject({
      action: "rebased",
      draft: {
        baseStorageRevision: 8,
        baseOwnersFingerprint: savedFingerprint,
        ownersFingerprint: descendant.ownersFingerprint,
        submittedOwnerFingerprints: [],
      },
    });
    expect(
      compareInitialOwnershipDraftToTree(
        acknowledged.draft,
        serverTree({ owners: submittedOwners, revision: 8 }),
      ),
    ).toMatchObject({
      state: INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES.SAFE_TO_REPLAY,
      reason: "base-owners-match",
    });

    expect(() =>
      acknowledgeInitialOwnershipDraftSave(
        "auth-user-1",
        "tree-1",
        "property-1",
        initialOwnershipOwnersFingerprint(baseOwners),
        8,
        9,
        { storage: descendantStorage },
      ),
    ).toThrowError(
      expect.objectContaining({ code: INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.REVISION_CONFLICT }),
    );
  });

  it("recovers an atomically-created outside owner but rejects missing data and ID collisions", () => {
    const storage = new MemoryStorage();
    const company = {
      id: "company-new",
      name: "New Holdings Limited",
      type: "company",
      registrationNumber: "C 12345",
    };
    const owners = [{ id: "company-owner", personId: company.id, sharePercent: 100 }];
    const draft = writeDraft(storage, {
      owners,
      outsideParties: [company],
    });
    const comparison = compareInitialOwnershipDraftToTree(draft, serverTree());
    expect(comparison).toMatchObject({
      state: INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES.SAFE_TO_REPLAY,
      outsidePartiesToAdd: [company],
    });
    const recovered = recoverInitialOwnershipDraftTree(draft, serverTree());
    expect(recovered.properties[0].owners).toEqual(owners);
    expect(recovered.outsideParties).toEqual([company]);
    expect(recovered.people).toEqual(serverTree().people);

    const missingPartyDraft = writeDraft(
      new MemoryStorage(),
      { owners, outsideParties: [] },
      { writerId: "missing-party" },
    );
    expect(compareInitialOwnershipDraftToTree(missingPartyDraft, serverTree())).toMatchObject({
      state: INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES.CONFLICT,
      reason: "missing-owner-party",
      missingPartyIds: [company.id],
    });

    expect(
      compareInitialOwnershipDraftToTree(
        draft,
        serverTree({
          outsideParties: [{ ...company, name: "A different company using the same ID" }],
        }),
      ),
    ).toMatchObject({
      state: INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES.CONFLICT,
      reason: "outside-party-collision",
      conflictingPartyIds: [company.id],
    });
  });

  it("clears only the exact source record selected by its CAS fingerprint", () => {
    const storage = new MemoryStorage();
    const first = writeDraft(storage, { owners: [editedOwners[0]] });
    const second = writeDraft(storage, { owners: editedOwners });

    expect(
      clearInitialOwnershipDraft("auth-user-1", "tree-1", "property-1", first.recordFingerprint, {
        storage,
      }),
    ).toBe(false);
    expect(readInitialOwnershipDraft("auth-user-1", "tree-1", "property-1", { storage })).toEqual(
      second,
    );
    expect(
      clearInitialOwnershipDraft("auth-user-1", "tree-1", "property-1", second.recordFingerprint, {
        storage,
      }),
    ).toBe(true);
    expect(readInitialOwnershipDraft("auth-user-1", "tree-1", "property-1", { storage })).toBe(
      null,
    );
  });

  it("hides an acknowledged cross-writer source non-destructively and resurfaces changed data", () => {
    const storage = new MemoryStorage();
    const source = writeDraft(storage, { owners: [editedOwners[0]] }, { writerId: "source-tab" });
    expect(
      dismissInitialOwnershipDraft(
        "auth-user-1",
        "tree-1",
        "property-1",
        source.recordFingerprint,
        {
          storage,
          writerId: "source-tab",
          now: new Date("2026-08-18T09:00:00.000Z"),
        },
      ),
    ).toBe(true);
    expect(
      readInitialOwnershipDraft("auth-user-1", "tree-1", "property-1", {
        storage,
        writerId: "source-tab",
      }),
    ).toEqual(source);
    expect(listInitialOwnershipDrafts("auth-user-1", { storage })).toEqual({
      drafts: [],
      invalidRecords: [],
    });

    const changed = writeDraft(storage, {}, { writerId: "source-tab" });
    expect(changed.recordFingerprint).not.toBe(source.recordFingerprint);
    expect(listInitialOwnershipDrafts("auth-user-1", { storage }).drafts).toEqual([changed]);
    expect(
      dismissInitialOwnershipDraft(
        "auth-user-1",
        "tree-1",
        "property-1",
        source.recordFingerprint,
        { storage, writerId: "source-tab" },
      ),
    ).toBe(false);

    const markerKey = initialOwnershipDraftDismissalKey(
      "auth-user-1",
      "tree-1",
      "property-1",
      "source-tab",
    );
    storage.setItem(markerKey, "{broken marker");
    const listed = listInitialOwnershipDrafts("auth-user-1", { storage });
    expect(listed.drafts).toEqual([changed]);
    expect(listed.invalidRecords).toEqual([
      expect.objectContaining({ kind: "dismissal", key: markerKey, raw: "{broken marker" }),
    ]);
  });

  it("clears every writer/property record on permanent deletion and blocks stale tabs", () => {
    const storage = new MemoryStorage();
    writeDraft(storage, {}, { writerId: "tab-a" });
    writeDraft(
      storage,
      { propertyId: "property-2", baseOwners: [], owners: [] },
      { writerId: "tab-b" },
    );
    const dismissed = readInitialOwnershipDraft("auth-user-1", "tree-1", "property-1", {
      storage,
      writerId: "tab-a",
    });
    dismissInitialOwnershipDraft(
      "auth-user-1",
      "tree-1",
      "property-1",
      dismissed.recordFingerprint,
      { storage, writerId: "tab-a" },
    );
    const malformedTreeRecord = initialOwnershipDraftKey(
      "auth-user-1",
      "tree-1",
      "property-3",
      "tab-c",
    );
    storage.setItem(malformedTreeRecord, "bad");
    writeInitialOwnershipDraft(
      "auth-user-1",
      {
        treeId: "tree-elsewhere",
        propertyId: "property-1",
        baseStorageRevision: 1,
        baseOwners: [],
        owners: [],
      },
      { storage, writerId: "tab-a" },
    );

    const deleted = markInitialOwnershipTreeDeleted("auth-user-1", "tree-1", {
      storage,
      now: new Date("2026-08-18T10:00:00.000Z"),
      randomUUID: () => "delete-token",
    });
    expect(deleted).toMatchObject({
      clearedRecordCount: 3,
      clearedMetadataCount: 1,
      tombstone: { tombstoneId: "delete-token" },
    });
    expect(
      storage.getItem(
        initialOwnershipDraftDismissalKey("auth-user-1", "tree-1", "property-1", "tab-a"),
      ),
    ).toBeNull();
    expect(listInitialOwnershipDrafts("auth-user-1", { storage })).toMatchObject({
      drafts: [expect.objectContaining({ treeId: "tree-elsewhere" })],
      invalidRecords: [],
    });
    expect(readInitialOwnershipDeletionTombstone("auth-user-1", "tree-1", { storage })).toEqual(
      deleted.tombstone,
    );
    expect(() => writeDraft(storage, {}, { writerId: "stale-tab" })).toThrowError(
      expect.objectContaining({ code: INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.TREE_DELETED }),
    );

    expect(
      clearInitialOwnershipDeletionTombstoneForRecreation("auth-user-1", "tree-1", "wrong-token", {
        storage,
      }),
    ).toBe(false);
    expect(
      clearInitialOwnershipDeletionTombstoneForRecreation("auth-user-1", "tree-1", "delete-token", {
        storage,
      }),
    ).toBe(true);
    expect(writeDraft(storage, {}, { writerId: "deliberate-recreation" })).toMatchObject({
      writerId: "deliberate-recreation",
    });
  });

  it("rechecks deletion cleanup when live key indexes shift during enumeration", () => {
    const storage = new MemoryStorage();
    storage.setItem("unrelated-lower-key", "unrelated");
    const draft = writeDraft(storage, {}, { writerId: "tab-b" });
    const draftKey = initialOwnershipDraftKey("auth-user-1", "tree-1", "property-1", "tab-b");
    const originalKey = storage.key.bind(storage);
    let shifted = false;
    storage.key = (index) => {
      const key = originalKey(index);
      if (!shifted && index === 0) {
        shifted = true;
        storage.removeItem("unrelated-lower-key");
      }
      return key;
    };

    const deleted = markInitialOwnershipTreeDeleted("auth-user-1", "tree-1", {
      storage,
      randomUUID: () => "shift-safe-delete",
    });

    expect(draft.recordFingerprint).toBeTruthy();
    expect(deleted.clearedRecordCount).toBe(1);
    expect(storage.getItem(draftKey)).toBeNull();
    expect(listInitialOwnershipDrafts("auth-user-1", { storage }).drafts).toEqual([]);
  });

  it("removes its own write when another tab tombstones the tree during storage", () => {
    const storage = new MemoryStorage();
    const tombstoneKey = initialOwnershipDeletionTombstoneKey("auth-user-1", "tree-1");
    const draftKey = initialOwnershipDraftKey("auth-user-1", "tree-1", "property-1", "racing-tab");
    storage.afterSet = (key, _value, target) => {
      if (key !== draftKey) return;
      target.afterSet = null;
      target.setItem(
        tombstoneKey,
        JSON.stringify({
          version: 1,
          userId: "auth-user-1",
          treeId: "tree-1",
          tombstoneId: "other-tab-delete",
          deletedAt: "2026-08-18T10:00:00.000Z",
        }),
      );
    };

    expect(() => writeDraft(storage, {}, { writerId: "racing-tab" })).toThrowError(
      expect.objectContaining({ code: INITIAL_OWNERSHIP_DRAFT_ERROR_CODES.TREE_DELETED }),
    );
    expect(storage.getItem(draftKey)).toBeNull();
    expect(storage.getItem(tombstoneKey)).not.toBeNull();
  });
});
