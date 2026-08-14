// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceSaveStatus } from "../../src/components/WorkspaceSaveStatus.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("WorkspaceSaveStatus", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it.each([
    ["saving", "Saving"],
    ["saved", "Saved"],
    ["error", "Save failed"],
    ["conflict", "Conflict"],
  ])("renders the %s state globally as %s", (phase, label) => {
    act(() => root.render(<WorkspaceSaveStatus state={{ phase, detail: "Details" }} />));

    const status = container.querySelector('[role="status"]');
    expect(status.textContent).toBe(label);
    expect(status.classList.contains(phase)).toBe(true);
    expect(status.getAttribute("aria-label")).toBe(`${label}. Details`);
  });
});
