// The samples below are invented, and exist so the scanner is proven to catch
// the real thing. Each is assembled from fragments at run time, so no complete
// secret-shaped literal sits in this file: a literal would be flagged by GitHub
// push protection, which cannot tell an invented key from a real one, and would
// block every push. It also means this file needs no scanner opt-out, so a real
// key pasted here later would still be caught.
import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_BROWSER_VARIABLES,
  MAX_REGULAR_FILE_BYTES,
  MAX_SENSITIVE_FILE_BYTES,
  SECRET_PATTERNS,
  findSecrets,
  isScannableTextFile,
  isSensitiveCredentialFile,
  shouldReadForSecretScan,
} from "../../scripts/scan-secrets.mjs";

/**
 * A3 — the scanner is only worth having if it actually catches the things that
 * would end a commercial launch, so each pattern is exercised against a
 * realistic sample and against text that must not trip it.
 */

const detects = (content) => findSecrets(content, { checkBrowserVariables: true }).length > 0;

/** Joins fragments so no complete secret-shaped literal exists in this file. */
const sample = (...fragments) => fragments.join("");

const STRIPE_LIVE_SECRET = sample("sk", "_", "live", "_", "51AbCdEfGhIjKlMnOpQrStUv");
const STRIPE_TEST_SECRET = sample("sk", "_", "test", "_", "51AbCdEfGhIjKlMnOpQrStUv");
const STRIPE_RESTRICTED = sample("rk", "_", "live", "_", "51AbCdEfGhIjKlMnOpQrStUv");
const STRIPE_WEBHOOK = sample("whsec", "_", "AbCdEfGhIjKlMnOpQrStUvWxYz01");
const STRIPE_PUBLISHABLE = sample("pk", "_", "live", "_", "51AbCdEfGhIjKlMnOpQrStUv");
const SUPABASE_SECRET = sample("sb", "_", "secret", "_", "ZmFrZUtleUZvclRlc3RzMTIzNDU2");
const AWS_KEY_ID = sample("AKIA", "IOSFODNN7EXAMPLE");
const GITHUB_TOKEN = sample("ghp", "_", "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789");
const GITHUB_FINE_GRAINED_TOKEN = sample(
  "github",
  "_pat_",
  "11AABBCCDDEEFF001122_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
);
const PRIVATE_KEY_HEADER = sample("-----BEGIN ", "RSA ", "PRIVATE KEY-----");
const POSTGRES_URL = sample("postgresql://postgres:", "hunter2", "@db.example.co:5432/postgres");
const BROWSER_SERVICE_ROLE_VARIABLE = sample("VITE", "_SUPABASE_", "SERVICE_ROLE", "_KEY");
const BROWSER_STRIPE_SECRET_VARIABLE = sample("VITE", "_STRIPE_", "SECRET", "_KEY");

describe("secret detection", () => {
  it.each([
    ["Supabase secret key", `const key = '${SUPABASE_SECRET}'`],
    ["Stripe live secret key", `STRIPE_SECRET_KEY=${STRIPE_LIVE_SECRET}`],
    ["Stripe test secret key", STRIPE_TEST_SECRET],
    ["Stripe restricted key", STRIPE_RESTRICTED],
    ["Stripe webhook secret", STRIPE_WEBHOOK],
    ["AWS access key id", AWS_KEY_ID],
    ["GitHub token", GITHUB_TOKEN],
    ["GitHub fine-grained token", GITHUB_FINE_GRAINED_TOKEN],
    ["private key block", PRIVATE_KEY_HEADER],
    ["Postgres URL with password", POSTGRES_URL],
  ])("catches a %s", (_label, content) => {
    expect(detects(content)).toBe(true);
  });

  it("catches a service_role JWT by decoding its claims, not by pattern", () => {
    const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
    expect(detects(`eyJhbGciOiJIUzI1NiJ9.${payload}.ZmFrZXNpZ25hdHVyZQ`)).toBe(true);
  });

  it("catches a secret-shaped browser variable, because Vite inlines those", () => {
    expect(detects(`import.meta.env.${BROWSER_SERVICE_ROLE_VARIABLE}`)).toBe(true);
    expect(detects(BROWSER_STRIPE_SECRET_VARIABLE)).toBe(true);
  });

  it.each([
    ["the publishable key the browser is meant to have", "VITE_SUPABASE_PUBLISHABLE_KEY"],
    ["the project URL", "VITE_SUPABASE_URL=https://abcd.supabase.co"],
    ["a Sentry DSN", "VITE_SENTRY_DSN=https://abc@o1.ingest.sentry.io/2"],
    ["a Stripe publishable key", STRIPE_PUBLISHABLE],
    ["prose about the service role", "Never expose the service role key in browser code."],
    ["a Postgres URL without a password", "postgresql://localhost:5432/postgres"],
    ["an ordinary anon JWT", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl"],
  ])("does not trip on %s", (_label, content) => {
    expect(detects(content)).toBe(false);
  });

  it("keeps every pattern anchored enough to avoid matching bare words", () => {
    const innocuous =
      "The secret is kept in Supabase Edge Function secrets, never in a VITE_ variable.";
    SECRET_PATTERNS.forEach(({ pattern }) => expect(pattern.test(innocuous)).toBe(false));
    expect(FORBIDDEN_BROWSER_VARIABLES.test(innocuous)).toBe(false);
  });

  it("reports every distinct secret it finds, not just the first", () => {
    const findings = findSecrets(`${STRIPE_LIVE_SECRET} and ${STRIPE_WEBHOOK}`);

    expect(findings).toHaveLength(2);
  });

  it.each([".env.production", ".env.local", "signing.pem", "deploy.key"])(
    "scans sensitive credential filename %s",
    (filePath) => {
      expect(isSensitiveCredentialFile(filePath)).toBe(true);
      expect(isScannableTextFile(filePath)).toBe(true);
    },
  );

  it("does not silently skip large recognized credential files", () => {
    const justOverRegularLimit = MAX_REGULAR_FILE_BYTES + 1;

    expect(shouldReadForSecretScan("notes.txt", justOverRegularLimit)).toBe(false);
    expect(shouldReadForSecretScan(".env.production", justOverRegularLimit)).toBe(true);
    expect(shouldReadForSecretScan("private.pem", justOverRegularLimit)).toBe(true);
    expect(shouldReadForSecretScan("private.key", MAX_SENSITIVE_FILE_BYTES + 1)).toBe(false);
  });
});
