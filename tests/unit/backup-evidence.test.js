import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  REQUIRED_COUNT_KEYS,
  REQUIRED_DUMP_FILES,
  SYNTHETIC_RESTORE_CONFIRMATION,
  assertSyntheticRestoreTarget,
  createBackupManifest,
  decryptBackupFile,
  encryptBackupFile,
  generateEphemeralBackupKeyPair,
  prepareRolesForLocalRestore,
  verifyBackupManifest,
  verifyChecksumRecord,
  writeChecksumRecord,
} from "../../scripts/backup/evidence.js";

const temporaryDirectories = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ftg-backup-evidence-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function counts(value = 0) {
  return Object.fromEntries(REQUIRED_COUNT_KEYS.map((key) => [key, value]));
}

function databaseUrl(host = "127.0.0.1", port = 54322) {
  const url = new URL(`postgresql://${host}:${port}/postgres`);
  url.username = "postgres";
  url.password = "fictional-local-password";
  return url.href;
}

describe("synthetic restore target guard", () => {
  it("accepts only an explicitly confirmed target below the local temp directory", async () => {
    const targetWorkdir = await temporaryDirectory();
    expect(
      assertSyntheticRestoreTarget({
        sourceKind: "synthetic-local",
        sourceProjectId: "ftg-synthetic-source",
        targetProjectId: "ftg-synthetic-target",
        sourceUrl: "http://127.0.0.1:54321",
        targetUrl: "http://localhost:54321",
        sourceDbUrl: databaseUrl(),
        targetDbUrl: databaseUrl("localhost"),
        confirmation: SYNTHETIC_RESTORE_CONFIRMATION,
        targetWorkdir,
      }),
    ).toMatchObject({
      sourceProjectId: "ftg-synthetic-source",
      targetProjectId: "ftg-synthetic-target",
    });
  });

  it("accepts GitHub's runner temp root when it differs from the OS temp root", () => {
    const previousRunnerTemp = process.env.RUNNER_TEMP;
    const runnerTemp = path.join(path.parse(process.cwd()).root, "ftg-synthetic-runner-temp");
    process.env.RUNNER_TEMP = runnerTemp;
    try {
      expect(
        assertSyntheticRestoreTarget({
          sourceKind: "synthetic-local",
          sourceProjectId: "ftg-synthetic-source",
          targetProjectId: "ftg-synthetic-target",
          sourceUrl: "http://127.0.0.1:54321",
          targetUrl: "http://localhost:54321",
          sourceDbUrl: databaseUrl(),
          targetDbUrl: databaseUrl("localhost"),
          confirmation: SYNTHETIC_RESTORE_CONFIRMATION,
          targetWorkdir: path.join(runnerTemp, "restore-project"),
        }),
      ).toMatchObject({
        targetWorkdir: path.join(runnerTemp, "restore-project"),
      });
    } finally {
      if (previousRunnerTemp === undefined) delete process.env.RUNNER_TEMP;
      else process.env.RUNNER_TEMP = previousRunnerTemp;
    }
  });

  it.each([
    {
      label: "a hosted Supabase target",
      override: { targetUrl: "https://example.supabase.co" },
    },
    {
      label: "a hosted database target",
      override: {
        targetDbUrl: databaseUrl("db.example.supabase.co", 5432),
      },
    },
    {
      label: "a local-looking database URL with a host override",
      override: {
        targetDbUrl: `${databaseUrl()}?host=db.example.supabase.co`,
      },
    },
    {
      label: "a local-looking database URL with a libpq service override",
      override: {
        targetDbUrl: `${databaseUrl()}?service=production`,
      },
    },
    {
      label: "a local-looking database URL with a database override",
      override: {
        targetDbUrl: `${databaseUrl()}?dbname=production`,
      },
    },
    {
      label: "a database URL fragment",
      override: {
        targetDbUrl: `${databaseUrl()}#production`,
      },
    },
    { label: "a production source kind", override: { sourceKind: "production" } },
    { label: "the same project", override: { targetProjectId: "ftg-synthetic-source" } },
    { label: "a vague source", override: { sourceProjectId: "source" } },
    { label: "a missing confirmation", override: { confirmation: "yes" } },
    { label: "a repository target", override: { targetWorkdir: process.cwd() } },
    {
      label: "a target nested inside the repository",
      override: { targetWorkdir: path.join(process.cwd(), "synthetic-restore") },
    },
  ])("rejects $label", async ({ override }) => {
    const targetWorkdir = await temporaryDirectory();
    expect(() =>
      assertSyntheticRestoreTarget({
        sourceKind: "synthetic-local",
        sourceProjectId: "ftg-synthetic-source",
        targetProjectId: "ftg-synthetic-target",
        sourceUrl: "http://127.0.0.1:54321",
        targetUrl: "http://127.0.0.1:54321",
        sourceDbUrl: databaseUrl(),
        targetDbUrl: databaseUrl(),
        confirmation: SYNTHETIC_RESTORE_CONFIRMATION,
        targetWorkdir,
        ...override,
      }),
    ).toThrow();
  });
});

