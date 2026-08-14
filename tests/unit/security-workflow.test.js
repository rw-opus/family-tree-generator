import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/security.yml", import.meta.url),
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
});
