import {
  constants as cryptoConstants,
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";

export const BACKUP_FORMAT = "family-tree-generator-logical-backup";
export const BACKUP_FORMAT_VERSION = 1;
export const ENCRYPTED_FORMAT = "family-tree-generator-encrypted-backup";
export const ENCRYPTED_FORMAT_VERSION = 1;
export const SYNTHETIC_SOURCE_KIND = "synthetic-local";
export const SYNTHETIC_RESTORE_CONFIRMATION = "DESTROY_ONLY_A_DISPOSABLE_LOCAL_SYNTHETIC_TARGET";

export const REQUIRED_DUMP_FILES = [
  "roles.sql",
  "schema.sql",
  "data.sql",
  "migration-history-schema.sql",
  "migration-history-data.sql",
];

export const REQUIRED_COUNT_KEYS = [
  "auth_users",
  "family_trees",
  "stripe_tree_events",
  "terms_acceptances",
  "tree_accounts",
  "tree_credit_orders",
  "tree_generations",
];

const HEADER_LIMIT_BYTES = 16 * 1024;
const GCM_TAG_BYTES = 16;

function requireNonBlank(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function localUrl(value, label) {
  let url;
  try {
    url = new URL(requireNonBlank(value, label));
  } catch {
    throw new Error(`${label} must be an absolute local URL.`);
  }

  const host = url.hostname.toLowerCase();
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`${label} must use HTTP on localhost; external targets are forbidden.`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} must not contain credentials.`);
  }
  return url;
}

function localDatabaseUrl(value, label) {
  let url;
  try {
    url = new URL(requireNonBlank(value, label));
  } catch {
    throw new Error(`${label} must be an absolute local PostgreSQL URL.`);
  }

  const host = url.hostname.toLowerCase();
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(host)
  ) {
    throw new Error(`${label} must use PostgreSQL on localhost; external targets are forbidden.`);
  }
  if (url.pathname !== "/postgres") {
    throw new Error(`${label} must target only the disposable local postgres database.`);
  }
  if (url.search || url.hash) {
    throw new Error(
      `${label} must not contain connection parameters or a fragment; libpq overrides are forbidden.`,
    );
  }
  return url;
}

/**
 * The restore harness is intentionally incapable of targeting Supabase Cloud,
 * Railway or any other external host. A separate, reviewed operator runbook is
 * required before a real backup can ever be restored.
 */
export function assertSyntheticRestoreTarget({
  sourceKind,
  sourceProjectId,
  targetProjectId,
  sourceUrl,
  targetUrl,
  sourceDbUrl,
  targetDbUrl,
  confirmation,
  targetWorkdir,
}) {
  if (sourceKind !== SYNTHETIC_SOURCE_KIND) {
    throw new Error(`sourceKind must be ${SYNTHETIC_SOURCE_KIND}.`);
  }
  if (confirmation !== SYNTHETIC_RESTORE_CONFIRMATION) {
    throw new Error("The synthetic restore confirmation token is missing or incorrect.");
  }

  const sourceId = requireNonBlank(sourceProjectId, "sourceProjectId");
  const targetId = requireNonBlank(targetProjectId, "targetProjectId");
  if (sourceId === targetId) throw new Error("Source and target project IDs must differ.");
  if (!sourceId.toLowerCase().includes("synthetic")) {
    throw new Error("The source project ID must be explicitly synthetic.");
  }
  if (!targetId.toLowerCase().includes("synthetic")) {
    throw new Error("The target project ID must be explicitly synthetic.");
  }

  const parsedSource = localUrl(sourceUrl, "sourceUrl");
  const parsedTarget = localUrl(targetUrl, "targetUrl");
  localDatabaseUrl(sourceDbUrl, "sourceDbUrl");
  localDatabaseUrl(targetDbUrl, "targetDbUrl");
  const resolvedWorkdir = path.resolve(requireNonBlank(targetWorkdir, "targetWorkdir"));
  const allowedTempRoots = [os.tmpdir(), process.env.RUNNER_TEMP]
    .filter(Boolean)
    .map((root) => path.resolve(root))
    .filter((root) => root !== path.parse(root).root);
  const workingDirectory = path.resolve(process.cwd());
  const relativeToWorkingDirectory = path.relative(workingDirectory, resolvedWorkdir);
  if (
    relativeToWorkingDirectory === "" ||
    (!relativeToWorkingDirectory.startsWith("..") && !path.isAbsolute(relativeToWorkingDirectory))
  ) {
    throw new Error("The synthetic restore target must not be inside the repository worktree.");
  }
  const isBelowAllowedTempRoot = allowedTempRoots.some((tempRoot) => {
    const relativeToTemp = path.relative(tempRoot, resolvedWorkdir);
    return (
      relativeToTemp !== "" && !relativeToTemp.startsWith("..") && !path.isAbsolute(relativeToTemp)
    );
  });
  if (!isBelowAllowedTempRoot) {
    throw new Error(
      "The synthetic restore target must live below an approved CI or operating-system temp directory.",
    );
  }

  return {
    sourceProjectId: sourceId,
    targetProjectId: targetId,
    sourceOrigin: parsedSource.origin,
    targetOrigin: parsedTarget.origin,
    targetWorkdir: resolvedWorkdir,
  };
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function validateCounts(counts) {
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) {
    throw new Error("Backup counts must be an object.");
  }
  const result = {};
  for (const key of REQUIRED_COUNT_KEYS) {
    const value = counts[key];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Backup count ${key} must be a non-negative safe integer.`);
    }
    result[key] = value;
  }
  return result;
}

