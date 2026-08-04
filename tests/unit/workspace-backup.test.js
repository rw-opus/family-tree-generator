import { describe, expect, it } from "vitest";
import {
  WORKSPACE_BACKUP_FORMAT,
  WORKSPACE_BACKUP_VERSION,
  workspaceBackupFilename,
  workspaceBackupJson,
  workspaceBackupPayload,
} from "../../src/domain/workspaceBackup.js";

describe("workspace backup", () => {
  it("exports every tree in a versioned payload", () => {
    const trees = [
      { id: "one", title: "One family", people: [{ id: "p1", name: "Person One" }] },
      { id: "two", title: "Two family", people: [] },
    ];
    const payload = workspaceBackupPayload(trees, "2026-08-04T05:00:00.000Z");

    expect(payload).toEqual({
      format: WORKSPACE_BACKUP_FORMAT,
      version: WORKSPACE_BACKUP_VERSION,
      exportedAt: "2026-08-04T05:00:00.000Z",
      treeCount: 2,
      trees,
    });
    expect(JSON.parse(workspaceBackupJson(trees, payload.exportedAt))).toEqual(payload);
  });

  it("uses a stable dated filename", () => {
    expect(workspaceBackupFilename(new Date("2026-08-04T12:00:00.000Z"))).toBe(
      "family-tree-workspace-backup-2026-08-04.json",
    );
  });
});
