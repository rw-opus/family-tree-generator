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

/* Product-owner inbox for anonymous feedback from every account. It only
   renders for a platform admin: loadFeedback rejects for anyone else (and
   when the migration is not applied yet), and we hide the whole panel in
   that case. */
export function SiteFeedbackInbox({ loadFeedback, onMarkHandled }) {
  const [status, setStatus] = useState("loading"); // loading | ready | hidden
  const [items, setItems] = useState([]);
  const [showHandled, setShowHandled] = useState(false);
  const [busyId, setBusyId] = useState("");

  const refresh = async () => {
    try {
      const rows = await loadFeedback();
      setItems(Array.isArray(rows) ? rows : []);
      setStatus("ready");
    } catch {
      setStatus("hidden"); // not a platform admin, or backend not ready
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "loading" || status === "hidden") return null;

  const newItems = items.filter((item) => !item.handledAt);
  const visible = showHandled ? items : newItems;

  const mark = async (item, handled) => {
    setBusyId(item.id);
    try {
      await onMarkHandled(item.id, handled);
      setItems((current) =>
        current.map((row) =>
          row.id === item.id
            ? { ...row, handledAt: handled ? new Date().toISOString() : null }
            : row,
        ),
      );
    } catch {
      /* leave as-is; a refresh will reconcile */
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
          <button type="button" className="admin-inline-action" onClick={refresh}>
            Refresh
          </button>
        </div>
      </div>
      <p className="feedback-inbox-note">
        Anonymous suggestions and bug reports from every account. No sender identity is recorded.
      </p>
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
