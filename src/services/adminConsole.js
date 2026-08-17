/* Platform Super Administrator console data access. Every call goes through a
   security-definer RPC gated by is_platform_admin(); the browser holds only
   its own JWT and never the service-role key. Calls reject for non-admins
   (and until the migration is applied), which the UI treats as "not a
   platform admin". */
import { supabase } from "../supabaseClient.js";

const str = (value) => (value == null ? "" : String(value));

const requireSupabase = () => {
  if (!supabase) throw new Error("Secure storage is not configured.");
  return supabase;
};

export async function isPlatformAdmin() {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error) return false;
  return data === true;
}

export async function loadPlatformOverview() {
  const { data, error } = await requireSupabase().rpc("admin_platform_overview");
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map((row) => ({
    userId: str(row.user_id),
    email: str(row.email) || "Unknown account",
    createdAt: row.created_at || "",
    treesActive: Number(row.trees_active) || 0,
    treesTrashed: Number(row.trees_trashed) || 0,
    totalTreesCreated: Number(row.total_trees_created) || 0,
    freeTreeLimit: Number(row.free_tree_limit) || 0,
    freeTreesUsed: Number(row.free_trees_used) || 0,
    paidTreeCredits: Number(row.paid_tree_credits) || 0,
    unlimitedTrees: row.unlimited_trees === true,
    stripeCustomerId: str(row.stripe_customer_id),
    lastActivity: row.last_activity || "",
  }));
}

export async function setUnlimitedTrees(userId, unlimited) {
  const { error } = await requireSupabase().rpc("admin_set_unlimited_trees", {
    target_user: userId,
    unlimited,
  });
  if (error) throw error;
}

export async function grantTreeCredits(userId, credits) {
  const { error } = await requireSupabase().rpc("admin_grant_tree_credits", {
    target_user: userId,
    credits,
  });
  if (error) throw error;
}

export async function getAnnouncement() {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("active_announcement");
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return row
    ? { id: str(row.id), message: str(row.message), level: row.level === "warning" ? "warning" : "info" }
    : null;
}

export async function setAnnouncement({ message, level }) {
  const { error } = await requireSupabase().rpc("admin_set_announcement", {
    new_message: message || "",
    new_level: level === "warning" ? "warning" : "info",
  });
  if (error) throw error;
}
