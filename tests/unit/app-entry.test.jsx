// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../src/App.jsx", () => ({
  App: ({ localOnlyMode }) => (
    <div data-testid="application">{localOnlyMode ? "Local application" : "Cloud application"}</div>
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
  supabase: null,
  supabaseConfigured: false,
}));

import { AppEntry } from "../../src/AppEntry.jsx";

describe("commercial rollout entry", () => {
  let container;
  let root;

  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    vi.unstubAllEnvs();
  });

  it("keeps the existing browser-saved application available by default", () => {
    vi.stubEnv("VITE_COMMERCIAL_MODE", "false");
    act(() => root.render(<AppEntry />));
    expect(container.textContent).toBe("Local application");
  });

  it("fails closed when commercial mode is enabled without Supabase", () => {
    vi.stubEnv("VITE_COMMERCIAL_MODE", "true");
    act(() => root.render(<AppEntry />));
    expect(container.textContent).toBe("Configuration required");
  });

  it("keeps the legal notices public even when Supabase is unavailable", () => {
    vi.stubEnv("VITE_COMMERCIAL_MODE", "true");
    window.history.replaceState({}, "", "/?legal=privacy");
    act(() => root.render(<AppEntry />));
    expect(container.textContent).toContain("Privacy Notice");
    expect(container.textContent).not.toContain("Configuration required");
  });
});
