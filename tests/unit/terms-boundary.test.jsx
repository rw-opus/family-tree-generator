// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("../../src/supabaseClient.js", () => ({ supabase: { from } }));

import { TERMS_VERSION } from "../../src/components/LegalNotice.jsx";
import { TermsBoundary } from "../../src/components/TermsBoundary.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const localKey = `family-tree-terms-accepted-${TERMS_VERSION}`;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("TermsBoundary", () => {
  let container;
  let root;

  beforeEach(() => {
    localStorage.clear();
    from.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("records local acceptance before opening the workspace", async () => {
    act(() =>
      root.render(
        <TermsBoundary localOnlyMode>
          <span>Workspace</span>
        </TermsBoundary>,
      ),
    );
    expect(container.textContent).toContain("Accept and continue");

    act(() => container.querySelector('input[type="checkbox"]').click());
    await act(async () => {
      container.querySelector("button.library-primary-button").click();
      await flush();
    });

    expect(localStorage.getItem(localKey)).toBe("yes");
    expect(container.textContent).toContain("Workspace");
  });

  it("opens when a cloud acceptance exists", async () => {
    const limit = vi.fn().mockResolvedValue({ data: [{ id: "accepted" }], error: null });
    const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), limit };
    from.mockReturnValue(chain);

    await act(async () => {
      root.render(
        <TermsBoundary session={{ user: { id: "user-1" } }}>
          <span>Workspace</span>
        </TermsBoundary>,
      );
      await flush();
    });

    expect(container.textContent).toContain("Workspace");
  });

  it("fails closed when the cloud lookup fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const limit = vi.fn().mockResolvedValue({ data: null, error: { message: "offline" } });
    const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), limit };
    from.mockReturnValue(chain);

    await act(async () => {
      root.render(
        <TermsBoundary session={{ user: { id: "user-1" } }}>
          <span>Workspace</span>
        </TermsBoundary>,
      );
      await flush();
    });

    expect(container.textContent).toContain("Accept and continue");
    expect(container.textContent).not.toContain("Workspace");
    consoleError.mockRestore();
  });

  it("accepts a verified duplicate after a transient initial lookup failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const failedLimit = vi.fn().mockResolvedValue({ data: null, error: { message: "offline" } });
    const failedChain = {
      select: vi.fn(() => failedChain),
      eq: vi.fn(() => failedChain),
      limit: failedLimit,
    };
    const insert = vi.fn().mockResolvedValue({ error: { code: "23505" } });
    const existingLimit = vi.fn().mockResolvedValue({ data: [{ id: "accepted" }], error: null });
    const existingChain = {
      select: vi.fn(() => existingChain),
      eq: vi.fn(() => existingChain),
      limit: existingLimit,
    };
    from
      .mockReturnValueOnce(failedChain)
      .mockReturnValueOnce({ insert })
      .mockReturnValueOnce(existingChain);

    await act(async () => {
      root.render(
        <TermsBoundary session={{ user: { id: "user-1" } }}>
          <span>Workspace</span>
        </TermsBoundary>,
      );
      await flush();
    });
    act(() => container.querySelector('input[type="checkbox"]').click());
    await act(async () => {
      container.querySelector("button.library-primary-button").click();
      await flush();
    });

    expect(container.textContent).toContain("Workspace");
    consoleError.mockRestore();
  });
});
