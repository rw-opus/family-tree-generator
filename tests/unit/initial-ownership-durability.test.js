import { describe, expect, it, vi } from "vitest";
import { createCloudSaveQueue } from "../../src/services/cloudSaveQueue.js";
import {
  INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES,
  acknowledgeInitialOwnershipDraftSave,
  compareInitialOwnershipDraftToTree,
  initialOwnershipOwnersFingerprint,
  markInitialOwnershipDraftSubmitted,
  readInitialOwnershipDraft,
  recoverInitialOwnershipDraftTree,
  writeInitialOwnershipDraft,
} from "../../src/services/initialOwnershipDraftJournal.js";
import { loadLocalWorkspace, saveLocalWorkspace } from "../../src/services/localWorkspace.js";
import {
  CURRENT_TREE_SCHEMA_VERSION,
  TREE_SCHEMA_VERSION_FIELD,
} from "../../src/domain/treeData.js";

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

const tree = (owners = []) => ({
  [TREE_SCHEMA_VERSION_FIELD]: CURRENT_TREE_SCHEMA_VERSION,
  schemaVersion: 2,
  id: "family",
  title: "Test family",
  storageRevision: 7,
  people: [
    { id: "husband", fullName: "Joseph Borg" },
    { id: "wife", fullName: "Maria Borg" },
  ],
  familyGroups: [
    {
      id: "group",
      rootPersonId: "husband",
      personIds: ["husband", "wife"],
    },
  ],
  activeFamilyGroupId: "group",
  properties: [{ id: "property", owners }],
  outsideParties: [],
  settings: { activePropertyId: "property", workspaceMode: "property-tax" },
});

const recordedOwners = [
  {
    id: "owner-husband",
    personId: "husband",
    shareNumerator: 3,
    shareDenominator: 5,
    acquisitionDate: "1980-01-02",
  },
  {
    id: "owner-wife",
    personId: "wife",
    shareNumerator: 2,
    shareDenominator: 5,
    acquisitionDate: "1980-01-02",
  },
];

