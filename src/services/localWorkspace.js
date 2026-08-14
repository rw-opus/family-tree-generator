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
export const LOCAL_WORKSPACE_VERSION = 2;
export const LOCAL_TRASH_RETENTION_DAYS = 30;
const LEGACY_LOCAL_WORKSPACE_VERSION = 1;
const LOCAL_TRASH_RETENTION_MS = LOCAL_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

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

const validDeletedAt = (value) => {
  if (typeof value !== "string" || !value.trim()) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
};

export function isLocalTrashExpired(tree, now = new Date()) {
  if (!validDeletedAt(tree?.deletedAt)) return true;
  const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowTime)) return false;
  return nowTime - Date.parse(tree.deletedAt) >= LOCAL_TRASH_RETENTION_MS;
}

const readActiveWorkspaceTree = (tree) => {
  if (tree?.deletedAt !== undefined || tree?.deleted_at !== undefined) {
    throw new Error("An active family is incorrectly marked as deleted.");
  }
  return readTreeForStorage(tree);
};

const readTrashedWorkspaceTree = (tree) => {
  if (!validDeletedAt(tree?.deletedAt)) {
    throw new Error("A trashed family does not have a valid deletion date.");
  }
  const stored = readTreeForStorage(tree);
  return { ...stored, deletedAt: tree.deletedAt };
};

const prepareActiveWorkspaceTree = (tree, options) => {
  const activeTree = { ...tree };
  delete activeTree.deletedAt;
  delete activeTree.deleted_at;
  return prepareWorkspaceTree(activeTree, options);
};

const prepareTrashedWorkspaceTree = (tree) => {
  if (!validDeletedAt(tree?.deletedAt)) {
    throw new Error("A trashed family does not have a valid deletion date.");
  }
  const trashedTree = { ...tree, deletedAt: tree.deletedAt };
  delete trashedTree.deleted_at;
  return prepareWorkspaceTree(trashedTree);
};

function recoveryWorkspace(
  target,
  raw,
  cause,
  trees = [],
  trashedTrees = [],
  requestedActiveTreeId = "",
) {
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
    trashedTrees,
    activeTreeId,
    loadError: `The saved workspace could not be read completely and has not been overwritten. ${
      recoveryKey ? "A recovery copy is available to download." : "Keep this page open."
    }`,
    recoveryKey,
    recoveryCause: cause?.message || "Invalid saved data.",
  };
}

export function loadLocalWorkspace(storage, now = new Date()) {
  let target;
  let raw = "";
  try {
    target = storage || globalThis.localStorage;
    if (!target) return { trees: [], trashedTrees: [], activeTreeId: "" };
    raw = target.getItem(LOCAL_WORKSPACE_KEY);
    if (!raw) return { trees: [], trashedTrees: [], activeTreeId: "" };
    if (utf8ByteLength(raw) > TREE_DATA_LIMITS.maxWorkspaceBytes) {
      throw new Error("The saved workspace exceeds the safe size limit.");
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.trees)) {
      throw new Error("The saved workspace does not contain a valid family-tree list.");
    }
    const workspaceVersion = Object.prototype.hasOwnProperty.call(parsed, "version")
      ? parsed.version
      : LEGACY_LOCAL_WORKSPACE_VERSION;
    if (
      workspaceVersion !== LEGACY_LOCAL_WORKSPACE_VERSION &&
      workspaceVersion !== LOCAL_WORKSPACE_VERSION
    ) {
      throw new Error("This workspace was saved by an unsupported application version.");
    }
    const storedTrash = workspaceVersion === LOCAL_WORKSPACE_VERSION ? parsed.trashedTrees : [];
    if (workspaceVersion === LOCAL_WORKSPACE_VERSION && !Array.isArray(storedTrash)) {
      throw new Error("The saved workspace does not contain a valid Trash list.");
    }
    if (parsed.trees.length + storedTrash.length > TREE_DATA_LIMITS.maxWorkspaceTrees) {
      throw new Error("The saved workspace contains too many family records.");
    }

    const trees = [];
    const trashedTrees = [];
    const rejected = [];
    parsed.trees.forEach((tree, index) => {
      try {
        trees.push(readActiveWorkspaceTree(tree));
      } catch (error) {
        rejected.push({ index, error });
      }
    });
    storedTrash.forEach((tree, index) => {
      try {
        const storedTree = readTrashedWorkspaceTree(tree);
        if (!isLocalTrashExpired(storedTree, now)) trashedTrees.push(storedTree);
      } catch (error) {
        rejected.push({ index: parsed.trees.length + index, error });
      }
    });
    const identifiers = [...trees, ...trashedTrees].map((tree) => tree.id);
    if (new Set(identifiers).size !== identifiers.length) {
      rejected.push({
        index: -1,
        error: new Error("A family cannot appear more than once in the workspace."),
      });
    }
    if (rejected.length) {
      return recoveryWorkspace(
        target,
        raw,
        rejected[0].error,
        trees,
        trashedTrees,
        parsed.activeTreeId,
      );
    }
    const activeTreeId = trees.some((tree) => tree.id === parsed.activeTreeId)
      ? parsed.activeTreeId
      : trees[0]?.id || "";
    return { trees, trashedTrees, activeTreeId };
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

export function saveLocalWorkspace(trees = [], activeTreeId = "", storage, trashedTrees = []) {
  try {
    const target = storage || globalThis.localStorage;
    if (!target) return false;
    if (
      !Array.isArray(trees) ||
      !Array.isArray(trashedTrees) ||
      trees.length + trashedTrees.length > TREE_DATA_LIMITS.maxWorkspaceTrees
    ) {
      return false;
    }
    const identifiers = [...trees, ...trashedTrees].map((tree) => tree?.id);
    if (new Set(identifiers).size !== identifiers.length) return false;

    // Prepare every tree before touching localStorage. A bad/future tree makes
    // the entire write fail atomically, leaving the prior workspace intact.
    const requestedActiveTreeId = trees.some((tree) => tree?.id === activeTreeId)
      ? activeTreeId
      : trees[0]?.id || "";
    const preparedTrees = trees.map((tree) =>
      prepareActiveWorkspaceTree(tree, { upgradeLegacy: tree?.id === requestedActiveTreeId }),
    );
    const preparedTrashedTrees = trashedTrees.map(prepareTrashedWorkspaceTree);
    const preparedActiveTreeId = preparedTrees.some((tree) => tree.id === requestedActiveTreeId)
      ? requestedActiveTreeId
      : preparedTrees[0]?.id || "";
    const payload = JSON.stringify({
      version: LOCAL_WORKSPACE_VERSION,
      activeTreeId: preparedActiveTreeId,
      trees: preparedTrees,
      trashedTrees: preparedTrashedTrees,
    });
    if (utf8ByteLength(payload) > TREE_DATA_LIMITS.maxWorkspaceBytes) return false;
    target.setItem(LOCAL_WORKSPACE_KEY, payload);
    return true;
  } catch {
    return false;
  }
}