export async function createBackupManifest({
  dumpDirectory,
  counts,
  outputPath = path.join(dumpDirectory, "manifest.json"),
  sourceKind = SYNTHETIC_SOURCE_KIND,
  createdAt = new Date().toISOString(),
  supabaseCliVersion = "unknown",
  databaseVersion = "unknown",
  sourceCommit = "unknown",
}) {
  if (sourceKind !== SYNTHETIC_SOURCE_KIND) {
    throw new Error("This bounded harness accepts synthetic local sources only.");
  }
  const parsedCreatedAt = new Date(createdAt);
  if (Number.isNaN(parsedCreatedAt.getTime()) || parsedCreatedAt.toISOString() !== createdAt) {
    throw new Error("createdAt must be a canonical ISO timestamp.");
  }

  const files = {};
  for (const filename of REQUIRED_DUMP_FILES) {
    const filePath = path.join(dumpDirectory, filename);
    const details = await stat(filePath).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (!details?.isFile() || details.size <= 0) {
      throw new Error(`Required dump file ${filename} is missing or empty.`);
    }
    files[filename] = {
      bytes: details.size,
      sha256: await sha256File(filePath),
    };
  }

  const manifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    sourceKind,
    createdAt,
    sourceCommit: String(sourceCommit || "unknown"),
    supabaseCliVersion: String(supabaseCliVersion || "unknown"),
    databaseVersion: String(databaseVersion || "unknown"),
    counts: validateCounts(counts),
    files,
  };
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return manifest;
}

export async function verifyBackupManifest({ dumpDirectory, manifestPath }) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.format !== BACKUP_FORMAT || manifest.version !== BACKUP_FORMAT_VERSION) {
    throw new Error("Unsupported backup manifest format or version.");
  }
  if (manifest.sourceKind !== SYNTHETIC_SOURCE_KIND) {
    throw new Error("The backup manifest is not marked as synthetic local data.");
  }
  validateCounts(manifest.counts);

  for (const filename of REQUIRED_DUMP_FILES) {
    const expected = manifest.files?.[filename];
    if (
      !expected ||
      !Number.isSafeInteger(expected.bytes) ||
      expected.bytes <= 0 ||
      !/^[a-f0-9]{64}$/.test(expected.sha256)
    ) {
      throw new Error(`Manifest metadata for ${filename} is invalid.`);
    }
    const filePath = path.join(dumpDirectory, filename);
    const details = await stat(filePath);
    if (!details.isFile() || details.size !== expected.bytes) {
      throw new Error(`Backup file ${filename} does not match its recorded size.`);
    }
    const actualHash = await sha256File(filePath);
    if (actualHash !== expected.sha256) {
      throw new Error(`Backup file ${filename} does not match its recorded checksum.`);
    }
  }
  return manifest;
}

export async function generateEphemeralBackupKeyPair({ publicKeyPath, privateKeyPath }) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 3072,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  await Promise.all([
    writeFile(publicKeyPath, publicKey, { encoding: "utf8", mode: 0o644 }),
    writeFile(privateKeyPath, privateKey, { encoding: "utf8", mode: 0o600 }),
  ]);
  await chmod(privateKeyPath, 0o600);
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) await once(stream, "drain");
}

async function closeWritable(stream) {
  stream.end();
  await once(stream, "finish");
}

