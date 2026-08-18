export const TREE_WORKSPACE_MODES = Object.freeze({
  FAMILY_TREE: "family-tree",
  PROPERTY_TAX: "property-tax",
});

export const DEFAULT_EXISTING_TREE_WORKSPACE_MODE = TREE_WORKSPACE_MODES.PROPERTY_TAX;
export const DEFAULT_NEW_TREE_WORKSPACE_MODE = TREE_WORKSPACE_MODES.FAMILY_TREE;

export function normaliseTreeWorkspaceMode(value, fallback = DEFAULT_EXISTING_TREE_WORKSPACE_MODE) {
  if (value === TREE_WORKSPACE_MODES.FAMILY_TREE) return TREE_WORKSPACE_MODES.FAMILY_TREE;
  if (value === TREE_WORKSPACE_MODES.PROPERTY_TAX) return TREE_WORKSPACE_MODES.PROPERTY_TAX;
  return fallback;
}

export const propertyTaxWorkspaceEnabled = (value) =>
  normaliseTreeWorkspaceMode(value) === TREE_WORKSPACE_MODES.PROPERTY_TAX;

const hasRows = (value) => Array.isArray(value) && value.length > 0;

/**
 * A pure-tree view may hide legal records, but it must not let a person be
 * deleted when an automatic title calculation could still depend on them.
 * This deliberately checks raw persisted records and never runs the legal
 * ownership engine.
 */
export function treeHasRecordedPropertyTaxData(tree = {}) {
  const properties = [tree, ...(Array.isArray(tree.properties) ? tree.properties : [])];
  if (tree.property && typeof tree.property === "object") properties.push(tree.property);
  if (
    properties.some(
      (property) =>
        hasRows(property?.owners) ||
        hasRows(property?.transfers) ||
        hasRows(property?.declarations) ||
        hasRows(property?.saleLots),
    )
  ) {
    return true;
  }
  if (
    hasRows(tree.transfers) ||
    hasRows(tree.declarations) ||
    hasRows(tree.succession?.heirs) ||
    hasRows(tree.statusToggleSessions)
  ) {
    return true;
  }
  return (Array.isArray(tree.people) ? tree.people : []).some(
    (person) =>
      hasRows(person?.wills) ||
      hasRows(person?.willHeirs) ||
      hasRows(person?.intestateHeirs) ||
      hasRows(person?.causaMortisDeclarations),
  );
}
