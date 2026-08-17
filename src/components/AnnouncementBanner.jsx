import { useEffect, useState } from "react";
import { Megaphone, X } from "lucide-react";
import { getAnnouncement } from "../services/adminConsole.js";
import "./AdminConsole.css";

/* A platform-wide banner the product owner posts; every signed-in account
   sees it. Dismissal is remembered per announcement id, so it does not nag
   after reading but a new announcement shows again. Hidden in local-only mode
   (no Supabase project configured). */
export function AnnouncementBanner({ localOnlyMode = false }) {
  const [announcement, setAnnouncement] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (localOnlyMode) return undefined;
    let live = true;
    getAnnouncement().then((a) => {
      if (!live || !a) return;
      let seen = false;
      try {
        seen = localStorage.getItem(`family-tree-ann-dismissed:${a.id}`) === "1";
      } catch {
        /* ignore */
      }
      setDismissed(seen);
      setAnnouncement(a);
    });
    return () => {
      live = false;
    };
  }, [localOnlyMode]);

  if (!announcement || dismissed) return null;
  const warn = announcement.level === "warning";
  const dismiss = () => {
    try {
      localStorage.setItem(`family-tree-ann-dismissed:${announcement.id}`, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <div
      className={`announcement-banner ${warn ? "warning" : "info"}`}
      data-testid="announcement-banner"
    >
      <Megaphone size={16} aria-hidden="true" />
      <p>{announcement.message}</p>
      <button type="button" onClick={dismiss} aria-label="Dismiss announcement">
        <X size={15} />
      </button>
    </div>
  );
}
