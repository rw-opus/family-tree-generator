import { describe, expect, it, vi } from "vitest";
import { createCloudSaveQueue } from "../../src/services/cloudSaveQueue.js";

describe("cloud save queue", () => {
  it("keeps only the latest debounced snapshot", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (snapshot) => snapshot);
    const queue = createCloudSaveQueue(save);

    queue.schedule({ title: "First" });
    queue.schedule({ title: "Latest" });
    await vi.advanceTimersByTimeAsync(900);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ title: "Latest" });
    expect(queue.hasUnsavedChanges()).toBe(false);
    vi.useRealTimers();
  });

  it("serialises in-flight writes in revision order", async () => {
    const releases = [];
    const save = vi.fn(
      (snapshot) => new Promise((resolve) => releases.push(() => resolve(snapshot))),
    );
    const queue = createCloudSaveQueue(save, {
      setTimer: () => 1,
      clearTimer: () => {},
    });

    queue.schedule({ title: "First" });
    const first = queue.flush();
    queue.schedule({ title: "Second" });
    const second = queue.flush();

    await Promise.resolve();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    releases.shift()();
    await first;
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(2);
    releases.shift()();
    await second;
    expect(save.mock.calls.map(([snapshot]) => snapshot.title)).toEqual(["First", "Second"]);
  });

  it("coalesces every not-yet-started write into one latest snapshot", async () => {
    const releases = [];
    const save = vi.fn(
      (snapshot) => new Promise((resolve) => releases.push(() => resolve(snapshot))),
    );
    const starts = [];
    const queue = createCloudSaveQueue(save, {
      setTimer: () => 1,
      clearTimer: () => {},
      onSaveStart: (snapshot) => starts.push(snapshot.title),
    });

    queue.schedule({ title: "A" });
    const first = queue.flush();
    queue.schedule({ title: "B" });
    const second = queue.flush();
    queue.schedule({ title: "C" });
    const third = queue.flush();

    expect(second).toBe(third);
    await Promise.resolve();
    await Promise.resolve();
    expect(save.mock.calls.map(([snapshot]) => snapshot.title)).toEqual(["A"]);
    releases.shift()();
    await first;
    await Promise.resolve();
    expect(save.mock.calls.map(([snapshot]) => snapshot.title)).toEqual(["A", "C"]);
    expect(starts).toEqual(["A", "C"]);
    releases.shift()();
    await expect(Promise.all([second, third])).resolves.toEqual([{ title: "C" }, { title: "C" }]);
    expect(queue.hasUnsavedChanges()).toBe(false);
  });

  it("keeps a bounded single unsent slot during a long active request", async () => {
    const releases = [];
    const save = vi.fn(
      (snapshot) => new Promise((resolve) => releases.push(() => resolve(snapshot))),
    );
    const starts = [];
    const queue = createCloudSaveQueue(save, {
      setTimer: () => 1,
      clearTimer: () => {},
      onSaveStart: (snapshot) => starts.push(snapshot.sequence),
    });

    queue.schedule({ sequence: 0 });
    const active = queue.flush();
    const queued = [];
    for (let sequence = 1; sequence <= 20; sequence += 1) {
      queue.schedule({ sequence });
      queued.push(queue.flush());
    }

    expect(new Set(queued).size).toBe(1);
    await Promise.resolve();
    expect(save.mock.calls.map(([snapshot]) => snapshot.sequence)).toEqual([0]);
    releases.shift()();
    await active;
    await Promise.resolve();
    expect(save.mock.calls.map(([snapshot]) => snapshot.sequence)).toEqual([0, 20]);
    expect(starts).toEqual([0, 20]);
    releases.shift()();
    await Promise.all(queued);
  });

  it("coalesces repeated flushes of the same revision", async () => {
    let release;
    const save = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const queue = createCloudSaveQueue(save, {
      setTimer: () => 1,
      clearTimer: () => {},
    });

    queue.schedule({ title: "Same" });
    const first = queue.flush();
    const second = queue.flush();

    await Promise.resolve();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    release({ title: "Saved" });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { title: "Saved" },
      { title: "Saved" },
    ]);
  });

  it("keeps a failed snapshot dirty so it can be retried", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ title: "Recovered" });
    const queue = createCloudSaveQueue(save, {
      setTimer: () => 1,
      clearTimer: () => {},
    });

    queue.schedule({ title: "Recovered" });
    await expect(queue.flush()).rejects.toThrow("offline");
    expect(queue.hasUnsavedChanges()).toBe(true);
    await expect(queue.flush()).resolves.toEqual({ title: "Recovered" });
    expect(queue.hasUnsavedChanges()).toBe(false);
  });

  it("rebases a queued newer edit onto the revision returned by the earlier save", async () => {
    const releases = [];
    const onSaveSuccess = vi.fn();
    const save = vi.fn(
      (snapshot) => new Promise((resolve) => releases.push(() => resolve(snapshot))),
    );
    const queue = createCloudSaveQueue(save, {
      setTimer: () => 1,
      clearTimer: () => {},
      snapshotKey: (snapshot) => snapshot.id,
      rebaseSnapshot: (snapshot, saved) => ({
        ...snapshot,
        storageRevision: saved.storageRevision + 1,
      }),
      onSaveSuccess,
    });

    queue.schedule({ id: "tree", title: "First", storageRevision: 1 });
    const first = queue.flush();
    queue.schedule({ id: "tree", title: "Newer local edit", storageRevision: 1 });
    const second = queue.flush();

    await Promise.resolve();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    releases.shift()();
    await first;
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toMatchObject({
      title: "Newer local edit",
      storageRevision: 2,
    });
    releases.shift()();
    await second;
    expect(onSaveSuccess.mock.calls[1][1]).toMatchObject({
      title: "Newer local edit",
      storageRevision: 2,
    });
  });

  it("reports a conflict distinctly and retains later local changes as unsaved", async () => {
    const conflict = Object.assign(new Error("changed elsewhere"), {
      code: "TREE_SAVE_CONFLICT",
    });
    const states = [];
    const save = vi.fn().mockRejectedValue(conflict);
    const queue = createCloudSaveQueue(save, {
      setTimer: () => 1,
      clearTimer: () => {},
      onStateChange: (state) => states.push(state.phase),
    });

    queue.schedule({ id: "tree", title: "Local edit" });
    await expect(queue.flush()).rejects.toBe(conflict);
    expect(queue.getState()).toMatchObject({
      phase: "conflict",
      conflict: true,
      dirty: true,
    });

    queue.schedule({ id: "tree", title: "Even newer local edit" });
    await expect(queue.flush()).rejects.toBe(conflict);
    expect(save).toHaveBeenCalledTimes(1);
    expect(queue.hasUnsavedChanges()).toBe(true);
    expect(states).toContain("saving");
    expect(states.at(-1)).toBe("conflict");
  });

  it("does not enqueue another write when only acknowledged save metadata changes", async () => {
    const save = vi.fn(async (snapshot) => ({ ...snapshot, storageRevision: 2 }));
    const content = (snapshot) => JSON.stringify({ id: snapshot.id, title: snapshot.title });
    const queue = createCloudSaveQueue(save, {
      setTimer: () => 1,
      clearTimer: () => {},
      snapshotFingerprint: content,
    });

    queue.schedule({ id: "tree", title: "Same content", storageRevision: 1 });
    await queue.flush();
    queue.schedule({ id: "tree", title: "Same content", storageRevision: 2 });

    expect(queue.getState()).toMatchObject({ revision: 1, savedRevision: 1, dirty: false });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("acknowledges a freshly loaded tree without writing it back", async () => {
    const save = vi.fn();
    const content = (snapshot) => JSON.stringify({ id: snapshot.id, title: snapshot.title });
    const queue = createCloudSaveQueue(save, {
      setTimer: () => 1,
      clearTimer: () => {},
      snapshotFingerprint: content,
    });
    const loaded = { id: "tree", title: "Loaded", storageRevision: 4 };

    queue.acknowledge(loaded);
    expect(queue.isSnapshotSaved({ ...loaded })).toBe(true);
    expect(queue.isSnapshotSaved({ ...loaded, title: "Changed" })).toBe(false);
    queue.schedule({ ...loaded });

    expect(queue.getState()).toMatchObject({ phase: "saved", dirty: false });
    await expect(queue.flush()).resolves.toEqual(loaded);
    expect(save).not.toHaveBeenCalled();
  });

  it("does not let a deleted tree's late conflict poison the newly active tree", async () => {
    const oldConflict = Object.assign(new Error("old tree changed elsewhere"), {
      code: "TREE_SAVE_CONFLICT",
    });
    let rejectOldSave;
    const save = vi.fn((snapshot) => {
      if (snapshot.id === "old-tree") {
        return new Promise((_, reject) => {
          rejectOldSave = reject;
        });
      }
      return Promise.resolve({ ...snapshot, storageRevision: 8 });
    });
    const queue = createCloudSaveQueue(save, {
      setTimer: () => 1,
      clearTimer: () => {},
      snapshotKey: (snapshot) => snapshot.id,
    });

    queue.schedule({ id: "old-tree", title: "Unsaved old tree", storageRevision: 3 });
    const oldSave = queue.flush();
    await Promise.resolve();
    await Promise.resolve();

    queue.acknowledge({ id: "new-tree", title: "Loaded tree", storageRevision: 7 });
    rejectOldSave(oldConflict);
    await expect(oldSave).rejects.toBe(oldConflict);
    expect(queue.getState()).toMatchObject({ phase: "saved", conflict: false, dirty: false });

    queue.schedule({ id: "new-tree", title: "New tree edit", storageRevision: 7 });
    await expect(queue.flush()).resolves.toMatchObject({
      id: "new-tree",
      title: "New tree edit",
      storageRevision: 8,
    });
    expect(queue.getState()).toMatchObject({ phase: "saved", conflict: false, dirty: false });
  });
});
