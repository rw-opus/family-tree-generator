import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("../../src/supabaseClient.js", () => ({ supabase: { rpc } }));

import {
  createAdminRequestId,
  grantTreeCredits,
  MAX_ADMIN_CREDIT_GRANT,
  setUnlimitedTrees,
} from "../../src/services/adminConsole.js";

describe("admin console service mutations", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: null });
  });

  it("uses an injectable UUID factory and sends an idempotency ID with credit grants", async () => {
    const requestId = "11111111-1111-4111-8111-111111111111";

    expect(createAdminRequestId(() => requestId)).toBe(requestId);
    await grantTreeCredits("account-1", MAX_ADMIN_CREDIT_GRANT, { requestId });

    expect(rpc).toHaveBeenCalledWith("admin_grant_tree_credits", {
      target_user: "account-1",
      credits: 100,
      request_id: requestId,
    });
  });

  it.each([0, -1, 1.5, 101, "not-a-number"])(
    "rejects an out-of-range credit grant before calling Supabase (%s)",
    async (credits) => {
      await expect(
        grantTreeCredits("account-1", credits, {
          requestId: "22222222-2222-4222-8222-222222222222",
        }),
      ).rejects.toThrow("whole numbers from 1 to 100");
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("sends an idempotency ID and the exact boolean for unlimited changes", async () => {
    const requestId = "33333333-3333-4333-8333-333333333333";

    await setUnlimitedTrees("account-2", true, { requestId });

    expect(rpc).toHaveBeenCalledWith("admin_set_unlimited_trees", {
      target_user: "account-2",
      enabled: true,
      request_id: requestId,
    });
  });

  it("surfaces RPC failures", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error("permission denied") });

    await expect(
      grantTreeCredits("account-1", 1, {
        requestId: "44444444-4444-4444-8444-444444444444",
      }),
    ).rejects.toThrow("permission denied");
  });
});
