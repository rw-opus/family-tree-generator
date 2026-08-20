// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DASHBOARD_PANEL_DEFAULT_WIDTH,
  DASHBOARD_PANEL_MAX_WIDTH,
  DASHBOARD_PANEL_MIN_WIDTH,
  DASHBOARD_PANEL_STORAGE_KEY,
  DashboardResizeHandle,
  clampDashboardPanelWidth,
  readDashboardPanelWidth,
  storeDashboardPanelWidth,
} from "../../src/components/DashboardResizeHandle.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("person details panel resizing", () => {
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

  it("supports keyboard resizing and a double-click reset", () => {
    const onChange = vi.fn();
    act(() => root.render(<DashboardResizeHandle width={390} onChange={onChange} />));

    const handle = container.querySelector("button");
    expect(handle.title).toContain("Drag left or right");

    act(() =>
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    expect(onChange).toHaveBeenLastCalledWith(414);

    act(() => handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(onChange).toHaveBeenLastCalledWith(DASHBOARD_PANEL_DEFAULT_WIDTH);
  });

  it("clamps stored and resized widths to the usable desktop space", () => {
    expect(clampDashboardPanelWidth(100)).toBe(DASHBOARD_PANEL_MIN_WIDTH);
    expect(clampDashboardPanelWidth(900)).toBe(DASHBOARD_PANEL_MAX_WIDTH);
    expect(clampDashboardPanelWidth(700, 940)).toBe(580);

    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    expect(readDashboardPanelWidth(storage)).toBe(DASHBOARD_PANEL_DEFAULT_WIDTH);

    storage.getItem.mockReturnValue("540");
    expect(readDashboardPanelWidth(storage)).toBe(540);

    storeDashboardPanelWidth(560, storage);
    expect(storage.setItem).toHaveBeenCalledWith(DASHBOARD_PANEL_STORAGE_KEY, "560");
  });
});
