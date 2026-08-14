import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  assertSyntheticRestoreTarget,
  createBackupManifest,
  decryptBackupFile,
  encryptBackupFile,
  generateEphemeralBackupKeyPair,
  verifyBackupManifest,
  verifyChecksumRecord,
  writeChecksumRecord,
} from "./evidence.js";

function argumentsMap(values) {
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Expected --name value arguments; received ${key ?? "nothing"}.`);
    }
    if (result.has(key)) throw new Error(`Argument ${key} was supplied more than once.`);
    result.set(key, value);
  }
  return result;
}

function required(argumentsByName, name) {
  const value = argumentsByName.get(name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function run(command, args) {
  const options = argumentsMap(args);
  switch (command) {
    case "assert-synthetic-target":
      assertSyntheticRestoreTarget({
        sourceKind: required(options, "--source-kind"),
        sourceProjectId: required(options, "--source-project-id"),
        targetProjectId: required(options, "--target-project-id"),
        sourceUrl: required(options, "--source-url"),
        targetUrl: required(options, "--target-url"),
        sourceDbUrl: required(options, "--source-db-url"),
        targetDbUrl: required(options, "--target-db-url"),
        confirmation: required(options, "--confirmation"),
        targetWorkdir: required(options, "--target-workdir"),
      });
      return;
    case "create-manifest": {
      const counts = JSON.parse(await readFile(required(options, "--counts"), "utf8"));
      await createBackupManifest({
        dumpDirectory: required(options, "--dump-directory"),
        counts,
        outputPath: required(options, "--output"),
        sourceKind: required(options, "--source-kind"),
        createdAt: required(options, "--created-at"),
        supabaseCliVersion: required(options, "--supabase-cli-version"),
        databaseVersion: required(options, "--database-version"),
        sourceCommit: required(options, "--source-commit"),
      });
      return;
    }
    case "verify-manifest":
      await verifyBackupManifest({
        dumpDirectory: required(options, "--dump-directory"),
        manifestPath: required(options, "--manifest"),
      });
      return;
    case "generate-ephemeral-key":
      await generateEphemeralBackupKeyPair({
        publicKeyPath: required(options, "--public-key"),
        privateKeyPath: required(options, "--private-key"),
      });
      return;
    case "encrypt":
      await encryptBackupFile({
        inputPath: required(options, "--input"),
        outputPath: required(options, "--output"),
        publicKeyPath: required(options, "--public-key"),
      });
      return;
    case "decrypt":
      await decryptBackupFile({
        inputPath: required(options, "--input"),
        outputPath: required(options, "--output"),
        privateKeyPath: required(options, "--private-key"),
      });
      return;
    case "write-checksum":
      await writeChecksumRecord({
        filePath: required(options, "--input"),
        outputPath: required(options, "--output"),
      });
      return;
    case "verify-checksum":
      await verifyChecksumRecord({
        filePath: required(options, "--input"),
        checksumPath: required(options, "--checksum"),
      });
      return;
    default:
      throw new Error(`Unknown backup evidence command: ${command || "(missing)"}.`);
  }
}

const [command, ...args] = process.argv.slice(2);
run(command, args).catch((error) => {
  const script = path.basename(process.argv[1]);
  console.error(`${script}: ${error.message}`);
  process.exitCode = 1;
});