describe("local reserved-role restore preparation", () => {
  it("omits only unsupported settings on Supabase-managed roles", async () => {
    const directory = await temporaryDirectory();
    const inputPath = path.join(directory, "roles.sql");
    const outputPath = path.join(directory, "roles-local.sql");
    const source = [
      `ALTER ROLE "authenticator" SET "log_min_messages" TO 'fatal';`,
      `ALTER ROLE "authenticator" SET "statement_timeout" TO '8s';`,
      `ALTER ROLE "supabase_auth_admin" SET "internal.secret" TO 'do-not-copy';`,
      `ALTER ROLE "custom_auditor" SET "log_min_messages" TO 'warning';`,
      `GRANT "custom_auditor" TO "postgres";`,
      "",
    ].join("\n");
    await writeFile(inputPath, source, "utf8");

    const result = await prepareRolesForLocalRestore({ inputPath, outputPath });
    const prepared = await readFile(outputPath, "utf8");

    expect(result).toEqual({ omittedCount: 2 });
    expect(await readFile(inputPath, "utf8")).toBe(source);
    expect(prepared).not.toContain("do-not-copy");
    expect(prepared).toContain(
      `-- Omitted target-managed setting for reserved role "authenticator": "log_min_messages".`,
    );
    expect(prepared).toContain(`ALTER ROLE "authenticator" SET "statement_timeout" TO '8s';`);
    expect(prepared).toContain(`ALTER ROLE "custom_auditor" SET "log_min_messages" TO 'warning';`);
    expect(prepared).toContain(`GRANT "custom_auditor" TO "postgres";`);
  });

  it("never overwrites the archived roles dump", async () => {
    const directory = await temporaryDirectory();
    const inputPath = path.join(directory, "roles.sql");
    await writeFile(inputPath, "RESET ALL;\n", "utf8");

    await expect(prepareRolesForLocalRestore({ inputPath, outputPath: inputPath })).rejects.toThrow(
      /must not overwrite/,
    );
  });
});

