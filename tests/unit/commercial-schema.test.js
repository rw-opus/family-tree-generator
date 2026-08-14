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
const unlimitedAccountsMigration = readFileSync(
  new URL("../../supabase/migrations/20260806060552_unlimited_tree_accounts.sql", import.meta.url),
  "utf8",
);
const concurrencyMigration = readFileSync(
  new URL(
    "../../supabase/migrations/20260814034839_family_tree_optimistic_concurrency.sql",
    import.meta.url,
  ),
  "utf8",
);
const enforcedConcurrencyMigration = readFileSync(
  new URL(
    "../../supabase/migrations/20260814041002_enforce_family_tree_save_rpc.sql",
    import.meta.url,
  ),
  "utf8",
);
const checkoutServiceRoleMigration = readFileSync(
  new URL(
    "../../supabase/migrations/20260814042300_grant_checkout_service_role_access.sql",
    import.meta.url,
  ),
  "utf8",
);
const treePayloadGuardMigration = readFileSync(
  new URL(
    "../../supabase/migrations/20260814044717_harden_family_tree_payloads.sql",
    import.meta.url,
  ),
  "utf8",
);
const trashRestoreMigration = readFileSync(
  new URL(
    "../../supabase/migrations/20260814091334_family_tree_trash_restore.sql",
    import.meta.url,
  ),
  "utf8",
);
const authConfig = readFileSync(new URL("../../supabase/config.toml", import.meta.url), "utf8");
const authScreen = readFileSync(
  new URL("../../src/components/AuthScreen.jsx", import.meta.url),
  "utf8",
);
const normaliseSql = (sql) => sql.replaceAll("\r\n", "\n").trim();

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

  it("supports a private unlimited entitlement without consuming free or paid credits", () => {
    for (const sql of [schema, unlimitedAccountsMigration]) {
      expect(sql).toContain("unlimited_trees boolean not null default false");
      expect(sql).toContain("if account.unlimited_trees then");
      expect(sql).toContain("allocation_source := 'admin'");
      expect(sql).toContain("set total_trees_created = total_trees_created + 1");
      expect(sql).toContain(
        "revoke all on function private.consume_tree_entitlement() from public, anon, authenticated",
      );
    }
    expect(unlimitedAccountsMigration).not.toContain("rolandwadge@gmail.com");
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

  it("uses a server-owned revision to reject stale family-tree updates", () => {
    for (const sql of [schema, concurrencyMigration]) {
      expect(sql).toContain("revision bigint not null default 1");
      expect(sql).toContain("private.increment_family_tree_revision()");
      expect(sql).toContain("new.revision := old.revision + 1");
      expect(sql).toContain("before update on public.family_trees");
      expect(sql).toContain(
        "revoke all on function private.increment_family_tree_revision() from public, anon, authenticated",
      );
    }
    expect(schema).toContain("GENERATED SNAPSHOT — DO NOT EDIT MANUALLY");
    expect(schema).toContain("supabase/migrations/ is the authoritative database history");
  });

  it("enforces compare-and-swap saves at the database API boundary", () => {
    for (const sql of [schema, enforcedConcurrencyMigration]) {
      expect(sql).toContain("function public.save_family_tree(");
      expect(sql).toContain("security definer");
      expect(sql).toContain("set search_path = ''");
      expect(sql).toContain("tree.owner_id = caller_id");
      expect(sql).toContain("message = 'TREE_SAVE_CONFLICT'");
      expect(sql).toContain(
        "grant execute on function public.save_family_tree(uuid, bigint, text, jsonb, jsonb)",
      );
    }
    expect(enforcedConcurrencyMigration).toContain(
      "revoke update on table public.family_trees from authenticated",
    );
    expect(schema).toContain("grant select, insert on table public.family_trees to authenticated");
    expect(schema).not.toMatch(/grant[^;]*delete[^;]*on table public\.family_trees/i);
    expect(schema).not.toMatch(
      /grant\s+select,\s*insert,\s*update,\s*delete\s+on table public\.family_trees/i,
    );
  });

  it("implements owner-scoped, revision-aware Trash and a 30-day restore window", () => {
    for (const sql of [schema, trashRestoreMigration]) {
      expect(sql).toContain("deleted_at timestamptz");
      expect(sql).toContain("function public.trash_family_tree(");
      expect(sql).toContain("function public.restore_family_tree(");
      expect(sql).toContain("function public.permanently_delete_family_tree(");
      expect(sql).toContain("function public.list_trashed_family_trees()");
      expect(sql).toContain("tree.owner_id = caller_id");
      expect(sql).toContain("current_revision <> p_expected_revision");
      expect(sql).toContain("message = 'TREE_TRASH_CONFLICT'");
      expect(sql).toContain("message = 'TREE_RESTORE_CONFLICT'");
      expect(sql).toContain("message = 'TREE_RESTORE_EXPIRED'");
      expect(sql).toContain("message = 'TREE_PERMANENT_DELETE_CONFLICT'");
      expect(sql).toContain("now() - interval '30 days'");
      expect(sql).toContain("security definer");
      expect(sql).toContain("set search_path = ''");
    }
    expect(trashRestoreMigration).toContain(
      "revoke delete on table public.family_trees from authenticated",
    );
    expect(schema).toContain('create policy "family trees select active own"');
    expect(schema).toContain("and deleted_at is null");
    expect(schema).not.toMatch(/create policy[^;]+on public\.family_trees[^;]+for delete/is);
  });

  it("gives the checkout service role only the table access its workflow uses", () => {
    for (const sql of [schema, checkoutServiceRoleMigration]) {
      expect(sql).toContain("grant select on table public.tree_accounts to service_role");
      expect(sql).toContain(
        "grant select, insert, update on table public.tree_credit_orders to service_role",
      );
      expect(sql).not.toContain("grant all on table public.tree_accounts to service_role");
      expect(sql).not.toContain("grant all on table public.tree_credit_orders to service_role");
    }
  });

  it("validates every persisted tree at the database boundary before other row triggers", () => {
    expect(normaliseSql(schema)).toContain(normaliseSql(treePayloadGuardMigration));
    for (const sql of [schema, treePayloadGuardMigration]) {
      expect(sql).toContain("function private.validate_family_tree_payload()");
      expect(sql).toContain("security invoker");
      expect(sql).toContain("set search_path = ''");
      expect(sql).toContain("message = 'TREE_PAYLOAD_INVALID'");
      expect(sql).toContain("message = 'TREE_PAYLOAD_TOO_LARGE'");
      expect(sql).toContain("raise sqlstate 'PT422'");
      expect(sql).toContain("raise sqlstate 'PT413'");
      expect(sql).toContain("max_tree_bytes constant integer := 8388608");
      expect(sql).toContain("max_json_nodes constant integer := 100000");
      expect(sql).toContain("max_json_depth constant integer := 20");
      expect(sql).toContain("TREE_PEOPLE_MIRROR_MISMATCH");
      expect(sql).toContain("TREE_JSON_KEY_FORBIDDEN");
      expect(sql).toContain("TREE_RECORD_COUNT_LIMIT_EXCEEDED");
      expect(sql).toContain("create trigger family_trees_00_validate_payload");
      expect(sql).toContain(
        "before insert or update of id, title, people, tree_data on public.family_trees",
      );
      expect(sql).toMatch(
        /revoke all on function private\.validate_family_tree_payload\(\)\s+from public, anon, authenticated/,
      );
    }
  });

  it("preserves deployed-client compatibility without silently accepting future schemas", () => {
    for (const sql of [schema, treePayloadGuardMigration]) {
      expect(sql).toContain("where not (tree_data ? 'tree_schema_version')");
      expect(sql).toContain("requested_marker = '1'");
      expect(sql).toContain("requested_marker = '2'");
      expect(sql).toContain("requested_marker = ''");
      expect(sql).toContain("'{tree_schema_version}'");
      expect(sql).toContain("'2'::jsonb");
      expect(sql).toContain("TREE_SCHEMA_VERSION_UNSUPPORTED");
      expect(sql).toContain(
        "alter table public.family_trees disable trigger family_trees_increment_revision",
      );
      expect(sql).toContain(
        "alter table public.family_trees enable trigger family_trees_increment_revision",
      );
    }
  });

  it("treats only an exact empty optional reference as a blank draft value", () => {
    for (const sql of [schema, treePayloadGuardMigration]) {
      expect(sql).toContain("where coalesce(family_group.value ->> 'rootPersonId', '') <> ''");
      expect(sql).toContain("where coalesce(reference.person_id, '') <> ''");
      expect(sql).toContain("where coalesce(declaration.value ->> 'propertyId', '') <> ''");
      expect(sql).toContain("coalesce(session.value ->> 'propertyId', '') <> ''");
      expect(sql).not.toContain("pg_catalog.btrim(coalesce(reference.person_id, '')) <> ''");
      expect(sql).not.toContain("pg_catalog.btrim(family_group.value ->> 'rootPersonId') <> ''");
    }
  });
});
