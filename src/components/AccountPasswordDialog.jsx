import { useState } from "react";
import { KeyRound, X } from "lucide-react";

const emptyDraft = { currentPassword: "", newPassword: "", confirmPassword: "" };

export function AccountPasswordDialog({ onChangePassword, onClose }) {
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  const updateField = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setError("");
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy || complete) return;
    if (!draft.currentPassword) {
      setError("Enter your current password.");
      return;
    }
    if (draft.newPassword.length < 10) {
      setError("Use a new password of at least 10 characters.");
      return;
    }
    if (draft.newPassword !== draft.confirmPassword) {
      setError("The two new passwords do not match.");
      return;
    }
    if (draft.newPassword === draft.currentPassword) {
      setError("Choose a new password that is different from your current password.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await onChangePassword({
        currentPassword: draft.currentPassword,
        newPassword: draft.newPassword,
      });
      setDraft(emptyDraft);
      setComplete(true);
    } catch (requestError) {
      setError(requestError?.message || "The password could not be changed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="library-dialog-backdrop" role="presentation">
      <form
        className="library-dialog account-password-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-password-title"
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <div className="library-dialog-heading">
          <div>
            <p className="library-kicker">Secure account</p>
            <h2 id="change-password-title">{complete ? "Password changed" : "Change password"}</h2>
          </div>
          <button
            type="button"
            className="library-icon-button"
            onClick={onClose}
            aria-label="Close password change"
            disabled={busy}
          >
            <X size={16} />
          </button>
        </div>

        {complete ? (
          <p className="commercial-auth-message success" role="status" aria-live="polite">
            Your password has been changed successfully.
          </p>
        ) : (
          <>
            <p className="library-dialog-intro">
              Confirm your current password, then choose a new one with at least 10 characters.
            </p>
            <label className="library-dialog-field full-width">
              <span>Current password</span>
              <input
                autoFocus
                type="password"
                required
                maxLength={1024}
                autoComplete="current-password"
                value={draft.currentPassword}
                onChange={(event) => updateField("currentPassword", event.target.value)}
              />
            </label>
            <div className="library-dialog-fields">
              <label className="library-dialog-field">
                <span>New password</span>
                <input
                  type="password"
                  required
                  minLength={10}
                  maxLength={1024}
                  autoComplete="new-password"
                  value={draft.newPassword}
                  onChange={(event) => updateField("newPassword", event.target.value)}
                />
              </label>
              <label className="library-dialog-field">
                <span>Repeat new password</span>
                <input
                  type="password"
                  required
                  minLength={10}
                  maxLength={1024}
                  autoComplete="new-password"
                  value={draft.confirmPassword}
                  onChange={(event) => updateField("confirmPassword", event.target.value)}
                />
              </label>
            </div>
          </>
        )}

        {error && (
          <p className="commercial-auth-message error" role="alert" aria-atomic="true">
            {error}
          </p>
        )}
        <div className="library-dialog-actions">
          {!complete && (
            <button
              type="button"
              className="library-secondary-button"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
          )}
          <button
            type={complete ? "button" : "submit"}
            className="library-primary-button"
            onClick={complete ? onClose : undefined}
            disabled={busy}
          >
            <KeyRound size={16} />
            {complete ? "Done" : busy ? "Changing password..." : "Change password"}
          </button>
        </div>
      </form>
    </div>
  );
}
