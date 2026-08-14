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

// Written beside each build output by scripts/precompress.mjs. Brotli is offered
// first: it is materially smaller than gzip on this bundle, and any client that
// advertises "br" supports it for static responses.
const encodingVariants = [
  { encoding: "br", extension: ".br" },
  { encoding: "gzip", extension: ".gz" },
];

export function acceptedEncodings(headerValue) {
  return String(headerValue || "")
    .split(",")
    .map((part) => {
      const [name, ...parameters] = part.trim().split(";");
      const quality = parameters
        .map((parameter) => parameter.trim())
        .find((parameter) => parameter.startsWith("q="));
      return { name: name.toLowerCase(), quality: quality ? Number(quality.slice(2)) : 1 };
    })
    .filter((entry) => entry.name && Number.isFinite(entry.quality) && entry.quality > 0)
    .map((entry) => entry.name);
}

async function resolveEncodedVariant(filePath, acceptEncodingHeader) {
  const accepted = acceptedEncodings(acceptEncodingHeader);
  if (!accepted.length) return null;
  for (const variant of encodingVariants) {
    if (!accepted.includes(variant.encoding)) continue;
    const candidate = `${filePath}${variant.extension}`;
    try {
      if ((await stat(candidate)).isFile()) return { ...variant, filePath: candidate };
    } catch {
      // No precompressed sibling for this file; try the next encoding.
    }
  }
  return null;
}

async function sendFile(response, requestMethod, filePath, statusCode, acceptEncodingHeader = "") {
  const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  const cacheControl = filePath.includes(`${path.sep}assets${path.sep}`)
    ? "public, max-age=31536000, immutable"
    : "no-cache";

  const variant = await resolveEncodedVariant(filePath, acceptEncodingHeader);

  response.writeHead(statusCode, {
    "Cache-Control": cacheControl,
    "Content-Type": contentType,
    // Declared even on an identity response: a shared cache must never hand a
    // brotli body to a client that did not ask for one.
    Vary: "Accept-Encoding",
    ...(variant ? { "Content-Encoding": variant.encoding } : {}),
    ...securityHeaders,
  });

  if (requestMethod === "HEAD") {
    response.end();
    return;
  }

  await new Promise((resolve, reject) => {
    createReadStream(variant ? variant.filePath : filePath)
      .on("error", reject)
      .on("end", resolve)
      .pipe(response);
  });
}

/**
 * One structured line per failed response. Successful static reads are not
 * logged: at this traffic level that is noise, and request paths can carry
 * identifiers that should not sit in a log.
 */
function logResponse(statusCode, pathname, error) {
  console.error(
    JSON.stringify({
      level: statusCode >= 500 ? "error" : "warn",
      event: "response",
      status: statusCode,
      path: pathname,
      ...(error ? { error: error.message } : {}),
      at: new Date().toISOString(),
    }),
  );
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

    const acceptEncoding = request.headers["accept-encoding"] || "";
    try {
      const { filePath, statusCode } = await resolveFile(request.url || "/");
      if (statusCode !== 200) logResponse(statusCode, pathname);
      await sendFile(response, request.method, filePath, statusCode, acceptEncoding);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof URIError) {
        logResponse(400, pathname, error);
        response.writeHead(400, {
          "Content-Type": "text/plain; charset=utf-8",
          ...securityHeaders,
        });
        response.end("Bad Request");
        return;
      }
      logResponse(500, pathname, error);
      try {
        await sendFile(response, request.method, serverErrorFile, 500, acceptEncoding);
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

/**
 * Stops accepting connections, lets in-flight responses finish, and exits.
 * Without this Railway's stop signal severs live responses on every deploy.
 */
export function shutdownGracefully(server, { signal = "SIGTERM", timeoutMs = 10_000 } = {}) {
  console.log(JSON.stringify({ level: "info", event: "shutdown", signal }));
  const forceExit = setTimeout(() => {
    console.log(JSON.stringify({ level: "warn", event: "shutdown-timeout", signal }));
    process.exit(1);
  }, timeoutMs);
  // A pending timer must not itself hold the process open once draining is done.
  forceExit.unref?.();
  return new Promise((resolve) => {
    server.close(() => {
      clearTimeout(forceExit);
      resolve();
    });
    server.closeIdleConnections?.();
  });
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const server = createPropertySuccessionServer();
  server.listen(port, "0.0.0.0", () => {
    console.log(`Property Succession Calculator listening on port ${port}`);
  });
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => {
      shutdownGracefully(server, { signal }).then(() => process.exit(0));
    });
  }
}
