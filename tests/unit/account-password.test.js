import { describe, expect, it, vi } from "vitest";
import { changeSignedInPassword } from "../../src/services/accountPassword.js";

const makeAuth = () => ({
  signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
  updateUser: vi.fn().mockResolvedValue({ error: null }),
});

describe("signed-in password changes", () => {
  it("verifies the current password before changing it", async () => {
    const auth = makeAuth();

    await changeSignedInPassword(auth, {
      email: " Roland@Example.com ",
      currentPassword: "current-password",
      newPassword: "new-secure-password",
    });

    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "roland@example.com",
      password: "current-password",
    });
    expect(auth.updateUser).toHaveBeenCalledWith({
      current_password: "current-password",
      password: "new-secure-password",
    });
    expect(auth.signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(
      auth.updateUser.mock.invocationCallOrder[0],
    );
  });

  it("does not attempt an update when the current password cannot be verified", async () => {
    const auth = makeAuth();
    auth.signInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });

    await expect(
      changeSignedInPassword(auth, {
        email: "roland@example.com",
        currentPassword: "wrong-password",
        newPassword: "new-secure-password",
      }),
    ).rejects.toThrow("Invalid login credentials");
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("reports a password update failure", async () => {
    const auth = makeAuth();
    auth.updateUser.mockResolvedValue({ error: { message: "Password rejected" } });

    await expect(
      changeSignedInPassword(auth, {
        email: "roland@example.com",
        currentPassword: "current-password",
        newPassword: "new-secure-password",
      }),
    ).rejects.toThrow("Password rejected");
  });

  it("preserves a rejected network request for the form to display", async () => {
    const auth = makeAuth();
    auth.signInWithPassword.mockRejectedValue(new Error("Network unavailable"));

    await expect(
      changeSignedInPassword(auth, {
        email: "roland@example.com",
        currentPassword: "current-password",
        newPassword: "new-secure-password",
      }),
    ).rejects.toThrow("Network unavailable");
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});
