// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cloudHarness = vi.hoisted(() => ({
  isPlatformAdmin: vi.fn(),
  listFamilyTrees: vi.fn(),
  listTrashedFamilyTrees: vi.fn(),
  loadTreeEntitlement: vi.fn(),
  queueAcknowledge: vi.fn(),
  queueFlush: vi.fn(),
  queueSchedule: vi.fn(),
  flushQueue: null,
  permanentlyDeleteFamilyTree: vi.fn(),
  restoreFamilyTree: vi.fn(),
  saveFamilyTree: vi.fn(async (tree) => tree),
  startTreeCreditCheckout: vi.fn(),
  trashFamilyTree: vi.fn(),
}));

vi.mock("../../src/services/familyTrees.js", () => ({
  createFamilyTree: vi.fn(async (tree) => tree),
  familyTreeSaveFingerprint: (tree) => JSON.stringify(tree),
  isFamilyTreeListValidationError: (error) => error?.code === "FAMILY_TREE_LIST_INVALID",
  isTreeSaveConflictError: (error) => error?.code === "TREE_SAVE_CONFLICT",
  listFamilyTrees: cloudHarness.listFamilyTrees,
  listTrashedFamilyTrees: cloudHarness.listTrashedFamilyTrees,
  permanentlyDeleteFamilyTree: cloudHarness.permanentlyDeleteFamilyTree,
  rebaseFamilyTreeListStorageRevision: (trees) => trees,
  rebaseFamilyTreeStorageRevision: (tree, saved) => ({
    ...tree,
    storageRevision: saved?.storageRevision || tree.storageRevision,
  }),
  restoreFamilyTree: cloudHarness.restoreFamilyTree,
  saveFamilyTree: cloudHarness.saveFamilyTree,
  trashFamilyTree: cloudHarness.trashFamilyTree,
}));

vi.mock("../../src/services/treeBilling.js", () => ({
  defaultTreeEntitlement: {
    freeTreeLimit: 5,
    freeTreesUsed: 0,
    freeTreesRemaining: 5,
    paidTreeCredits: 0,
    totalTreesCreated: 0,
    unlimitedTrees: false,
    canCreate: true,
  },
  isTreePaymentRequiredError: vi.fn(() => false),
  loadTreeEntitlement: cloudHarness.loadTreeEntitlement,
  startTreeCreditCheckout: cloudHarness.startTreeCreditCheckout,
}));

vi.mock("../../src/services/adminConsole.js", () => ({
  isPlatformAdmin: cloudHarness.isPlatformAdmin,
}));

vi.mock("../../src/services/cloudSaveQueue.js", () => ({
  createCloudSaveQueue: (_save, options = {}) => {
    let latestSnapshot;
    let savedFingerprint = "";
    let dirty = false;
    const queue = {
      schedule: (snapshot) => {
        cloudHarness.queueSchedule(snapshot);
        latestSnapshot = snapshot;
        const fingerprint = JSON.stringify(snapshot);
        dirty = fingerprint !== savedFingerprint;
      },
      flush: async () => {
        cloudHarness.queueFlush(latestSnapshot);
        if (!dirty) return latestSnapshot;
        const submittedSnapshot = latestSnapshot;
        options.onSaveStart?.(submittedSnapshot);
        const saved = await cloudHarness.saveFamilyTree(submittedSnapshot);
        latestSnapshot = saved;
        savedFingerprint = JSON.stringify(saved);
        dirty = false;
        options.onSaveSuccess?.(saved, submittedSnapshot);
        return saved;
      },
      acknowledge: (snapshot) => {
        latestSnapshot = snapshot;
        savedFingerprint = JSON.stringify(snapshot);
        dirty = false;
        cloudHarness.queueAcknowledge(snapshot);
      },
      dispose: vi.fn(),
      hasUnsavedChanges: () => dirty,
      isSnapshotSaved: (snapshot) => JSON.stringify(snapshot) === savedFingerprint,
    };
    cloudHarness.flushQueue = queue.flush;
    return queue;
  },
}));

