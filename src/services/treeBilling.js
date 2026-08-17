import { supabase } from "../supabaseClient.js";

export const TREE_PRICE_EUR = 30;
export const DEFAULT_FREE_TREE_LIMIT = 3;

export const defaultTreeEntitlement = Object.freeze({
  freeTreeLimit: DEFAULT_FREE_TREE_LIMIT,
  freeTreesUsed: 0,
  freeTreesRemaining: DEFAULT_FREE_TREE_LIMIT,
  paidTreeCredits: 0,
  totalTreesCreated: 0,
  unlimitedTrees: false,
  canCreate: true,
});

export function normaliseTreeEntitlement(record = {}) {
  const freeTreeLimit = Math.max(0, Number(record.free_tree_limit ?? DEFAULT_FREE_TREE_LIMIT) || 0);
  const freeTreesUsed = Math.max(0, Number(record.free_trees_used ?? 0) || 0);
  const paidTreeCredits = Math.max(0, Number(record.paid_tree_credits ?? 0) || 0);
  const unlimitedTrees = record.unlimited_trees === true;
  const freeTreesRemaining = Math.max(0, freeTreeLimit - freeTreesUsed);
  return {
    freeTreeLimit,
    freeTreesUsed,
    freeTreesRemaining,
    paidTreeCredits,
    totalTreesCreated: Math.max(0, Number(record.total_trees_created ?? freeTreesUsed) || 0),
    unlimitedTrees,
    canCreate: unlimitedTrees || freeTreesRemaining > 0 || paidTreeCredits > 0,
  };
}

export async function loadTreeEntitlement(userId) {
  const { data, error } = await supabase
    .from("tree_accounts")
    .select("free_tree_limit,free_trees_used,paid_tree_credits,total_trees_created,unlimited_trees")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return normaliseTreeEntitlement(data || {});
}

export async function startTreeCreditCheckout() {
  const { data, error } = await supabase.functions.invoke("create-tree-checkout", { body: {} });
  if (error) throw error;
  if (!data?.url) throw new Error("No secure checkout URL was returned.");
  return data.url;
}

export function isTreePaymentRequiredError(error) {
  const text = `${error?.message || ""} ${error?.details || ""}`;
  return text.includes("TREE_PAYMENT_REQUIRED");
}