describe("backup manifest", () => {
  async function fixture() {
    const directory = await temporaryDirectory();
    await Promise.all(
      REQUIRED_DUMP_FILES.map((filename, index) =>
        writeFile(path.join(directory, filename), `synthetic SQL ${index}\n`, "utf8"),
      ),
    );
    const manifestPath = path.join(directory, "manifest.json");
    await createBackupManifest({
      dumpDirectory: directory,
      counts: counts(2),
      outputPath: manifestPath,
      createdAt: "2026-08-14T08:00:00.000Z",
      supabaseCliVersion: "2.114.0",
      databaseVersion: "17.6",
      sourceCommit: "abc123",
    });
    return { directory, manifestPath };
  }

  it("records and verifies every required logical dump component", async () => {
    const { directory, manifestPath } = await fixture();
    const manifest = await verifyBackupManifest({ dumpDirectory: directory, manifestPath });

    expect(manifest.counts).toEqual(counts(2));
    expect(Object.keys(manifest.files)).toEqual(REQUIRED_DUMP_FILES);
    for (const file of Object.values(manifest.files)) {
      expect(file.bytes).toBeGreaterThan(0);
      expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("fails closed when a dump is missing, empty or changed", async () => {
    const directory = await temporaryDirectory();
    await Promise.all(
      REQUIRED_DUMP_FILES.slice(0, -1).map((filename) =>
        writeFile(path.join(directory, filename), "synthetic SQL\n", "utf8"),
      ),
    );
    await expect(
      createBackupManifest({
        dumpDirectory: directory,
        counts: counts(),
        createdAt: "2026-08-14T08:00:00.000Z",
      }),
    ).rejects.toThrow(/missing or empty/);

    const complete = await fixture();
    await writeFile(path.join(complete.directory, "data.sql"), "tampered\n", "utf8");
    await expect(
      verifyBackupManifest({
        dumpDirectory: complete.directory,
        manifestPath: complete.manifestPath,
      }),
    ).rejects.toThrow(/recorded (size|checksum)/);
  });

  it("rejects incomplete and invalid aggregate counts", async () => {
    const directory = await temporaryDirectory();
    await Promise.all(
      REQUIRED_DUMP_FILES.map((filename) =>
        writeFile(path.join(directory, filename), "synthetic SQL\n", "utf8"),
      ),
    );
    await expect(
      createBackupManifest({
        dumpDirectory: directory,
        counts: { auth_users: -1 },
        createdAt: "2026-08-14T08:00:00.000Z",
      }),
    ).rejects.toThrow(/non-negative safe integer/);
  });
});

describe("encrypted backup evidence", () => {
  async function encryptedFixture() {
    const directory = await temporaryDirectory();
    const plaintextPath = path.join(directory, "backup.tar.gz");
    const encryptedPath = path.join(directory, "backup.ftgbackup");
    const recoveredPath = path.join(directory, "recovered.tar.gz");
    const publicKeyPath = path.join(directory, "public.pem");
    const privateKeyPath = path.join(directory, "private.pem");
    const checksumPath = path.join(directory, "backup.sha256.json");
    await writeFile(plaintextPath, Buffer.from("fictional backup contents\n".repeat(1000)));
    await generateEphemeralBackupKeyPair({ publicKeyPath, privateKeyPath });
    await encryptBackupFile({ inputPath: plaintextPath, outputPath: encryptedPath, publicKeyPath });
    await writeChecksumRecord({ filePath: encryptedPath, outputPath: checksumPath });
    return {
      plaintextPath,
      encryptedPath,
      recoveredPath,
      publicKeyPath,
      privateKeyPath,
      checksumPath,
    };
  }

  it("round-trips through public-key-wrapped authenticated encryption", async () => {
    const fixture = await encryptedFixture();
    await verifyChecksumRecord({
      filePath: fixture.encryptedPath,
      checksumPath: fixture.checksumPath,
    });
    await decryptBackupFile({
      inputPath: fixture.encryptedPath,
      outputPath: fixture.recoveredPath,
      privateKeyPath: fixture.privateKeyPath,
    });
    expect(await readFile(fixture.recoveredPath)).toEqual(await readFile(fixture.plaintextPath));
  });

  it("detects ciphertext tampering before or during decryption", async () => {
    const fixture = await encryptedFixture();
    const encrypted = await readFile(fixture.encryptedPath);
    encrypted[encrypted.length - 20] ^= 0xff;
    await writeFile(fixture.encryptedPath, encrypted);

    await expect(
      verifyChecksumRecord({
        filePath: fixture.encryptedPath,
        checksumPath: fixture.checksumPath,
      }),
    ).rejects.toThrow(/checksum does not match/);
    await expect(
      decryptBackupFile({
        inputPath: fixture.encryptedPath,
        outputPath: fixture.recoveredPath,
        privateKeyPath: fixture.privateKeyPath,
      }),
    ).rejects.toThrow();
  });

  it("cannot decrypt with an unrelated private key", async () => {
    const fixture = await encryptedFixture();
    const wrongPrivateKeyPath = path.join(
      path.dirname(fixture.privateKeyPath),
      "wrong-private.pem",
    );
    const wrongPublicKeyPath = path.join(path.dirname(fixture.privateKeyPath), "wrong-public.pem");
    await generateEphemeralBackupKeyPair({
      publicKeyPath: wrongPublicKeyPath,
      privateKeyPath: wrongPrivateKeyPath,
    });

    await expect(
      decryptBackupFile({
        inputPath: fixture.encryptedPath,
        outputPath: fixture.recoveredPath,
        privateKeyPath: wrongPrivateKeyPath,
      }),
    ).rejects.toThrow();
  });
});
