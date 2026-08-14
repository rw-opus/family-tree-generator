export const PUBLIC_AUTH_MESSAGES = Object.freeze({
  resetRequestAcknowledged:
    "If an account exists for this email, a password reset link is on its way.",
  resetRequestUnavailable: "Password reset is unavailable right now. Please try again later.",
  signInRejected: "The email address or password is incorrect.",
  signInUnavailable: "Sign-in is unavailable right now. Please try again later.",
  passwordUpdateFailed: "The password could not be changed. Request a new link and try again.",
});

const RESET_REQUEST_ACCOUNT_STATE_CODES = new Set(["user_not_found"]);

export function publicResetRequestOutcome(error, { requestRejected = false } = {}) {
  const acknowledged =
    !requestRejected && (!error || RESET_REQUEST_ACCOUNT_STATE_CODES.has(error.code));

  return acknowledged
    ? { kind: "acknowledged", message: PUBLIC_AUTH_MESSAGES.resetRequestAcknowledged }
    : { kind: "unavailable", message: PUBLIC_AUTH_MESSAGES.resetRequestUnavailable };
}

export function publicSignInFailure({ requestUnavailable = false } = {}) {
  return requestUnavailable
    ? PUBLIC_AUTH_MESSAGES.signInUnavailable
    : PUBLIC_AUTH_MESSAGES.signInRejected;
}
