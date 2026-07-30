import { supabase } from "../supabaseClient.js";

export function familyTreeRecord(tree) {
  return {
    id: tree.id,
    title: tree.title || "Untitled family tree",
    people: tree.people || [],
    tree_data: tree,
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
  };
}

export async function listFamilyTrees() {
  const { data, error } = await supabase
    .from("family_trees")
    .select("id,title,people,tree_data,created_at,updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(hydrateFamilyTree);
}

export async function saveFamilyTree(tree) {
  const { data, error } = await supabase
    .from("family_trees")
    .upsert(familyTreeRecord(tree))
    .select()
    .single();
  if (error) throw error;
  return hydrateFamilyTree(data);
}

export async function removeFamilyTree(id) {
  const { error } = await supabase.from("family_trees").delete().eq("id", id);
  if (error) throw error;
}
