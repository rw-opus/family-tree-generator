// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const adminHarness = vi.hoisted(() => ({
  createAdminRequestId: vi.fn(),
  getAnnouncement: vi.fn(),
  grantTreeCredits: vi.fn(),
  loadPlatformOverview: vi.fn(),
  setAnnouncement: vi.fn(),
  setUnlimitedTrees: vi.fn(),
}));

vi.mock("../../src/services/adminConsole.js", () => ({
  ...adminHarness,
  MAX_ADMIN_CREDIT_GRANT: 100,
}));

vi.mock("../../src/services/siteFeedback.js", () => ({
  listSiteFeedback: vi.fn(async () => []),
  setSiteFeedbackHandled: vi.fn(),
}));

import { AdminConsole, CreditsCell, UnlimitedControl } from "../../src/components/AdminConsole.jsx";

const account = {
  userId: "account-123",
  email: "owner@example.com",
  createdAt: "2026-08-17T10:00:00.000Z",
  treesActive: 2,
  treesTrashed: 0,
  freeTreeLimit: 3,
  freeTreesUsed: 3,
  paidTreeCredits: 2,
  unlimitedTrees: false,
  lastActivity: "2026-08-17T11:00:00.000Z",
};

const changeInput = (input, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const changeTextarea = (textarea, value) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("AdminConsole", () => {
  let container;
  let root;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    adminHarness.createAdminRequestId.mockReturnValue("55555555-5555-4555-8555-555555555555");
    adminHarness.getAnnouncement.mockResolvedValue(null);
    adminHarness.loadPlatformOverview.mockResolvedValue([]);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("bounds, confirms and guards a paid-credit grant while exposing live success", async () => {
    let resolveGrant;
    const onGrant = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveGrant = resolve;
        }),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    act(() => root.render(<CreditsCell account={account} onGrant={onGrant} />));

    const input = container.querySelector("input");
    expect(input.min).toBe("1");
    expect(input.max).toBe("100");
    expect(input.getAttribute("aria-label")).toContain("owner@example.com (account-123)");
    act(() => changeInput(input, "3"));

    const add = container.querySelector("button");
    act(() => {
      add.click();
      add.click();
    });

    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0]).toContain("owner@example.com (account-123)");
    expect(confirm.mock.calls[0][0]).toContain("Balance: 2 -> 5 (+3)");
    expect(onGrant).toHaveBeenCalledOnce();
    expect(onGrant).toHaveBeenCalledWith(account, 3, {
      requestId: "55555555-5555-4555-8555-555555555555",
    });
    expect(container.querySelector("button").disabled).toBe(true);

    await act(async () => {
      resolveGrant();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="status"]').textContent).toContain(
      "Added 3 paid tree credits to owner@example.com",
    );
  });

  it("prevents an over-cap credit grant before confirmation", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onGrant = vi.fn();
    act(() => root.render(<CreditsCell account={account} onGrant={onGrant} />));

    act(() => changeInput(container.querySelector("input"), "101"));

    expect(container.querySelector("button").disabled).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(onGrant).not.toHaveBeenCalled();
  });

  it("guards an unlimited toggle and exposes a service error", async () => {
    let rejectToggle;
    const onToggle = vi.fn(
      () =>
        new Promise((_, reject) => {
          rejectToggle = reject;
        }),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    act(() => root.render(<UnlimitedControl account={account} onToggle={onToggle} />));

    const toggle = container.querySelector("button");
    act(() => {
      toggle.click();
      toggle.click();
    });

    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0]).toContain("owner@example.com (account-123)");
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onToggle).toHaveBeenCalledWith(account, true, {
      requestId: "55555555-5555-4555-8555-555555555555",
    });
    expect(container.querySelector("button").disabled).toBe(true);

    await act(async () => {
      rejectToggle(new Error("audit write failed"));
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]').textContent).toBe("audit write failed");
  });

  it("reuses the paid-credit request ID after a lost response and remount", async () => {
    const onGrant = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network response was lost"))
      .mockResolvedValueOnce();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    act(() => root.render(<CreditsCell account={account} onGrant={onGrant} />));

    await act(async () => {
      container.querySelector("button").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]').textContent).toBe("Network response was lost");
    expect(localStorage).toHaveLength(1);

    act(() => root.unmount());
    sessionStorage.clear();
    root = createRoot(container);
    act(() => root.render(<CreditsCell account={account} onGrant={onGrant} />));

    await act(async () => {
      container.querySelector("button").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onGrant).toHaveBeenCalledTimes(2);
    expect(onGrant.mock.calls[0][2]).toEqual(onGrant.mock.calls[1][2]);
    expect(adminHarness.createAdminRequestId).toHaveBeenCalledOnce();
    expect(localStorage).toHaveLength(0);
    expect(container.querySelector('[role="status"]').textContent).toContain(
      "Added 1 paid tree credit",
    );
  });

  it("reuses the unlimited request ID after a lost response and remount", async () => {
    const unlimitedAccount = { ...account, unlimitedTrees: true };
    const onToggle = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network response was lost"))
      .mockResolvedValueOnce();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    act(() => root.render(<UnlimitedControl account={unlimitedAccount} onToggle={onToggle} />));

    await act(async () => {
      container.querySelector("button").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(localStorage).toHaveLength(1);

    act(() => root.unmount());
    sessionStorage.clear();
    root = createRoot(container);
    act(() => root.render(<UnlimitedControl account={unlimitedAccount} onToggle={onToggle} />));

    await act(async () => {
      container.querySelector("button").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(confirm.mock.calls[0][0]).toContain("Revoke unlimited tree creation");
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onToggle.mock.calls[0][1]).toBe(false);
    expect(onToggle.mock.calls[0][2]).toEqual(onToggle.mock.calls[1][2]);
    expect(adminHarness.createAdminRequestId).toHaveBeenCalledOnce();
    expect(localStorage).toHaveLength(0);
  });

  it("labels the announcement message and announces publish success and errors", async () => {
    adminHarness.setAnnouncement
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("Announcement save failed"));
    await act(async () => {
      root.render(<AdminConsole onClose={vi.fn()} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() =>
      [...container.querySelectorAll('[role="tab"]')]
        .find((tab) => tab.textContent.includes("Announcement"))
        .click(),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const textarea = container.querySelector("#admin-announcement-message");
    expect(container.querySelector('label[for="admin-announcement-message"]').textContent).toBe(
      "Banner message",
    );
    act(() => changeTextarea(textarea, "Planned maintenance tonight."));
    const publish = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Publish",
    );

    await act(async () => {
      publish.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="status"]').textContent).toContain("Banner published");
    expect(container.querySelector('[role="status"]').getAttribute("aria-live")).toBe("polite");

    await act(async () => {
      publish.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]').textContent).toBe("Announcement save failed");
  });

  it("uses labelled tab semantics and supports arrow-key navigation", async () => {
    await act(async () => {
      root.render(<AdminConsole onClose={vi.fn()} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const tablist = container.querySelector('[role="tablist"]');
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    expect(tablist.getAttribute("aria-label")).toBe("Admin console sections");
    expect(tabs).toHaveLength(3);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector('[role="tabpanel"]').id).toBe("admin-panel-overview");

    act(() =>
      tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );

    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[1]);
    expect(container.querySelector('[role="tabpanel"]').id).toBe("admin-panel-feedback");
  });
});
