const LABELS = {
  saving: "Saving",
  saved: "Saved",
  error: "Save failed",
  conflict: "Conflict",
};

export function WorkspaceSaveStatus({ state = { phase: "saved" } }) {
  const phase = LABELS[state.phase] ? state.phase : "saved";
  const label = LABELS[phase];

  return (
    <span
      className={`workspace-save-status ${phase}`}
      role="status"
      aria-live="polite"
      aria-label={state.detail ? `${label}. ${state.detail}` : label}
      title={state.detail || label}
    >
      <span className="workspace-save-status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
