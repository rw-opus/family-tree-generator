// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingAdminMutation,
  getOrCreatePendingAdminMutation,
  PENDING_ADMIN_MUTATION_MAX_AGE_MS,
} from "../../src/services/adminMutationRequests.js";

const mutation = {
  operation: "grant-tree-credits",
  targetUserId: "account-123",
  payload: 2,
};

describe("pending admin mutation requests", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("survives replacement of tab-scoped storage and clears after success", () => {
    const createRequestId = vi.fn(() => "11111111-1111-4111-8111-111111111111");
    const first = getOrCreatePendingAdminMutation(mutation, createRequestId);

    sessionStorage.setItem("tab-only-state", "discarded on close");
    sessionStorage.clear();
    const afterNewTabSession = getOrCreatePendingAdminMutation(mutation, createRequestId);

    expect(afterNewTabSession).toBe(first);
    expect(createRequestId).toHaveBeenCalledOnce();
    expect(localStorage).toHaveLength(1);

    clearPendingAdminMutation(mutation, first);
    expect(localStorage).toHaveLength(0);
  });

  it("expires an abandoned request after the bounded retention period", () => {
    const createRequestId = vi
      .fn()
      .mockReturnValueOnce("22222222-2222-4222-8222-222222222222")
      .mockReturnValueOnce("33333333-3333-4333-8333-333333333333");

    const first = getOrCreatePendingAdminMutation(mutation, createRequestId);
    vi.setSystemTime(Date.now() + PENDING_ADMIN_MUTATION_MAX_AGE_MS + 1);
    const afterExpiry = getOrCreatePendingAdminMutation(mutation, createRequestId);

    expect(first).not.toBe(afterExpiry);
    expect(createRequestId).toHaveBeenCalledTimes(2);
    expect(localStorage).toHaveLength(1);
  });

  it("does not send an entitlement change when durable storage cannot be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "QuotaExceededError");
    });

    expect(() =>
      getOrCreatePendingAdminMutation(mutation, () => "44444444-4444-4444-8444-444444444444"),
    ).toThrow("could not safely retain");
  });
});
