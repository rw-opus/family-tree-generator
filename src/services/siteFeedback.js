/* Anonymous product feedback. submit_site_feedback stores no submitter
   identity at all, so nobody - including a platform admin - can see who sent
   a given message. The list/mark-handled RPCs reject for non-admins, so a
   thrown error there means "not a platform admin" (or the migration isn't
   applied yet) - callers hide the inbox in that case. */
import { supabase } from "../supabaseClient.js";

const FEEDBACK_TYPES = new Set(["suggestion", "bug"]);
const MIN_MESSAGE_LENGTH = 5;
const MAX_MESSAGE_LENGTH = 3000;

const requireSupabase = () => {
  if (!supabase) throw new Error("Secure storage is not configured.");
  return supabase;
};

export function feedbackValidationMessage(type, message) {
  if (!FEEDBACK_TYPES.has(type)) return "Choose whether this is a suggestion or a bug report.";
  const trimmed = String(message || "").trim();
  if (trimmed.length < MIN_MESSAGE_LENGTH) return "Please add a little more detail before sending.";
  if (trimmed.length > MAX_MESSAGE_LENGTH) return "Keep the message to 3,000 characters or fewer.";
  return "";
}

export async function submitSiteFeedback({ kind, message }) {
  const validationMessage = feedbackValidationMessage(kind, message);
  if (validationMessage) throw new Error(validationMessage);

  const { error } = await requireSupabase().rpc("submit_site_feedback", {
    feedback_kind: kind,
    feedback_message: String(message).trim(),
  });
  if (error) throw error;
}

export async function listSiteFeedback({ includeHandled = true } = {}) {
  const { data, error } = await requireSupabase().rpc("list_site_feedback", {
    include_handled: includeHandled,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map((row) => ({
    id: String(row.id),
    kind: row.kind === "bug" ? "bug" : "suggestion",
    message: String(row.message || ""),
    createdAt: row.created_at || "",
    handledAt: row.handled_at || null,
  }));
}

export async function setSiteFeedbackHandled(feedbackId, handled) {
  const { error } = await requireSupabase().rpc("set_site_feedback_handled", {
    feedback_id: feedbackId,
    handled,
  });
  if (error) throw error;
}
