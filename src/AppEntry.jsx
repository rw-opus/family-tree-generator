import { useEffect, useState } from "react";
import { App } from "./App.jsx";
import { AuthScreen, ConfigurationError, PasswordResetScreen } from "./components/AuthScreen.jsx";
import { PublicLegalPage } from "./components/LegalNotice.jsx";
import { TermsBoundary } from "./components/TermsBoundary.jsx";
import { changeSignedInPassword } from "./services/accountPassword.js";
import { supabase, supabaseConfigured } from "./supabaseClient.js";

const LoadingScreen = () => (
  <main className="commercial-loading-screen">Loading your secure family workspace...</main>
);

const sessionUserId = (session) => String(session?.user?.id || "").trim();

const nextPasswordRecovery = (current, event, nextSession) => {
  if (event === "PASSWORD_RECOVERY") {
    return { userId: sessionUserId(nextSession) };
  }
  if (event === "SIGNED_OUT") return null;
  if (!current || !["INITIAL_SESSION", "SIGNED_IN"].includes(event)) return current;

  const nextUserId = sessionUserId(nextSession);
  return current.userId && nextUserId && current.userId !== nextUserId ? null : current;
};

export function AppEntry() {
  const requestedLegalPage = new URLSearchParams(window.location.search).get("legal");
  const legalPage = ["privacy", "terms"].includes(requestedLegalPage) ? requestedLegalPage : "";
  // A production build must never silently fall back to browser-local storage.
  // Local-only mode remains available in development when explicitly unconfigured.
  const commercialMode =
    import.meta.env.PROD || import.meta.env.VITE_COMMERCIAL_MODE === "true" || supabaseConfigured;
  const localOnlyMode = !commercialMode;
  const missingProductionConfig = commercialMode && !supabaseConfigured;
  const [session, setSession] = useState(localOnlyMode ? null : undefined);
  const [passwordRecovery, setPasswordRecovery] = useState(null);

  useEffect(() => {
    if (localOnlyMode || !supabase) return undefined;
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session || null))
      .catch((error) => {
        console.error("Could not restore the Supabase session", error);
        setSession(null);
      });
    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setPasswordRecovery((current) => nextPasswordRecovery(current, event, nextSession));
      setSession(nextSession);
    });
    return () => subscription.subscription.unsubscribe();
  }, [localOnlyMode]);

  if (legalPage) return <PublicLegalPage page={legalPage} />;
  if (missingProductionConfig) return <ConfigurationError />;
  if (localOnlyMode) {
    return (
      <TermsBoundary localOnlyMode>
        <App localOnlyMode />
      </TermsBoundary>
    );
  }
  if (session === undefined) return <LoadingScreen />;
  if (!session) return <AuthScreen />;
  if (passwordRecovery) {
    return (
      <PasswordResetScreen
        onDone={() => setPasswordRecovery(null)}
        onSignOut={() => {
          setPasswordRecovery(null);
          supabase.auth.signOut({ scope: "local" });
        }}
      />
    );
  }
  const signOut = () => supabase.auth.signOut({ scope: "local" });
  const changePassword = ({ currentPassword, newPassword }) =>
    changeSignedInPassword(supabase.auth, {
      email: session.user.email,
      currentPassword,
      newPassword,
    });
  return (
    <TermsBoundary session={session} onSignOut={signOut}>
      <App
        key={session.user.id}
        localOnlyMode={false}
        session={session}
        onChangePassword={changePassword}
        onSignOut={signOut}
      />
    </TermsBoundary>
  );
}
