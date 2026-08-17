// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const announcementHarness = vi.hoisted(() => ({
  getAnnouncement: vi.fn(),
}));

vi.mock("../../src/services/adminConsole.js", () => ({
  getAnnouncement: announcementHarness.getAnnouncement,
}));

import { AnnouncementBanner } from "../../src/components/AnnouncementBanner.jsx";

describe("AnnouncementBanner", () => {
  let container;
  let root;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("refreshes the visible announcement when the app regains focus", async () => {
    announcementHarness.getAnnouncement
      .mockResolvedValueOnce({ id: "first", message: "First notice", level: "info" })
      .mockResolvedValueOnce({ id: "second", message: "Urgent notice", level: "warning" });

    await act(async () => {
      root.render(<AnnouncementBanner />);
      await Promise.resolve();
    });
    expect(container.textContent).toContain("First notice");
    expect(container.querySelector(".announcement-banner.info").getAttribute("role")).toBe(
      "status",
    );

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(announcementHarness.getAnnouncement).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Urgent notice");
    const warning = container.querySelector(".announcement-banner.warning");
    expect(warning).not.toBeNull();
    expect(warning.getAttribute("role")).toBe("alert");
    expect(warning.getAttribute("aria-live")).toBe("assertive");
  });

  it("does not request announcements in local-only mode", async () => {
    await act(async () => {
      root.render(<AnnouncementBanner localOnlyMode />);
      await Promise.resolve();
    });

    expect(announcementHarness.getAnnouncement).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="announcement-banner"]')).toBeNull();
  });
});
