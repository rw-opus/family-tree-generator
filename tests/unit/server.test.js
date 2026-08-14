import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { gunzipSync, brotliDecompressSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acceptedEncodings,
  createPropertySuccessionServer,
  shutdownGracefully,
} from "../../server.mjs";
import { shouldCompress, COMPRESSIBLE_EXTENSIONS } from "../../scripts/precompress.mjs";

const distributionUrl = new URL("../../dist/index.html", import.meta.url);
const hasBuild = existsSync(distributionUrl);

describe("Accept-Encoding parsing", () => {
  it("reads a plain list", () => {
    expect(acceptedEncodings("gzip, deflate, br")).toEqual(["gzip", "deflate", "br"]);
  });

  it("keeps weighted encodings and drops the ones refused with q=0", () => {
    expect(acceptedEncodings("br;q=1.0, gzip;q=0.8, identity;q=0")).toEqual(["br", "gzip"]);
  });

  it("treats a missing or empty header as no encoding support", () => {
    expect(acceptedEncodings("")).toEqual([]);
    expect(acceptedEncodings(undefined)).toEqual([]);
  });
});

describe("precompression selection", () => {
  it("compresses text formats above the packet-overhead threshold", () => {
    expect(shouldCompress("/dist/assets/index.js", 40_000)).toBe(true);
    expect(shouldCompress("/dist/assets/index.css", 40_000)).toBe(true);
    expect(shouldCompress("/dist/index.html", 40_000)).toBe(true);
  });

  it("leaves tiny files and already-compressed formats alone", () => {
    expect(shouldCompress("/dist/assets/index.js", 200)).toBe(false);
    expect(shouldCompress("/dist/logo.png", 400_000)).toBe(false);
    expect(shouldCompress("/dist/font.woff2", 400_000)).toBe(false);
    expect(COMPRESSIBLE_EXTENSIONS.has(".png")).toBe(false);
  });
});

describe.skipIf(!hasBuild)("static server", () => {
  let server;
  let origin;

  beforeAll(async () => {
    server = createPropertySuccessionServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await shutdownGracefully(server, { signal: "TEST" });
  });

  const fetchRaw = (path, headers = {}) =>
    fetch(`${origin}${path}`, { headers, redirect: "manual" });

  // fetch() decompresses transparently and inconsistently between encodings, so
  // the wire bytes are read with node:http to assert what the server really sent.
  const rawRequest = (path, headers = {}) =>
    new Promise((resolve, reject) => {
      const request = httpRequest(`${origin}${path}`, { headers }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
      });
      request.on("error", reject);
      request.end();
    });

  it("reports the built commit on the health endpoint", async () => {
    const response = await fetchRaw("/healthz");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.commit).toEqual(expect.any(String));
    expect(body.commit).not.toBe("");
  });

  it("serves brotli when the client accepts it", async () => {
    const response = await rawRequest("/index.html", { "Accept-Encoding": "br" });
    const source = await readFile(distributionUrl);

    expect(response.headers["content-encoding"]).toBe("br");
    expect(response.headers.vary).toBe("Accept-Encoding");
    expect(response.body.byteLength).toBeLessThan(source.byteLength);
    expect(brotliDecompressSync(response.body).toString()).toBe(source.toString());
  });

  it("falls back to gzip when brotli is not accepted", async () => {
    const response = await rawRequest("/index.html", { "Accept-Encoding": "gzip" });
    const source = await readFile(distributionUrl);

    expect(response.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(response.body).toString()).toBe(source.toString());
  });

  it("serves the identity body when no encoding is accepted, and still varies", async () => {
    const response = await rawRequest("/index.html", { "Accept-Encoding": "identity;q=0.5" });
    const source = await readFile(distributionUrl);

    expect(response.headers["content-encoding"]).toBeUndefined();
    // Without Vary a shared cache could hand this body to a brotli client.
    expect(response.headers.vary).toBe("Accept-Encoding");
    expect(response.body.toString()).toBe(source.toString());
  });

  it("keeps the security headers on a compressed response", async () => {
    const response = await fetchRaw("/index.html", { "Accept-Encoding": "br" });

    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("caches fingerprinted assets immutably and the entry document not at all", async () => {
    const html = await readFile(distributionUrl, "utf8");
    const assetPath = html.match(/\/assets\/[A-Za-z0-9._-]+\.js/)?.[0];
    expect(assetPath).toBeTruthy();

    const asset = await fetchRaw(assetPath, { "Accept-Encoding": "br" });
    const entry = await fetchRaw("/index.html");

    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(entry.headers.get("cache-control")).toBe("no-cache");
  });

  it("never serves the runtime environment script from a cache", async () => {
    const response = await fetchRaw("/env.js");

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain("window.__FAMILY_TREE_ENV__");
  });

  it("refuses writes and unknown paths without leaking the filesystem", async () => {
    const post = await fetch(`${origin}/`, { method: "POST" });
    const traversal = await fetchRaw("/../package.json");
    const missing = await fetchRaw("/nope");

    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
    expect(traversal.status).toBe(404);
    expect(missing.status).toBe(404);
  });

  it("answers HEAD without a body", async () => {
    const response = await fetch(`${origin}/index.html`, { method: "HEAD" });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });
});

describe.skipIf(!hasBuild)("graceful shutdown", () => {
  it("drains, resolves and releases the port", async () => {
    const server = createPropertySuccessionServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;

    // A request served immediately before the signal must still complete.
    const served = await fetch(`${origin}/healthz`);
    expect(served.status).toBe(200);

    await expect(shutdownGracefully(server, { signal: "TEST" })).resolves.toBeUndefined();
    expect(server.listening).toBe(false);
    // The port is released, so a later request cannot connect.
    await expect(fetch(`${origin}/healthz`)).rejects.toThrow();
  });

  it("does not keep the process alive on its force-exit timer", async () => {
    const server = createPropertySuccessionServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

    const before = process._getActiveHandles?.().length ?? 0;
    await shutdownGracefully(server, { signal: "TEST", timeoutMs: 60_000 });

    // An un-unref'd 60s timer here would hold the container open after a deploy.
    expect(process._getActiveHandles?.().length ?? 0).toBeLessThanOrEqual(before);
  });
});
