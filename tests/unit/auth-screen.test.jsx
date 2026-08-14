// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  signInWithPassword: vi.fn(),
}));

vi.mock("../../src/supabaseClient.js", () => ({ supabase: { auth } }));

import { AuthScreen } from "../../src/components/AuthScreen.jsx";
import { PUBLIC_AUTH_MESSAGES } from "../../src/services/publicAuthMessages.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const setInput = (container, labelText, value) => {
  const label = [...container.querySelectorAll("label")].find((item) =>
    item.textContent.includes(labelText),
  );
  const input = label.querySelector("input");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const clickButton = async (container, text) => {
  const button = [...container.querySelectorAll("button")].find((item) =>
    item.textContent.includes(text),
  );
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
};

const submit = async (container) => {
  await act(async () => {
    container
      .querySelector("form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
};

describe("AuthScreen public responses", () => {
  let container;
  let root;

  beforeEach(() => {
    auth.resetPasswordForEmail.mockReset();
    auth.signInWithPassword.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<AuthScreen />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it.each([
    ["a successful reset request", { error: null }],
    [
      "a provider response that could reveal account state",
      { error: { code: "user_not_found", status: 422, message: "User not found" } },
    ],
    [
      "a nonexistent-account response with different internal wording",
      { error: { code: "user_not_found", status: 422, message: "No matching identity" } },
    ],
  ])("uses the same neutral response for %s", async (_description, providerResponse) => {
    auth.resetPasswordForEmail.mockResolvedValue(providerResponse);
    await clickButton(container, "Forgot password?");
    setInput(container, "Email address", " Person@Example.com ");

    await submit(container);

    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("person@example.com", {
      redirectTo: window.location.origin,
    });
    expect(container.querySelector('[role="status"]').textContent).toBe(
      PUBLIC_AUTH_MESSAGES.resetRequestAcknowledged,
    );
    expect(container.textContent).not.toContain("User not found");
    expect(container.textContent).not.toContain("No matching identity");
  });

  it.each([
    [
      "a retryable client error",
      { name: "AuthRetryableFetchError", status: 0, message: "internal host failed" },
    ],
    ["a rate limit", { code: "over_email_send_rate_limit", status: 429, message: "limit 7" }],
    ["an HTTP 429", { code: "future_rate_code", status: 429, message: "bucket secret" }],
    ["a server error", { code: "unexpected_failure", status: 503, message: "database detail" }],
    [
      "an unavailable email provider",
      { code: "email_provider_disabled", status: 422, message: "SMTP configuration detail" },
    ],
    [
      "an unauthorized delivery address",
      {
        code: "email_address_not_authorized",
        status: 422,
        message: "Email address is not authorized",
      },
    ],
    ["a failed captcha", { code: "captcha_failed", status: 400, message: "captcha vendor detail" }],
    [
      "an unknown future code",
      { code: "future_auth_error", status: 422, message: "future detail" },
    ],
  ])("shows one generic unavailable response for %s", async (_description, resetError) => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: resetError });
    await clickButton(container, "Forgot password?");
    setInput(container, "Email address", "person@example.com");

    await submit(container);

    expect(container.querySelector('[role="alert"]').textContent).toBe(
      PUBLIC_AUTH_MESSAGES.resetRequestUnavailable,
    );
    expect(container.textContent).not.toContain(resetError.message);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("uses a generic reset failure when the request itself is unavailable", async () => {
    auth.resetPasswordForEmail.mockRejectedValue(new Error("SMTP vendor secret"));
    await clickButton(container, "Forgot password?");
    setInput(container, "Email address", "person@example.com");

    await submit(container);

    expect(container.querySelector('[role="alert"]').textContent).toBe(
      PUBLIC_AUTH_MESSAGES.resetRequestUnavailable,
    );
    expect(container.textContent).not.toContain("SMTP vendor secret");
  });

  it("normalizes provider sign-in errors without disclosing raw details", async () => {
    auth.signInWithPassword.mockResolvedValue({
      error: { message: "Email not confirmed for internal tenant 42" },
    });
    setInput(container, "Email address", " Person@Example.com ");
    setInput(container, "Password", "secret-password");

    await submit(container);

    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "secret-password",
    });
    expect(container.querySelector('[role="alert"]').textContent).toBe(
      PUBLIC_AUTH_MESSAGES.signInRejected,
    );
    expect(container.textContent).not.toContain("internal tenant 42");
  });

  it("normalizes rejected sign-in requests as unavailable", async () => {
    auth.signInWithPassword.mockRejectedValue(new Error("auth.example.internal timed out"));
    setInput(container, "Email address", "person@example.com");
    setInput(container, "Password", "secret-password");

    await submit(container);

    expect(container.querySelector('[role="alert"]').textContent).toBe(
      PUBLIC_AUTH_MESSAGES.signInUnavailable,
    );
    expect(container.textContent).not.toContain("auth.example.internal");
  });
});
