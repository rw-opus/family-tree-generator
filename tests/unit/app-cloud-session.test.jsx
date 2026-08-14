// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cloudHarness = vi.hoisted(() => ({
  listFamilyTrees: vi.fn(),
  listTrashedFamilyTrees: vi.fn(),
  loadTreeEntitlement: vi.fn(),
  queueAcknowledge: vi.fn(),
  queueFlush: vi.fn(),
  permanentlyDeleteFamilyTree: vi.fn(),
  restoreFamilyTree: vi.fn(),
  saveFamilyTree: vi.fn(async (tree) => tree),
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
  startTreeCreditCheckout: vi.fn(),
}));

vi.mock("../../src/services/cloudSaveQueue.js", () => ({
  createCloudSaveQueue: (_save, options = {}) => {
    let latestSnapshot;
    let savedFingerprint = "";
    let dirty = false;
    return {
      schedule: (snapshot) => {
        latestSnapshot = snapshot;
        const fingerprint = JSON.stringify(snapshot);
        dirty = fingerprint !== savedFingerprint;
      },
      flush: async () => {
        cloudHarness.queueFlush(latestSnapshot);
        if (!dirty) return latestSnapshot;
        const saved = await cloudHarness.saveFamilyTree(latestSnapshot);
        latestSnapshot = saved;
        savedFingerprint = JSON.stringify(saved);
        dirty = false;
        options.onSaveSuccess?.(saved, latestSnapshot);
        return saved;
      },
      acknowledge: (snapshot) => {
        latestSnapshot = snapshot;
        savedFingerprint = JSON.stringify(snapshot);
        dirty = false;
        cloudHarness.queueAcknowledge(snapshot);
      },
      dispose: vi.fn(),
      hasUnsavedChanges: () => false,
    };
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
  }) => (
    <div data-testid="family-library" data-active-tree-id={activeTreeId}>
      <span role="status">{saveState?.phase}</span>
      <span data-testid="storage-status">{storageStatus}</span>
      <button type="button" onClick={onDownloadBackup} disabled={backupDisabled}>
        Download backup
      </button>
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

vi.mock("../../src/components/FamilyTreeCanvas.jsx", () => ({
  FamilyTreeCanvas: ({ treeTitle }) => <div data-testid="tree-canvas">{treeTitle}</div>,
}));

import { App } from "../../src/App.jsx";

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

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
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