async function atomicOutput(outputPath, writer) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.partial-${process.pid}-${randomBytes(8).toString("hex")}`;
  try {
    await writer(temporaryPath);
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function encryptBackupFile({ inputPath, outputPath, publicKeyPath }) {
  if (path.resolve(inputPath) === path.resolve(outputPath)) {
    throw new Error("Encrypted output must not overwrite its plaintext input.");
  }
  const publicKey = await readFile(publicKeyPath, "utf8");
  const contentKey = randomBytes(32);
  const iv = randomBytes(12);
  const encryptedKey = publicEncrypt(
    {
      key: publicKey,
      oaepHash: "sha256",
      padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
    },
    contentKey,
  );
  const header = Buffer.from(
    `${JSON.stringify({
      format: ENCRYPTED_FORMAT,
      version: ENCRYPTED_FORMAT_VERSION,
      keyAlgorithm: "RSA-OAEP-SHA256",
      contentAlgorithm: "AES-256-GCM",
      encryptedKey: encryptedKey.toString("base64"),
      iv: iv.toString("base64"),
    })}\n`,
    "utf8",
  );

  await atomicOutput(outputPath, async (temporaryPath) => {
    const output = createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 });
    try {
      const cipher = createCipheriv("aes-256-gcm", contentKey, iv);
      cipher.setAAD(header);
      await writeChunk(output, header);
      for await (const chunk of createReadStream(inputPath)) {
        const encrypted = cipher.update(chunk);
        if (encrypted.length) await writeChunk(output, encrypted);
      }
      const final = cipher.final();
      if (final.length) await writeChunk(output, final);
      await writeChunk(output, cipher.getAuthTag());
      await closeWritable(output);
    } catch (error) {
      output.destroy();
      throw error;
    }
  });
}

async function readEncryptedHeader(filePath) {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(HEADER_LIMIT_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const lineEnd = buffer.subarray(0, bytesRead).indexOf(0x0a);
    if (lineEnd < 0) throw new Error("Encrypted backup header is missing or too large.");
    const headerBytes = buffer.subarray(0, lineEnd + 1);
    const header = JSON.parse(headerBytes.subarray(0, lineEnd).toString("utf8"));
    if (
      header.format !== ENCRYPTED_FORMAT ||
      header.version !== ENCRYPTED_FORMAT_VERSION ||
      header.keyAlgorithm !== "RSA-OAEP-SHA256" ||
      header.contentAlgorithm !== "AES-256-GCM"
    ) {
      throw new Error("Unsupported encrypted backup format or algorithms.");
    }
    return { header, headerBytes, headerLength: lineEnd + 1 };
  } finally {
    await handle.close();
  }
}

export async function decryptBackupFile({ inputPath, outputPath, privateKeyPath }) {
  if (path.resolve(inputPath) === path.resolve(outputPath)) {
    throw new Error("Decrypted output must not overwrite its encrypted input.");
  }
  const details = await stat(inputPath);
  const { header, headerBytes, headerLength } = await readEncryptedHeader(inputPath);
  if (details.size <= headerLength + GCM_TAG_BYTES) {
    throw new Error("Encrypted backup contains no ciphertext.");
  }

  const privateKey = await readFile(privateKeyPath, "utf8");
  const contentKey = privateDecrypt(
    {
      key: privateKey,
      oaepHash: "sha256",
      padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
    },
    Buffer.from(header.encryptedKey, "base64"),
  );
  const iv = Buffer.from(header.iv, "base64");
  if (contentKey.length !== 32 || iv.length !== 12) {
    throw new Error("Encrypted backup key material is invalid.");
  }

  const handle = await open(inputPath, "r");
  let authenticationTag;
  try {
    authenticationTag = Buffer.alloc(GCM_TAG_BYTES);
    await handle.read(authenticationTag, 0, authenticationTag.length, details.size - GCM_TAG_BYTES);
  } finally {
    await handle.close();
  }

  await atomicOutput(outputPath, async (temporaryPath) => {
    const output = createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 });
    try {
      const decipher = createDecipheriv("aes-256-gcm", contentKey, iv);
      decipher.setAAD(headerBytes);
      decipher.setAuthTag(authenticationTag);
      const ciphertext = createReadStream(inputPath, {
        start: headerLength,
        end: details.size - GCM_TAG_BYTES - 1,
      });
      for await (const chunk of ciphertext) {
        const plaintext = decipher.update(chunk);
        if (plaintext.length) await writeChunk(output, plaintext);
      }
      const final = decipher.final();
      if (final.length) await writeChunk(output, final);
      await closeWritable(output);
    } catch (error) {
      output.destroy();
      throw error;
    }
  });
}

export async function writeChecksumRecord({ filePath, outputPath }) {
  const details = await stat(filePath);
  if (!details.isFile() || details.size <= 0)
    throw new Error("Checksum input is missing or empty.");
  const record = {
    algorithm: "sha256",
    bytes: details.size,
    sha256: await sha256File(filePath),
  };
  await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return record;
}

export async function verifyChecksumRecord({ filePath, checksumPath }) {
  const record = JSON.parse(await readFile(checksumPath, "utf8"));
  if (
    record.algorithm !== "sha256" ||
    !Number.isSafeInteger(record.bytes) ||
    record.bytes <= 0 ||
    !/^[a-f0-9]{64}$/.test(record.sha256)
  ) {
    throw new Error("Checksum record is invalid.");
  }
  const details = await stat(filePath);
  if (details.size !== record.bytes) throw new Error("Encrypted backup size does not match.");
  const expected = Buffer.from(record.sha256, "hex");
  const actual = Buffer.from(await sha256File(filePath), "hex");
  if (!timingSafeEqual(expected, actual))
    throw new Error("Encrypted backup checksum does not match.");
  return record;
}