vi.mock("../../src/components/FamilyLibrary.jsx", () => ({
  FamilyLibrary: ({
    trees,
    trashedTrees,
    activeTreeId,
    onOpen,
    onRename,
    onRemove,
    onRestore,
    onPermanentDelete,
    onDownloadBackup,
    backupDisabled,
    storageStatus,
    saveState,
    entitlement,
    canCreate,
    billingMessage,
    onBuyTree,
    isPlatformAdmin,
    onOpenAdminConsole,
    pendingCloudRecoveries = [],
    onApplyCloudRecovery,
    onDiscardCloudRecovery,
  }) => (
    <div data-testid="family-library" data-active-tree-id={activeTreeId}>
      <span role="status">{saveState?.phase}</span>
      <span data-testid="storage-status">{storageStatus}</span>
      <span data-testid="paid-tree-credits">{entitlement?.paidTreeCredits ?? "loading"}</span>
      <span data-testid="can-create-tree">{String(canCreate)}</span>
      <span data-testid="billing-message">{billingMessage}</span>
      {!canCreate && (
        <button type="button" onClick={onBuyTree}>
          Buy one tree
        </button>
      )}
      {isPlatformAdmin && (
        <button type="button" onClick={onOpenAdminConsole}>
          Open admin console
        </button>
      )}
      <button type="button" onClick={onDownloadBackup} disabled={backupDisabled}>
        Download backup
      </button>
      {pendingCloudRecoveries.map((recovery) => (
        <div key={`recovery-${recovery.id}`} data-testid="pending-cloud-recovery">
          Pending {recovery.title} ({recovery.state})
          {recovery.state === "safe" && (
            <button type="button" onClick={() => onApplyCloudRecovery(recovery.id)}>
              Use {recovery.title}
            </button>
          )}
          <button type="button" onClick={() => onDiscardCloudRecovery(recovery.id)}>
            Dismiss {recovery.title}
          </button>
        </div>
      ))}
      {trees.map((tree) => (
        <div key={tree.id}>
          <button type="button" onClick={() => onOpen(tree.id)}>
            Open {tree.title}
          </button>
          <button type="button" onClick={() => onRename(tree.id, `${tree.title} renamed`)}>
            Rename {tree.title}
          </button>
          <button type="button" onClick={() => onRemove(tree.id)}>
            Move {tree.title} to Trash
          </button>
        </div>
      ))}
      {trashedTrees.map((tree) => (
        <div key={`trash-${tree.id}`}>
          <span>Trashed {tree.title}</span>
          <button type="button" onClick={() => onRestore(tree.id)}>
            Restore {tree.title}
          </button>
          <button type="button" onClick={() => onPermanentDelete(tree.id)}>
            Permanently delete {tree.title}
          </button>
        </div>
      ))}
    </div>
  ),
}));

vi.mock("../../src/components/AdminConsole.jsx", () => ({
  AdminConsole: ({ onClose }) => (
    <div data-testid="admin-console">
      <button type="button" onClick={onClose}>
        Close admin console
      </button>
    </div>
  ),
}));

vi.mock("../../src/components/AnnouncementBanner.jsx", () => ({
  AnnouncementBanner: () => <div data-testid="announcement-banner" />,
}));

vi.mock("../../src/components/FamilyTreeCanvas.jsx", () => ({
  FamilyTreeCanvas: ({ treeTitle, toolbar }) => (
    <>
      <div data-testid="tree-canvas">{treeTitle}</div>
      <div>{toolbar}</div>
    </>
  ),
}));

import { App, caseActivationState } from "../../src/App.jsx";
import {
  listInitialOwnershipDrafts,
  readInitialOwnershipDraft,
  writeInitialOwnershipDraft,
} from "../../src/services/initialOwnershipDraftJournal.js";

const pendingInitialOwnership = (serverTree, owners, { writerId = "default-writer", now } = {}) =>
  writeInitialOwnershipDraft(
    "user-1",
    {
      treeId: serverTree.id,
      propertyId: serverTree.properties[0].id,
      baseStorageRevision: serverTree.storageRevision,
      baseOwners: serverTree.properties[0].owners || [],
      owners,
      baseOutsideParties: serverTree.outsideParties || [],
      outsideParties: serverTree.outsideParties || [],
    },
    { writerId, now },
  );

