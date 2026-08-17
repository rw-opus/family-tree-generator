import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { assertLocalDatabaseUrl } from "../../scripts/backup/evidence.js";

/**
 * A1 and A4 — tenant isolation, proven rather than assumed.
 *
 * Every request below goes straight to PostgREST with a bearer token. Nothing
 * here touches the application's own code, because the threat is somebody who
 * never opens the application at all: if the browser can send it, an attacker
 * can send it by hand.
 *
 * Requires a Supabase instance. `npm run test:rls` fails loudly rather than
 * skipping, so a green CI run cannot mean "the security tests did not run".
 */

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const jwtSecret = process.env.SUPABASE_JWT_SECRET;
const databaseUrl = process.env.SUPABASE_DB_URL;
const fixtureConfirmation = process.env.FTG_RLS_DB_FIXTURE_CONFIRMATION;
const REQUIRED_FIXTURE_CONFIRMATION = "ALLOW_ONLY_DISPOSABLE_LOCAL_RLS_FIXTURES";

if (
  !url ||
  !anonKey ||
  !serviceRoleKey ||
  !jwtSecret ||
  !databaseUrl ||
  fixtureConfirmation !== REQUIRED_FIXTURE_CONFIRMATION
) {
  throw new Error(
    "RLS tests need SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY " +
      "SUPABASE_JWT_SECRET, SUPABASE_DB_URL and the disposable-fixture confirmation. " +
      "Start a local stack with `npx supabase start` and export them, or run this in CI.",
  );
}

let apiUrl;
try {
  apiUrl = new URL(url);
} catch {
  throw new Error("RLS tests require an absolute local Supabase API URL.");
}
if (
  apiUrl.protocol !== "http:" ||
  !["127.0.0.1", "localhost"].includes(apiUrl.hostname.toLowerCase())
) {
  throw new Error("RLS tests are forbidden unless the Supabase API is local and disposable.");
}
const localDatabaseUrl = assertLocalDatabaseUrl(databaseUrl, "SUPABASE_DB_URL").toString();
const adminRepairMigration = readFileSync(
  new URL(
    "../../supabase/migrations/20260817164224_repair_admin_overview_and_allowances.sql",
    import.meta.url,
  ),
  "utf8",
);

function localSql(input, variables = {}) {
  const variableArguments = Object.entries(variables).map(([name, value]) => {
    if (!/^[a-z][a-z0-9_]*$/i.test(name)) throw new Error(`Invalid psql variable name: ${name}`);
    return `--set=${name}=${String(value)}`;
  });
  return execFileSync(
    "psql",
    [
      localDatabaseUrl,
      "--no-psqlrc",
      "--quiet",
      "--tuples-only",
      "--no-align",
      "--set=ON_ERROR_STOP=1",
      ...variableArguments,
    ],
    { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}

const signedLocalJwt = (payload) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const body = encode(payload);
  const signature = createHmac("sha256", jwtSecret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
};

const rest = (path, { token, method = "GET", body, prefer } = {}) =>
  fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token ?? anonKey}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const readJson = async (response) => {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
};

const admin = (path, init = {}) =>
  fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

function ageTrashedFamilyTree(treeId, deletedAt) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(treeId)) {
    throw new Error("The RLS fixture tree ID must be a UUID.");
  }
  const parsedDeletedAt = new Date(deletedAt);
  if (Number.isNaN(parsedDeletedAt.getTime()) || parsedDeletedAt.toISOString() !== deletedAt) {
    throw new Error("The RLS fixture deletion time must be a canonical ISO timestamp.");
  }

  const output = execFileSync(
    "psql",
    [
      localDatabaseUrl,
      "--no-psqlrc",
      "--quiet",
      "--tuples-only",
      "--no-align",
      "--set=ON_ERROR_STOP=1",
      `--set=tree_id=${treeId}`,
      `--set=deleted_at=${deletedAt}`,
    ],
    {
      encoding: "utf8",
      input:
        "update public.family_trees " +
        "set deleted_at = :'deleted_at'::timestamptz " +
        "where id = :'tree_id'::uuid returning revision;\n",
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();
  const revision = Number(output);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("The local RLS fixture did not update exactly one family tree.");
  }
  return revision;
}

async function createUser(email) {
  const password = `Fictional-${crypto.randomUUID()}`;
  const created = await admin("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!created.ok) throw new Error(`Could not create ${email}: ${await created.text()}`);
  const { id } = await created.json();

  const signedIn = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!signedIn.ok) throw new Error(`Could not sign in ${email}: ${await signedIn.text()}`);
  const { access_token: token } = await signedIn.json();
  return { id, email, token };
}

const strictTreePayload = (treeId, title, people = [{ id: `${treeId}:person:1` }]) => {
  const familyGroupId = `${treeId}:group:1`;
  const propertyId = `${treeId}:property:1`;
  return {
    tree_schema_version: 2,
    schemaVersion: 2,
    id: treeId,
    title,
    people,
    familyGroups: [
      {
        id: familyGroupId,
        rootPersonId: people[0].id,
        personIds: people.map((person) => person.id),
      },
    ],
    activeFamilyGroupId: familyGroupId,
    outsideParties: [],
    properties: [{ id: propertyId, owners: [], transfers: [], declarations: [], saleLots: [] }],
    settings: { activePropertyId: propertyId },
  };
};

