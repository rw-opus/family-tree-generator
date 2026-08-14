import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/security.yml", import.meta.url),
  "utf8",
);
const restoreDrill = readFileSync(
  new URL("../../scripts/backup/run-synthetic-restore-drill.sh", import.meta.url),
  "utf8",
);

describe("Security workflow credential handling", () => {
  it("masks discovered credentials before validating them and never prints the raw status", () => {
    const maskIndex = workflow.indexOf('echo "::add-mask::$credential"');
    const validationIndex = workflow.indexOf('if [ "${#missing[@]}" -gt 0 ]');

    expect(maskIndex).toBeGreaterThan(-1);
    expect(validationIndex).toBeGreaterThan(maskIndex);
    expect(workflow).not.toContain('echo "$status" >&2');
  });

  it("neutralizes fresh-target browser grants before creating restored objects", () => {
    expect(restoreDrill).toContain(
      "alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated",
    );

    const neutralizeIndex = restoreDrill.indexOf(
      "alter default privileges for role postgres in schema public revoke all on tables",
    );
    const schemaRestoreIndex = restoreDrill.indexOf('--file "$recovered_directory/schema.sql"');
    expect(neutralizeIndex).toBeGreaterThan(-1);
    expect(schemaRestoreIndex).toBeGreaterThan(neutralizeIndex);
  });
});
