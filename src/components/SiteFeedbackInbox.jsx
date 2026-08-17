import { useEffect, useState } from "react";
import { Bug, Check, Inbox, Lightbulb, RotateCcw } from "lucide-react";
import "./AdminConsole.css";

const fmtWhen = (at) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
};

/* Product-owner inbox for feedback records that omit account identifiers.
   The parent admin console controls access; backend authorization remains the
   source of truth and load failures are reported without exposing data. */
export function SiteFeedbackInbox({ loadFeedback, onMarkHandled }) {
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [items, setItems] = useState([]);
  const [showHandled, setShowHandled] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [actionStatus, setActionStatus] = useState({ message: "", tone: "" });

  const refresh = async (includeHandled = showHandled) => {
    setStatus("loading");
    setActionStatus({ message: "", tone: "" });
    try {
      const rows = await loadFeedback({ includeHandled });
      setItems(Array.isArray(rows) ? rows : []);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  };

  useEffect(() => {
    refresh(showHandled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHandled]);

  if (status === "loading") {
    return (
      <p className="admin-console-loader" role="status" aria-live="polite">
        Loading feedback…
      </p>
    );
  }

  if (status === "error") {
    return (
      <section className="feedback-inbox" data-testid="site-feedback-inbox">
        <p className="admin-console-loader error" role="alert">
          Feedback could not be loaded. Check your connection or administrator access and try again.
        </p>
        <button type="button" className="admin-inline-action" onClick={() => refresh(showHandled)}>
          Retry
        </button>
      </section>
    );
  }

  const newItems = items.filter((item) => !item.handledAt);
  const visible = showHandled ? items : newItems;

  const mark = async (item, handled) => {
    setBusyId(item.id);
    setActionStatus({ message: "", tone: "" });
    try {
      await onMarkHandled(item.id, handled);
      setItems((current) =>
        current.map((row) =>
          row.id === item.id
            ? { ...row, handledAt: handled ? new Date().toISOString() : null }
            : row,
        ),
      );
      setActionStatus({
        message: handled ? "Feedback marked as done." : "Feedback reopened.",
        tone: "success",
      });
    } catch {
      setActionStatus({
        message: "The feedback status could not be updated. Try again.",
        tone: "error",
      });
    } finally {
      setBusyId("");
    }
  };

  return (
    <section className="feedback-inbox" data-testid="site-feedback-inbox">
      <div className="feedback-inbox-header">
        <h2>
          <Inbox size={18} aria-hidden="true" /> Feedback Inbox
          {newItems.length > 0 && <span className="feedback-new-count">{newItems.length} new</span>}
        </h2>
        <div className="feedback-inbox-controls">
          <label>
            <input
              type="checkbox"
              checked={showHandled}
              onChange={(event) => setShowHandled(event.target.checked)}
            />{" "}
            Show done
          </label>
          <button
            type="button"
            className="admin-inline-action"
            onClick={() => refresh(showHandled)}
          >
            Refresh
          </button>
        </div>
      </div>
      <p className="feedback-inbox-note">
        Feedback rows do not contain an account ID or email address. Supabase service logs may
        identify the signed-in requester, and messages may identify a sender if they include
        personal details.
      </p>
      {actionStatus.message && (
        <p
          className={`feedback-inbox-action-status ${actionStatus.tone}`}
          role={actionStatus.tone === "error" ? "alert" : "status"}
          aria-live={actionStatus.tone === "error" ? "assertive" : "polite"}
        >
          {actionStatus.message}
        </p>
      )}
      {visible.length === 0 ? (
        <p className="admin-console-loader">
          {showHandled ? "No feedback yet." : "No new feedback - you're all caught up."}
        </p>
      ) : (
        <ul className="feedback-list">
          {visible.map((item) => (
            <li key={item.id} className={`feedback-item ${item.handledAt ? "handled" : ""}`}>
              <span className={`feedback-kind ${item.kind}`}>
                {item.kind === "bug" ? <Bug size={11} /> : <Lightbulb size={11} />}
                {item.kind === "bug" ? "Bug" : "Suggestion"}
              </span>
              <div className="feedback-item-body">
                <p className="feedback-item-message">{item.message}</p>
                <p className="feedback-item-meta">
                  {fmtWhen(item.createdAt)}
                  {item.handledAt ? " · done" : ""}
                </p>
              </div>
              {item.handledAt ? (
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => mark(item, false)}
                  className="admin-inline-action"
                >
                  <RotateCcw size={12} /> Reopen
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => mark(item, true)}
                  className="admin-inline-action"
                >
                  <Check size={12} /> Mark done
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
