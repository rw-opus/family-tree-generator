import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";

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

if (!url || !anonKey || !serviceRoleKey || !jwtSecret) {
  throw new Error(
    "RLS tests need SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY " +
      "and SUPABASE_JWT_SECRET. " +
      "Start a local stack with `npx supabase start` and export them, or run this in CI.",
  );
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
    expect(await readJson(response)).toEqual([]);

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
});

describe("entitlements are out of the browser's reach", () => {
  let carol;

  beforeAll(async () => {
    carol = await createUser(`carol-${crypto.randomUUID().slice(0, 8)}@fictional.invalid`);
  }, 60_000);

  afterAll(async () => {
    if (carol?.id) await admin(`/auth/v1/admin/users/${carol.id}`, { method: "DELETE" });
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
