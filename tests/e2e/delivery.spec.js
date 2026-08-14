import { test, expect } from "@playwright/test";

/**
 * Runs against `node server.mjs` serving the real production build. It asserts
 * what that layer owns and nothing else, so it needs no Supabase project.
 */
test.describe("production delivery", () => {
  test("reports the built commit on the health endpoint", async ({ request }) => {
    const response = await request.get("/healthz");
    const body = await response.json();

    expect(response.status()).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.commit).toMatch(/^[0-9a-f]{7,40}$/);
    expect(body.builtAt).toBeTruthy();
  });

  test("sends the security headers on the document", async ({ request }) => {
    const headers = (await request.get("/")).headers();

    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["strict-transport-security"]).toContain("max-age=");
  });

  test("compresses the bundle and varies on the encoding", async ({ request }) => {
    const compressed = await request.get("/", { headers: { "Accept-Encoding": "br" } });
    const identity = await request.get("/", { headers: { "Accept-Encoding": "identity" } });

    expect(compressed.headers()["content-encoding"]).toBe("br");
    expect(compressed.headers().vary).toBe("Accept-Encoding");
    expect(identity.headers()["content-encoding"]).toBeUndefined();
    expect(identity.headers().vary).toBe("Accept-Encoding");
  });

  test("caches fingerprinted assets immutably and the document not at all", async ({ request }) => {
    const html = await (await request.get("/")).text();
    const assetPath = html.match(/\/assets\/[A-Za-z0-9._-]+\.js/)?.[0];
    expect(assetPath, "the document should reference a fingerprinted asset").toBeTruthy();

    const asset = await request.get(assetPath);
    const document = await request.get("/");

    expect(asset.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(document.headers()["cache-control"]).toBe("no-cache");
  });

  test("keeps the runtime environment script uncached and free of secrets", async ({ request }) => {
    const response = await request.get("/env.js");
    const body = await response.text();

    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(body).toContain("window.__FAMILY_TREE_ENV__");
    // Only the four public values may ever reach the browser.
    expect(body).not.toMatch(/service_role|secret|STRIPE/i);
  });

  test("refuses writes and keeps the filesystem closed", async ({ request }) => {
    const written = await request.post("/");
    const traversal = await request.get("/../package.json");
    const missing = await request.get("/no-such-page");

    expect(written.status()).toBe(405);
    expect(traversal.status()).toBe(404);
    expect(missing.status()).toBe(404);
  });

  test("stops at the configuration screen rather than storing data locally", async ({ page }) => {
    // A production build must never silently fall back to browser storage. This
    // is the guarantee AppEntry makes; if it ever regressed, client data would
    // be written unencrypted to the device.
    await page.goto("/");
    await expect(page.getByText("Secure storage is not connected")).toBeVisible();
  });
});
