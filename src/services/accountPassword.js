const authFailure = (error, fallback) => {
  const message = String(error?.message || "").trim();
  return new Error(message || fallback, { cause: error });
};

export async function changeSignedInPassword(auth, { email, currentPassword, newPassword }) {
  if (!auth || typeof auth.signInWithPassword !== "function") {
    throw new Error("Password changes are unavailable at the moment.");
  }
  if (!String(email || "").trim()) {
    throw new Error("This account has no email address available for verification.");
  }

  const { error: verificationError } = await auth.signInWithPassword({
    email: String(email).trim().toLowerCase(),
    password: currentPassword,
  });
  if (verificationError) {
    throw authFailure(verificationError, "The current password could not be verified.");
  }

  const { error: updateError } = await auth.updateUser({
    current_password: currentPassword,
    password: newPassword,
  });
  if (updateError) {
    throw authFailure(updateError, "The password could not be changed.");
  }
}
