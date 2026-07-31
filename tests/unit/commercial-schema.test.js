import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../../supabase/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../../supabase/migrations/20260731124716_commercial_tree_credits.sql", import.meta.url),
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
});
