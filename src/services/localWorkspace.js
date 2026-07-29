export const LOCAL_WORKSPACE_KEY = "family-tree-generator:workspace:v1";

const usableTree = (tree) =>
  tree && typeof tree === "object" && typeof tree.id === "string" && Array.isArray(tree.people);

export function upsertWorkspaceTree(trees = [], tree) {
  if (!usableTree(tree)) return trees.filter(usableTree);
  return [tree, ...trees.filter((item) => usableTree(item) && item.id !== tree.id)];
}

export function loadLocalWorkspace(storage) {
  try {
    const target = storage || globalThis.localStorage;
    if (!target) return { trees: [], activeTreeId: "" };
    const parsed = JSON.parse(target.getItem(LOCAL_WORKSPACE_KEY) || "{}");
    const trees = Array.isArray(parsed.trees) ? parsed.trees.filter(usableTree) : [];
    const activeTreeId = trees.some((tree) => tree.id === parsed.activeTreeId)
      ? parsed.activeTreeId
      : trees[0]?.id || "";
    return { trees, activeTreeId };
  } catch {
    return { trees: [], activeTreeId: "" };
  }
}

export function saveLocalWorkspace(trees = [], activeTreeId = "", storage) {
  try {
    const target = storage || globalThis.localStorage;
    if (!target) return false;
    const validTrees = trees.filter(usableTree);
    target.setItem(
      LOCAL_WORKSPACE_KEY,
      JSON.stringify({
        version: 1,
        activeTreeId,
        trees: validTrees,
      }),
    );
    return true;
  } catch {
    return false;
  }
}
