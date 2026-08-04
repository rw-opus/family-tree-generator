import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const distributionDirectory = path.join(rootDirectory, "dist");
const fallbackFile = path.join(distributionDirectory, "index.html");
const notFoundFile = path.join(distributionDirectory, "404.html");
const serverErrorFile = path.join(distributionDirectory, "500.html");
const port = Number(process.env.PORT) || 4173;
const contentSecurityPolicy = [
  "base-uri 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io",
  "default-src 'self'",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'self' blob:",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "upgrade-insecure-requests",
  "worker-src 'self' blob:",
].join("; ");
const securityHeaders = {
  "Content-Security-Policy": contentSecurityPolicy,
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Origin-Agent-Cluster": "?1",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

// Written at build time by scripts/write-build-info.mjs, so /healthz can report the exact
// commit a running deployment is serving without needing git available at runtime.
let buildInfo = { commit: "unknown", builtAt: null };
try {
  buildInfo = JSON.parse(readFileSync(path.join(distributionDirectory, "build-info.json"), "utf8"));
} catch {
  // No build-info.json yet (e.g. dist/ hasn't been built). Defaults above apply.
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

function runtimeEnvScript() {
  const env = {
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || "",
    VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
    VITE_SENTRY_DSN: process.env.VITE_SENTRY_DSN || "",
    RELEASE_SHA: process.env.RAILWAY_GIT_COMMIT_SHA || buildInfo.commit || "",
  };
  return `window.__FAMILY_TREE_ENV__=${JSON.stringify(env).replace(/</g, "\\u003c")};`;
}

async function resolveFile(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  if (pathname === "/") return { filePath: fallbackFile, statusCode: 200 };

  const requestedPath = path.resolve(distributionDirectory, `.${pathname}`);
  const isInsideDistribution =
    requestedPath === distributionDirectory ||
    requestedPath.startsWith(`${distributionDirectory}${path.sep}`);

  if (!isInsideDistribution) return { filePath: notFoundFile, statusCode: 404 };

  try {
    const requestedStat = await stat(requestedPath);
    if (requestedStat.isFile()) return { filePath: requestedPath, statusCode: 200 };
  } catch {
    // This application has no pathname-based client routes. Password recovery and
    // checkout callbacks return to / using query strings or fragments.
  }

  return { filePath: notFoundFile, statusCode: 404 };
}

async function sendFile(response, requestMethod, filePath, statusCode) {
  const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  const cacheControl = filePath.includes(`${path.sep}assets${path.sep}`)
    ? "public, max-age=31536000, immutable"
    : "no-cache";

  response.writeHead(statusCode, {
    "Cache-Control": cacheControl,
    "Content-Type": contentType,
    ...securityHeaders,
  });

  if (requestMethod === "HEAD") {
    response.end();
    return;
  }

  await new Promise((resolve, reject) => {
    createReadStream(filePath).on("error", reject).on("end", resolve).pipe(response);
  });
}

export function createPropertySuccessionServer() {
  return createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD", ...securityHeaders });
      response.end("Method Not Allowed");
      return;
    }

    const { pathname } = new URL(request.url || "/", "http://localhost");
    if (pathname === "/healthz") {
      const body = JSON.stringify({ status: "ok", ...buildInfo });
      response.writeHead(200, {
        "Cache-Control": "no-cache",
        "Content-Type": "application/json; charset=utf-8",
        ...securityHeaders,
      });
      response.end(request.method === "HEAD" ? undefined : body);
      return;
    }
    if (pathname === "/env.js") {
      const body = runtimeEnvScript();
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "text/javascript; charset=utf-8",
        ...securityHeaders,
      });
      response.end(request.method === "HEAD" ? undefined : body);
      return;
    }

    try {
      const { filePath, statusCode } = await resolveFile(request.url || "/");
      await sendFile(response, request.method, filePath, statusCode);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof URIError) {
        response.writeHead(400, {
          "Content-Type": "text/plain; charset=utf-8",
          ...securityHeaders,
        });
        response.end("Bad Request");
        return;
      }
      try {
        await sendFile(response, request.method, serverErrorFile, 500);
      } catch {
        response.writeHead(500, {
          "Content-Type": "text/plain; charset=utf-8",
          ...securityHeaders,
        });
        response.end("Internal Server Error");
      }
    }
  });
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  createPropertySuccessionServer().listen(port, "0.0.0.0", () => {
    console.log(`Property Succession Calculator listening on port ${port}`);
  });
}
