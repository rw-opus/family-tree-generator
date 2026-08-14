import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { SYNTHETIC_SOURCE_KIND, assertLocalDatabaseUrl, verifyBackupManifest } from "./evidence.js";

const PUBLIC_TABLES = [
  "family_trees",
  "stripe_tree_events",
  "terms_acceptances",
  "tree_accounts",
  "tree_credit_orders",
  "tree_generations",
];

const execFileAsync = promisify(execFile);

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function localApiUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("The synthetic fixture may only use a local Supabase API.");
  }
  return url.origin;
}

function configuration() {
  return {
    url: localApiUrl(requiredEnvironment("SUPABASE_URL")),
    anonKey: requiredEnvironment("SUPABASE_ANON_KEY"),
    serviceRoleKey: requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
    databaseUrl: assertLocalDatabaseUrl(requiredEnvironment("SUPABASE_DB_URL"), "SUPABASE_DB_URL")
      .href,
  };
}

async function requestJson(url, init, label) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return { body, response };
}

function adminHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
}

function userHeaders(anonKey, token) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function createUser(config, email, password) {
  const { body } = await requestJson(
    `${config.url}/auth/v1/admin/users`,
    {
      method: "POST",
      headers: adminHeaders(config.serviceRoleKey),
      body: JSON.stringify({ email, password, email_confirm: true }),
    },
    `Create ${email}`,
  );
  return { id: body.id, email, password };
}

async function signIn(config, user) {
  const { body } = await requestJson(
    `${config.url}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: config.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, password: user.password }),
    },
    `Sign in ${user.email}`,
  );
  if (body.user?.id !== user.id || !body.access_token) {
    throw new Error(`Authentication returned the wrong identity for ${user.email}.`);
  }
  return body.access_token;
}

function strictTreePayload(treeId, title, personId) {
  const familyGroupId = `${treeId}:group:1`;
  const propertyId = `${treeId}:property:1`;
  return {
    tree_schema_version: 2,
    schemaVersion: 2,
    id: treeId,
    title,
    people: [{ id: personId }],
    familyGroups: [
      {
        id: familyGroupId,
        rootPersonId: personId,
        personIds: [personId],
      },
    ],
    activeFamilyGroupId: familyGroupId,
    outsideParties: [],
    properties: [
      {
        id: propertyId,
        owners: [],
        transfers: [],
        declarations: [],
        saleLots: [],
      },
    ],
    settings: { activePropertyId: propertyId },
  };
}

async function createTree(config, user, token, title) {
  const treeId = crypto.randomUUID();
  const tree = strictTreePayload(treeId, title, `${treeId}:person:1`);
  const { body } = await requestJson(
    `${config.url}/rest/v1/family_trees`,
    {
      method: "POST",
      headers: {
        ...userHeaders(config.anonKey, token),
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        id: treeId,
        owner_id: user.id,
        title,
        people: tree.people,
        tree_data: tree,
      }),
    },
    `Create tree for ${user.email}`,
  );
  if (!Array.isArray(body) || body.length !== 1) {
    throw new Error(`Tree creation returned an unexpected result for ${user.email}.`);
  }
  return treeId;
}

async function acceptTerms(config, user, token) {
  await requestJson(
    `${config.url}/rest/v1/terms_acceptances`,
    {
      method: "POST",
      headers: userHeaders(config.anonKey, token),
      body: JSON.stringify({ user_id: user.id, version: "synthetic-restore-drill-v1" }),
    },
    `Accept terms for ${user.email}`,
  );
}

export async function collectCounts(config = configuration()) {
  const pairs = [
    ["auth_users", "auth.users"],
    ...PUBLIC_TABLES.map((table) => [table, `public.${table}`]),
  ];
  const query = `select json_build_object(${pairs
    .map(([key, table]) => `'${key}', (select count(*) from ${table})`)
    .join(", ")})::text;`;
  const { stdout } = await execFileAsync(
    "psql",
    [config.databaseUrl, "--tuples-only", "--no-align", "--command", query],
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
  const counts = JSON.parse(stdout.trim());
  for (const [name, count] of Object.entries(counts)) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Synthetic database count ${name} is invalid.`);
    }
  }
  return counts;
}

