/* Platform Super Administrator console data access. Every call goes through a
   security-definer RPC gated by is_platform_admin(); the browser holds only
   its own JWT and never the service-role key. Calls reject for non-admins
   (and until the migration is applied), which the UI treats as "not a
   platform admin". */
import { supabase } from "../supabaseClient.js";

const str = (value) => (value == null ? "" : String(value));
export const MAX_ADMIN_CREDIT_GRANT = 100;

let fallbackRequestSequence = 0;

const fallbackAdminRequestId = () => {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // This path exists for older test/runtime environments. Request IDs are
    // still made unique per page process; production browsers use Web Crypto.
    const seed = `${Date.now()}:${fallbackRequestSequence++}:${Math.random()}`;
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = seed.charCodeAt(index % seed.length) ^ ((index * 37) & 0xff);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export function createAdminRequestId(
  randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto),
) {
  return randomUUID ? randomUUID() : fallbackAdminRequestId();
}

const requiredRequestId = (requestId) => {
  const value = str(requestId).trim();
  if (!value) throw new Error("A request ID is required for this admin change.");
  return value;
};

const requiredGrantCredits = (credits) => {
  const value = Number(credits);
  if (!Number.isInteger(value) || value < 1 || value > MAX_ADMIN_CREDIT_GRANT) {
    throw new Error(
      `Paid-credit grants must be whole numbers from 1 to ${MAX_ADMIN_CREDIT_GRANT}.`,
    );
  }
  return value;
};

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

export async function setUnlimitedTrees(
  userId,
  unlimited,
  { requestId = createAdminRequestId() } = {},
) {
  const { error } = await requireSupabase().rpc("admin_set_unlimited_trees", {
    target_user: userId,
    enabled: unlimited === true,
    request_id: requiredRequestId(requestId),
  });
  if (error) throw error;
}

export async function grantTreeCredits(
  userId,
  credits,
  { requestId = createAdminRequestId() } = {},
) {
  const { error } = await requireSupabase().rpc("admin_grant_tree_credits", {
    target_user: userId,
    credits: requiredGrantCredits(credits),
    request_id: requiredRequestId(requestId),
  });
  if (error) throw error;
}

export async function getAnnouncement() {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("active_announcement");
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return row
    ? {
        id: str(row.id),
        message: str(row.message),
        level: row.level === "warning" ? "warning" : "info",
      }
    : null;
}

export async function setAnnouncement({ message, level }) {
  const { error } = await requireSupabase().rpc("admin_set_announcement", {
    new_message: message || "",
    new_level: level === "warning" ? "warning" : "info",
  });
  if (error) throw error;
}
