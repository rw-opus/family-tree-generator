import { GitBranch, SlidersHorizontal } from "lucide-react";
import { TREE_WORKSPACE_MODES } from "../domain/treeWorkspaceMode.js";

export function TreeWorkspaceModeControl({ mode, onChange }) {
  const modeLabel =
    mode === TREE_WORKSPACE_MODES.FAMILY_TREE ? "Family tree only" : "Legal workspace";
  return (
    <details className="tree-workspace-mode-control">
      <summary aria-label={`Workspace mode: ${modeLabel}`} title={`Workspace mode: ${modeLabel}`}>
        <SlidersHorizontal size={16} aria-hidden="true" />
        <span>{mode === TREE_WORKSPACE_MODES.FAMILY_TREE ? "Tree only" : "Legal workspace"}</span>
      </summary>
      <div className="tree-workspace-mode-menu">
        <strong>Workspace purpose</strong>
        <p>
          Choose what the tree should check and show. Changing this does not delete any saved
          information.
        </p>
        <label>
          <input
            type="radio"
            name="tree-workspace-mode"
            checked={mode === TREE_WORKSPACE_MODES.FAMILY_TREE}
            onChange={() => onChange(TREE_WORKSPACE_MODES.FAMILY_TREE)}
          />
          <span>
            <b>Family tree only</b>
            <small>People, relationships and printing, without legal or tax warnings.</small>
          </span>
        </label>
        <label>
          <input
            type="radio"
            name="tree-workspace-mode"
            checked={mode === TREE_WORKSPACE_MODES.PROPERTY_TAX}
            onChange={() => onChange(TREE_WORKSPACE_MODES.PROPERTY_TAX)}
          />
          <span>
            <b>Property, succession &amp; tax</b>
            <small>Turn on ownership, inheritance, deed and tax calculations.</small>
          </span>
        </label>
        {mode === TREE_WORKSPACE_MODES.FAMILY_TREE && (
          <p className="tree-workspace-mode-note">
            <GitBranch size={14} aria-hidden="true" /> You can turn on the legal workspace later.
          </p>
        )}
      </div>
    </details>
  );
}
