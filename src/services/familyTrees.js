import { supabase } from "../supabaseClient.js";

export async function listFamilyTrees() {
  const { data, error } = await supabase.from("family_trees").select("id,title,people,updated_at").order("updated_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function saveFamilyTree(tree) {
  const record = { id: tree.id, title: tree.title || "Untitled family tree", people: tree.people || [] };
  const { data, error } = await supabase.from("family_trees").upsert(record).select().single();
  if (error) throw error;
  return data;
}

