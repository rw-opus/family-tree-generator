// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cloudHarness = vi.hoisted(() => ({
  listFamilyTrees: vi.fn(),
  loadTreeEntitlement: vi.fn(),
  queueAcknowledge: vi.fn(),
  removeFamilyTree: vi.fn(),
  saveFamilyTree: vi.fn(async (tree) => tree),
}));

vi.mock("../../src/services/familyTrees.js", () => ({
  createFamilyTree: vi.fn(async (tree) => tree),
  familyTreeSaveFingerprint: (tree) => JSON.stringify(tree),
  isFamilyTreeListValidationError: (error) => error?.code === "FAMILY_TREE_LIST_INVALID",
  isTreeSaveConflictError: (error) => error?.code === "TREE_SAVE_CONFLICT",
  listFamilyTrees: cloudHarness.listFamilyTrees,
  rebaseFamilyTreeListStorageRevision: (trees) => trees,
  rebaseFamilyTreeStorageRevision: (tree) => tree,
  removeFamilyTree: cloudHarness.removeFamilyTree,
  saveFamilyTree: cloudHarness.saveFamilyTree,
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
  createCloudSaveQueue: () => {
    let latestSnapshot;
    return {
      schedule: (snapshot) => {
        latestSnapshot = snapshot;
      },
      flush: async () => latestSnapshot,
      acknowledge: cloudHarness.queueAcknowledge,
      dispose: vi.fn(),
      hasUnsavedChanges: () => false,
    };
  },
}));

vi.mock("../../src/components/FamilyLibrary.jsx", () => ({
  FamilyLibrary: ({ trees, activeTreeId, onOpen, onRename, onRemove, saveState }) => (
    <div data-testid="family-library" data-active-tree-id={activeTreeId}>
      <span role="status">{saveState?.phase}</span>
      {trees.map((tree) => (
        <div key={tree.id}>
          <button type="button" onClick={() => onOpen(tree.id)}>
            Open {tree.title}
          </button>
          <button type="button" onClick={() => onRename(tree.id, `${tree.title} renamed`)}>
            Rename {tree.title}
          </button>
          <button type="button" onClick={() => onRemove(tree.id)}>
            Remove {tree.title}
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
    cloudHarness.loadTreeEntitlement.mockResolvedValue({
      freeTreeLimit: 5,
      freeTreesUsed: 2,
      freeTreesRemaining: 3,
      paidTreeCredits: 0,
      totalTreesCreated: 2,
      unlimitedTrees: false,
      canCreate: true,
    });
    cloudHarness.removeFamilyTree.mockResolvedValue(undefined);
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

  it("abandons the deleted active tree's save context before activating another tree", async () => {
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
    const removeFirst = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Remove First family",
    );
    await act(async () => {
      removeFirst.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cloudHarness.queueAcknowledge).toHaveBeenCalledWith(
      expect.objectContaining({ id: "second" }),
    );
    expect(cloudHarness.queueAcknowledge.mock.invocationCallOrder[0]).toBeLessThan(
      cloudHarness.removeFamilyTree.mock.invocationCallOrder[0],
    );
    expect(container.querySelector('[data-testid="family-library"]').dataset.activeTreeId).toBe(
      "second",
    );
  });
});
