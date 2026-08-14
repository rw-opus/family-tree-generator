import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Opt-out for files that deliberately contain sample secrets for this scanner. */
export const ALLOW_FIXTURES_MARKER = "secret-scan:allow-fixtures";

/**
 * A3 — refuse to ship a secret.
 *
 * Two things are checked, and the second is the one that matters most: the
 * built bundle is what actually reaches a browser, so a key that leaks through
 * an import or a stray `VITE_` variable is caught there even if the source read
 * innocently.
 */

// Directories that either hold third-party code or are not shipped.
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "playwright-report",
  "test-results",
  "coverage",
]);

export const SECRET_PATTERNS = [
  {
    name: "Supabase service-role or secret key",
    // Supabase issues sb_secret_… and legacy service_role JWTs.
    pattern: /\bsb_secret_[A-Za-z0-9_-]{10,}/,
  },
  { name: "Stripe secret key", pattern: /\bsk_(live|test)_[A-Za-z0-9]{16,}/ },
  { name: "Stripe restricted key", pattern: /\brk_(live|test)_[A-Za-z0-9]{16,}/ },
  { name: "Stripe webhook signing secret", pattern: /\bwhsec_[A-Za-z0-9]{16,}/ },
  { name: "AWS access key id", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: "Private key block", pattern: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  {
    name: "Postgres connection string with a password",
    pattern: /postgres(ql)?:\/\/[^\s:@/]+:[^\s@/]+@/,
  },
];

/**
 * Names that must never be exposed to the browser through a VITE_ variable.
 * Vite inlines anything prefixed VITE_, so this is how a secret most plausibly
 * reaches production here.
 */
export const FORBIDDEN_BROWSER_VARIABLES =
  /\bVITE_[A-Z0-9_]*(SECRET|SERVICE_ROLE|SERVICE_KEY|PRIVATE|STRIPE_SECRET|WEBHOOK|PASSWORD|TOKEN)[A-Z0-9_]*/;

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".env",
  ".example",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".map",
  ".md",
  ".mjs",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

/**
 * A Supabase service_role key is a JWT whose role sits inside the base64
 * payload, so it cannot be matched by a pattern over the encoded text. Each
 * JWT-shaped token is decoded and its claims inspected instead.
 */
export function findPrivilegedJwt(content) {
  const tokens = content.match(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g) || [];
  for (const token of tokens) {
    try {
      const payload = Buffer.from(token.split(".")[1], "base64url").toString("utf8");
      const role = JSON.parse(payload)?.role;
      if (role && role !== "anon") return role;
    } catch {
      // Not a decodable JWT payload; the literal patterns still apply.
    }
  }
  return null;
}

export function findSecrets(content, { checkBrowserVariables = false } = {}) {
  const findings = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    const match = content.match(pattern);
    if (match) findings.push({ name, sample: match[0].slice(0, 12) });
  }
  const privilegedRole = findPrivilegedJwt(content);
  if (privilegedRole) {
    findings.push({ name: `Supabase JWT carrying the "${privilegedRole}" role`, sample: "" });
  }
  if (checkBrowserVariables) {
    const match = content.match(FORBIDDEN_BROWSER_VARIABLES);
    if (match) findings.push({ name: `Secret-shaped browser variable ${match[0]}`, sample: "" });
  }
  return findings;
}

async function* walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(entryPath);
    else if (entry.isFile()) yield entryPath;
  }
}

async function scanTree(directory, options) {
  const problems = [];
  for await (const filePath of walk(directory)) {
    const extension = path.extname(filePath).toLowerCase();
    // Read extensionless dotfiles such as .env too.
    if (extension && !TEXT_EXTENSIONS.has(extension)) continue;
    const info = await stat(filePath);
    if (info.size > 8 * 1024 * 1024) continue;

    const content = await readFile(filePath, "utf8");
    // A file may hold deliberate fixtures for this very scanner. The marker
    // must sit in the opening lines so it is impossible to miss in review.
    if (content.split("\n", 6).join("\n").includes(ALLOW_FIXTURES_MARKER)) continue;

    for (const finding of findSecrets(content, options)) {
      problems.push(`${path.relative(rootDirectory, filePath)}: ${finding.name}`);
    }
  }
  return problems;
}

async function main() {
  const source = await scanTree(rootDirectory, { checkBrowserVariables: true });

  const distributionDirectory = path.join(rootDirectory, "dist");
  let bundle = [];
  let bundleScanned = false;
  try {
    if ((await stat(distributionDirectory)).isDirectory()) {
      bundleScanned = true;
      bundle = await scanTree(distributionDirectory, { checkBrowserVariables: true });
    }
  } catch {
    // No build present; the source scan still runs.
  }

  const problems = [...new Set([...source, ...bundle])];
  if (problems.length) {
    console.error("Secret scan failed:");
    problems.forEach((problem) => console.error(`  - ${problem}`));
    process.exitCode = 1;
    return;
  }

  console.log(
    `Secret scan clean (source${bundleScanned ? " and built bundle" : "; no dist/ to scan"}).`,
  );
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) await main();
