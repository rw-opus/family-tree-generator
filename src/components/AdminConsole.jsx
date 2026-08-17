import { useEffect, useState } from "react";
import { Gauge, Megaphone, MessageSquare } from "lucide-react";
import {
  grantTreeCredits,
  loadPlatformOverview,
  setUnlimitedTrees,
  getAnnouncement,
  setAnnouncement,
} from "../services/adminConsole.js";
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

function CreditsCell({ account, onGrant }) {
  const [value, setValue] = useState("1");
  const [busy, setBusy] = useState(false);
  const grant = async () => {
    const credits = parseInt(value, 10);
    if (!Number.isFinite(credits) || credits <= 0) return;
    setBusy(true);
    try {
      await onGrant(account.userId, credits);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
      <span>{account.paidTreeCredits}</span>
      <input
        type="number"
        min="1"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        style={{ width: "3.2rem" }}
      />
      <button type="button" className="admin-inline-action" disabled={busy} onClick={grant}>
        {busy ? "…" : "Add"}
      </button>
    </div>
  );
}

function OverviewTab() {
  const [accounts, setAccounts] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  const refresh = () =>
    loadPlatformOverview()
      .then((rows) => {
        setAccounts(rows);
        setStatus(rows.length ? "ready" : "empty");
      })
      .catch((e) => {
        setError(e?.message || "");
        setStatus("error");
      });

  useEffect(() => {
    refresh();
  }, []);

  const toggleUnlimited = async (account) => {
    const next = !account.unlimitedTrees;
    if (
      next &&
      !window.confirm(
        `Grant ${account.email} unlimited tree creation, bypassing free and paid credits?`,
      )
    ) {
      return;
    }
    await setUnlimitedTrees(account.userId, next);
    await refresh();
  };

  const grant = async (userId, credits) => {
    await grantTreeCredits(userId, credits);
    await refresh();
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
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Trees</th>
                  <th>Free used</th>
                  <th>Paid credits</th>
                  <th>Unlimited</th>
                  <th>Last activity</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.userId}>
                    <td>
                      <div className="admin-table-email">{account.email}</div>
                      <div style={{ color: "var(--muted)", fontSize: "var(--type-micro)" }}>
                        Joined {dateTime(account.createdAt)}
                      </div>
                    </td>
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
                      <button
                        type="button"
                        className="admin-inline-action"
                        onClick={() => toggleUnlimited(account)}
                      >
                        {account.unlimitedTrees ? "Revoke unlimited" : "Grant unlimited"}
                      </button>
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
  const [saved, setSaved] = useState("");

  const load = () => {
    setStatus("loading");
    getAnnouncement()
      .then((a) => {
        setMessage(a?.message || "");
        setLevel(a?.level || "info");
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  };
  useEffect(() => {
    load();
  }, []);

  const publish = async (clear = false) => {
    setBusy(true);
    setSaved("");
    try {
      await setAnnouncement({ message: clear ? "" : message, level });
      if (clear) setMessage("");
      setSaved(clear ? "Banner cleared." : "Banner published to every signed-in account.");
    } catch (e) {
      setSaved(e?.message || "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  if (status === "loading") return <p className="admin-console-loader">Loading…</p>;

  return (
    <div className="admin-console-panel admin-announcement-editor">
      <h3>Announcement banner</h3>
      <p>
        Shows at the top of the app for every signed-in account until cleared. Leave empty and clear
        to remove it.
      </p>
      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        rows={3}
        placeholder="e.g. Scheduled maintenance on Sunday 22:00–23:00."
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
        {saved && <span className="admin-announcement-status">{saved}</span>}
      </div>
    </div>
  );
}

export function AdminConsole({ onClose }) {
  const [tab, setTab] = useState("overview");
  const loadFeedback = () => listSiteFeedback();
  const markFeedbackHandled = (id, handled) => setSiteFeedbackHandled(id, handled);

  return (
    <main className="admin-console-page">
      <AnnouncementBanner />
      <div className="admin-console-content">
        <div className="admin-console-header">
          <div>
            <h1>Admin Console</h1>
            <p>Platform administration for the product owner.</p>
          </div>
          {onClose && (
            <button type="button" className="library-secondary-button" onClick={onClose}>
              Close
            </button>
          )}
        </div>
        <div className="admin-console-tabs">
          {TABS.map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              className={`admin-console-tab ${tab === key ? "active" : ""}`}
              onClick={() => setTab(key)}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
        {tab === "overview" && <OverviewTab />}
        {tab === "feedback" && (
          <div className="admin-console-panel">
            <SiteFeedbackInbox loadFeedback={loadFeedback} onMarkHandled={markFeedbackHandled} />
          </div>
        )}
        {tab === "announcement" && <AnnouncementTab />}
      </div>
    </main>
  );
}
