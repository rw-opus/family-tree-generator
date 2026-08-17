import { useEffect, useRef, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { feedbackValidationMessage, submitSiteFeedback } from "../services/siteFeedback.js";
import "./AdminConsole.css";

/* Small, always-available control for sending product feedback. Shown only
   when signed in to a cloud account. The feedback row omits account identity,
   while the privacy copy accurately discloses service-request logging. */
export function SiteFeedbackForm() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("suggestion");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ message: "", tone: "" });
  const triggerRef = useRef(null);
  const dialogRef = useRef(null);
  const messageRef = useRef(null);
  const openedRef = useRef(false);
  const closeTimerRef = useRef(null);

  useEffect(() => {
    if (open) {
      openedRef.current = true;
      messageRef.current?.focus();
      return;
    }
    if (openedRef.current) {
      openedRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  useEffect(
    () => () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    },
    [],
  );

  const close = () => {
    if (busy) return;
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    setOpen(false);
    setMessage("");
    setStatus({ message: "", tone: "" });
  };

  const handleDialogKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = [
      ...(dialogRef.current?.querySelectorAll("button, input, textarea") || []),
    ].filter((element) => !element.disabled && element.tabIndex !== -1);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    const validationMessage = feedbackValidationMessage(kind, message);
    if (validationMessage) {
      setStatus({ message: validationMessage, tone: "error" });
      return;
    }
    setBusy(true);
    setStatus({ message: "", tone: "" });
    try {
      await submitSiteFeedback({ kind, message });
      setStatus({ message: "Thank you - your feedback has been sent.", tone: "success" });
      setMessage("");
      closeTimerRef.current = window.setTimeout(() => setOpen(false), 1200);
    } catch (error) {
      setStatus({ message: error?.message || "Could not send feedback.", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="feedback-form-trigger"
        onClick={() => {
          setStatus({ message: "", tone: "" });
          setOpen(true);
        }}
        aria-label="Send feedback"
      >
        <MessageSquarePlus size={15} /> Send feedback
      </button>
      {open && (
        <div className="feedback-form-dialog-backdrop" role="presentation" onClick={close}>
          <form
            ref={dialogRef}
            className="feedback-form-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-form-title"
            aria-describedby="feedback-form-description feedback-form-privacy"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={handleDialogKeyDown}
            onSubmit={submit}
          >
            <h3 id="feedback-form-title">Send feedback</h3>
            <p id="feedback-form-description">
              A quick suggestion or bug report for the product owner.
            </p>
            <p id="feedback-form-privacy" className="feedback-form-privacy">
              Your account ID and email are not attached to the feedback record. Supabase service
              logs may identify the signed-in requester. Do not include client names, personal data,
              privileged information or other confidential case details.
            </p>
            <fieldset className="feedback-form-kind" disabled={busy}>
              <legend>Feedback type</legend>
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
            </fieldset>
            <label className="feedback-form-message-label" htmlFor="site-feedback-message">
              Feedback
            </label>
            <textarea
              ref={messageRef}
              id="site-feedback-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={3000}
              placeholder="What's on your mind?"
              aria-required="true"
              disabled={busy}
            />
            {status.message && (
              <p
                id="feedback-form-status"
                className={`feedback-form-status ${status.tone}`}
                role={status.tone === "error" ? "alert" : "status"}
                aria-live={status.tone === "error" ? "assertive" : "polite"}
              >
                {status.message}
              </p>
            )}
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