async function assertEmptySource(config) {
  const counts = await collectCounts(config);
  for (const [name, count] of Object.entries(counts)) {
    if (count !== 0) throw new Error(`Synthetic source is not empty: ${name} has ${count} rows.`);
  }

  const { body: buckets } = await requestJson(
    `${config.url}/storage/v1/bucket`,
    { headers: adminHeaders(config.serviceRoleKey) },
    "List Storage buckets",
  );
  if (!Array.isArray(buckets) || buckets.length !== 0) {
    throw new Error(
      "Synthetic source must not contain Storage buckets; database dumps omit objects.",
    );
  }
}

export async function seedSyntheticSource(statePath) {
  const config = configuration();
  await assertEmptySource(config);
  const suffix = crypto.randomUUID().slice(0, 12);
  const alice = await createUser(
    config,
    `alice-backup-${suffix}@fictional.invalid`,
    `Fictional-Alice-${suffix}-9!`,
  );
  const bob = await createUser(
    config,
    `bob-backup-${suffix}@fictional.invalid`,
    `Fictional-Bob-${suffix}-9!`,
  );
  const [aliceToken, bobToken] = await Promise.all([signIn(config, alice), signIn(config, bob)]);
  const [aliceTreeId, bobTreeId] = await Promise.all([
    createTree(config, alice, aliceToken, "Alice synthetic restore estate"),
    createTree(config, bob, bobToken, "Bob synthetic restore estate"),
  ]);
  await Promise.all([acceptTerms(config, alice, aliceToken), acceptTerms(config, bob, bobToken)]);
  const counts = await collectCounts(config);
  const state = {
    format: "family-tree-generator-synthetic-restore-state",
    version: 1,
    sourceKind: SYNTHETIC_SOURCE_KIND,
    users: { alice, bob },
    trees: { alice: aliceTreeId, bob: bobTreeId },
    counts,
  };
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return state;
}

async function readState(statePath) {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  if (
    state.format !== "family-tree-generator-synthetic-restore-state" ||
    state.version !== 1 ||
    state.sourceKind !== SYNTHETIC_SOURCE_KIND
  ) {
    throw new Error("Synthetic restore state is invalid.");
  }
  return state;
}

async function rest(config, path, token, init = {}) {
  return requestJson(
    `${config.url}/rest/v1/${path}`,
    {
      ...init,
      headers: {
        ...userHeaders(config.anonKey, token),
        ...(init.headers || {}),
      },
    },
    `${init.method || "GET"} ${path}`,
  );
}

async function assertOwnAndCrossTenantReads(config, state, aliceToken, bobToken) {
  const { body: aliceOwn } = await rest(
    config,
    `family_trees?id=eq.${state.trees.alice}&select=id,title,revision,people,tree_data`,
    aliceToken,
  );
  const { body: bobOwn } = await rest(
    config,
    `family_trees?id=eq.${state.trees.bob}&select=id,title`,
    bobToken,
  );
  const { body: bobReadsAlice } = await rest(
    config,
    `family_trees?id=eq.${state.trees.alice}&select=id,title`,
    bobToken,
  );
  const { body: aliceReadsBob } = await rest(
    config,
    `family_trees?id=eq.${state.trees.bob}&select=id,title`,
    aliceToken,
  );
  if (aliceOwn.length !== 1 || bobOwn.length !== 1) {
    throw new Error("Restored users could not load their known trees.");
  }
  if (bobReadsAlice.length !== 0 || aliceReadsBob.length !== 0) {
    throw new Error("Cross-account RLS isolation failed after restore.");
  }
  return aliceOwn[0];
}

async function assertEntitlementAndTerms(config, state, aliceToken, bobToken) {
  const checks = await Promise.all([
    rest(
      config,
      `tree_accounts?user_id=eq.${state.users.alice.id}&select=user_id,free_trees_used,total_trees_created`,
      aliceToken,
    ),
    rest(config, `tree_accounts?user_id=eq.${state.users.alice.id}&select=user_id`, bobToken),
    rest(
      config,
      `terms_acceptances?user_id=eq.${state.users.alice.id}&select=user_id,version`,
      aliceToken,
    ),
    rest(
      config,
      `tree_generations?tree_id=eq.${state.trees.alice}&select=tree_id,owner_id,entitlement_source`,
      aliceToken,
    ),
  ]);
  const [aliceAccount, bobReadsAliceAccount, terms, generations] = checks.map(
    (result) => result.body,
  );
  if (
    aliceAccount.length !== 1 ||
    aliceAccount[0].free_trees_used !== 1 ||
    aliceAccount[0].total_trees_created !== 1 ||
    bobReadsAliceAccount.length !== 0 ||
    terms.length !== 1 ||
    terms[0].version !== "synthetic-restore-drill-v1" ||
    generations.length !== 1 ||
    generations[0].entitlement_source !== "free"
  ) {
    throw new Error("Restored entitlement or terms data did not match the synthetic fixture.");
  }
}