describe("cross-account isolation", () => {
  let alice;
  let bob;
  let aliceTreeId;

  beforeAll(async () => {
    const stamp = crypto.randomUUID().slice(0, 8);
    [alice, bob] = await Promise.all([
      createUser(`alice-${stamp}@fictional.invalid`),
      createUser(`bob-${stamp}@fictional.invalid`),
    ]);

    aliceTreeId = crypto.randomUUID();
    const legacyCompatiblePayload = strictTreePayload(aliceTreeId, "Alice private estate");
    delete legacyCompatiblePayload.tree_schema_version;
    const created = await rest("family_trees", {
      token: alice.token,
      method: "POST",
      prefer: "return=representation",
      body: {
        id: aliceTreeId,
        owner_id: alice.id,
        title: legacyCompatiblePayload.title,
        people: legacyCompatiblePayload.people,
        tree_data: legacyCompatiblePayload,
      },
    });
    const rows = await readJson(created);
    if (!created.ok) throw new Error(`Alice could not create a tree: ${JSON.stringify(rows)}`);
    if (rows[0].tree_data.tree_schema_version !== 2) {
      throw new Error("The database did not upgrade a strict unmarked tree to schema version 2.");
    }
  }, 60_000);

  afterAll(async () => {
    for (const user of [alice, bob]) {
      if (user?.id) await admin(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" });
    }
  });

  it("lets Alice read her own tree", async () => {
    const response = await rest(`family_trees?id=eq.${aliceTreeId}`, { token: alice.token });
    const rows = await readJson(response);

    expect(response.status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Alice private estate");
  });

  it("hides Alice's tree from a listing by Bob", async () => {
    const response = await rest("family_trees?select=id,title", { token: bob.token });
    const rows = await readJson(response);

    expect(response.status).toBe(200);
    expect(rows).toEqual([]);
  });

  it("hides Alice's tree from Bob even when he names its exact id", async () => {
    const response = await rest(`family_trees?id=eq.${aliceTreeId}`, { token: bob.token });
    const rows = await readJson(response);

    // RLS filters rather than errors, so an attacker cannot even confirm the
    // row exists.
    expect(response.status).toBe(200);
    expect(rows).toEqual([]);
  });

  it("refuses an update by Bob to Alice's tree", async () => {
    const response = await rest(`family_trees?id=eq.${aliceTreeId}`, {
      token: bob.token,
      method: "PATCH",
      prefer: "return=representation",
      body: { title: "Taken over by Bob" },
    });
    expect(response.ok).toBe(false);
    expect([401, 403]).toContain(response.status);

    const check = await rest(`family_trees?id=eq.${aliceTreeId}`, { token: alice.token });
    expect((await readJson(check))[0].title).toBe("Alice private estate");
  });

  it("refuses a delete by Bob of Alice's tree", async () => {
    const response = await rest(`family_trees?id=eq.${aliceTreeId}`, {
      token: bob.token,
      method: "DELETE",
      prefer: "return=representation",
    });
    expect(response.ok).toBe(false);
    expect([401, 403]).toContain(response.status);

    const check = await rest(`family_trees?id=eq.${aliceTreeId}`, { token: alice.token });
    expect(await readJson(check)).toHaveLength(1);
  });

  it("refuses Bob an insert that claims Alice as the owner", async () => {
    const plantedId = crypto.randomUUID();
    const planted = strictTreePayload(plantedId, "Planted by Bob");
    const response = await rest("family_trees", {
      token: bob.token,
      method: "POST",
      prefer: "return=representation",
      body: {
        id: plantedId,
        owner_id: alice.id,
        title: planted.title,
        people: planted.people,
        tree_data: planted,
      },
    });

    expect(response.ok).toBe(false);
    expect([401, 403]).toContain(response.status);
  });

  it("shows Alice nothing of Bob's, in reverse", async () => {
    const bobTreeId = crypto.randomUUID();
    const bobTreeData = strictTreePayload(bobTreeId, "Bob private estate");
    const created = await rest("family_trees", {
      token: bob.token,
      method: "POST",
      prefer: "return=representation",
      body: {
        id: bobTreeId,
        owner_id: bob.id,
        title: bobTreeData.title,
        people: bobTreeData.people,
        tree_data: bobTreeData,
      },
    });
    const [bobTree] = await readJson(created);

    const response = await rest(`family_trees?id=eq.${bobTree.id}`, { token: alice.token });
    expect(await readJson(response)).toEqual([]);
  });

  it("returns nothing for a guessed identifier", async () => {
    const response = await rest(`family_trees?id=eq.${crypto.randomUUID()}`, { token: bob.token });

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual([]);
  });

  it("leaks nothing through a malformed identifier", async () => {
    const response = await rest("family_trees?id=eq.not-a-uuid", { token: bob.token });
    const body = await readJson(response);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(body)).not.toContain("Alice private estate");
  });

  it("denies an unconditional table PATCH even from the tree owner", async () => {
    const before = await rest(`family_trees?id=eq.${aliceTreeId}&select=title,revision`, {
      token: alice.token,
    });
    const [original] = await readJson(before);

    const response = await rest(`family_trees?id=eq.${aliceTreeId}`, {
      token: alice.token,
      method: "PATCH",
      prefer: "return=representation",
      body: { title: "Bypassed compare and swap" },
    });

    expect(response.ok).toBe(false);
    expect([401, 403]).toContain(response.status);

    const after = await rest(`family_trees?id=eq.${aliceTreeId}&select=title,revision`, {
      token: alice.token,
    });
    expect((await readJson(after))[0]).toEqual(original);
  });

  it("saves the owner's matching revision through the RPC and increments it", async () => {
    const read = await rest(`family_trees?id=eq.${aliceTreeId}&select=id,title,revision`, {
      token: alice.token,
    });
    const [original] = await readJson(read);

    const legacyClientPayload = strictTreePayload(aliceTreeId, "Alice RPC save");
    legacyClientPayload.tree_schema_version = 1;
    const firstSave = await rest("rpc/save_family_tree", {
      token: alice.token,
      method: "POST",
      body: {
        p_tree_id: aliceTreeId,
        p_expected_revision: original.revision,
        p_title: legacyClientPayload.title,
        p_people: legacyClientPayload.people,
        p_tree_data: legacyClientPayload,
      },
    });
    const [newer] = await readJson(firstSave);
    expect(firstSave.status).toBe(200);
    expect(newer).toMatchObject({
      title: "Alice RPC save",
      revision: original.revision + 1,
    });
    expect(newer.tree_data.tree_schema_version).toBe(2);
  });

  it("returns a typed conflict for a stale RPC save without overwriting", async () => {
    const read = await rest(`family_trees?id=eq.${aliceTreeId}&select=id,title,revision`, {
      token: alice.token,
    });
    const [original] = await readJson(read);

    const newerPayload = strictTreePayload(aliceTreeId, "Alice newer revision");
    newerPayload.tree_schema_version = 1;
    const firstSave = await rest("rpc/save_family_tree", {
      token: alice.token,
      method: "POST",
      body: {
        p_tree_id: aliceTreeId,
        p_expected_revision: original.revision,
        p_title: newerPayload.title,
        p_people: newerPayload.people,
        p_tree_data: newerPayload,
      },
    });
    const [newer] = await readJson(firstSave);
    expect(firstSave.status).toBe(200);
    expect(newer.tree_data.tree_schema_version).toBe(2);

    const stalePayload = strictTreePayload(aliceTreeId, "Alice stale overwrite");
    const staleSave = await rest("rpc/save_family_tree", {
      token: alice.token,
      method: "POST",
      body: {
        p_tree_id: aliceTreeId,
        p_expected_revision: original.revision,
        p_title: stalePayload.title,
        p_people: stalePayload.people,
        p_tree_data: stalePayload,
      },
    });
    const conflict = await readJson(staleSave);
    expect(staleSave.status).toBe(409);
    expect(conflict).toMatchObject({ code: "PT409", message: "TREE_SAVE_CONFLICT" });

    const finalRead = await rest(`family_trees?id=eq.${aliceTreeId}&select=title,revision`, {
      token: alice.token,
    });
    expect((await readJson(finalRead))[0]).toEqual({
      title: "Alice newer revision",
      revision: newer.revision,
    });
  });

  it("rejects an invalid RPC payload before the row revision can change", async () => {
    const before = await rest(
      `family_trees?id=eq.${aliceTreeId}&select=title,people,tree_data,revision`,
      { token: alice.token },
    );
    const [original] = await readJson(before);
    const invalid = structuredClone(original.tree_data);
    invalid.people[0].fatherId = "missing-person";

    const response = await rest("rpc/save_family_tree", {
      token: alice.token,
      method: "POST",
      body: {
        p_tree_id: aliceTreeId,
        p_expected_revision: original.revision,
        p_title: original.title,
        p_people: invalid.people,
        p_tree_data: invalid,
      },
    });
    const failure = await readJson(response);

    expect(response.status).toBe(422);
    expect(failure).toMatchObject({
      code: "PT422",
      message: "TREE_PAYLOAD_INVALID",
      details: "TREE_RELATIONSHIP_REFERENCE_INVALID",
    });

    const after = await rest(
      `family_trees?id=eq.${aliceTreeId}&select=title,people,tree_data,revision`,
      { token: alice.token },
    );
    expect((await readJson(after))[0]).toEqual(original);
  });

  it("denies Bob's save RPC for Alice's exact tree identifier", async () => {
    const read = await rest(`family_trees?id=eq.${aliceTreeId}&select=title,revision`, {
      token: alice.token,
    });
    const [original] = await readJson(read);

    const overwrite = strictTreePayload(aliceTreeId, "Bob RPC overwrite");
    const response = await rest("rpc/save_family_tree", {
      token: bob.token,
      method: "POST",
      body: {
        p_tree_id: aliceTreeId,
        p_expected_revision: original.revision,
        p_title: overwrite.title,
        p_people: overwrite.people,
        p_tree_data: overwrite,
      },
    });

    expect(response.ok).toBe(false);
    expect([401, 403]).toContain(response.status);

    const finalRead = await rest(`family_trees?id=eq.${aliceTreeId}&select=title,revision`, {
      token: alice.token,
    });
    expect((await readJson(finalRead))[0]).toEqual(original);
  });
});

describe("recoverable family-tree deletion", () => {
  let alice;
  let bob;

  beforeAll(async () => {
    const stamp = crypto.randomUUID().slice(0, 8);
    [alice, bob] = await Promise.all([
      createUser(`trash-alice-${stamp}@fictional.invalid`),
      createUser(`trash-bob-${stamp}@fictional.invalid`),
    ]);
  }, 60_000);

  afterAll(async () => {
    for (const user of [alice, bob]) {
      if (user?.id) await admin(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" });
    }
  });

  it("trashes, isolates, restores and explicitly deletes without changing entitlements", async () => {
    const treeId = crypto.randomUUID();
    const payload = strictTreePayload(treeId, "Recoverable fictional estate");
    const createdResponse = await rest("family_trees", {
      token: alice.token,
      method: "POST",
      prefer: "return=representation",
      body: {
        id: treeId,
        owner_id: alice.id,
        title: payload.title,
        people: payload.people,
        tree_data: payload,
      },
    });
    const [created] = await readJson(createdResponse);
    expect(createdResponse.status).toBe(201);

    const accountPath =
      `tree_accounts?user_id=eq.${alice.id}` +
      "&select=free_trees_used,paid_tree_credits,total_trees_created";
    const accountAfterCreate = await rest(accountPath, { token: alice.token });
    const entitlementSnapshot = await readJson(accountAfterCreate);

    const directDelete = await rest(`family_trees?id=eq.${treeId}`, {
      token: alice.token,
      method: "DELETE",
      prefer: "return=representation",
    });
    expect(directDelete.ok).toBe(false);
    expect([401, 403]).toContain(directDelete.status);

    const trashedResponse = await rest("rpc/trash_family_tree", {
      token: alice.token,
      method: "POST",
      body: { p_tree_id: treeId, p_expected_revision: created.revision },
    });
    const [trashed] = await readJson(trashedResponse);
    expect(trashedResponse.status).toBe(200);
    expect(trashed).toMatchObject({ id: treeId, revision: created.revision + 1 });
    expect(trashed.deleted_at).toEqual(expect.any(String));

    const trashWhileAlreadyTrashed = await rest("rpc/trash_family_tree", {
      token: alice.token,
      method: "POST",
      body: { p_tree_id: treeId, p_expected_revision: trashed.revision },
    });
    expect(trashWhileAlreadyTrashed.status).toBe(409);
    expect(await readJson(trashWhileAlreadyTrashed)).toMatchObject({
      code: "PT409",
      message: "TREE_TRASH_CONFLICT",
    });

    const [aliceActive, bobActive, aliceTrash, bobTrash] = await Promise.all([
      rest(`family_trees?id=eq.${treeId}&select=id`, { token: alice.token }),
      rest(`family_trees?id=eq.${treeId}&select=id`, { token: bob.token }),
      rest("rpc/list_trashed_family_trees", { token: alice.token, method: "POST", body: {} }),
      rest("rpc/list_trashed_family_trees", { token: bob.token, method: "POST", body: {} }),
    ]);
    expect(await readJson(aliceActive)).toEqual([]);
    expect(await readJson(bobActive)).toEqual([]);
    expect(await readJson(aliceTrash)).toEqual([
      expect.objectContaining({ id: treeId, revision: trashed.revision }),
    ]);
    expect(await readJson(bobTrash)).toEqual([]);

    const hiddenSave = strictTreePayload(treeId, "Invisible edit must fail");
    const saveWhileTrashed = await rest("rpc/save_family_tree", {
      token: alice.token,
      method: "POST",
      body: {
        p_tree_id: treeId,
        p_expected_revision: trashed.revision,
        p_title: hiddenSave.title,
        p_people: hiddenSave.people,
        p_tree_data: hiddenSave,
      },
    });
    expect(saveWhileTrashed.status).toBe(409);
    expect(await readJson(saveWhileTrashed)).toMatchObject({
      code: "PT409",
      message: "TREE_SAVE_CONFLICT",
    });

    const crossOwner = await rest("rpc/trash_family_tree", {
      token: bob.token,
      method: "POST",
      body: { p_tree_id: treeId, p_expected_revision: trashed.revision },
    });
    const missing = await rest("rpc/trash_family_tree", {
      token: bob.token,
      method: "POST",
      body: { p_tree_id: crypto.randomUUID(), p_expected_revision: trashed.revision },
    });
    expect(crossOwner.ok).toBe(false);
    expect(await readJson(crossOwner)).toMatchObject({
      code: "42501",
      message: "TREE_TRASH_FORBIDDEN",
    });
    expect(await readJson(missing)).toMatchObject({
      code: "42501",
      message: "TREE_TRASH_FORBIDDEN",
    });

    const crossRestore = await rest("rpc/restore_family_tree", {
      token: bob.token,
      method: "POST",
      body: { p_tree_id: treeId, p_expected_revision: trashed.revision },
    });
    const missingRestore = await rest("rpc/restore_family_tree", {
      token: bob.token,
      method: "POST",
      body: { p_tree_id: crypto.randomUUID(), p_expected_revision: trashed.revision },
    });
    expect(await readJson(crossRestore)).toMatchObject({
      code: "42501",
      message: "TREE_RESTORE_FORBIDDEN",
    });
    expect(await readJson(missingRestore)).toMatchObject({
      code: "42501",
      message: "TREE_RESTORE_FORBIDDEN",
    });

    const staleRestore = await rest("rpc/restore_family_tree", {
      token: alice.token,
      method: "POST",
      body: { p_tree_id: treeId, p_expected_revision: created.revision },
    });
    expect(staleRestore.status).toBe(409);
    expect(await readJson(staleRestore)).toMatchObject({
      code: "PT409",
      message: "TREE_RESTORE_CONFLICT",
    });

    const restoredResponse = await rest("rpc/restore_family_tree", {
      token: alice.token,
      method: "POST",
      body: { p_tree_id: treeId, p_expected_revision: trashed.revision },
    });
    const [restored] = await readJson(restoredResponse);
    expect(restoredResponse.status).toBe(200);
    expect(restored).toMatchObject({
      id: treeId,
      revision: trashed.revision + 1,
      deleted_at: null,
    });

    const restoreWhileActive = await rest("rpc/restore_family_tree", {
      token: alice.token,
      method: "POST",
      body: { p_tree_id: treeId, p_expected_revision: restored.revision },
    });
    expect(restoreWhileActive.status).toBe(409);
    expect(await readJson(restoreWhileActive)).toMatchObject({
      code: "PT409",
      message: "TREE_RESTORE_CONFLICT",
    });

    const deleteWhileActive = await rest("rpc/permanently_delete_family_tree", {
      token: alice.token,
      method: "POST",
      body: { p_tree_id: treeId, p_expected_revision: restored.revision },
    });
    expect(deleteWhileActive.status).toBe(409);
    expect(await readJson(deleteWhileActive)).toMatchObject({
      code: "PT409",
      message: "TREE_PERMANENT_DELETE_CONFLICT",
    });

    const secondTrashResponse = await rest("rpc/trash_family_tree", {
      token: alice.token,
      method: "POST",
      body: { p_tree_id: treeId, p_expected_revision: restored.revision },
    });
    const [secondTrash] = await readJson(secondTrashResponse);
    expect(secondTrashResponse.status).toBe(200);

    const crossPermanentDelete = await rest("rpc/permanently_delete_family_tree", {
      token: bob.token,
      method: "POST",
      body: { p_tree_id: treeId, p_expected_revision: secondTrash.revision },
    });
    const missingPermanentDelete = await rest("rpc/permanently_delete_family_tree", {
      token: bob.token,
      method: "POST",
      body: { p_tree_id: crypto.randomUUID(), p_expected_revision: secondTrash.revision },
    });
    expect(await readJson(crossPermanentDelete)).toMatchObject({
      code: "42501",
      message: "TREE_PERMANENT_DELETE_FORBIDDEN",
    });
    expect(await readJson(missingPermanentDelete)).toMatchObject({
      code: "42501",
      message: "TREE_PERMANENT_DELETE_FORBIDDEN",
    });

    const stalePermanentDelete = await rest("rpc/permanently_delete_family_tree", {
      token: alice.token,
      method: "POST",
      body: { p_tree_id: treeId, p_expected_revision: restored.revision },
    });
    expect(stalePermanentDelete.status).toBe(409);

    const permanentDelete = await rest("rpc/permanently_delete_family_tree", {
      token: alice.token,
      method: "POST",
      body: { p_tree_id: treeId, p_expected_revision: secondTrash.revision },
    });
    expect(permanentDelete.status).toBe(200);
    expect(await readJson(permanentDelete)).toBe(treeId);

    const [activeAfterDelete, trashAfterDelete, accountAfterDelete, generationAfterDelete] =
      await Promise.all([
        rest(`family_trees?id=eq.${treeId}&select=id`, { token: alice.token }),
        rest("rpc/list_trashed_family_trees", {
          token: alice.token,
          method: "POST",
          body: {},
        }),
        rest(accountPath, { token: alice.token }),
        rest(`tree_generations?owner_id=eq.${alice.id}&tree_id=is.null&select=tree_id,tree_title`, {
          token: alice.token,
        }),
      ]);
    expect(await readJson(activeAfterDelete)).toEqual([]);
    expect(await readJson(trashAfterDelete)).toEqual([]);
    expect(await readJson(accountAfterDelete)).toEqual(entitlementSnapshot);
    expect(await readJson(generationAfterDelete)).toContainEqual({
      tree_id: null,
      tree_title: payload.title,
    });
  });

  it("lists expired trash but refuses to restore it after 30 days", async () => {
    const treeId = crypto.randomUUID();
    const payload = strictTreePayload(treeId, "Expired fictional trash");
    const createdResponse = await rest("family_trees", {
      token: alice.token,
      method: "POST",
      prefer: "return=representation",
      body: {
        id: treeId,
        owner_id: alice.id,
        title: payload.title,
        people: payload.people,
        tree_data: payload,
      },
    });
    const [created] = await readJson(createdResponse);
    expect(createdResponse.status).toBe(201);

    const trashedResponse = await rest("rpc/trash_family_tree", {
      token: alice.token,
      method: "POST",
      body: { p_tree_id: treeId, p_expected_revision: created.revision },
    });
    expect(trashedResponse.status).toBe(200);

    const expiredAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const agedRevision = ageTrashedFamilyTree(treeId, expiredAt);

    const listedResponse = await rest("rpc/list_trashed_family_trees", {
      token: alice.token,
      method: "POST",
      body: {},
    });
    expect(await readJson(listedResponse)).toContainEqual(
      expect.objectContaining({ id: treeId, revision: agedRevision }),
    );

    const restoreResponse = await rest("rpc/restore_family_tree", {
      token: alice.token,
      method: "POST",
      body: { p_tree_id: treeId, p_expected_revision: agedRevision },
    });
    expect(restoreResponse.status).toBe(410);
    expect(await readJson(restoreResponse)).toMatchObject({
      code: "PT410",
      message: "TREE_RESTORE_EXPIRED",
    });

    const permanentDelete = await rest("rpc/permanently_delete_family_tree", {
      token: alice.token,
      method: "POST",
      body: { p_tree_id: treeId, p_expected_revision: agedRevision },
    });
    expect(permanentDelete.status).toBe(200);
  });
});

describe("unauthenticated and invalid credentials", () => {
  it("refuses an anonymous listing of trees", async () => {
    const response = await rest("family_trees?select=id,title");
    const body = await readJson(response);

    // Either refused outright or filtered to nothing; never a row.
    if (response.status === 200) expect(body).toEqual([]);
    else expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses a forged bearer token", async () => {
    const response = await rest("family_trees?select=id", { token: "not.a.real.token" });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses a structurally valid token with a bogus signature", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ role: "service_role", exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString("base64url");

    const response = await rest("family_trees?select=id", {
      token: `${header}.${payload}.invalidsignature`,
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses a correctly signed but expired authentication token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signedLocalJwt({
      aud: "authenticated",
      exp: now - 60,
      iat: now - 3600,
      iss: `${url}/auth/v1`,
      role: "authenticated",
      sub: crypto.randomUUID(),
    });

    const response = await rest("family_trees?select=id", { token });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses anonymous invocation of the family-tree save RPC", async () => {
    const treeId = crypto.randomUUID();
    const anonymousPayload = strictTreePayload(treeId, "Anonymous overwrite");
    const response = await rest("rpc/save_family_tree", {
      method: "POST",
      body: {
        p_tree_id: treeId,
        p_expected_revision: 1,
        p_title: anonymousPayload.title,
        p_people: anonymousPayload.people,
        p_tree_data: anonymousPayload,
      },
    });

    expect(response.ok).toBe(false);
    expect([401, 403]).toContain(response.status);
  });

  it("refuses anonymous invocation of every Trash RPC", async () => {
    const treeId = crypto.randomUUID();
    const requests = [
      ["list_trashed_family_trees", {}],
      ["trash_family_tree", { p_tree_id: treeId, p_expected_revision: 1 }],
      ["restore_family_tree", { p_tree_id: treeId, p_expected_revision: 1 }],
      ["permanently_delete_family_tree", { p_tree_id: treeId, p_expected_revision: 1 }],
    ];

    for (const [rpcName, body] of requests) {
      const response = await rest(`rpc/${rpcName}`, { method: "POST", body });
      expect(response.ok).toBe(false);
      expect([401, 403]).toContain(response.status);
    }
  });
});

describe("entitlements are out of the browser's reach", () => {
  let carol;

  beforeAll(async () => {
    carol = await createUser(`carol-${crypto.randomUUID().slice(0, 8)}@fictional.invalid`);
  }, 60_000);

  afterAll(async () => {
    if (carol?.id) await admin(`/auth/v1/admin/users/${carol.id}`, { method: "DELETE" });
  });

  it("refuses a browser-created trashed row without consuming an entitlement", async () => {
    const accountPath =
      `tree_accounts?user_id=eq.${carol.id}` +
      "&select=user_id,free_trees_used,paid_tree_credits,total_trees_created";
    const before = await rest(accountPath, { token: carol.token });
    const originalAccount = await readJson(before);
    const treeId = crypto.randomUUID();
    const payload = strictTreePayload(treeId, "Forged trashed estate");

    const response = await rest("family_trees", {
      token: carol.token,
      method: "POST",
      prefer: "return=representation",
      body: {
        id: treeId,
        owner_id: carol.id,
        title: payload.title,
        people: payload.people,
        tree_data: payload,
        deleted_at: new Date().toISOString(),
      },
    });
    expect(response.ok).toBe(false);
    expect([401, 403]).toContain(response.status);

    const [after, trash] = await Promise.all([
      rest(accountPath, { token: carol.token }),
      rest("rpc/list_trashed_family_trees", {
        token: carol.token,
        method: "POST",
        body: {},
      }),
    ]);
    expect(await readJson(after)).toEqual(originalAccount);
    expect(await readJson(trash)).not.toContainEqual(expect.objectContaining({ id: treeId }));
  });

  it("rejects an invalid direct insert before consuming any entitlement", async () => {
    const accountPath =
      `tree_accounts?user_id=eq.${carol.id}` +
      "&select=user_id,free_trees_used,paid_tree_credits,total_trees_created";
    const before = await rest(accountPath, { token: carol.token });
    const originalAccount = await readJson(before);
    const treeId = crypto.randomUUID();
    const invalid = strictTreePayload(treeId, "Invalid fictional estate");
    invalid.people[0].fatherId = "missing-person";

    const response = await rest("family_trees", {
      token: carol.token,
      method: "POST",
      prefer: "return=representation",
      body: {
        id: treeId,
        owner_id: carol.id,
        title: invalid.title,
        people: invalid.people,
        tree_data: invalid,
      },
    });
    const failure = await readJson(response);

    expect(response.status).toBe(422);
    expect(failure).toMatchObject({
      code: "PT422",
      message: "TREE_PAYLOAD_INVALID",
      details: "TREE_RELATIONSHIP_REFERENCE_INVALID",
    });

    const [after, tree] = await Promise.all([
      rest(accountPath, { token: carol.token }),
      rest(`family_trees?id=eq.${treeId}&select=id`, { token: carol.token }),
    ]);
    expect(await readJson(after)).toEqual(originalAccount);
    expect(await readJson(tree)).toEqual([]);
  });

  it("rejects whitespace-only optional references instead of treating them as blank", async () => {
    const cases = [
      {
        title: "Whitespace parent reference",
        mutate: (tree) => {
          tree.people[0].fatherId = "   ";
        },
        details: "TREE_RELATIONSHIP_REFERENCE_INVALID",
      },
      {
        title: "Whitespace group-root reference",
        mutate: (tree) => {
          tree.familyGroups[0].rootPersonId = "   ";
        },
        details: "TREE_FAMILY_GROUP_REFERENCE_INVALID",
      },
    ];

    for (const testCase of cases) {
      const treeId = crypto.randomUUID();
      const invalid = strictTreePayload(treeId, testCase.title);
      testCase.mutate(invalid);
      const response = await rest("family_trees", {
        token: carol.token,
        method: "POST",
        prefer: "return=representation",
        body: {
          id: treeId,
          owner_id: carol.id,
          title: invalid.title,
          people: invalid.people,
          tree_data: invalid,
        },
      });
      const failure = await readJson(response);

      expect(response.status).toBe(422);
      expect(failure).toMatchObject({
        code: "PT422",
        message: "TREE_PAYLOAD_INVALID",
        details: testCase.details,
      });
      const tree = await rest(`family_trees?id=eq.${treeId}&select=id`, { token: carol.token });
      expect(await readJson(tree)).toEqual([]);
    }
  });

  it("returns a stable payload-too-large error without persisting the rejected tree", async () => {
    const treeId = crypto.randomUUID();
    const oversized = strictTreePayload(treeId, "Oversized fictional estate");
    oversized.people[0].notes = "x".repeat(50_001);

    const response = await rest("family_trees", {
      token: carol.token,
      method: "POST",
      prefer: "return=representation",
      body: {
        id: treeId,
        owner_id: carol.id,
        title: oversized.title,
        people: oversized.people,
        tree_data: oversized,
      },
    });
    const failure = await readJson(response);

    expect(response.status).toBe(413);
    expect(failure).toMatchObject({
      code: "PT413",
      message: "TREE_PAYLOAD_TOO_LARGE",
      details: "TREE_JSON_STRING_LIMIT_EXCEEDED",
    });
    expect(JSON.stringify(failure)).not.toContain(oversized.title);

    const tree = await rest(`family_trees?id=eq.${treeId}&select=id`, { token: carol.token });
    expect(await readJson(tree)).toEqual([]);
  });

  it("refuses an attempt to grant unlimited trees", async () => {
    const response = await rest(`tree_accounts?user_id=eq.${carol.id}`, {
      token: carol.token,
      method: "PATCH",
      prefer: "return=representation",
      body: { unlimited_trees: true },
    });

    expect(response.ok).toBe(false);
    expect([401, 403]).toContain(response.status);
  });

  it("refuses an attempt to award paid credits", async () => {
    const response = await rest(`tree_accounts?user_id=eq.${carol.id}`, {
      token: carol.token,
      method: "PATCH",
      body: { paid_tree_credits: 99 },
    });

    expect(response.ok).toBe(false);
  });

  it("refuses an attempt to insert a paid order", async () => {
    const response = await rest("tree_credit_orders", {
      token: carol.token,
      method: "POST",
      body: { user_id: carol.id, status: "paid" },
    });

    expect(response.ok).toBe(false);
  });

  it("refuses an attempt to write a tree generation directly", async () => {
    const response = await rest("tree_generations", {
      token: carol.token,
      method: "POST",
      body: { owner_id: carol.id, entitlement_source: "admin", tree_title: "Free tree" },
    });

    expect(response.ok).toBe(false);
  });

  it("keeps the Stripe idempotency ledger completely unreachable", async () => {
    const read = await rest("stripe_tree_events?select=event_id", { token: carol.token });
    const write = await rest("stripe_tree_events", {
      token: carol.token,
      method: "POST",
      body: { event_id: "evt_forged", event_type: "checkout.session.completed" },
    });

    expect(read.ok).toBe(false);
    expect(write.ok).toBe(false);
  });

  it("lets an account read only its own allowance row", async () => {
    const response = await rest("tree_accounts?select=user_id", { token: carol.token });
    const rows = await readJson(response);

    expect(response.status).toBe(200);
    rows.forEach((row) => expect(row.user_id).toBe(carol.id));
  });
});

describe("terms acceptance is append-only", () => {
  let dave;

  beforeAll(async () => {
    dave = await createUser(`dave-${crypto.randomUUID().slice(0, 8)}@fictional.invalid`);
    await rest("terms_acceptances", {
      token: dave.token,
      method: "POST",
      body: { user_id: dave.id, version: "test-version" },
    });
  }, 60_000);

  afterAll(async () => {
    if (dave?.id) await admin(`/auth/v1/admin/users/${dave.id}`, { method: "DELETE" });
  });

  it("refuses to let a user rewrite their own acceptance record", async () => {
    const response = await rest(`terms_acceptances?user_id=eq.${dave.id}`, {
      token: dave.token,
      method: "PATCH",
      body: { version: "rewritten" },
    });

    expect(response.ok).toBe(false);
  });

  it("refuses to let a user delete their own acceptance record", async () => {
    const response = await rest(`terms_acceptances?user_id=eq.${dave.id}`, {
      token: dave.token,
      method: "DELETE",
    });

    expect(response.ok).toBe(false);
  });
});

describe("platform administration and anonymous site feedback", () => {
  let operator;
  let account;
  let concurrentAccount;

  beforeAll(async () => {
    const stamp = crypto.randomUUID().slice(0, 8);
    [operator, account, concurrentAccount] = await Promise.all([
      createUser(`platform-operator-${stamp}@fictional.invalid`),
      createUser(`platform-account-${stamp}@fictional.invalid`),
      createUser(`platform-concurrent-${stamp}@fictional.invalid`),
    ]);

    // The real migration ran before these disposable users existed. Move the
    // operator fixture before the recorded rollout instant and execute the
    // actual idempotent repair migration to prove its one-time backfill.
    localSql(
      `
        delete from public.tree_accounts where user_id = :'operator_id'::uuid;
        update auth.users
        set created_at = timestamptz '2026-08-03 12:00:00+00'
        where id in (:'operator_id'::uuid, :'concurrent_id'::uuid);

        insert into public.tree_accounts (
          user_id,
          free_tree_limit,
          free_trees_used,
          paid_tree_credits,
          total_trees_created,
          unlimited_trees
        )
        values (:'concurrent_id'::uuid, 3, 1, 2, 3, true)
        on conflict (user_id) do update
        set free_tree_limit = 3,
            free_trees_used = 1,
            paid_tree_credits = 2,
            total_trees_created = 3,
            unlimited_trees = true;
      `,
      { operator_id: operator.id, concurrent_id: concurrentAccount.id },
    );
    localSql(adminRepairMigration);
    localSql(
      `
        insert into public.platform_admins (user_id)
        values (:'operator_id'::uuid)
        on conflict (user_id) do nothing;
      `,
      { operator_id: operator.id },
    );
  }, 60_000);

  afterAll(async () => {
    for (const user of [operator, account, concurrentAccount]) {
      if (user?.id) await admin(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" });
    }
  });

  it("grandfathers a pre-rollout account that had no entitlement row", async () => {
    const response = await rest(
      `tree_accounts?select=free_tree_limit,free_trees_used,paid_tree_credits,total_trees_created,unlimited_trees&user_id=eq.${operator.id}`,
      { token: operator.token },
    );
    const rows = await readJson(response);

    expect(response.status).toBe(200);
    expect(rows).toEqual([
      {
        free_tree_limit: 5,
        free_trees_used: 0,
        paid_tree_credits: 0,
        total_trees_created: 0,
        unlimited_trees: false,
      },
    ]);
  });

  it("raises an existing pre-rollout limit to five without changing other entitlement state", async () => {
    const response = await rest(
      `tree_accounts?select=free_tree_limit,free_trees_used,paid_tree_credits,total_trees_created,unlimited_trees&user_id=eq.${concurrentAccount.id}`,
      { token: concurrentAccount.token },
    );
    const rows = await readJson(response);

    expect(response.status).toBe(200);
    expect(rows).toEqual([
      {
        free_tree_limit: 5,
        free_trees_used: 1,
        paid_tree_credits: 2,
        total_trees_created: 3,
        unlimited_trees: true,
      },
    ]);
  });

  it("does not touch an entitlement that is already grandfathered", () => {
    const before = localSql(
      `select updated_at::text from public.tree_accounts where user_id = :'operator_id'::uuid;`,
      { operator_id: operator.id },
    );

    localSql(adminRepairMigration);

    const after = localSql(
      `select updated_at::text from public.tree_accounts where user_id = :'operator_id'::uuid;`,
      { operator_id: operator.id },
    );
    expect(after).toBe(before);
  });

  it("executes the typed overview RPC for an admin and denies a normal account", async () => {
    const allowed = await rest("rpc/admin_platform_overview", {
      token: operator.token,
      method: "POST",
      body: {},
    });
    const rows = await readJson(allowed);
    const denied = await rest("rpc/admin_platform_overview", {
      token: account.token,
      method: "POST",
      body: {},
    });

    expect(allowed.status).toBe(200);
    expect(rows.find((row) => row.user_id === operator.id)).toMatchObject({
      email: operator.email,
      free_tree_limit: 5,
      free_trees_used: 0,
    });
    expect(rows.find((row) => row.user_id === account.id)).toMatchObject({
      email: account.email,
      free_tree_limit: 3,
      free_trees_used: 0,
    });
    expect(denied.ok).toBe(false);
  });

  it("grants credits exactly once per audited request and removes the old overload", async () => {
    const requestId = crypto.randomUUID();
    const request = {
      target_user: account.id,
      credits: 2,
      request_id: requestId,
    };
    const first = await rest("rpc/admin_grant_tree_credits", {
      token: operator.token,
      method: "POST",
      body: request,
    });
    const replay = await rest("rpc/admin_grant_tree_credits", {
      token: operator.token,
      method: "POST",
      body: request,
    });
    const collision = await rest("rpc/admin_grant_tree_credits", {
      token: operator.token,
      method: "POST",
      body: { ...request, credits: 3 },
    });
    const unauditedOverload = await rest("rpc/admin_grant_tree_credits", {
      token: operator.token,
      method: "POST",
      body: { target_user: account.id, credits: 1 },
    });
    const allowance = await rest(
      `tree_accounts?select=paid_tree_credits&user_id=eq.${account.id}`,
      { token: account.token },
    );

    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    expect(collision.ok).toBe(false);
    expect(unauditedOverload.ok).toBe(false);
    expect(await readJson(allowance)).toEqual([{ paid_tree_credits: 2 }]);
    expect(
      Number(
        localSql(
          `
            select count(*)
            from private.admin_entitlement_audit
            where request_id = :'request_id'::uuid
              and actor_user_id = :'operator_id'::uuid
              and target_user_id = :'account_id'::uuid
              and operation = 'grant_tree_credits'
              and integer_value = 2;
          `,
          { request_id: requestId, operator_id: operator.id, account_id: account.id },
        ),
      ),
    ).toBe(1);
  });

  it("bounds credit grants and denies entitlement mutations by a non-admin", async () => {
    const oversized = await rest("rpc/admin_grant_tree_credits", {
      token: operator.token,
      method: "POST",
      body: { target_user: account.id, credits: 101, request_id: crypto.randomUUID() },
    });
    const denied = await rest("rpc/admin_grant_tree_credits", {
      token: account.token,
      method: "POST",
      body: { target_user: account.id, credits: 1, request_id: crypto.randomUUID() },
    });
    const allowance = await rest(
      `tree_accounts?select=paid_tree_credits&user_id=eq.${account.id}`,
      { token: account.token },
    );

    expect(oversized.ok).toBe(false);
    expect(denied.ok).toBe(false);
    expect(await readJson(allowance)).toEqual([{ paid_tree_credits: 2 }]);
  });

  it("sets unlimited access idempotently and records an immutable audit row", async () => {
    const requestId = crypto.randomUUID();
    const request = {
      target_user: account.id,
      enabled: true,
      request_id: requestId,
    };
    const first = await rest("rpc/admin_set_unlimited_trees", {
      token: operator.token,
      method: "POST",
      body: request,
    });
    const replay = await rest("rpc/admin_set_unlimited_trees", {
      token: operator.token,
      method: "POST",
      body: request,
    });
    const collision = await rest("rpc/admin_set_unlimited_trees", {
      token: operator.token,
      method: "POST",
      body: { ...request, enabled: false },
    });
    const allowance = await rest(`tree_accounts?select=unlimited_trees&user_id=eq.${account.id}`, {
      token: account.token,
    });

    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    expect(collision.ok).toBe(false);
    expect(await readJson(allowance)).toEqual([{ unlimited_trees: true }]);
    expect(() =>
      localSql(
        `
          update private.admin_entitlement_audit
          set boolean_value = false
          where request_id = :'request_id'::uuid;
        `,
        { request_id: requestId },
      ),
    ).toThrow();
  });

  it("stores anonymous feedback, filters on the server, and denies inbox access", async () => {
    const marker = crypto.randomUUID();
    const submitted = await rest("rpc/submit_site_feedback", {
      token: account.token,
      method: "POST",
      body: { feedback_kind: "suggestion", feedback_message: `Suggestion ${marker}` },
    });
    const handledId = crypto.randomUUID();
    localSql(
      `
        insert into public.site_feedback (id, kind, message, handled_at)
        values (
          :'handled_id'::uuid,
          'bug',
          'Already handled regression fixture',
          now()
        );
      `,
      { handled_id: handledId },
    );
    const openOnly = await rest("rpc/list_site_feedback", {
      token: operator.token,
      method: "POST",
      body: { include_handled: false },
    });
    const openRows = await readJson(openOnly);
    const denied = await rest("rpc/list_site_feedback", {
      token: account.token,
      method: "POST",
      body: { include_handled: true },
    });

    expect(submitted.ok).toBe(true);
    expect(openOnly.status).toBe(200);
    expect(openRows.some((row) => row.message === `Suggestion ${marker}`)).toBe(true);
    expect(openRows.some((row) => row.id === handledId)).toBe(false);
    expect(denied.ok).toBe(false);
    expect(
      localSql(
        `
          select count(*)
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'site_feedback'
            and column_name in ('user_id', 'owner_id', 'email');
        `,
      ),
    ).toBe("0");
    expect(
      localSql(
        `
          select count(*)
          from information_schema.columns
          where table_schema = 'private'
            and table_name = 'site_feedback_rate_limits'
            and column_name = 'updated_at';
        `,
      ),
    ).toBe("0");
  });

  it("enforces the feedback cap atomically per account", async () => {
    localSql(
      `
        insert into private.site_feedback_rate_limits (
          user_id,
          hour_bucket,
          message_count
        ) values (
          :'account_id'::uuid,
          date_trunc('hour', now()),
          19
        )
        on conflict (user_id, hour_bucket) do update
        set message_count = 19;
      `,
      { account_id: account.id },
    );

    const marker = crypto.randomUUID();
    const responses = await Promise.all([
      rest("rpc/submit_site_feedback", {
        token: account.token,
        method: "POST",
        body: { feedback_kind: "bug", feedback_message: `Concurrent A ${marker}` },
      }),
      rest("rpc/submit_site_feedback", {
        token: account.token,
        method: "POST",
        body: { feedback_kind: "bug", feedback_message: `Concurrent B ${marker}` },
      }),
    ]);

    expect(responses.filter((response) => response.ok)).toHaveLength(1);
    expect(responses.filter((response) => !response.ok)).toHaveLength(1);
    expect(
      localSql(
        `
          select message_count
          from private.site_feedback_rate_limits
          where user_id = :'account_id'::uuid
            and hour_bucket = date_trunc('hour', now());
        `,
        { account_id: account.id },
      ),
    ).toBe("20");
  });

  it("purges feedback after 24 months and stale rate buckets after 24 hours", async () => {
    const expiredId = crypto.randomUUID();
    localSql(
      `
        insert into public.site_feedback (id, kind, message, created_at)
        values (
          :'expired_id'::uuid,
          'bug',
          'Expired retention regression fixture',
          now() - interval '25 months'
        );
        insert into private.site_feedback_rate_limits (
          user_id,
          hour_bucket,
          message_count
        ) values (
          :'operator_id'::uuid,
          date_trunc('hour', now()) - interval '48 hours',
          1
        )
        on conflict (user_id, hour_bucket) do update
        set message_count = 1;
        insert into private.site_feedback_rate_limits (
          user_id,
          hour_bucket,
          message_count
        ) values (
          :'operator_id'::uuid,
          date_trunc('hour', now()) - interval '24 hours',
          1
        )
        on conflict (user_id, hour_bucket) do update
        set message_count = 1;
      `,
      { expired_id: expiredId, operator_id: operator.id },
    );
    const listed = await rest("rpc/list_site_feedback", {
      token: operator.token,
      method: "POST",
      body: { include_handled: true },
    });
    const submitted = await rest("rpc/submit_site_feedback", {
      token: operator.token,
      method: "POST",
      body: { feedback_kind: "suggestion", feedback_message: "Retention cleanup trigger" },
    });

    expect(listed.status).toBe(200);
    expect((await readJson(listed)).some((row) => row.id === expiredId)).toBe(false);
    expect(submitted.ok).toBe(true);
    expect(
      localSql(
        `
          select
            (select count(*) from public.site_feedback where id = :'expired_id'::uuid),
            (
              select count(*)
              from private.site_feedback_rate_limits
              where user_id = :'operator_id'::uuid
                and hour_bucket <= date_trunc('hour', now()) - interval '24 hours'
            );
        `,
        { expired_id: expiredId, operator_id: operator.id },
      ),
    ).toBe("0|0");
  });
});
