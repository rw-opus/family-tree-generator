import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { feedbackValidationMessage, submitSiteFeedback } from "../services/siteFeedback.js";
import "./AdminConsole.css";

/* Small, always-available control for sending anonymous product feedback.
   Shown only when signed in to a cloud account (feedback is tied to being
   authenticated, not to a particular identity - see siteFeedback.js). */
export function SiteFeedbackForm() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("suggestion");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const close = () => {
    if (busy) return;
    setOpen(false);
    setMessage("");
    setStatus("");
  };

  const submit = async (event) => {
    event.preventDefault();
    const validationMessage = feedbackValidationMessage(kind, message);
    if (validationMessage) {
      setStatus(validationMessage);
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      await submitSiteFeedback({ kind, message });
      setStatus("Thank you - your feedback has been sent.");
      setMessage("");
      window.setTimeout(() => setOpen(false), 1200);
    } catch (error) {
      setStatus(error?.message || "Could not send feedback.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="feedback-form-trigger"
        onClick={() => setOpen(true)}
        aria-label="Send feedback"
      >
        <MessageSquarePlus size={15} /> Send feedback
      </button>
      {open && (
        <div className="feedback-form-dialog-backdrop" onClick={close}>
          <form
            className="feedback-form-dialog"
            onClick={(event) => event.stopPropagation()}
            onSubmit={submit}
          >
            <h3>Send feedback</h3>
            <p>A quick suggestion or bug report for the product owner. Nothing identifies you.</p>
            <div className="feedback-form-kind">
              <label>
                <input
                  type="radio"
                  name="feedback-kind"
                  checked={kind === "suggestion"}
                  onChange={() => setKind("suggestion")}
                />{" "}
                Suggestion
              </label>
              <label>
                <input
                  type="radio"
                  name="feedback-kind"
                  checked={kind === "bug"}
                  onChange={() => setKind("bug")}
                />{" "}
                Bug report
              </label>
            </div>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={3000}
              placeholder="What's on your mind?"
              autoFocus
            />
            {status && <p className="feedback-form-status">{status}</p>}
            <div className="feedback-form-actions">
              <button
                type="button"
                className="library-secondary-button"
                onClick={close}
                disabled={busy}
              >
                Cancel
              </button>
              <button type="submit" className="library-primary-button" disabled={busy}>
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
