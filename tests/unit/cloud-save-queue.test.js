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
});
