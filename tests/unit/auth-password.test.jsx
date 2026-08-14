// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { updateUser } = vi.hoisted(() => ({ updateUser: vi.fn() }));

vi.mock("../../src/supabaseClient.js", () => ({
  supabase: { auth: { updateUser } },
}));

import { PasswordResetScreen } from "../../src/components/AuthScreen.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const setInput = (container, labelText, value) => {
  const label = [...container.querySelectorAll("label")].find((item) =>
    item.textContent.includes(labelText),
  );
  const input = label.querySelector("input");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const submitForm = async (container) => {
  await act(async () => {
    container
      .querySelector("form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
};

describe("PasswordResetScreen", () => {
  let container;
  let root;
  let onDone;
  let onSignOut;

  beforeEach(() => {
    updateUser.mockReset();
    onDone = vi.fn();
    onSignOut = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<PasswordResetScreen onDone={onDone} onSignOut={onSignOut} />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("rejects a password shorter than ten characters before calling Supabase", async () => {
    setInput(container, "New password", "short");
    setInput(container, "Repeat new password", "short");

    await submitForm(container);

    expect(updateUser).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      "at least 10 characters",
    );
  });

  it("rejects mismatched passwords before calling Supabase", async () => {
    setInput(container, "New password", "a-secure-password");
    setInput(container, "Repeat new password", "another-password");

    await submitForm(container);

    expect(updateUser).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]').textContent).toContain("do not match");
  });

  it("does not disclose a Supabase error and keeps the recovery screen open", async () => {
    updateUser.mockResolvedValue({ error: { message: "Recovery session expired" } });
    setInput(container, "New password", "a-secure-password");
    setInput(container, "Repeat new password", "a-secure-password");

    await submitForm(container);

    expect(updateUser).toHaveBeenCalledWith({ password: "a-secure-password" });
    expect(container.querySelector('[role="alert"]').textContent).toBe(
      "The password could not be changed. Request a new link and try again.",
    );
    expect(container.textContent).not.toContain("Recovery session expired");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("recovers from a rejected network request without leaving the form busy", async () => {
    updateUser.mockRejectedValue(new Error("Network unavailable"));
    setInput(container, "New password", "a-secure-password");
    setInput(container, "Repeat new password", "a-secure-password");

    await submitForm(container);

    expect(container.querySelector('[role="alert"]').textContent).toBe(
      "The password could not be changed. Request a new link and try again.",
    );
    expect(container.textContent).not.toContain("Network unavailable");
    expect(container.querySelector('button[type="submit"]').disabled).toBe(false);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("confirms success before the user continues to the account", async () => {
    updateUser.mockResolvedValue({ error: null });
    setInput(container, "New password", "a-secure-password");
    setInput(container, "Repeat new password", "a-secure-password");

    await submitForm(container);

    expect(onDone).not.toHaveBeenCalled();
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent.toLowerCase()).toContain("password");
    expect(status?.textContent.toLowerCase()).toContain("changed");

    const continueButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Continue to account"),
    );
    expect(continueButton).not.toBeNull();
    act(() => continueButton.click());
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("allows the user to cancel and sign out", () => {
    const cancel = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Cancel and sign out"),
    );

    act(() => cancel.click());

    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
