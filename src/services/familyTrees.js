import { supabase } from "../supabaseClient.js";

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

const storageRevision = (value) => {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : 1;
};

export function rebaseFamilyTreeStorageRevision(snapshot, savedTree) {
  if (!snapshot || !savedTree || snapshot.id !== savedTree.id) return snapshot;
  return {
    ...snapshot,
    storageRevision: storageRevision(savedTree.storageRevision),
  };
}

export const rebaseFamilyTreeListStorageRevision = (trees, savedTree) =>
  trees.map((tree) => rebaseFamilyTreeStorageRevision(tree, savedTree));

const treeDataRecord = (tree = {}) => {
  // The database revision is trusted only from the row column. Keeping it out
  // of tree_data prevents an imported or browser-edited payload from becoming
  // the source of truth for concurrency control.
  const treeData = { ...tree };
  delete treeData.storageRevision;
  return treeData;
};

export const familyTreeSaveFingerprint = (tree) => JSON.stringify(treeDataRecord(tree));

const FAMILY_TREE_COLUMNS = "id,title,people,tree_data,revision,created_at,updated_at";

export function familyTreeRecord(tree) {
  return {
    id: tree.id,
    title: tree.title || "Untitled family tree",
    people: tree.people || [],
    tree_data: treeDataRecord(tree),
  };
}

export function hydrateFamilyTree(record = {}) {
  const storedTree =
    record.tree_data && typeof record.tree_data === "object" && !Array.isArray(record.tree_data)
      ? record.tree_data
      : {};
  return {
    ...storedTree,
    id: record.id || storedTree.id,
    title: record.title || storedTree.title || "Untitled family tree",
    people:
      Number(storedTree.schemaVersion) >= 2
        ? storedTree.people || record.people || []
        : record.people || storedTree.people || [],
    createdAt: storedTree.createdAt || record.created_at || record.updated_at || "",
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
  return (data || []).map(hydrateFamilyTree);
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
  const { data, error } = await supabase
    .rpc("save_family_tree", {
      p_tree_id: tree.id,
      p_expected_revision: expectedRevision,
      p_title: tree.title || "Untitled family tree",
      p_people: tree.people || [],
      p_tree_data: treeDataRecord(tree),
    })
    .select(FAMILY_TREE_COLUMNS)
    .single();
  if (error) {
    if (error.code === "PT409") {
      throw new TreeSaveConflictError(tree.id, expectedRevision);
    }
    throw error;
  }
  if (!data) throw new TreeSaveConflictError(tree.id, expectedRevision);
  return hydrateFamilyTree(data);
}

export async function removeFamilyTree(id, ownerId = "") {
  let query = supabase.from("family_trees").delete().eq("id", id);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { error } = await query;
  if (error) throw error;
}
