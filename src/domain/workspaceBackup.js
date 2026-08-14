export const WORKSPACE_BACKUP_FORMAT = "family-tree-generator-workspace";
export const WORKSPACE_BACKUP_VERSION = 2;

export function workspaceBackupPayload(
  trees = [],
  exportedAt = new Date().toISOString(),
  trashedTrees = [],
) {
  if (!Array.isArray(trees)) throw new Error("The workspace backup requires a tree list.");
  if (!Array.isArray(trashedTrees)) {
    throw new Error("The workspace backup requires a Trash list.");
  }
  return {
    format: WORKSPACE_BACKUP_FORMAT,
    version: WORKSPACE_BACKUP_VERSION,
    exportedAt,
    treeCount: trees.length,
    trashedTreeCount: trashedTrees.length,
    trees,
    trashedTrees,
  };
}

export function workspaceBackupJson(trees = [], exportedAt, trashedTrees = []) {
  return JSON.stringify(workspaceBackupPayload(trees, exportedAt, trashedTrees), null, 2);
}

export function workspaceBackupFilename(date = new Date()) {
  const stamp = Number.isNaN(date.getTime()) ? "undated" : date.toISOString().slice(0, 10);
  return `family-tree-workspace-backup-${stamp}.json`;
}
