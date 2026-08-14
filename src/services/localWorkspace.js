import {
  CURRENT_TREE_SCHEMA_VERSION,
  LEGACY_TREE_SCHEMA_VERSION,
  TREE_DATA_LIMITS,
  prepareTreeForPersistence,
  readTreeForStorage,
  readTreeSchemaVersion,
  utf8ByteLength,
} from "../domain/treeData.js";
import { CASE_SCHEMA_VERSION } from "../domain/caseModel.js";

export const LOCAL_WORKSPACE_KEY = "family-tree-generator:workspace:v1";
export const LOCAL_WORKSPACE_RECOVERY_PREFIX = "family-tree-generator:workspace:recovery:";
const LOCAL_WORKSPACE_VERSION = 1;

const usableTree = (tree) =>
  tree && typeof tree === "object" && typeof tree.id === "string" && Array.isArray(tree.people);

export function upsertWorkspaceTree(trees = [], tree) {
  // Never tidy malformed entries here. The load path quarantines them and
  // blocks automatic saving; silently filtering would turn a harmless UI
  // update into permanent data loss.
  if (!usableTree(tree)) return trees;
  return [tree, ...trees.filter((item) => item?.id !== tree.id)];
}

const hasCurrentTreeEnvelope = (tree) =>
  Array.isArray(tree?.people) &&
  Array.isArray(tree?.familyGroups) &&
  Array.isArray(tree?.properties) &&
  Array.isArray(tree?.outsideParties) &&
  tree?.settings &&
  typeof tree.settings === "object" &&
  !Array.isArray(tree.settings);

function prepareWorkspaceTree(tree, { upgradeLegacy = false } = {}) {
  const version = readTreeSchemaVersion(tree);
  if (
    version === CURRENT_TREE_SCHEMA_VERSION ||
    (upgradeLegacy && tree.schemaVersion === CASE_SCHEMA_VERSION && hasCurrentTreeEnvelope(tree))
  ) {
    return prepareTreeForPersistence(tree);
  }

  // An unopened legacy tree may not yet have received defaults supplied by
  // normaliseCase. Preserve it explicitly as v1; opening and saving it later
  // upgrades the fully normalised tree through the strict v2 path above.
  if (version === LEGACY_TREE_SCHEMA_VERSION) return readTreeForStorage(tree);
  return tree;
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
      const recoveryBase = `${LOCAL_WORKSPACE_RECOVERY_PREFIX}${new Date().toISOString()}`;
      recoveryKey = recoveryBase;
      let suffix = 1;
      while (target.getItem(recoveryKey) !== null) {
        recoveryKey = `${recoveryBase}:${suffix}`;
        suffix += 1;
      }
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
  let target;
  let raw = "";
  try {
    target = storage || globalThis.localStorage;
    if (!target) return { trees: [], activeTreeId: "" };
    raw = target.getItem(LOCAL_WORKSPACE_KEY);
    if (!raw) return { trees: [], activeTreeId: "" };
    if (utf8ByteLength(raw) > TREE_DATA_LIMITS.maxWorkspaceBytes) {
      throw new Error("The saved workspace exceeds the safe size limit.");
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.trees)) {
      throw new Error("The saved workspace does not contain a valid family-tree list.");
    }
    if (
      Object.prototype.hasOwnProperty.call(parsed, "version") &&
      parsed.version !== LOCAL_WORKSPACE_VERSION
    ) {
      throw new Error("This workspace was saved by an unsupported application version.");
    }
    if (parsed.trees.length > TREE_DATA_LIMITS.maxWorkspaceTrees) {
      throw new Error("The saved workspace contains too many family records.");
    }

    const trees = [];
    const rejected = [];
    parsed.trees.forEach((tree, index) => {
      try {
        trees.push(readTreeForStorage(tree));
      } catch (error) {
        rejected.push({ index, error });
      }
    });
    if (rejected.length) {
      return recoveryWorkspace(target, raw, rejected[0].error, trees, parsed.activeTreeId);
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
    if (!Array.isArray(trees) || trees.length > TREE_DATA_LIMITS.maxWorkspaceTrees) return false;

    // Prepare every tree before touching localStorage. A bad/future tree makes
    // the entire write fail atomically, leaving the prior workspace intact.
    const requestedActiveTreeId = trees.some((tree) => tree?.id === activeTreeId)
      ? activeTreeId
      : trees[0]?.id || "";
    const preparedTrees = trees.map((tree) =>
      prepareWorkspaceTree(tree, { upgradeLegacy: tree?.id === requestedActiveTreeId }),
    );
    const preparedActiveTreeId = preparedTrees.some((tree) => tree.id === requestedActiveTreeId)
      ? requestedActiveTreeId
      : preparedTrees[0]?.id || "";
    const payload = JSON.stringify({
      version: LOCAL_WORKSPACE_VERSION,
      activeTreeId: preparedActiveTreeId,
      trees: preparedTrees,
    });
    if (utf8ByteLength(payload) > TREE_DATA_LIMITS.maxWorkspaceBytes) return false;
    target.setItem(LOCAL_WORKSPACE_KEY, payload);
    return true;
  } catch {
    return false;
  }
}
