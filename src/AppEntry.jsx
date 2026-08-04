import { useEffect, useState } from "react";
import { App } from "./App.jsx";
import { AuthScreen, ConfigurationError, PasswordResetScreen } from "./components/AuthScreen.jsx";
import { PublicLegalPage } from "./components/LegalNotice.jsx";
import { TermsBoundary } from "./components/TermsBoundary.jsx";
import { supabase, supabaseConfigured } from "./supabaseClient.js";

const LoadingScreen = () => (
  <main className="commercial-loading-screen">Loading your secure family workspace...</main>
);

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
  const [passwordRecovery, setPasswordRecovery] = useState(false);

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
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
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
        onDone={() => setPasswordRecovery(false)}
        onSignOut={() => {
          setPasswordRecovery(false);
          supabase.auth.signOut({ scope: "local" });
        }}
      />
    );
  }
  const signOut = () => supabase.auth.signOut({ scope: "local" });
  return (
    <TermsBoundary session={session} onSignOut={signOut}>
      <App session={session} onSignOut={signOut} />
    </TermsBoundary>
  );
}
