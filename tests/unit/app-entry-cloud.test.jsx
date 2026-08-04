// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../src/App.jsx", () => ({
  App: ({ localOnlyMode, session }) => (
    <div
      data-testid="authenticated-application"
      data-local-only-mode={String(localOnlyMode)}
      data-user-id={session?.user?.id || ""}
    />
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
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user: { id: "user-1", email: "user@example.com" } } },
      }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signOut: vi.fn(),
    },
  },
}));

import { AppEntry } from "../../src/AppEntry.jsx";

describe("authenticated application entry", () => {
  let container;
  let root;

  beforeEach(() => {
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
    expect(application.dataset.localOnlyMode).toBe("false");
    expect(application.dataset.userId).toBe("user-1");
  });
});
