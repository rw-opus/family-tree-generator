import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../../supabase/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../../supabase/migrations/20260731124716_commercial_tree_credits.sql", import.meta.url),
  "utf8",
);
const orderIndexMigration = readFileSync(
  new URL(
    "../../supabase/migrations/20260804045736_index_tree_generation_orders.sql",
    import.meta.url,
  ),
  "utf8",
);
const termsMigration = readFileSync(
  new URL(
    "../../supabase/migrations/20260804052042_family_tree_terms_acceptances.sql",
    import.meta.url,
  ),
  "utf8",
);
const authConfig = readFileSync(new URL("../../supabase/config.toml", import.meta.url), "utf8");
const authScreen = readFileSync(
  new URL("../../src/components/AuthScreen.jsx", import.meta.url),
  "utf8",
);

describe("commercial Supabase schema", () => {
  it("enforces five free trees and paid credits in a private insert trigger", () => {
    for (const sql of [schema, migration]) {
      expect(sql).toContain("free_tree_limit smallint not null default 5");
      expect(sql).toContain("TREE_PAYMENT_REQUIRED");
      expect(sql).toContain("after insert on public.family_trees");
      expect(sql).toContain("paid_tree_credits = paid_tree_credits - 1");
      expect(sql).toContain("on delete set null");
      expect(sql).toContain("security definer");
      expect(sql).toContain("set search_path = ''");
    }
  });

  it("isolates exposed commercial tables and keeps the Stripe ledger private", () => {
    expect(schema).toContain("alter table public.family_trees enable row level security");
    expect(schema).toContain("using ((select auth.uid()) = owner_id)");
    expect(schema).toContain("using ((select auth.uid()) = user_id)");
    expect(schema).toContain(
      "revoke all on table public.stripe_tree_events from anon, authenticated",
    );
    expect(schema).not.toMatch(/using\s*\(\s*true\s*\)/i);
  });

  it("indexes paid-generation order references", () => {
    for (const sql of [schema, orderIndexMigration]) {
      expect(sql).toContain("tree_generations_order_idx");
      expect(sql).toContain("on public.tree_generations (order_id)");
    }
  });

  it("keeps clickwrap acceptance versioned, owner-scoped and append-only", () => {
    for (const sql of [schema, termsMigration]) {
      expect(sql).toContain("create table if not exists public.terms_acceptances");
      expect(sql).toContain("terms acceptances select own");
      expect(sql).toContain("terms acceptances insert own");
      expect(sql).toContain("grant select, insert on table public.terms_acceptances");
      expect(sql).not.toMatch(/terms acceptances (update|delete) own/i);
    }
  });

  it("keeps account creation invitation-only at both client and Supabase config boundaries", () => {
    expect(authScreen).not.toContain("supabase.auth.signUp");
    expect(authConfig).toMatch(/\[auth\][\s\S]*enable_signup\s*=\s*false/);
    expect(authConfig).toMatch(/\[auth\.email\][\s\S]*enable_signup\s*=\s*true/);
    expect(authConfig).toMatch(/\[auth\.rate_limit\][\s\S]*sign_in_sign_ups\s*=\s*10/);
    expect(authConfig).toContain(
      'site_url = "https://family-tree-generator-production.up.railway.app"',
    );
    expect(authConfig).toMatch(/\[auth\.mfa\.totp\][\s\S]*verify_enabled\s*=\s*true/);
  });
});
