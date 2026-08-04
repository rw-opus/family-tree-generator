import { useState } from "react";
import { Eye, EyeOff, GitBranch, ShieldCheck } from "lucide-react";
import { supabase } from "../supabaseClient.js";

export function AuthScreen() {
  const [mode, setMode] = useState("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const changeMode = (nextMode) => {
    setMode(nextMode);
    setError("");
    setMessage("");
  };

  const submit = async (event) => {
    event.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || trimmedEmail.length > 254) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "reset") {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
          redirectTo: window.location.origin,
        });
        if (resetError) throw resetError;
        setMessage("If an account exists for this email, a password reset link is on its way.");
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });
      if (signInError) throw signInError;
    } catch (requestError) {
      setError(requestError?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="commercial-auth-page">
      <section className="commercial-auth-intro">
        <span className="commercial-auth-logo">
          <GitBranch size={24} />
        </span>
        <p className="library-kicker">Property succession workspace</p>
        <h1>Family Tree Generator</h1>
        <p>
          Build the family structure, trace inherited property ownership and calculate each
          vendor&apos;s Maltese property tax position in one secure workspace.
        </p>
        <div className="commercial-price-callout">
          <strong>First 5 trees free</strong>
          <span>Then €30 for each additional tree. Editing an existing tree remains free.</span>
        </div>
        <span className="commercial-security-note">
          <ShieldCheck size={16} /> Private account storage protected by Supabase row-level security
        </span>
      </section>

      <form className="commercial-auth-card" onSubmit={submit}>
        <p className="library-kicker">Secure account</p>
        <h2>{mode === "reset" ? "Reset your password" : "Sign in"}</h2>
        <p className="commercial-auth-help">
          {mode === "reset"
            ? "We will send a reset link to your email address."
            : "Open your saved family trees and property calculations. Accounts are created by invitation."}
        </p>

        <label>
          Email address
          <input
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        {mode !== "reset" && (
          <label>
            Password
            <span className="commercial-password-field">
              <input
                type={showPassword ? "text" : "password"}
                required
                minLength={1}
                maxLength={1024}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </span>
          </label>
        )}

        {error && (
          <p className="commercial-auth-message error" role="alert" aria-atomic="true">
            {error}
          </p>
        )}
        {message && (
          <p
            className="commercial-auth-message success"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {message}
          </p>
        )}

        <button type="submit" className="library-primary-button" disabled={busy}>
          {busy ? "Please wait..." : mode === "reset" ? "Send reset link" : "Sign in"}
        </button>
        {mode === "reset" && (
          <button
            type="button"
            className="commercial-auth-link"
            onClick={() => changeMode("sign-in")}
          >
            Back to sign in
          </button>
        )}
        {mode === "sign-in" && (
          <button
            type="button"
            className="commercial-auth-link"
            onClick={() => changeMode("reset")}
          >
            Forgot password?
          </button>
        )}
        <nav className="commercial-legal-links" aria-label="Legal information">
          <a href="/?legal=terms">Terms and tax disclaimer</a>
          <a href="/?legal=privacy">Privacy Notice</a>
        </nav>
      </form>
    </main>
  );
}

export function PasswordResetScreen({ onDone, onSignOut }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    if (password.length < 10) {
      setError("Use a password of at least 10 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) setError(updateError.message || "Could not update the password.");
    else onDone();
  };

  return (
    <main className="commercial-auth-page single-card">
      <form className="commercial-auth-card" onSubmit={submit}>
        <p className="library-kicker">Secure account</p>
        <h2>Choose a new password</h2>
        <label>
          New password
          <input
            type="password"
            required
            minLength={10}
            maxLength={1024}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label>
          Repeat new password
          <input
            type="password"
            required
            minLength={10}
            maxLength={1024}
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </label>
        {error && (
          <p className="commercial-auth-message error" role="alert" aria-atomic="true">
            {error}
          </p>
        )}
        <button type="submit" className="library-primary-button" disabled={busy}>
          {busy ? "Please wait..." : "Set new password"}
        </button>
        <button type="button" className="commercial-auth-link" onClick={onSignOut}>
          Cancel and sign out
        </button>
      </form>
    </main>
  );
}

export function ConfigurationError() {
  return (
    <main className="commercial-auth-page single-card">
      <section className="commercial-auth-card configuration-error">
        <p className="library-kicker">Configuration needed</p>
        <h2>Secure storage is not connected</h2>
        <p>
          This production deployment requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.
          The application has stopped rather than store client data insecurely.
        </p>
      </section>
    </main>
  );
}
