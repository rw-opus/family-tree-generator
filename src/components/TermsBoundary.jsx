import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient.js";
import { TERMS_VERSION, TermsGate } from "./LegalNotice.jsx";

/* The current terms must be accepted before the workspace loads. Cloud-mode
   checks fail closed: an unavailable or missing audit row shows the gate. */
export function TermsBoundary({ localOnlyMode = false, session, onSignOut, children }) {
  const userId = session?.user?.id || "";
  const localKey = `family-tree-terms-accepted-${TERMS_VERSION}`;
  const [accepted, setAccepted] = useState(() => {
    if (!localOnlyMode) return null;
    try {
      return localStorage.getItem(localKey) === "yes";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (localOnlyMode || !userId) return undefined;
    let cancelled = false;

    supabase
      .from("terms_acceptances")
      .select("id")
      .eq("user_id", userId)
      .eq("version", TERMS_VERSION)
      .limit(1)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Terms acceptance check failed", error);
          setAccepted(false);
          return;
        }
        setAccepted(Boolean(data?.length));
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Terms acceptance check failed", error);
          setAccepted(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [localOnlyMode, userId]);

  const handleAccept = async () => {
    if (localOnlyMode) {
      try {
        localStorage.setItem(localKey, "yes");
      } catch {
        // A development-only browser may block storage; acceptance still applies to this session.
      }
      setAccepted(true);
      return;
    }

    const { error } = await supabase.from("terms_acceptances").insert({
      user_id: userId,
      version: TERMS_VERSION,
      user_agent: (typeof navigator === "undefined" ? "" : navigator.userAgent).slice(0, 500),
    });
    if (error) {
      // A prior successful acceptance can be hidden by a transient lookup
      // failure. Verify an ownership-scoped duplicate instead of trapping the
      // user behind a unique-constraint error.
      if (error.code === "23505") {
        const { data: existing, error: lookupError } = await supabase
          .from("terms_acceptances")
          .select("id")
          .eq("user_id", userId)
          .eq("version", TERMS_VERSION)
          .limit(1);
        if (!lookupError && existing?.length) {
          setAccepted(true);
          return;
        }
      }
      console.error("Could not record terms acceptance", error);
      throw error;
    }
    setAccepted(true);
  };

  if (accepted === null) {
    return <main className="commercial-loading-screen">Checking the current terms...</main>;
  }
  if (!accepted) {
    return (
      <TermsGate localOnlyMode={localOnlyMode} onAccept={handleAccept} onSignOut={onSignOut} />
    );
  }
  return children;
}
