// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const feedbackService = vi.hoisted(() => ({
  submit: vi.fn(),
}));

vi.mock("../../src/services/siteFeedback.js", () => ({
  feedbackValidationMessage: (type, message) => {
    if (!new Set(["suggestion", "bug"]).has(type)) return "Choose a feedback type.";
    const trimmed = String(message || "").trim();
    if (trimmed.length < 5) return "Please add a little more detail before sending.";
    if (trimmed.length > 3000) return "Keep the message to 3,000 characters or fewer.";
    return "";
  },
  submitSiteFeedback: feedbackService.submit,
}));

import { SiteFeedbackForm } from "../../src/components/SiteFeedbackForm.jsx";
import { SiteFeedbackInbox } from "../../src/components/SiteFeedbackInbox.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => new Promise((resolve) => window.setTimeout(resolve, 0));

describe("site feedback privacy and accessibility", () => {
  let container;
  let root;

  beforeEach(() => {
    feedbackService.submit.mockReset();
    feedbackService.submit.mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const openForm = () => {
    act(() => root.render(<SiteFeedbackForm />));
    const trigger = container.querySelector(".feedback-form-trigger");
    act(() => {
      trigger.focus();
      trigger.click();
    });
    return trigger;
  };

  it("uses a labelled modal, discloses request logging and restores focus on Escape", () => {
    const trigger = openForm();
    const dialog = container.querySelector('[role="dialog"]');
    const textarea = container.querySelector("#site-feedback-message");

    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("feedback-form-title");
    expect(dialog.getAttribute("aria-describedby")).toContain("feedback-form-privacy");
    expect(textarea.labels[0].textContent).toBe("Feedback");
    expect(document.activeElement).toBe(textarea);
    expect(dialog.textContent).toContain("account ID and email are not attached");
    expect(dialog.textContent).toContain("service logs may identify the signed-in requester");
    expect(dialog.textContent).toContain("Do not include client names");
    expect(dialog.textContent.toLowerCase()).not.toContain("anonymous");

    act(() => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("traps keyboard focus within the open feedback dialog", () => {
    openForm();
    const dialog = container.querySelector('[role="dialog"]');
    const focusable = [...dialog.querySelectorAll("button, input, textarea")].filter(
      (element) => !element.disabled && element.tabIndex !== -1,
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    act(() => {
      last.focus();
      last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(document.activeElement).toBe(first);

    act(() => {
      first.focus();
      first.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(last);
  });

  it("announces validation errors and successful submission", async () => {
    openForm();
    const form = container.querySelector('[role="dialog"]');
    const textarea = container.querySelector("#site-feedback-message");

    act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(container.querySelector('[role="alert"]').textContent).toContain("more detail");

    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(
        textarea,
        "Please improve the print preview.",
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flush();
    });

    expect(feedbackService.submit).toHaveBeenCalledWith({
      kind: "suggestion",
      message: "Please improve the print preview.",
    });
    expect(container.querySelector('[role="status"]').textContent).toContain("has been sent");
  });

  it("loads unresolved feedback by default and requests handled rows only when selected", async () => {
    const unresolved = {
      id: "new-feedback",
      kind: "bug",
      message: "The print preview is clipped.",
      createdAt: "2026-08-17T12:00:00Z",
      handledAt: null,
    };
    const handled = {
      id: "handled-feedback",
      kind: "suggestion",
      message: "Add another print size.",
      createdAt: "2026-08-16T12:00:00Z",
      handledAt: "2026-08-17T13:00:00Z",
    };
    const loadFeedback = vi.fn(async ({ includeHandled }) =>
      includeHandled ? [unresolved, handled] : [unresolved],
    );
    const onMarkHandled = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(<SiteFeedbackInbox loadFeedback={loadFeedback} onMarkHandled={onMarkHandled} />);
      await flush();
    });

    expect(loadFeedback).toHaveBeenLastCalledWith({ includeHandled: false });
    expect(container.textContent).toContain("The print preview is clipped.");
    expect(container.textContent).not.toContain("Add another print size.");
    expect(container.textContent).toContain("do not contain an account ID or email address");
    expect(container.textContent).toContain("service logs may identify the signed-in requester");

    const markDone = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Mark done"),
    );
    await act(async () => {
      markDone.click();
      await flush();
    });
    expect(onMarkHandled).toHaveBeenCalledWith("new-feedback", true);
    expect(container.querySelector('[role="status"]').textContent).toContain("marked as done");

    const showDone = container.querySelector('.feedback-inbox-controls input[type="checkbox"]');
    await act(async () => {
      showDone.click();
      await flush();
    });

    expect(loadFeedback).toHaveBeenLastCalledWith({ includeHandled: true });
    expect(container.textContent).toContain("Add another print size.");
  });

  it("reports an inbox load failure and offers a working retry", async () => {
    const loadFeedback = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([]);

    await act(async () => {
      root.render(<SiteFeedbackInbox loadFeedback={loadFeedback} onMarkHandled={vi.fn()} />);
      await flush();
    });

    expect(container.querySelector('[role="alert"]').textContent).toContain(
      "Feedback could not be loaded",
    );
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Retry",
    );
    await act(async () => {
      retry.click();
      await flush();
    });

    expect(loadFeedback).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("No new feedback");
  });
});
