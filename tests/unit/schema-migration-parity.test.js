import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  describePrivilegeState,
  parsePrivilegeStatement,
  replayPrivileges,
  splitStatements,
} from "../../scripts/sql-privileges.mjs";

/**
 * `supabase/migrations/` builds every real database. `supabase/schema.sql` is a
 * generated snapshot, and it is the file the entitlement tests read. Until now
 * nothing forced the two to agree, so a migration could hand `update` back to
 * the browser and all 27 of those tests would stay green, because they were
 * reading a document the database had never seen.
 */

const supabaseDirectory = fileURLToPath(new URL("../../supabase/", import.meta.url));
const migrationsDirectory = path.join(supabaseDirectory, "migrations");

const migrationFiles = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort();

// Filenames carry the ordering, so sorting them replays the history in the
// order Supabase applies it.
const migrations = migrationFiles
  .map((name) => readFileSync(path.join(migrationsDirectory, name), "utf8"))
  .join("\n;\n");
const schema = readFileSync(path.join(supabaseDirectory, "schema.sql"), "utf8");

const stateOf = (sql) => describePrivilegeState(replayPrivileges(sql));

describe("the snapshot and the migration history describe the same database", () => {
  it("ends in exactly the same privilege state", () => {
    expect(stateOf(schema)).toEqual(stateOf(migrations));
  });

  it("describes a privilege state that is not empty", () => {
    // A parser that silently matched nothing would make the comparison above
    // pass for the worst possible reason.
    expect(stateOf(schema).length).toBeGreaterThan(40);
  });

  it("reads every privilege statement in both sources", () => {
    // An unreadable grant is the hole this check exists to close, so it is
    // reported rather than skipped.
    expect(replayPrivileges(schema).unparsed).toEqual([]);
    expect(replayPrivileges(migrations).unparsed).toEqual([]);
  });

  it("honours a revoke that arrives several migrations after the grant", () => {
    // The first migration grants update and delete on family_trees; later ones
    // take both back. Comparing the texts would report drift here; replaying
    // them agrees with the snapshot, which simply never grants either.
    const held = replayPrivileges(migrations).privileges.get(
      "table public.family_trees → authenticated",
    );

    expect([...held].sort()).toEqual(["insert", "select"]);
    expect(migrations).toMatch(
      /grant select, insert, update, delete on table public\.family_trees/,
    );
  });

  it("agrees that the browser holds only select on every entitlement table", () => {
    for (const table of ["tree_accounts", "tree_credit_orders", "tree_generations"]) {
      for (const sql of [schema, migrations]) {
        const held = replayPrivileges(sql).privileges.get(`table public.${table} → authenticated`);
        expect([...held]).toEqual(["select"]);
      }
    }
  });
});

describe("the comparison notices a snapshot that has fallen behind", () => {
  const driftFrom = (mutate) => {
    const mutated = stateOf(mutate(migrations));
    return mutated.filter((line) => !stateOf(schema).includes(line));
  };

  it("catches a migration that hands update back to the browser", () => {
    expect(
      driftFrom((sql) => `${sql};\ngrant update on table public.family_trees to authenticated;`),
    ).toEqual(["table public.family_trees → authenticated: insert, select, update"]);
  });

  it("catches a policy predicate weakened to allow everyone", () => {
    const drift = driftFrom((sql) =>
      [
        sql,
        ';drop policy if exists "tree accounts select own" on public.tree_accounts;',
        'create policy "tree accounts select own"',
        "on public.tree_accounts for select to authenticated using (true);",
      ].join("\n"),
    );

    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain("using (true)");
  });

  it("catches a brand new policy that lets an account write its own allowance", () => {
    const drift = driftFrom((sql) =>
      [
        sql,
        ';create policy "tree accounts update own"',
        "on public.tree_accounts for update to authenticated",
        "using ((select auth.uid()) = user_id);",
      ].join("\n"),
    );

    expect(drift).toEqual([
      "policy public.tree_accounts::tree accounts update own: for update to authenticated using ((select auth.uid()) = user_id)",
    ]);
  });

  it("catches row level security being switched off", () => {
    expect(
      driftFrom((sql) => `${sql};\nalter table public.family_trees disable row level security;`),
    ).toEqual(["row level security public.family_trees: DISABLED"]);
  });

  it("catches a revoke that is dropped from one side", () => {
    // The effective privilege set is unchanged, so only recording that the role
    // was named at all catches this.
    const withoutRevoke = migrations.replace(
      "revoke all on table public.tree_accounts from anon, authenticated;",
      "",
    );
    expect(withoutRevoke).not.toEqual(migrations);

    expect(stateOf(withoutRevoke)).not.toEqual(stateOf(schema));
  });
});

describe("reading SQL", () => {
  it("keeps a dollar-quoted function body whole despite its semicolons", () => {
    const statements = splitStatements(`
      create function private.example() returns void language plpgsql as $$
      begin
        perform 1; perform 2;
      end;
      $$;
      grant execute on function private.example() to authenticated;
    `);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("perform 1; perform 2;");
    expect(statements[1]).toBe("grant execute on function private.example() to authenticated");
  });

  it("ignores semicolons inside comments and string literals", () => {
    const statements = splitStatements(`
      -- a comment; with a semicolon
      select 'a literal; with one';
      grant select on table public.thing to anon;
    `);

    expect(statements).toHaveLength(2);
    expect(statements[1]).toBe("grant select on table public.thing to anon");
  });

  it("expands `all` to the full privilege set so a later revoke can remove one", () => {
    const { privileges } = replayPrivileges(`
      grant all on table public.thing to authenticated;
      revoke delete on table public.thing from authenticated;
    `);
    const held = privileges.get("table public.thing → authenticated");

    expect(held.has("select")).toBe(true);
    expect(held.has("delete")).toBe(false);
  });

  it("reports a privilege statement it cannot read rather than ignoring it", () => {
    expect(parsePrivilegeStatement("grant select on all tables in schema public to anon")).toEqual({
      kind: "unparsed",
      statement: "grant select on all tables in schema public to anon",
    });
    expect(parsePrivilegeStatement("alter policy x on public.thing using (true)")).toMatchObject({
      kind: "unparsed",
    });
  });

  it("has no opinion on statements that do not touch privileges", () => {
    expect(parsePrivilegeStatement("create index thing_idx on public.thing (id)")).toBeNull();
    expect(parsePrivilegeStatement("alter table public.thing add column x int")).toBeNull();
  });
});
