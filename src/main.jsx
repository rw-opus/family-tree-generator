import React from "react";
import { createRoot } from "react-dom/client";
import { AppEntry } from "./AppEntry.jsx";
import { publicFamilyTreeErrorReference, sanitiseTelemetryEvent } from "./safetyUtils.js";
import "./styles.css";
import "./calculator.css";
import "./workbench.css";

const runtimeEnv = window.__FAMILY_TREE_ENV__ || {};
const sentryDsn = import.meta.env.VITE_SENTRY_DSN || runtimeEnv.VITE_SENTRY_DSN;
if (sentryDsn && import.meta.env.PROD) {
  import("@sentry/browser")
    .then(({ init }) =>
      init({
        dsn: sentryDsn,
        release: runtimeEnv.RELEASE_SHA || undefined,
        sendDefaultPii: false,
        beforeSend: sanitiseTelemetryEvent,
      }),
    )
    .catch((error) => console.error("Family Tree monitoring could not start", error));
}

window.addEventListener("error", (event) => {
  console.error("Unhandled Family Tree error", event.error || event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled Family Tree promise rejection", event.reason);
});

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Family Tree startup error", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="startup-error-page">
        <section className="startup-error-card">
          <p className="library-kicker">Family Tree Generator</p>
          <h1>The workspace could not open</h1>
          <p>
            Reload the page first. If the problem repeats, share the reference below with the person
            maintaining the service; it contains no family or property details.
          </p>
          <code>{publicFamilyTreeErrorReference(this.state.error)}</code>
          <button
            type="button"
            className="library-primary-button"
            onClick={() => location.reload()}
          >
            Reload workspace
          </button>
        </section>
      </main>
    );
  }
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <AppEntry />
    </AppErrorBoundary>
  </React.StrictMode>,
);