describe("initial ownership durability", () => {
  it("recovers an edit after the page closes inside the cloud debounce window", () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const serverTree = tree();
    const editedTree = tree(recordedOwners);
    const save = vi.fn();
    const queue = createCloudSaveQueue(save, { delay: 900 });
    queue.acknowledge(serverTree);
    queue.schedule(editedTree);
    expect(queue.hasUnsavedChanges()).toBe(true);
    writeInitialOwnershipDraft(
      "auth-user",
      {
        treeId: editedTree.id,
        propertyId: "property",
        baseStorageRevision: serverTree.storageRevision,
        baseOwners: serverTree.properties[0].owners,
        owners: editedTree.properties[0].owners,
        baseOutsideParties: [],
        outsideParties: [],
      },
      { storage },
    );

    // Closing before 900 ms cancels the network timer, but not the journal.
    queue.dispose();
    expect(save).not.toHaveBeenCalled();
    const draft = readInitialOwnershipDraft("auth-user", "family", "property", { storage });
    expect(compareInitialOwnershipDraftToTree(draft, serverTree).state).toBe(
      INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES.SAFE_TO_REPLAY,
    );
    expect(recoverInitialOwnershipDraftTree(draft, serverTree).properties[0].owners).toEqual(
      recordedOwners,
    );
    vi.useRealTimers();
  });

  it("round-trips exact initial owners synchronously in a local workspace", () => {
    const storage = new MemoryStorage();
    expect(saveLocalWorkspace([tree(recordedOwners)], "family", storage)).toBe(true);
    expect(loadLocalWorkspace(storage).trees[0].properties[0].owners).toEqual(recordedOwners);
  });

  it("keeps C safely replayable when A is in flight and queued B is superseded", async () => {
    const storage = new MemoryStorage();
    const writerId = "writer-a";
    const releases = [];
    const saves = [];
    let liveTree = tree();
    let cachedDraft = null;
    const save = vi.fn(
      (snapshot) =>
        new Promise((resolve) => {
          saves.push(snapshot);
          releases.push(() =>
            resolve({ ...snapshot, storageRevision: snapshot.storageRevision + 1 }),
          );
        }),
    );
    const queue = createCloudSaveQueue(save, {
      setTimer: () => 1,
      clearTimer: () => {},
      snapshotKey: (snapshot) => snapshot.id,
      rebaseSnapshot: (snapshot, saved) => ({
        ...snapshot,
        storageRevision: saved.storageRevision,
      }),
      onSaveStart: (snapshot) => {
        const property = snapshot.properties[0];
        const submittedFingerprint = initialOwnershipOwnersFingerprint(property.owners);
        if (
          cachedDraft.ownersFingerprint !== submittedFingerprint &&
          !cachedDraft.submittedOwnerFingerprints.includes(submittedFingerprint)
        ) {
          return;
        }
        cachedDraft = markInitialOwnershipDraftSubmitted(
          "auth-user",
          snapshot.id,
          property.id,
          submittedFingerprint,
          { storage, writerId },
        );
      },
      onSaveSuccess: (savedTree, submittedSnapshot) => {
        const property = submittedSnapshot.properties[0];
        const savedFingerprint = initialOwnershipOwnersFingerprint(property.owners);
        if (
          cachedDraft.ownersFingerprint !== savedFingerprint &&
          !cachedDraft.submittedOwnerFingerprints.includes(savedFingerprint)
        ) {
          return;
        }
        const acknowledgement = acknowledgeInitialOwnershipDraftSave(
          "auth-user",
          submittedSnapshot.id,
          property.id,
          savedFingerprint,
          submittedSnapshot.storageRevision,
          savedTree.storageRevision,
          { storage, writerId },
        );
        cachedDraft = acknowledgement.draft;
        liveTree = { ...liveTree, storageRevision: savedTree.storageRevision };
      },
    });
    queue.acknowledge(liveTree);

    const commitOwners = (owners) => {
      const previousTree = liveTree;
      liveTree = {
        ...previousTree,
        properties: previousTree.properties.map((property) =>
          property.id === "property" ? { ...property, owners } : property,
        ),
      };
      cachedDraft = writeInitialOwnershipDraft(
        "auth-user",
        {
          treeId: liveTree.id,
          propertyId: "property",
          baseStorageRevision: previousTree.storageRevision,
          baseOwners: previousTree.properties[0].owners,
          owners,
        },
        { storage, writerId },
      );
      queue.schedule(liveTree);
    };
    const ownersA = recordedOwners.map((owner) => ({ ...owner, shareNumerator: 1 }));
    const ownersB = recordedOwners.map((owner) => ({ ...owner, shareNumerator: 2 }));
    const ownersC = recordedOwners.map((owner) => ({ ...owner, shareNumerator: 3 }));

    commitOwners(ownersA);
    const saveA = queue.flush();
    commitOwners(ownersB);
    const saveB = queue.flush();
    commitOwners(ownersC);
    const saveC = queue.flush();

    expect(saveB).toBe(saveC);
    await Promise.resolve();
    await Promise.resolve();
    expect(saves.map((snapshot) => snapshot.properties[0].owners)).toEqual([ownersA]);

    releases.shift()();
    const savedA = await saveA;
    await Promise.resolve();
    await Promise.resolve();
    expect(saves.map((snapshot) => snapshot.properties[0].owners)).toEqual([ownersA, ownersC]);
    expect(saves[1].storageRevision).toBe(savedA.storageRevision);

    const pendingC = readInitialOwnershipDraft("auth-user", "family", "property", {
      storage,
      writerId,
    });
    expect(compareInitialOwnershipDraftToTree(pendingC, savedA)).toMatchObject({
      state: INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES.SAFE_TO_REPLAY,
      reason: "base-owners-match",
    });

    releases.shift()();
    await Promise.all([saveB, saveC]);
    expect(
      readInitialOwnershipDraft("auth-user", "family", "property", { storage, writerId }),
    ).toBeNull();
  });
});