async function assertFunctions(config, state, aliceToken, aliceTree) {
  const updatedTree = structuredClone(aliceTree.tree_data);
  updatedTree.title = "Alice restored function check";
  const { body: saved } = await rest(config, "rpc/save_family_tree", aliceToken, {
    method: "POST",
    body: JSON.stringify({
      p_tree_id: state.trees.alice,
      p_expected_revision: aliceTree.revision,
      p_title: updatedTree.title,
      p_people: updatedTree.people,
      p_tree_data: updatedTree,
    }),
  });
  if (!Array.isArray(saved) || saved.length !== 1 || saved[0].revision !== aliceTree.revision + 1) {
    throw new Error("The restored save_family_tree function did not execute correctly.");
  }

  const { body: stripeResult } = await requestJson(
    `${config.url}/rest/v1/rpc/process_stripe_tree_event`,
    {
      method: "POST",
      headers: adminHeaders(config.serviceRoleKey),
      body: JSON.stringify({
        p_event_id: `evt_synthetic_restore_${crypto.randomUUID()}`,
        p_event_type: "synthetic.restore.check",
        p_order_id: null,
        p_user_id: null,
        p_checkout_session_id: null,
        p_payment_status: null,
        p_amount_total: null,
        p_currency: null,
        p_payment_intent_id: null,
        p_customer_id: null,
      }),
    },
    "Invoke restored Stripe event function",
  );
  if (stripeResult !== "ignored") {
    throw new Error("The restored Stripe event function returned an unexpected result.");
  }
}

async function assertApplicationHealth(config, appUrl) {
  if (!appUrl) return;
  const origin = new URL(appUrl).origin;
  const health = await requestJson(`${origin}/healthz`, {}, "Read restored application health");
  if (health.body?.status !== "ok" || !health.body?.commit) {
    throw new Error("Application health did not identify a built commit.");
  }
  const envResponse = await fetch(`${origin}/env.js`);
  const envScript = await envResponse.text();
  if (
    !envResponse.ok ||
    !envScript.includes(JSON.stringify(config.url)) ||
    !envScript.includes(JSON.stringify(config.anonKey)) ||
    envScript.includes(config.serviceRoleKey)
  ) {
    throw new Error("Application runtime configuration is not safely bound to the restored stack.");
  }
}

export async function verifySyntheticRestore({ statePath, manifestPath, dumpDirectory, appUrl }) {
  const config = configuration();
  const [state, manifest] = await Promise.all([
    readState(statePath),
    verifyBackupManifest({ dumpDirectory, manifestPath }),
  ]);
  const actualCounts = await collectCounts(config);
  if (JSON.stringify(actualCounts) !== JSON.stringify(manifest.counts)) {
    throw new Error("Restored aggregate counts do not match the encrypted backup manifest.");
  }
  if (JSON.stringify(state.counts) !== JSON.stringify(manifest.counts)) {
    throw new Error("Synthetic source state does not match the backup manifest.");
  }

  const [aliceToken, bobToken] = await Promise.all([
    signIn(config, state.users.alice),
    signIn(config, state.users.bob),
  ]);
  const aliceTree = await assertOwnAndCrossTenantReads(config, state, aliceToken, bobToken);
  await assertEntitlementAndTerms(config, state, aliceToken, bobToken);
  await assertFunctions(config, state, aliceToken, aliceTree);
  await assertApplicationHealth(config, appUrl);
}

async function run() {
  const [command, statePath, manifestPath, dumpDirectory, appUrl] = process.argv.slice(2);
  if (command === "seed") {
    if (!statePath) throw new Error("A state output path is required.");
    await seedSyntheticSource(statePath);
    return;
  }
  if (command === "verify") {
    if (!statePath || !manifestPath || !dumpDirectory) {
      throw new Error("State, manifest and extracted dump paths are required.");
    }
    await verifySyntheticRestore({ statePath, manifestPath, dumpDirectory, appUrl });
    return;
  }
  throw new Error("Use the seed or verify command.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(`synthetic-fixture.js: ${error.message}`);
    process.exitCode = 1;
  });
}