const tree = (id, title) => ({
  id,
  title,
  storageRevision: 1,
  people: [
    {
      id: `${id}-person`,
      givenNames: title,
      surname: "Owner",
      fullName: `${title} Owner`,
      sex: "Other",
    },
  ],
  familyGroups: [
    {
      id: `${id}-family`,
      title,
      rootPersonId: `${id}-person`,
      personIds: [`${id}-person`],
    },
  ],
  activeFamilyGroupId: `${id}-family`,
  properties: [{ id: `${id}-property`, owners: [] }],
});

describe("App cloud session identity", () => {
  let container;
  let root;

  beforeEach(() => {
    vi.clearAllMocks();
    cloudHarness.flushQueue = null;
    localStorage.clear();
    cloudHarness.isPlatformAdmin.mockResolvedValue(true);
    cloudHarness.listFamilyTrees.mockResolvedValue([
      tree("first", "First family"),
      tree("second", "Second family"),
    ]);
    cloudHarness.listTrashedFamilyTrees.mockResolvedValue([]);
    cloudHarness.loadTreeEntitlement.mockResolvedValue({
      freeTreeLimit: 5,
      freeTreesUsed: 2,
      freeTreesRemaining: 3,
      paidTreeCredits: 0,
      totalTreesCreated: 2,
      unlimitedTrees: false,
      canCreate: true,
    });
    cloudHarness.saveFamilyTree.mockImplementation(async (value) => ({
      ...value,
      storageRevision: value.storageRevision + 1,
    }));
    cloudHarness.trashFamilyTree.mockImplementation(async (value) => ({
      ...value,
      deletedAt: "2026-08-14T10:00:00.000Z",
      storageRevision: value.storageRevision + 1,
    }));
    cloudHarness.restoreFamilyTree.mockImplementation(async (value) => ({
      ...value,
      deletedAt: "",
      storageRevision: value.storageRevision + 1,
    }));
    cloudHarness.permanentlyDeleteFamilyTree.mockResolvedValue("deleted");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it("recovers exact pending initial-owner rows before reopening the family", async () => {
    const serverTree = {
      ...caseActivationState(tree("first", "First family")).caseData,
      storageRevision: 1,
    };
    cloudHarness.listFamilyTrees.mockResolvedValue([serverTree]);
    pendingInitialOwnership(serverTree, [
      {
        id: "initial-owner",
        personId: "first-person",
        shareNumerator: 1,
        shareDenominator: 1,
      },
    ]);

    await act(async () => {
      root.render(
        <App localOnlyMode={false} session={{ user: { id: "user-1" } }} onSignOut={() => {}} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Open First family");
    expect(cloudHarness.queueAcknowledge).toHaveBeenCalledWith(
      expect.objectContaining({ id: "first", title: "First family" }),
    );
    expect(cloudHarness.queueSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "first",
        properties: [
          expect.objectContaining({
            owners: [expect.objectContaining({ personId: "first-person" })],
          }),
        ],
      }),
    );

    await act(async () => {
      await cloudHarness.flushQueue();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(listInitialOwnershipDrafts("user-1").drafts).toEqual([]);
  });

  it("hydrates every safe family and saves each recovered ownership when opened", async () => {
    const firstServer = {
      ...caseActivationState(tree("first", "First family")).caseData,
      storageRevision: 1,
    };
    const secondServer = {
      ...caseActivationState(tree("second", "Second family")).caseData,
      storageRevision: 1,
    };
    cloudHarness.listFamilyTrees.mockResolvedValue([firstServer, secondServer]);
    pendingInitialOwnership(
      firstServer,
      [
        {
          id: "first-owner-row",
          personId: "first-person",
          shareNumerator: 1,
          shareDenominator: 1,
        },
      ],
      { writerId: "writer-first", now: new Date("2026-08-18T08:00:00.000Z") },
    );
    pendingInitialOwnership(
      secondServer,
      [
        {
          id: "second-owner-row",
          personId: "second-person",
          shareNumerator: 1,
          shareDenominator: 1,
        },
      ],
      { writerId: "writer-second", now: new Date("2026-08-18T09:00:00.000Z") },
    );

    await act(async () => {
      root.render(
        <App localOnlyMode={false} session={{ user: { id: "user-1" } }} onSignOut={() => {}} />,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cloudHarness.queueSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "first",
        properties: [
          expect.objectContaining({ owners: [expect.objectContaining({ id: "first-owner-row" })] }),
        ],
      }),
    );
    expect(container.textContent).not.toContain("Pending First family");
    expect(container.textContent).not.toContain("Pending Second family");

    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Open Second family")
        .click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(cloudHarness.queueSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "second",
        properties: [
          expect.objectContaining({
            owners: [expect.objectContaining({ id: "second-owner-row" })],
          }),
        ],
      }),
    );
  });

  it("saves another tab's pending ownership version without cloning or deleting its source", async () => {
    const serverTree = {
      ...caseActivationState(tree("first", "First family")).caseData,
      storageRevision: 1,
    };
    cloudHarness.listFamilyTrees.mockResolvedValue([serverTree]);
    pendingInitialOwnership(
      serverTree,
      [
        {
          id: "other-tab-owner-row",
          personId: "first-person",
          shareNumerator: 1,
          shareDenominator: 1,
        },
      ],
      { writerId: "other-open-tab" },
    );
    await act(async () => {
      root.render(
        <App localOnlyMode={false} session={{ user: { id: "user-1" } }} onSignOut={() => {}} />,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cloudHarness.queueSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: [
          expect.objectContaining({
            owners: [expect.objectContaining({ id: "other-tab-owner-row" })],
          }),
        ],
      }),
    );
    expect(listInitialOwnershipDrafts("user-1").drafts).toHaveLength(1);

    await act(async () => {
      await cloudHarness.flushQueue();
      await Promise.resolve();
    });
    expect(listInitialOwnershipDrafts("user-1").drafts).toEqual([]);
    expect(
      readInitialOwnershipDraft("user-1", "first", "first-property", {
        writerId: "other-open-tab",
      }),
    ).not.toBeNull();
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container.remove();
  });

  it("flushes a focused initial-owner field before disposing the App save queue", async () => {
    const serverTree = {
      ...caseActivationState({
        ...tree("first", "First family"),
        settings: { workspaceMode: "property-tax", activePropertyId: "first-property" },
      }).caseData,
      storageRevision: 1,
    };
    serverTree.settings = {
      ...serverTree.settings,
      workspaceMode: "property-tax",
      activePropertyId: "first-property",
    };
    serverTree.properties[0] = {
      ...serverTree.properties[0],
      owners: [
        {
          id: "focused-owner",
          personId: "first-person",
          shareNumerator: 1,
          shareDenominator: 1,
        },
      ],
    };
    cloudHarness.listFamilyTrees.mockResolvedValue([serverTree]);

    await act(async () => {
      root.render(
        <App localOnlyMode={false} session={{ user: { id: "user-1" } }} onSignOut={() => {}} />,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Open First family")
        .click();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector('button[aria-label="Property & Tax"]').click();
      await Promise.resolve();
    });

    const numerator = container.querySelector('input[aria-label="Initial ownership numerator"]');
    expect(numerator).not.toBeNull();
    act(() => {
      numerator.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(numerator, "2");
      numerator.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(listInitialOwnershipDrafts("user-1").drafts).toEqual([]);

    act(() => root.unmount());
    root = null;

    const drafts = listInitialOwnershipDrafts("user-1").drafts;
    expect(drafts).toHaveLength(1);
    expect(String(drafts[0].owners[0].shareNumerator)).toBe("2");
    expect(cloudHarness.queueSchedule).toHaveBeenLastCalledWith(
      expect.objectContaining({
        properties: [
          expect.objectContaining({
            owners: [expect.objectContaining({ shareNumerator: "2" })],
          }),
        ],
      }),
    );
  });

  it("stops a cloud save when its ownership lineage cannot be stored", async () => {
    const serverTree = {
      ...caseActivationState({
        ...tree("first", "First family"),
        settings: { workspaceMode: "property-tax", activePropertyId: "first-property" },
      }).caseData,
      storageRevision: 1,
    };
    serverTree.settings = {
      ...serverTree.settings,
      workspaceMode: "property-tax",
      activePropertyId: "first-property",
    };
    serverTree.properties[0] = {
      ...serverTree.properties[0],
      owners: [
        {
          id: "lineage-owner",
          personId: "first-person",
          shareNumerator: 1,
          shareDenominator: 1,
        },
      ],
    };
    cloudHarness.listFamilyTrees.mockResolvedValue([serverTree]);

    await act(async () => {
      root.render(
        <App localOnlyMode={false} session={{ user: { id: "user-1" } }} onSignOut={() => {}} />,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Open First family")
        .click();
      await Promise.resolve();
      container.querySelector('button[aria-label="Property & Tax"]').click();
      await Promise.resolve();
    });

    const numerator = container.querySelector('input[aria-label="Initial ownership numerator"]');
    act(() => {
      numerator.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(numerator, "2");
      numerator.dispatchEvent(new Event("input", { bubbles: true }));
      numerator.blur();
    });
    expect(listInitialOwnershipDrafts("user-1").drafts).toHaveLength(1);

    const originalSetItem = Storage.prototype.setItem;
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function failLineageWrite(key, value) {
        if (String(key).includes("initial-ownership-draft")) {
          throw new DOMException("Quota exceeded", "QuotaExceededError");
        }
        return originalSetItem.call(this, key, value);
      });
    cloudHarness.saveFamilyTree.mockClear();
    let saveError;
    await act(async () => {
      try {
        await cloudHarness.flushQueue();
      } catch (error) {
        saveError = error;
      }
    });
    setItem.mockRestore();

    expect(saveError).toMatchObject({ code: "INITIAL_OWNERSHIP_DRAFT_STORAGE_FAILURE" });
    expect(cloudHarness.saveFamilyTree).not.toHaveBeenCalled();
    expect(listInitialOwnershipDrafts("user-1").drafts).toHaveLength(1);
  });

  it("refreshes the signed-in allowance after closing admin and when a target session regains focus", async () => {
    const initialEntitlement = {
      freeTreeLimit: 3,
      freeTreesUsed: 3,
      freeTreesRemaining: 0,
      paidTreeCredits: 0,
      totalTreesCreated: 3,
      unlimitedTrees: false,
      canCreate: false,
    };
    const refreshedEntitlement = {
      ...initialEntitlement,
      paidTreeCredits: 4,
      canCreate: true,
    };
    cloudHarness.loadTreeEntitlement
      .mockResolvedValueOnce(initialEntitlement)
      .mockResolvedValue(refreshedEntitlement);

    await act(async () => {
      root.render(
        <App
          localOnlyMode={false}
          session={{ access_token: "token", user: { id: "user-1", email: "user@example.com" } }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="paid-tree-credits"]').textContent).toBe("0");
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Open admin console")
        .click();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="admin-console"]')).not.toBeNull();

    await act(async () => {
      container.querySelector('[data-testid="admin-console"] button').click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(cloudHarness.loadTreeEntitlement).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="paid-tree-credits"]').textContent).toBe("4");

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(cloudHarness.loadTreeEntitlement).toHaveBeenCalledTimes(3);
  });

  it("refreshes a stale allowance before checkout and unlocks an unlimited account", async () => {
    const exhaustedEntitlement = {
      freeTreeLimit: 3,
      freeTreesUsed: 3,
      freeTreesRemaining: 0,
      paidTreeCredits: 0,
      totalTreesCreated: 3,
      unlimitedTrees: false,
      canCreate: false,
    };
    const unlimitedEntitlement = {
      ...exhaustedEntitlement,
      unlimitedTrees: true,
      canCreate: true,
    };
    cloudHarness.loadTreeEntitlement
      .mockResolvedValueOnce(exhaustedEntitlement)
      .mockResolvedValue(unlimitedEntitlement);

    await act(async () => {
      root.render(
        <App
          localOnlyMode={false}
          session={{ access_token: "token", user: { id: "user-1", email: "user@example.com" } }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="can-create-tree"]').textContent).toBe("false");
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Buy one tree")
        .click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cloudHarness.loadTreeEntitlement).toHaveBeenCalledTimes(2);
    expect(cloudHarness.startTreeCreditCheckout).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="can-create-tree"]').textContent).toBe("true");
    expect(container.querySelector('[data-testid="billing-message"]').textContent).toContain(
      "Unlimited tree creation is active",
    );
  });

  it("does not reload or reactivate the first tree when the same user's token refreshes", async () => {
    const initialSession = {
      access_token: "initial-token",
      user: { id: "user-1", email: "user@example.com" },
    };

    await act(async () => {
      root.render(<App localOnlyMode={false} session={initialSession} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const openSecondTree = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Second family"),
    );
    expect(openSecondTree).not.toBeUndefined();
    await act(async () => {
      openSecondTree.click();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="tree-canvas"]').textContent).toBe(
      "Second family",
    );
    expect(container.querySelector('[data-testid="announcement-banner"]')).not.toBeNull();

    await act(async () => {
      root.render(
        <App
          localOnlyMode={false}
          session={{
            access_token: "refreshed-token",
            user: { id: "user-1", email: "user@example.com" },
          }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cloudHarness.listFamilyTrees).toHaveBeenCalledTimes(1);
    expect(cloudHarness.loadTreeEntitlement).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="tree-canvas"]').textContent).toBe(
      "Second family",
    );
  });

  it("keeps valid cloud families available when another saved row is quarantined", async () => {
    const safeTree = tree("safe", "Safe family");
    cloudHarness.listFamilyTrees.mockRejectedValueOnce(
      Object.assign(
        new Error("1 saved family could not be opened safely and has not been changed."),
        {
          code: "FAMILY_TREE_LIST_INVALID",
          trees: [safeTree],
          rejected: [{ id: "future", code: "TREE_DATA_UNSUPPORTED_VERSION" }],
        },
      ),
    );

    await act(async () => {
      root.render(
        <App
          localOnlyMode={false}
          session={{ access_token: "token", user: { id: "user-1", email: "user@example.com" } }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Safe family");
    expect(container.querySelector('[data-testid="family-library"]').dataset.activeTreeId).toBe(
      "safe",
    );
    expect(container.querySelector('[role="status"]').textContent).toBe("error");
  });

  it("keeps active families available when Trash contains a quarantined row", async () => {
    cloudHarness.listTrashedFamilyTrees.mockRejectedValueOnce(
      Object.assign(new Error("1 trashed family could not be opened safely."), {
        code: "FAMILY_TREE_LIST_INVALID",
        trees: [
          {
            ...tree("recoverable", "Recoverable family"),
            deletedAt: "2026-08-14T10:00:00.000Z",
          },
        ],
        rejected: [{ id: "future-trash", code: "TREE_DATA_UNSUPPORTED_VERSION" }],
      }),
    );

    await act(async () => {
      root.render(
        <App
          localOnlyMode={false}
          session={{ access_token: "token", user: { id: "user-1", email: "user@example.com" } }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("First family");
    expect(container.textContent).toContain("Trashed Recoverable family");
    expect(container.querySelector('[role="status"]').textContent).toBe("error");
    expect(container.querySelector('[data-testid="storage-status"]').textContent).toContain(
      "Trash needs attention",
    );
    expect(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Download backup",
      ).disabled,
    ).toBe(true);
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Rename First family")
        .click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="storage-status"]').textContent).toContain(
      "Trash needs attention",
    );
  });

  it("shows a conflict and retains a non-current family's newer local rename", async () => {
    cloudHarness.saveFamilyTree.mockRejectedValueOnce(
      Object.assign(new Error("changed in another session"), { code: "TREE_SAVE_CONFLICT" }),
    );

    await act(async () => {
      root.render(
        <App
          localOnlyMode={false}
          session={{ access_token: "token", user: { id: "user-1", email: "user@example.com" } }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const renameSecond = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Rename Second family",
    );
    await act(async () => {
      renameSecond.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="status"]').textContent).toBe("conflict");
    expect(container.textContent).toContain("Second family renamed");
  });

  it("does not trash a non-current rename that still cannot be saved", async () => {
    const conflict = () =>
      Object.assign(new Error("changed in another session"), { code: "TREE_SAVE_CONFLICT" });
    cloudHarness.saveFamilyTree.mockRejectedValueOnce(conflict()).mockRejectedValueOnce(conflict());

    await act(async () => {
      root.render(
        <App
          localOnlyMode={false}
          session={{ access_token: "token", user: { id: "user-1", email: "user@example.com" } }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const renameSecond = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Rename Second family",
    );
    await act(async () => {
      renameSecond.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const moveSecond = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Move Second family renamed to Trash",
    );
    await act(async () => {
      moveSecond.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cloudHarness.trashFamilyTree).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Move Second family renamed to Trash");
  });

  it("waits for an in-flight non-current rename before moving that revision to Trash", async () => {
    let resolveRename;
    let pendingRename;
    cloudHarness.saveFamilyTree.mockImplementationOnce(
      (value) =>
        new Promise((resolve) => {
          pendingRename = value;
          resolveRename = resolve;
        }),
    );

    await act(async () => {
      root.render(
        <App
          localOnlyMode={false}
          session={{ access_token: "token", user: { id: "user-1", email: "user@example.com" } }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Rename Second family")
        .click(),
    );
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Move Second family renamed to Trash")
        .click();
      await Promise.resolve();
    });
    expect(cloudHarness.trashFamilyTree).not.toHaveBeenCalled();

    await act(async () => {
      resolveRename({ ...pendingRename, storageRevision: 2 });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cloudHarness.trashFamilyTree).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Second family renamed", storageRevision: 2 }),
    );
  });

  it("flushes the active family, moves it to Trash, then switches save context", async () => {
    await act(async () => {
      root.render(
        <App
          localOnlyMode={false}
          session={{ access_token: "token", user: { id: "user-1", email: "user@example.com" } }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    cloudHarness.queueAcknowledge.mockClear();
    cloudHarness.queueFlush.mockClear();
    const removeFirst = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Move First family to Trash",
    );
    await act(async () => {
      removeFirst.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cloudHarness.queueAcknowledge).toHaveBeenCalledWith(
      expect.objectContaining({ id: "second" }),
    );
    expect(cloudHarness.queueFlush.mock.invocationCallOrder[0]).toBeLessThan(
      cloudHarness.trashFamilyTree.mock.invocationCallOrder[0],
    );
    expect(cloudHarness.trashFamilyTree.mock.invocationCallOrder[0]).toBeLessThan(
      cloudHarness.queueAcknowledge.mock.invocationCallOrder[0],
    );
    expect(container.querySelector('[data-testid="family-library"]').dataset.activeTreeId).toBe(
      "second",
    );
  });

  it("preserves a concurrent update to the next family while Trash is pending", async () => {
    let resolveTrash;
    let pendingTrash;
    cloudHarness.trashFamilyTree.mockImplementationOnce(
      (value) =>
        new Promise((resolve) => {
          pendingTrash = value;
          resolveTrash = resolve;
        }),
    );
    await act(async () => {
      root.render(
        <App
          localOnlyMode={false}
          session={{ access_token: "token", user: { id: "user-1", email: "user@example.com" } }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    cloudHarness.queueAcknowledge.mockClear();
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Move First family to Trash")
        .click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(resolveTrash).toBeTypeOf("function");

    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Rename Second family")
        .click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      resolveTrash({
        ...pendingTrash,
        deletedAt: "2026-08-14T10:00:00.000Z",
        storageRevision: pendingTrash.storageRevision + 1,
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cloudHarness.queueAcknowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "second",
        title: "Second family renamed",
        storageRevision: 2,
      }),
    );
    expect(container.textContent).toContain("Rename Second family renamed");
  });

  it("waits for the next family's in-flight save when Trash resolves first", async () => {
    let resolveRename;
    let pendingRename;
    let resolveTrash;
    let pendingTrash;
    cloudHarness.saveFamilyTree.mockImplementationOnce(
      (value) =>
        new Promise((resolve) => {
          pendingRename = value;
          resolveRename = resolve;
        }),
    );
    cloudHarness.trashFamilyTree.mockImplementationOnce(
      (value) =>
        new Promise((resolve) => {
          pendingTrash = value;
          resolveTrash = resolve;
        }),
    );
    await act(async () => {
      root.render(
        <App
          localOnlyMode={false}
          session={{ access_token: "token", user: { id: "user-1", email: "user@example.com" } }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Rename Second family")
        .click(),
    );
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Move First family to Trash")
        .click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(resolveRename).toBeTypeOf("function");
    expect(resolveTrash).toBeTypeOf("function");

    cloudHarness.queueAcknowledge.mockClear();
    await act(async () => {
      resolveTrash({
        ...pendingTrash,
        deletedAt: "2026-08-14T10:00:00.000Z",
        storageRevision: pendingTrash.storageRevision + 1,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="family-library"]').dataset.activeTreeId).toBe("");
    expect(cloudHarness.queueAcknowledge).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "second" }),
    );

    await act(async () => {
      resolveRename({ ...pendingRename, storageRevision: 2 });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cloudHarness.queueAcknowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "second",
        title: "Second family renamed",
        storageRevision: 2,
      }),
    );
    expect(container.querySelector('[data-testid="family-library"]').dataset.activeTreeId).toBe(
      "second",
    );
  });

  it("restores the latest saved title and revision after recoverable deletion", async () => {
    await act(async () => {
      root.render(
        <App
          localOnlyMode={false}
          session={{ access_token: "token", user: { id: "user-1", email: "user@example.com" } }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const renameFirst = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Rename First family",
    );
    await act(async () => {
      renameFirst.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const moveRenamed = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Move First family renamed to Trash",
    );
    await act(async () => {
      moveRenamed.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cloudHarness.trashFamilyTree).toHaveBeenCalledWith(
      expect.objectContaining({ title: "First family renamed", storageRevision: 2 }),
    );
    const restore = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Restore First family renamed",
    );
    await act(async () => {
      restore.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cloudHarness.restoreFamilyTree).toHaveBeenCalledWith(
      expect.objectContaining({ title: "First family renamed", storageRevision: 3 }),
    );
    expect(container.textContent).toContain("Rename First family renamed");
  });

  it("keeps divergent restored owner drafts in explicit multiple-version review", async () => {
    const trashed = {
      ...caseActivationState(tree("trashed", "Trashed family")).caseData,
      deletedAt: "2026-08-18T08:00:00.000Z",
      storageRevision: 1,
    };
    cloudHarness.listFamilyTrees.mockResolvedValue([tree("first", "First family")]);
    cloudHarness.listTrashedFamilyTrees.mockResolvedValue([trashed]);
    cloudHarness.restoreFamilyTree.mockResolvedValue({
      ...trashed,
      deletedAt: "",
      storageRevision: 2,
    });
    pendingInitialOwnership(
      trashed,
      [
        {
          id: "owner-x",
          personId: "trashed-person",
          shareNumerator: 1,
          shareDenominator: 1,
        },
      ],
      { writerId: "writer-x", now: new Date("2026-08-18T08:10:00.000Z") },
    );
    pendingInitialOwnership(
      trashed,
      [
        {
          id: "owner-y",
          personId: "trashed-person",
          shareNumerator: 3,
          shareDenominator: 4,
        },
      ],
      { writerId: "writer-y", now: new Date("2026-08-18T08:20:00.000Z") },
    );

    await act(async () => {
      root.render(
        <App localOnlyMode={false} session={{ user: { id: "user-1" } }} onSignOut={() => {}} />,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Restore Trashed family")
        .click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const recoveries = [
      ...container.querySelectorAll('[data-testid="pending-cloud-recovery"]'),
    ].filter((item) => item.textContent.includes("Trashed family"));
    expect(recoveries).toHaveLength(2);
    recoveries.forEach((item) => expect(item.textContent).toContain("(multiple)"));
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "Use Trashed family",
      ),
    ).toBe(false);

    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Dismiss Trashed family")
        .click();
      await Promise.resolve();
    });

    const remaining = [
      ...container.querySelectorAll('[data-testid="pending-cloud-recovery"]'),
    ].filter((item) => item.textContent.includes("Trashed family"));
    expect(remaining).toHaveLength(1);
    expect(remaining[0].textContent).toContain("(safe)");
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "Use Trashed family",
      ),
    ).toBe(true);
  });

  it("leaves an active family open when moving it to Trash fails", async () => {
    cloudHarness.trashFamilyTree.mockRejectedValueOnce(new Error("temporary network failure"));
    await act(async () => {
      root.render(
        <App
          localOnlyMode={false}
          session={{ access_token: "token", user: { id: "user-1", email: "user@example.com" } }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    cloudHarness.queueAcknowledge.mockClear();
    const moveFirst = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Move First family to Trash",
    );
    await act(async () => {
      moveFirst.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Move First family to Trash");
    expect(container.textContent).not.toContain("Trashed First family");
    expect(cloudHarness.queueAcknowledge).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "second" }),
    );
  });
});
