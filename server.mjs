import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const distributionDirectory = path.join(rootDirectory, "dist");
const fallbackFile = path.join(distributionDirectory, "index.html");
const port = Number(process.env.PORT) || 4173;

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
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function resolveFile(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  const requestedPath = path.resolve(distributionDirectory, `.${pathname}`);
  const isInsideDistribution =
    requestedPath === distributionDirectory ||
    requestedPath.startsWith(`${distributionDirectory}${path.sep}`);

  if (!isInsideDistribution) return fallbackFile;

  try {
    const requestedStat = await stat(requestedPath);
    if (requestedStat.isFile()) return requestedPath;
  } catch {
    // Client-side routes are served by the SPA entry point.
  }

  return fallbackFile;
}

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method Not Allowed");
    return;
  }

  const { pathname } = new URL(request.url || "/", "http://localhost");
  if (pathname === "/healthz") {
    const body = JSON.stringify({ status: "ok", ...buildInfo });
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(request.method === "HEAD" ? undefined : body);
    return;
  }

  try {
    const filePath = await resolveFile(request.url || "/");
    const contentType =
      mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    const cacheControl = filePath.includes(`${path.sep}assets${path.sep}`)
      ? "public, max-age=31536000, immutable"
      : "no-cache";

    response.writeHead(200, {
      "Cache-Control": cacheControl,
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    createReadStream(filePath)
      .on("error", () => {
        if (!response.headersSent) response.writeHead(500);
        response.end("Internal Server Error");
      })
      .pipe(response);
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad Request");
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Property Succession Calculator listening on port ${port}`);
});
