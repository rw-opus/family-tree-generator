// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const authHarness = vi.hoisted(() => ({
  listener: null,
  getSession: vi.fn().mockResolvedValue({
    data: { session: { user: { id: "user-1", email: "user@example.com" } } },
  }),
  signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
  updateUser: vi.fn().mockResolvedValue({ error: null }),
  signOut: vi.fn(),
}));

vi.mock("../../src/App.jsx", () => ({
  App: ({ localOnlyMode, onChangePassword, session }) => (
    <div data-testid="authenticated-application">
      <span data-local-only-mode={String(localOnlyMode)} data-user-id={session?.user?.id || ""} />
      <button
        type="button"
        data-testid="change-password"
        onClick={() =>
          onChangePassword({
            currentPassword: "current-password",
            newPassword: "new-secure-password",
          })
        }
      >
        Change password
      </button>
    </div>
  ),
}));

vi.mock("../../src/components/AuthScreen.jsx", () => ({
  AuthScreen: () => <div>Authentication</div>,
  ConfigurationError: () => <div>Configuration required</div>,
  PasswordResetScreen: () => <div>Password reset</div>,
}));

vi.mock("../../src/components/TermsBoundary.jsx", () => ({
  TermsBoundary: ({ children }) => children,
}));

vi.mock("../../src/supabaseClient.js", () => ({
  supabaseConfigured: true,
  supabase: {
    auth: {
      getSession: authHarness.getSession,
      onAuthStateChange: vi.fn((listener) => {
        authHarness.listener = listener;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signInWithPassword: authHarness.signInWithPassword,
      updateUser: authHarness.updateUser,
      signOut: authHarness.signOut,
    },
  },
}));

import { AppEntry } from "../../src/AppEntry.jsx";

describe("authenticated application entry", () => {
  let container;
  let root;

  beforeEach(() => {
    vi.clearAllMocks();
    authHarness.listener = null;
    window.history.replaceState({}, "", "/");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("opens an authenticated session in cloud mode", async () => {
    await act(async () => {
      root.render(<AppEntry />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const application = container.querySelector('[data-testid="authenticated-application"]');
    expect(application).not.toBeNull();
    expect(application.querySelector("span").dataset.localOnlyMode).toBe("false");
    expect(application.querySelector("span").dataset.userId).toBe("user-1");
  });

  it("wires the authenticated account email into a verified password change", async () => {
    await act(async () => {
      root.render(<AppEntry />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      container.querySelector('[data-testid="change-password"]').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(authHarness.signInWithPassword).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "current-password",
    });
    expect(authHarness.updateUser).toHaveBeenCalledWith({
      current_password: "current-password",
      password: "new-secure-password",
    });
  });

  it("opens the reset screen when Supabase reports password recovery", async () => {
    await act(async () => {
      root.render(<AppEntry />);
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      authHarness.listener("PASSWORD_RECOVERY", {
        user: { id: "user-1", email: "user@example.com" },
      });
    });

    expect(container.textContent).toContain("Password reset");
  });
});
