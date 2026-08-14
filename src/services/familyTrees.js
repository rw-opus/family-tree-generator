import { supabase } from "../supabaseClient.js";
import {
  LEGACY_TREE_SCHEMA_VERSION,
  TREE_SCHEMA_VERSION_FIELD,
  TREE_DATA_ERROR_CODES,
  TreeDataValidationError,
  isTreeDataValidationError,
  prepareTreeForPersistence,
  readTreeForStorage,
  readTreeSchemaVersion,
} from "../domain/treeData.js";

export const TREE_SAVE_CONFLICT = "TREE_SAVE_CONFLICT";

export class TreeSaveConflictError extends Error {
  constructor(treeId, expectedRevision) {
    super(
      "This family was changed in another session. Your newer work is still open here and has not been overwritten.",
    );
    this.name = "TreeSaveConflictError";
    this.code = TREE_SAVE_CONFLICT;
    this.treeId = treeId;
    this.expectedRevision = expectedRevision;
  }
}

export const isTreeSaveConflictError = (error) => error?.code === TREE_SAVE_CONFLICT;

export class FamilyTreeListValidationError extends Error {
  constructor(trees, rejected) {
    const count = rejected.length;
    super(
      `${count} saved famil${count === 1 ? "y" : "ies"} could not be opened safely and ${
        count === 1 ? "has" : "have"
      } not been changed.`,
    );
    this.name = "FamilyTreeListValidationError";
    this.code = "FAMILY_TREE_LIST_INVALID";
    this.trees = [...trees];
    this.rejected = rejected.map((entry) => ({ ...entry }));
  }
}

export const isFamilyTreeListValidationError = (error) =>
  error?.code === "FAMILY_TREE_LIST_INVALID";

const storageRevision = (value) => {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : 1;
};

export function rebaseFamilyTreeStorageRevision(snapshot, savedTree) {
  if (!snapshot || !savedTree || snapshot.id !== savedTree.id) return snapshot;
  return {
    ...snapshot,
    [TREE_SCHEMA_VERSION_FIELD]:
      savedTree[TREE_SCHEMA_VERSION_FIELD] ?? snapshot[TREE_SCHEMA_VERSION_FIELD],
    storageRevision: storageRevision(savedTree.storageRevision),
  };
}

export const rebaseFamilyTreeListStorageRevision = (trees, savedTree) =>
  trees.map((tree) => rebaseFamilyTreeStorageRevision(tree, savedTree));

const treeDataFingerprintRecord = (tree = {}) => {
  // The database revision is trusted only from the row column. Keeping it out
  // of tree_data prevents an imported or browser-edited payload from becoming
  // the source of truth for concurrency control.
  const treeData = { ...tree };
  delete treeData.storageRevision;
  delete treeData.created_at;
  delete treeData.updated_at;
  return treeData;
};

export const familyTreeSaveFingerprint = (tree) => JSON.stringify(treeDataFingerprintRecord(tree));

const FAMILY_TREE_COLUMNS = "id,title,people,tree_data,revision,created_at,updated_at";

export function familyTreeRecord(tree) {
  const treeData = prepareTreeForPersistence(tree);
  return {
    id: treeData.id,
    title: treeData.title,
    people: treeData.people,
    tree_data: treeData,
  };
}

const recordMismatch = (path, message) =>
  new TreeDataValidationError(TREE_DATA_ERROR_CODES.INVALID, message, [
    { code: "storage-mirror-mismatch", path, message },
  ]);

const sameJson = (left, right) => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameJson(value, right[index]))
    );
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) => Object.prototype.hasOwnProperty.call(right, key) && sameJson(left[key], right[key]),
    )
  );
};

export function hydrateFamilyTree(record = {}) {
  // Read the explicit persisted version before applying any legacy row-column
  // fallbacks. In particular, a future version must never reach normalisation
  // in App.jsx, where it could otherwise be mistaken for a current tree.
  const storedTree = record.tree_data;
  const version = readTreeSchemaVersion(storedTree);
  let tree;

  if (version === LEGACY_TREE_SCHEMA_VERSION) {
    const people =
      Number(storedTree.schemaVersion) >= 2
        ? storedTree.people || record.people || []
        : record.people || storedTree.people || [];
    tree = readTreeForStorage({
      ...storedTree,
      id: record.id || storedTree.id,
      title: record.title || storedTree.title || "Untitled family tree",
      people,
    });
  } else {
    tree = readTreeForStorage(storedTree);
    if (record.id && tree.id !== record.id) {
      throw recordMismatch("$.id", "The saved family identifier does not match its storage row.");
    }
    if (record.title !== undefined && tree.title !== record.title) {
      throw recordMismatch("$.title", "The saved family title does not match its storage index.");
    }
    if (Array.isArray(record.people) && !sameJson(tree.people, record.people)) {
      throw recordMismatch(
        "$.people",
        "The saved family people index does not match the canonical family record.",
      );
    }
  }

  return {
    ...tree,
    createdAt: tree.createdAt || record.created_at || record.updated_at || "",
    created_at: record.created_at,
    updated_at: record.updated_at,
    storageRevision: storageRevision(record.revision),
  };
}

export async function listFamilyTrees(ownerId = "") {
  let query = supabase
    .from("family_trees")
    .select(FAMILY_TREE_COLUMNS)
    .order("updated_at", { ascending: false });
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data, error } = await query;
  if (error) throw error;
  const trees = [];
  const rejected = [];
  (data || []).forEach((record) => {
    try {
      trees.push(hydrateFamilyTree(record));
    } catch (validationFailure) {
      if (!isTreeDataValidationError(validationFailure)) throw validationFailure;
      rejected.push({
        id: typeof record?.id === "string" ? record.id : "",
        code: validationFailure.code,
        message: validationFailure.message,
      });
    }
  });
  if (rejected.length) throw new FamilyTreeListValidationError(trees, rejected);
  return trees;
}

export async function createFamilyTree(tree) {
  const { data, error } = await supabase
    .from("family_trees")
    .insert(familyTreeRecord(tree))
    .select(FAMILY_TREE_COLUMNS)
    .single();
  if (error) throw error;
  return hydrateFamilyTree(data);
}

export async function saveFamilyTree(tree, _ownerId = "") {
  const expectedRevision = storageRevision(tree.storageRevision);
  const treeData = prepareTreeForPersistence(tree);
  const { data, error } = await supabase
    .rpc("save_family_tree", {
      p_tree_id: treeData.id,
      p_expected_revision: expectedRevision,
      p_title: treeData.title,
      p_people: treeData.people,
      p_tree_data: treeData,
    })
    .select(FAMILY_TREE_COLUMNS)
    .single();
  if (error) {
    if (error.code === "PT409") {
      throw new TreeSaveConflictError(treeData.id, expectedRevision);
    }
    throw error;
  }
  if (!data) throw new TreeSaveConflictError(treeData.id, expectedRevision);
  return hydrateFamilyTree(data);
}

export async function removeFamilyTree(id, ownerId = "") {
  let query = supabase.from("family_trees").delete().eq("id", id);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { error } = await query;
  if (error) throw error;
}
