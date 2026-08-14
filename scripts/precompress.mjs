import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompress, constants, gzip } from "node:zlib";
import { promisify } from "node:util";

const compressBrotli = promisify(brotliCompress);
const compressGzip = promisify(gzip);

const rootDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distributionDirectory = path.join(rootDirectory, "dist");

// Only text formats benefit. Images, fonts and archives are already compressed,
// and a second pass on them costs build time to make the file slightly larger.
export const COMPRESSIBLE_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".svg",
  ".txt",
  ".webmanifest",
  ".xml",
]);

// Below roughly a TCP segment the header overhead outweighs the saving.
export const MINIMUM_COMPRESSIBLE_BYTES = 1024;

export function shouldCompress(filePath, byteLength) {
  if (byteLength < MINIMUM_COMPRESSIBLE_BYTES) return false;
  return COMPRESSIBLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(entryPath);
    else if (entry.isFile()) yield entryPath;
  }
}

/**
 * Writes .br and .gz siblings for every compressible build output. Compressing
 * once at build time keeps the server's per-request cost at zero and allows the
 * slowest, highest-ratio settings, which a runtime compressor could not afford.
 */
export async function precompressDistribution(directory = distributionDirectory) {
  const results = [];
  for await (const filePath of walk(directory)) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === ".br" || extension === ".gz") continue;

    const source = await readFile(filePath);
    if (!shouldCompress(filePath, source.byteLength)) continue;

    const [brotli, gzipped] = await Promise.all([
      compressBrotli(source, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
          [constants.BROTLI_PARAM_SIZE_HINT]: source.byteLength,
        },
      }),
      compressGzip(source, { level: constants.Z_BEST_COMPRESSION }),
    ]);

    // A variant that is not smaller would only cost the client a redundant
    // decompression, so it is not written and the server will not find it.
    if (brotli.byteLength < source.byteLength) await writeFile(`${filePath}.br`, brotli);
    if (gzipped.byteLength < source.byteLength) await writeFile(`${filePath}.gz`, gzipped);

    results.push({
      file: path.relative(directory, filePath),
      raw: source.byteLength,
      brotli: brotli.byteLength,
      gzip: gzipped.byteLength,
    });
  }
  return results;
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const results = await precompressDistribution();
  const raw = results.reduce((total, entry) => total + entry.raw, 0);
  const brotli = results.reduce((total, entry) => total + entry.brotli, 0);
  const saved = raw ? Math.round((1 - brotli / raw) * 100) : 0;
  console.log(
    `Precompressed ${results.length} file(s): ${(raw / 1024).toFixed(0)} KB raw -> ` +
      `${(brotli / 1024).toFixed(0)} KB brotli (${saved}% smaller)`,
  );
}
