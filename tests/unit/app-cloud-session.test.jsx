// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cloudHarness = vi.hoisted(() => ({
  listFamilyTrees: vi.fn(),
  loadTreeEntitlement: vi.fn(),
  saveFamilyTree: vi.fn(async (tree) => tree),
}));

vi.mock("../../src/services/familyTrees.js", () => ({
  createFamilyTree: vi.fn(async (tree) => tree),
  listFamilyTrees: cloudHarness.listFamilyTrees,
  removeFamilyTree: vi.fn(),
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
      dispose: vi.fn(),
      hasUnsavedChanges: () => false,
    };
  },
}));

vi.mock("../../src/components/FamilyLibrary.jsx", () => ({
  FamilyLibrary: ({ trees, activeTreeId, onOpen }) => (
    <div data-testid="family-library" data-active-tree-id={activeTreeId}>
      {trees.map((tree) => (
        <button key={tree.id} type="button" onClick={() => onOpen(tree.id)}>
          Open {tree.title}
        </button>
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
});
