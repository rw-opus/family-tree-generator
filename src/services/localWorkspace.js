export const LOCAL_WORKSPACE_KEY = "family-tree-generator:workspace:v1";
export const LOCAL_WORKSPACE_RECOVERY_PREFIX = "family-tree-generator:workspace:recovery:";

const usableTree = (tree) =>
  tree && typeof tree === "object" && typeof tree.id === "string" && Array.isArray(tree.people);

export function upsertWorkspaceTree(trees = [], tree) {
  if (!usableTree(tree)) return trees.filter(usableTree);
  return [tree, ...trees.filter((item) => usableTree(item) && item.id !== tree.id)];
}

function recoveryWorkspace(target, raw, cause, trees = [], requestedActiveTreeId = "") {
  let recoveryKey = "";
  try {
    for (let index = 0; index < Number(target.length || 0); index += 1) {
      const candidateKey = target.key(index);
      if (
        candidateKey?.startsWith(LOCAL_WORKSPACE_RECOVERY_PREFIX) &&
        target.getItem(candidateKey) === raw
      ) {
        recoveryKey = candidateKey;
        break;
      }
    }
    if (!recoveryKey) {
      recoveryKey = `${LOCAL_WORKSPACE_RECOVERY_PREFIX}${new Date().toISOString()}`;
      target.setItem(recoveryKey, raw);
    }
  } catch {
    recoveryKey = "";
  }
  const activeTreeId = trees.some((tree) => tree.id === requestedActiveTreeId)
    ? requestedActiveTreeId
    : trees[0]?.id || "";
  return {
    trees,
    activeTreeId,
    loadError: `The saved workspace could not be read completely and has not been overwritten. ${
      recoveryKey ? "A recovery copy is available to download." : "Keep this page open."
    }`,
    recoveryKey,
    recoveryCause: cause?.message || "Invalid saved data.",
  };
}

export function loadLocalWorkspace(storage) {
  const target = storage || globalThis.localStorage;
  if (!target) return { trees: [], activeTreeId: "" };
  const raw = target.getItem(LOCAL_WORKSPACE_KEY);
  if (!raw) return { trees: [], activeTreeId: "" };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.trees)) {
      throw new Error("The saved workspace does not contain a valid family-tree list.");
    }
    const trees = Array.isArray(parsed.trees) ? parsed.trees.filter(usableTree) : [];
    if (trees.length !== parsed.trees.length) {
      return recoveryWorkspace(
        target,
        raw,
        new Error("One or more saved family records are malformed."),
        trees,
        parsed.activeTreeId,
      );
    }
    const activeTreeId = trees.some((tree) => tree.id === parsed.activeTreeId)
      ? parsed.activeTreeId
      : trees[0]?.id || "";
    return { trees, activeTreeId };
  } catch (error) {
    return recoveryWorkspace(target, raw, error);
  }
}

export function readLocalWorkspaceRecovery(recoveryKey, storage) {
  if (!String(recoveryKey || "").startsWith(LOCAL_WORKSPACE_RECOVERY_PREFIX)) return "";
  try {
    const target = storage || globalThis.localStorage;
    return target?.getItem(recoveryKey) || "";
  } catch {
    return "";
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
