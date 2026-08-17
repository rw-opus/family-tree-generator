import { useEffect, useRef, useState } from "react";
import { Gauge, Megaphone, MessageSquare } from "lucide-react";
import {
  createAdminRequestId,
  grantTreeCredits,
  loadPlatformOverview,
  MAX_ADMIN_CREDIT_GRANT,
  setUnlimitedTrees,
  getAnnouncement,
  setAnnouncement,
} from "../services/adminConsole.js";
import {
  clearPendingAdminMutation,
  getOrCreatePendingAdminMutation,
} from "../services/adminMutationRequests.js";
import { listSiteFeedback, setSiteFeedbackHandled } from "../services/siteFeedback.js";
import { AnnouncementBanner } from "./AnnouncementBanner.jsx";
import { SiteFeedbackInbox } from "./SiteFeedbackInbox.jsx";
import "./AdminConsole.css";

const TABS = [
  ["overview", "Overview", Gauge],
  ["feedback", "Feedback", MessageSquare],
  ["announcement", "Announcement", Megaphone],
];

const dateTime = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : `${date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};

function Loader({ status, error, empty, children }) {
  if (status === "loading") return <p className="admin-console-loader">Loading…</p>;
  if (status === "error") {
    return (
      <p className="admin-console-loader error">
        {error || "Could not load. The admin migration may not be applied yet."}
      </p>
    );
  }
  if (status === "empty") return <p className="admin-console-loader">{empty}</p>;
  return children;
}

function ActionStatus({ status }) {
  if (!status.message) return null;
  return (
    <p
      className={`admin-action-status ${status.tone}`}
      role={status.tone === "error" ? "alert" : "status"}
      aria-live={status.tone === "error" ? "assertive" : "polite"}
    >
      {status.message}
    </p>
  );
}

export function CreditsCell({ account, onGrant }) {
  const [value, setValue] = useState("1");
  const [busy, setBusy] = useState(false);
  const [actionStatus, setActionStatus] = useState({ message: "", tone: "" });
  const busyRef = useRef(false);
  const credits = Number(value);
  const valid = Number.isInteger(credits) && credits >= 1 && credits <= MAX_ADMIN_CREDIT_GRANT;

  const grant = async () => {
    if (busyRef.current || !valid) return;
    const nextBalance = account.paidTreeCredits + credits;
    const confirmed = window.confirm(
      `Add ${credits} paid tree credit${credits === 1 ? "" : "s"} to ${account.email} (${account.userId})?\n\nBalance: ${account.paidTreeCredits} -> ${nextBalance} (+${credits}).`,
    );
    if (!confirmed) return;

    const mutation = {
      operation: "grant-tree-credits",
      targetUserId: account.userId,
      payload: credits,
    };
    let requestId;
    try {
      requestId = getOrCreatePendingAdminMutation(mutation, createAdminRequestId);
    } catch (error) {
      setActionStatus({
        message: error?.message || "Could not prepare the credit grant.",
        tone: "error",
      });
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setActionStatus({ message: "", tone: "" });
    try {
      await onGrant(account, credits, { requestId });
      clearPendingAdminMutation(mutation, requestId);
      setActionStatus({
        message: `Added ${credits} paid tree credit${credits === 1 ? "" : "s"} to ${account.email}.`,
        tone: "success",
      });
    } catch (error) {
      setActionStatus({
        message: error?.message || `Could not add paid credits to ${account.email}.`,
        tone: "error",
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="admin-entitlement-action">
      <div className="admin-entitlement-controls">
        <span aria-label={`${account.email} has ${account.paidTreeCredits} paid tree credits`}>
          {account.paidTreeCredits}
        </span>
        <input
          type="number"
          min="1"
          max={MAX_ADMIN_CREDIT_GRANT}
          step="1"
          inputMode="numeric"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
          disabled={busy}
          aria-label={`Paid credits to add for ${account.email} (${account.userId}), maximum ${MAX_ADMIN_CREDIT_GRANT}`}
        />
        <button
          type="button"
          className="admin-inline-action"
          disabled={busy || !valid}
          onClick={grant}
          aria-label={`Add paid credits to ${account.email} (${account.userId})`}
        >
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
      <ActionStatus status={actionStatus} />
    </div>
  );
}

export function UnlimitedControl({ account, onToggle }) {
  const [busy, setBusy] = useState(false);
  const [actionStatus, setActionStatus] = useState({ message: "", tone: "" });
  const busyRef = useRef(false);

  const toggle = async () => {
    if (busyRef.current) return;
    const next = !account.unlimitedTrees;
    const confirmed = window.confirm(
      next
        ? `Grant unlimited tree creation to ${account.email} (${account.userId}), bypassing free and paid credits?`
        : `Revoke unlimited tree creation for ${account.email} (${account.userId})? The account will return to its free and paid-credit allowance.`,
    );
    if (!confirmed) {
      return;
    }

    const mutation = {
      operation: "set-unlimited-trees",
      targetUserId: account.userId,
      payload: next,
    };
    let requestId;
    try {
      requestId = getOrCreatePendingAdminMutation(mutation, createAdminRequestId);
    } catch (error) {
      setActionStatus({
        message: error?.message || "Could not prepare the unlimited-tree change.",
        tone: "error",
      });
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setActionStatus({ message: "", tone: "" });
    try {
      await onToggle(account, next, { requestId });
      clearPendingAdminMutation(mutation, requestId);
      setActionStatus({
        message: `Unlimited tree creation ${next ? "granted to" : "revoked for"} ${account.email}.`,
        tone: "success",
      });
    } catch (error) {
      setActionStatus({
        message:
          error?.message || `Could not ${next ? "grant" : "revoke"} unlimited tree creation.`,
        tone: "error",
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="admin-entitlement-action">
      <button
        type="button"
        className="admin-inline-action"
        disabled={busy}
        onClick={toggle}
        aria-label={`${account.unlimitedTrees ? "Revoke" : "Grant"} unlimited tree creation for ${account.email} (${account.userId})`}
      >
        {busy
          ? account.unlimitedTrees
            ? "Revoking…"
            : "Granting…"
          : account.unlimitedTrees
            ? "Revoke unlimited"
            : "Grant unlimited"}
      </button>
      <ActionStatus status={actionStatus} />
    </div>
  );
}

function OverviewTab() {
  const [accounts, setAccounts] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  const refresh = async () => {
    const rows = await loadPlatformOverview();
    setAccounts(rows);
    setError("");
    setStatus(rows.length ? "ready" : "empty");
    return rows;
  };

  useEffect(() => {
    refresh().catch((e) => {
      setError(e?.message || "");
      setStatus("error");
    });
  }, []);

  const refreshAfterChange = async (savedMessage) => {
    try {
      await refresh();
    } catch {
      throw new Error(
        `${savedMessage} The latest account data could not be reloaded; close and reopen the Overview before making another change.`,
      );
    }
  };

  const toggleUnlimited = async (account, next, options) => {
    await setUnlimitedTrees(account.userId, next, options);
    await refreshAfterChange(
      `Unlimited tree creation was ${next ? "granted" : "revoked"} successfully.`,
    );
  };

  const grant = async (account, credits, options) => {
    await grantTreeCredits(account.userId, credits, options);
    await refreshAfterChange("The paid credits were added successfully.");
  };

  const cards = [
    { label: "Accounts", value: accounts.length },
    { label: "Trees (active)", value: accounts.reduce((sum, a) => sum + a.treesActive, 0) },
    { label: "Unlimited accounts", value: accounts.filter((a) => a.unlimitedTrees).length },
    {
      label: "Paid credits outstanding",
      value: accounts.reduce((sum, a) => sum + a.paidTreeCredits, 0),
    },
  ];

  return (
    <div>
      {status === "ready" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(9rem, 1fr))",
            gap: "0.75rem",
            marginBottom: "1rem",
          }}
        >
          {cards.map((card) => (
            <div key={card.label} className="admin-console-panel" style={{ padding: "0.85rem" }}>
              <div style={{ font: "700 1.4rem var(--tracker-serif)" }}>{card.value}</div>
              <div
                style={{
                  marginTop: "0.2rem",
                  color: "var(--muted)",
                  fontSize: "var(--type-micro)",
                  fontWeight: 700,
                  textTransform: "uppercase",
                }}
              >
                {card.label}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="admin-console-panel">
        <div className="admin-table-wrap">
          <Loader status={status} error={error} empty="No accounts yet.">
            <table className="admin-table">
              <caption className="admin-visually-hidden">
                Platform accounts and tree entitlements
              </caption>
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Trees</th>
                  <th scope="col">Free used</th>
                  <th scope="col">Paid credits</th>
                  <th scope="col">Unlimited</th>
                  <th scope="col">Last activity</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.userId}>
                    <th scope="row" className="admin-account-cell">
                      <div className="admin-table-email">{account.email}</div>
                      <div className="admin-account-id">{account.userId}</div>
                      <div style={{ color: "var(--muted)", fontSize: "var(--type-micro)" }}>
                        Joined {dateTime(account.createdAt)}
                      </div>
                    </th>
                    <td>
                      {account.treesActive} active
                      {account.treesTrashed > 0 && (
                        <span style={{ color: "var(--muted)" }}>
                          {" "}
                          / {account.treesTrashed} trashed
                        </span>
                      )}
                    </td>
                    <td>
                      {account.freeTreesUsed} / {account.freeTreeLimit}
                    </td>
                    <td>
                      <CreditsCell account={account} onGrant={grant} />
                    </td>
                    <td>
                      <span
                        className={`admin-badge ${account.unlimitedTrees ? "unlimited" : "limited"}`}
                      >
                        {account.unlimitedTrees ? "Unlimited" : "Standard"}
                      </span>
                    </td>
                    <td>{dateTime(account.lastActivity)}</td>
                    <td>
                      <UnlimitedControl account={account} onToggle={toggleUnlimited} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Loader>
        </div>
        <p className="admin-console-footnote">
          Every tree costs €30 after the free allowance. Unlimited bypasses both free and paid
          credits; grant it sparingly. Paid credits are added on top of whatever the account already
          holds.
        </p>
      </div>
    </div>
  );
}

function AnnouncementTab() {
  const [message, setMessage] = useState("");
  const [level, setLevel] = useState("info");
  const [status, setStatus] = useState("loading");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState({ message: "", tone: "" });
  const busyRef = useRef(false);

  const load = () => {
    setStatus("loading");
    getAnnouncement()
      .then((a) => {
        setMessage(a?.message || "");
        setLevel(a?.level || "info");
        setStatus("ready");
      })
      .catch((error) => {
        setStatus("error");
        setSaved({
          message: error?.message || "Could not load the current announcement.",
          tone: "error",
        });
      });
  };
  useEffect(() => {
    load();
  }, []);

  const publish = async (clear = false) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setSaved({ message: "", tone: "" });
    try {
      await setAnnouncement({ message: clear ? "" : message, level });
      if (clear) setMessage("");
      setSaved({
        message: clear ? "Banner cleared." : "Banner published to every signed-in account.",
        tone: "success",
      });
    } catch (e) {
      setSaved({ message: e?.message || "Could not save.", tone: "error" });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  if (status === "loading") return <p className="admin-console-loader">Loading…</p>;

  return (
    <div className="admin-console-panel admin-announcement-editor">
      <h3>Announcement banner</h3>
      <p id="admin-announcement-help">
        Shows at the top of the app for every signed-in account until cleared. Leave empty and clear
        to remove it.
      </p>
      <label className="admin-announcement-message-label" htmlFor="admin-announcement-message">
        Banner message
      </label>
      <textarea
        id="admin-announcement-message"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        rows={3}
        placeholder="e.g. Scheduled maintenance on Sunday 22:00–23:00."
        aria-describedby="admin-announcement-help"
        disabled={busy}
      />
      <div className="admin-announcement-controls">
        <label>
          Style{" "}
          <select value={level} onChange={(event) => setLevel(event.target.value)}>
            <option value="info">Info (green)</option>
            <option value="warning">Warning (amber)</option>
          </select>
        </label>
        <button
          type="button"
          className="library-primary-button"
          disabled={busy || !message.trim()}
          onClick={() => publish(false)}
        >
          {busy ? "Saving…" : "Publish"}
        </button>
        <button
          type="button"
          className="library-secondary-button"
          disabled={busy}
          onClick={() => publish(true)}
        >
          Clear
        </button>
        {saved.message && (
          <span
            className={`admin-announcement-status ${saved.tone}`}
            role={saved.tone === "error" ? "alert" : "status"}
            aria-live={saved.tone === "error" ? "assertive" : "polite"}
          >
            {saved.message}
          </span>
        )}
      </div>
    </div>
  );
}

export function AdminConsole({ onClose }) {
  const [tab, setTab] = useState("overview");
  const loadFeedback = (options) => listSiteFeedback(options);
  const markFeedbackHandled = (id, handled) => setSiteFeedbackHandled(id, handled);

  return (
    <main className="admin-console-page" aria-labelledby="admin-console-title">
      <AnnouncementBanner />
      <div className="admin-console-content">
        <div className="admin-console-header">
          <div>
            <h1 id="admin-console-title">Admin Console</h1>
            <p>Platform administration for the product owner.</p>
          </div>
          {onClose && (
            <button
              type="button"
              className="library-secondary-button"
              onClick={onClose}
              aria-label="Close admin console"
            >
              Close
            </button>
          )}
        </div>
        <div className="admin-console-tabs" role="tablist" aria-label="Admin console sections">
          {TABS.map(([key, label, Icon], index) => (
            <button
              key={key}
              id={`admin-tab-${key}`}
              type="button"
              role="tab"
              aria-selected={tab === key}
              aria-controls={`admin-panel-${key}`}
              tabIndex={tab === key ? 0 : -1}
              className={`admin-console-tab ${tab === key ? "active" : ""}`}
              onClick={() => setTab(key)}
              onKeyDown={(event) => {
                const finalIndex = TABS.length - 1;
                const nextIndex =
                  event.key === "ArrowRight"
                    ? (index + 1) % TABS.length
                    : event.key === "ArrowLeft"
                      ? (index + finalIndex) % TABS.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? finalIndex
                          : -1;
                if (nextIndex < 0) return;
                event.preventDefault();
                const nextKey = TABS[nextIndex][0];
                setTab(nextKey);
                document.getElementById(`admin-tab-${nextKey}`)?.focus();
              }}
            >
              <Icon size={15} aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
        {tab === "overview" && (
          <section id="admin-panel-overview" role="tabpanel" aria-labelledby="admin-tab-overview">
            <OverviewTab />
          </section>
        )}
        {tab === "feedback" && (
          <section id="admin-panel-feedback" role="tabpanel" aria-labelledby="admin-tab-feedback">
            <div className="admin-console-panel">
              <SiteFeedbackInbox loadFeedback={loadFeedback} onMarkHandled={markFeedbackHandled} />
            </div>
          </section>
        )}
        {tab === "announcement" && (
          <section
            id="admin-panel-announcement"
            role="tabpanel"
            aria-labelledby="admin-tab-announcement"
          >
            <AnnouncementTab />
          </section>
        )}
      </div>
    </main>
  );
}
