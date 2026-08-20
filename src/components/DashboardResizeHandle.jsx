import { GripVertical } from "lucide-react";
import { useEffect, useRef } from "react";

export const DASHBOARD_PANEL_DEFAULT_WIDTH = 390;
export const DASHBOARD_PANEL_MIN_WIDTH = 350;
export const DASHBOARD_PANEL_MAX_WIDTH = 720;
export const DASHBOARD_PANEL_STORAGE_KEY = "family-tree-dashboard-panel-width";

const TREE_MIN_WIDTH = 360;

export function clampDashboardPanelWidth(value, containerWidth = Number.POSITIVE_INFINITY) {
  const availableMaximum = Number.isFinite(containerWidth)
    ? Math.max(DASHBOARD_PANEL_MIN_WIDTH, containerWidth - TREE_MIN_WIDTH)
    : DASHBOARD_PANEL_MAX_WIDTH;
  const maximum = Math.min(DASHBOARD_PANEL_MAX_WIDTH, availableMaximum);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DASHBOARD_PANEL_DEFAULT_WIDTH;
  return Math.round(Math.max(DASHBOARD_PANEL_MIN_WIDTH, Math.min(maximum, numeric)));
}

export function readDashboardPanelWidth(storage = globalThis.localStorage) {
  try {
    const storedWidth = storage?.getItem(DASHBOARD_PANEL_STORAGE_KEY);
    return storedWidth == null || storedWidth === ""
      ? DASHBOARD_PANEL_DEFAULT_WIDTH
      : clampDashboardPanelWidth(storedWidth);
  } catch {
    return DASHBOARD_PANEL_DEFAULT_WIDTH;
  }
}

export function storeDashboardPanelWidth(width, storage = globalThis.localStorage) {
  try {
    storage?.setItem(DASHBOARD_PANEL_STORAGE_KEY, String(clampDashboardPanelWidth(width)));
  } catch {
    // The panel still resizes for this session when browser storage is unavailable.
  }
}

export function DashboardResizeHandle({ width, onChange }) {
  const cleanupRef = useRef(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const stopDragging = () => {
    cleanupRef.current?.();
    cleanupRef.current = null;
  };

  const startDragging = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    stopDragging();

    const workbench = event.currentTarget.closest(".workbench-body");
    const bounds = workbench?.getBoundingClientRect();
    if (!bounds) return;

    const resize = (nextEvent) => {
      onChange(clampDashboardPanelWidth(nextEvent.clientX - bounds.left, bounds.width));
    };
    const finish = () => stopDragging();

    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    document.body.classList.add("dashboard-panel-resizing");

    cleanupRef.current = () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.classList.remove("dashboard-panel-resizing");
    };
  };

  return (
    <button
      type="button"
      className="dashboard-resize-handle"
      aria-label="Resize person details panel"
      title="Drag left or right to resize the details panel. Use the arrow keys for smaller adjustments; double-click to reset."
      onPointerDown={startDragging}
      onDoubleClick={() => onChange(DASHBOARD_PANEL_DEFAULT_WIDTH)}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const adjustment = event.key === "ArrowLeft" ? -24 : 24;
        onChange(clampDashboardPanelWidth(width + adjustment));
      }}
    >
      <GripVertical size={16} aria-hidden="true" />
    </button>
  );
}
