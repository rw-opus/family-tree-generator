import { createClient } from "@supabase/supabase-js";

const runtimeEnv = typeof window === "undefined" ? {} : window.__FAMILY_TREE_ENV__ || {};
const url = import.meta.env.VITE_SUPABASE_URL || runtimeEnv.VITE_SUPABASE_URL;
const key =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || runtimeEnv.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabaseConfigured = Boolean(url && key);
export const supabase = supabaseConfigured ? createClient(url, key) : null;
