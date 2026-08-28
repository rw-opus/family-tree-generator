import { useEffect, useRef, useState } from "react";
import {
  ArchiveRestore,
  Check,
  ChevronDown,
  Download,
  FileUp,
  FolderOpen,
  FolderPlus,
  KeyRound,
  LogOut,
  Pencil,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { AccountPasswordDialog } from "./AccountPasswordDialog.jsx";
import { AnnouncementBanner } from "./AnnouncementBanner.jsx";
import { SiteFeedbackForm } from "./SiteFeedbackForm.jsx";
import { isoDateToDisplay } from "../domain/dateFormat.js";
import { isLegalGedcomWarning } from "../domain/gedcom.js";
import { TREE_DATA_LIMITS } from "../domain/treeData.js";
import { TREE_WORKSPACE_MODES } from "../domain/treeWorkspaceMode.js";
import { LOCAL_TRASH_RETENTION_DAYS } from "../services/localWorkspace.js";
import { WorkspaceSaveStatus } from "./WorkspaceSaveStatus.jsx";

const displayDate = (value) => {
  if (!value) return "Saved on this device";
  return isoDateToDisplay(String(value).slice(0, 10)) || "Saved on this device";
};

const accountName = (session) => {
  const metadata = session?.user?.user_metadata || {};
  return (
    metadata.full_name || metadata.name || session?.user?.email?.split("@")[0] || "Local workspace"
  );
};

const familyAddedDate = (tree) => tree.createdAt || tree.created_at || tree.updated_at || "";

const trashRetention = (tree, now = Date.now()) => {
  const deletedAt = Date.parse(tree?.deletedAt || "");
  if (!Number.isFinite(deletedAt)) return { expired: true, label: "Restore unavailable" };
  const expiresAt = deletedAt + LOCAL_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return {
    expired: expiresAt <= now,
    label:
      expiresAt <= now
        ? "Restore period expired"
        : `Restore by ${displayDate(new Date(expiresAt).toISOString())}`,
  };
};

const routineStorageMessages = new Set([
  "Automatically saved on this device.",
  "Saved securely to your workspace.",
]);

export function FamilyLibrary({
  trees,
  trashedTrees = [],
  activeTreeId,
  session,
  commercialMode = false,
  entitlement = null,
  storageStatus = "",
  saveState,
  backupDisabled = false,
  recoveryAvailable = false,
  pendingCloudRecoveries = [],
  isPlatformAdmin = false,
  onOpenAdminConsole,
  onCreate,
  onImport,
  onOpen,
  onRename,
  onRemove,
  onRestore,
  onPermanentDelete,
  onChangePassword,
  onSignOut,
  onDownloadRecovery,
  onDownloadBackup,
  onApplyCloudRecovery,
  onDiscardCloudRecovery,
  onDownloadCloudRecovery,
}) {
  const [query, setQuery] = useState("");
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [creationOpen, setCreationOpen] = useState(false);
  const [creationBusy, setCreationBusy] = useState(false);
  const [creationDraft, setCreationDraft] = useState({
    title: "",
    givenNames: "",
    surname: "",
    sex: "",
    workspaceMode: TREE_WORKSPACE_MODES.FAMILY_TREE,
  });
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pendingPermanentDelete, setPendingPermanentDelete] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashAction, setTrashAction] = useState({ id: "", type: "" });
  const [renamingId, setRenamingId] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [recoveryActionId, setRecoveryActionId] = useState("");
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef(null);
  const toolsTriggerRef = useRef(null);
  const filteredTrees = trees.filter((tree) =>
    String(tree.title || "Untitled family")
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const signedIn = Boolean(session);
  const visibleStorageStatus = routineStorageMessages.has(storageStatus) ? "" : storageStatus;

  useEffect(() => {
    if (!toolsOpen) return undefined;

    const closeFromOutside = (event) => {
      if (!toolsRef.current?.contains(event.target)) setToolsOpen(false);
    };
    const closeFromKeyboard = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setToolsOpen(false);
      toolsTriggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [toolsOpen]);

  const closeCreation = () => {
    if (creationBusy) return;
    setCreationOpen(false);
    setCreationDraft({
      title: "",
      givenNames: "",
      surname: "",
      sex: "",
      workspaceMode: TREE_WORKSPACE_MODES.FAMILY_TREE,
    });
  };

  const submitCreation = async (event) => {
    event.preventDefault();
    if (creationBusy) return;
    setCreationBusy(true);
    try {
      const created = await onCreate({
        title: creationDraft.title.trim(),
        givenNames: creationDraft.givenNames.trim(),
        surname: creationDraft.surname.trim(),
        sex: creationDraft.sex,
        workspaceMode: creationDraft.workspaceMode,
      });
      if (created !== false) {
        setCreationOpen(false);
        setCreationDraft({
          title: "",
          givenNames: "",
          surname: "",
          sex: "",
          workspaceMode: TREE_WORKSPACE_MODES.FAMILY_TREE,
        });
      }
    } finally {
      setCreationBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete || deleteBusy) return;
    setDeleteBusy(true);
    try {
      const removed = await onRemove(pendingDelete.id);
      if (removed !== false) setPendingDelete(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const restoreFromTrash = async (tree) => {
    if (trashAction.id || (!commercialMode && trashRetention(tree).expired)) return;
    setTrashAction({ id: tree.id, type: "restore" });
    try {
      await onRestore(tree.id);
    } finally {
      setTrashAction({ id: "", type: "" });
    }
  };

  const confirmPermanentDelete = async () => {
    if (!pendingPermanentDelete || trashAction.id) return;
    setTrashAction({ id: pendingPermanentDelete.id, type: "delete" });
    try {
      const removed = await onPermanentDelete(pendingPermanentDelete.id);
      if (removed !== false) setPendingPermanentDelete(null);
    } finally {
      setTrashAction({ id: "", type: "" });
    }
  };

  const startRename = (tree) => {
    setRenamingId(tree.id);
    setRenameDraft(tree.title || "");
  };

  const cancelRename = () => {
    setRenamingId("");
    setRenameDraft("");
  };

  const submitRename = (event, treeId) => {
    event.preventDefault();
    const nextTitle = renameDraft.trim();
    if (nextTitle) onRename(treeId, nextTitle);
    cancelRename();
  };

  const importGedcom = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportStatus(`Importing ${file.name}...`);
    try {
      await onImport(file);
    } catch (error) {
      setImportStatus(`Could not import GEDCOM: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  };

  return (
    <main className="family-library-page">
      {commercialMode && <AnnouncementBanner />}
      <header className="family-library-header">
        <div className="family-library-brand">
          <FolderOpen size={22} aria-hidden="true" />
          <span>Family Tree Generator</span>
        </div>
        <div className="family-library-header-actions">
          <WorkspaceSaveStatus state={saveState} />
          <div className="tree-tools" ref={toolsRef}>
            <button
              ref={toolsTriggerRef}
              type="button"
              className="tree-tools-trigger"
              aria-haspopup="true"
              aria-expanded={toolsOpen}
              aria-controls="tree-tools-list"
              onClick={() => setToolsOpen((open) => !open)}
            >
              <Wrench size={16} aria-hidden="true" />
              <span>Tree Tools</span>
              <ChevronDown size={15} aria-hidden="true" />
            </button>
            <div
              id="tree-tools-list"
              className="tree-tools-list"
              role="group"
              aria-label="Tree Tools"
              hidden={!toolsOpen}
            >
              <button
                type="button"
                onClick={() => {
                  setToolsOpen(false);
                  setCreationOpen(true);
                }}
                title="Create new family"
                aria-label="Create new family"
              >
                <FolderPlus size={16} aria-hidden="true" /> Create new family
              </button>
              <label title="Import GEDCOM">
                <FileUp size={16} aria-hidden="true" /> Import GEDCOM
                <input
                  className="library-file-input"
                  type="file"
                  aria-label="Import GEDCOM"
                  accept=".ged,.gedcom,text/plain"
                  onClick={() => setToolsOpen(false)}
                  onChange={importGedcom}
                />
              </label>
              <button
                type="button"
                aria-expanded={trashOpen}
                aria-controls="family-library-trash"
                onClick={() => {
                  setTrashOpen((open) => !open);
                  setToolsOpen(false);
                  window.requestAnimationFrame?.(() =>
                    document.getElementById("family-library-trash")?.scrollIntoView?.({
                      block: "nearest",
                    }),
                  );
                }}
              >
                <Trash2 size={16} aria-hidden="true" /> Trash ({trashedTrees.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setToolsOpen(false);
                  onDownloadBackup();
                }}
                aria-label="Download workspace backup"
                disabled={backupDisabled}
                title={
                  backupDisabled
                    ? "Wait for the complete family and Trash lists before downloading a backup"
                    : "Download workspace backup"
                }
              >
                <Download size={16} aria-hidden="true" /> Download workspace backup
              </button>
              {recoveryAvailable && (
                <button
                  type="button"
                  onClick={() => {
                    setToolsOpen(false);
                    onDownloadRecovery();
                  }}
                >
                  <Download size={16} aria-hidden="true" /> Download recovery copy
                </button>
              )}
              {signedIn && (
                <>
                  {onChangePassword && (
                    <button
                      type="button"
                      onClick={() => {
                        setToolsOpen(false);
                        setPasswordDialogOpen(true);
                      }}
                      aria-label="Change password"
                    >
                      <KeyRound size={16} aria-hidden="true" /> Change password
                    </button>
                  )}
                  <SiteFeedbackForm />
                  {isPlatformAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setToolsOpen(false);
                        onOpenAdminConsole();
                      }}
                      aria-label="Open admin console"
                    >
                      <ShieldCheck size={16} aria-hidden="true" /> Admin console
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setToolsOpen(false);
                      onSignOut();
                    }}
                    aria-label="Sign out"
                  >
                    <LogOut size={16} aria-hidden="true" /> Sign out
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="family-library-content">
        <section className="account-summary" aria-labelledby="account-details-title">
          <div className="account-summary-heading">
            <span className="account-summary-icon">
              <UserRound size={18} />
            </span>
            <div>
              <p className="library-kicker">Workspace</p>
              <h1 id="account-details-title">Account Details</h1>
            </div>
          </div>
          <dl className="account-summary-list">
            <div>
              <dt>Name</dt>
              <dd>{accountName(session)}</dd>
            </div>
            <div>
              <dt>Email address</dt>
              <dd>{session?.user?.email || "Not signed in"}</dd>
            </div>
            <div className="account-storage-detail">
              <dt>Storage</dt>
              <dd>{signedIn ? "Cloud" : "This device"}</dd>
            </div>
            {commercialMode && (
              <div className="account-subscription-detail">
                <dt>Subscription</dt>
                <dd>Started</dd>
              </div>
            )}
            {commercialMode && entitlement && (
              <div>
                <dt>Trees generated</dt>
                <dd>{entitlement.totalTreesCreated}</dd>
              </div>
            )}
          </dl>
          {commercialMode && (
            <p className="library-subscription-note">
              Your subscription has started. Subscription fees will become due under the Terms of
              Use.
            </p>
          )}
          {visibleStorageStatus && (
            <p className="library-storage-message" aria-live="polite">
              {visibleStorageStatus}
            </p>
          )}
          {pendingCloudRecoveries.length > 0 && (
            <section className="library-cloud-recovery" aria-labelledby="cloud-recovery-title">
              <h3 id="cloud-recovery-title">Pending local changes need review</h3>
              <p>
                The browser kept a local copy of some changes because a cloud save may not have
                finished. Review or download them before hiding a copy.
              </p>
              <ul>
                {pendingCloudRecoveries.map((recovery) => {
                  const isTreeKind = recovery.kind === "tree";
                  return (
                    <li key={recovery.id}>
                      <span>
                        <strong>{recovery.title}</strong>
                        <small>
                          {recovery.propertyLabel ? `${recovery.propertyLabel}: ` : ""}
                          {recovery.state === "invalid"
                            ? "This browser record is unreadable. Download it before dismissing it."
                            : recovery.state === "safe"
                              ? isTreeKind
                                ? "The cloud family has not changed since this local copy was made. Open it so it can be saved."
                                : "Cloud initial ownership has not changed. Open these owner rows so they can be saved."
                              : recovery.state === "trashed"
                                ? `Restore the family from Trash before reviewing ${isTreeKind ? "this local copy" : "these owner rows"}.`
                                : recovery.state === "orphan"
                                  ? "The cloud family is unavailable."
                                  : recovery.state === "multiple"
                                    ? isTreeKind
                                      ? "Different pending local copies exist for this family, from different browser tabs or devices. Download them before choosing what to keep."
                                      : "Different pending owner rows exist for this property. Download them before choosing what to enter."
                                    : isTreeKind
                                      ? "The cloud family changed after this local copy was made. Download it for comparison."
                                      : "Cloud initial ownership changed after this browser record was made. Download it for comparison."}
                        </small>
                      </span>
                      <div>
                        <button
                          type="button"
                          className="library-account-action"
                          onClick={() => onDownloadCloudRecovery?.(recovery.id)}
                        >
                          <Download size={15} /> Download
                        </button>
                        {recovery.state === "safe" && (
                          <button
                            type="button"
                            className="library-account-action"
                            disabled={Boolean(recoveryActionId)}
                            onClick={async () => {
                              if (
                                !window.confirm(
                                  isTreeKind
                                    ? `Open the pending local copy of ${recovery.title}? It will be checked against the current cloud family before it is saved.`
                                    : `Open the pending initial ownership for ${recovery.title}? The owner rows will be checked against the current cloud family before they are saved.`,
                                )
                              ) {
                                return;
                              }
                              setRecoveryActionId(recovery.id);
                              try {
                                await onApplyCloudRecovery?.(recovery.id);
                              } finally {
                                setRecoveryActionId("");
                              }
                            }}
                          >
                            <ArchiveRestore size={15} />{" "}
                            {isTreeKind ? "Use this copy" : "Use owner rows"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="library-account-action danger"
                          disabled={Boolean(recoveryActionId)}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Hide this pending browser copy of ${recovery.title}? Neither the browser copy nor the cloud version will be deleted or changed. It will reappear if its source records newer changes.`,
                              )
                            ) {
                              onDiscardCloudRecovery?.(recovery.id);
                            }
                          }}
                        >
                          <Trash2 size={15} /> Hide copy
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <nav className="library-legal-links" aria-label="Legal and privacy information">
            <a href="/?legal=terms" aria-label="Terms and tax disclaimer">
              Terms &amp; disclaimer
            </a>
            <a href="/?legal=privacy" aria-label="Privacy Notice">
              Privacy
            </a>
          </nav>
        </section>

        <section className="family-library" aria-labelledby="families-title">
          <div className="family-library-heading">
            <div>
              <p className="library-kicker">Your work</p>
              <h2 id="families-title">Families</h2>
            </div>
          </div>

          {importStatus && (
            <p className="library-import-status" aria-live="polite">
              {importStatus}
            </p>
          )}

          <label className="family-library-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Find a family</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a family"
            />
          </label>

          <div className="family-library-table" role="table" aria-label="Saved families">
            <div className="family-library-row family-library-table-head" role="row">
              <span role="columnheader">Family name</span>
              <span role="columnheader">Added</span>
              <span role="columnheader">Actions</span>
            </div>
            {filteredTrees.map((tree) => {
              const familyTreeOnly =
                tree.settings?.workspaceMode === TREE_WORKSPACE_MODES.FAMILY_TREE;
              const importReviewCount = familyTreeOnly
                ? (tree.importWarnings || []).filter((warning) => !isLegalGedcomWarning(warning))
                    .length
                : tree.importWarnings?.length || 0;
              const legalImportReviewCount = familyTreeOnly
                ? 0
                : tree.legalImportWarnings?.length || 0;
              const reviewCount =
                (tree.dataWarnings?.length || 0) + importReviewCount + legalImportReviewCount;
              const isActive = tree.id === activeTreeId;
              const isRenaming = renamingId === tree.id;

              return (
                <div
                  className={`family-library-row${isActive ? " is-active" : ""}${isRenaming ? " is-renaming" : ""}`}
                  role="row"
                  key={tree.id}
                >
                  <div className="family-row-name" role="cell">
                    {isRenaming ? (
                      <form
                        className="family-rename-form"
                        onSubmit={(event) => submitRename(event, tree.id)}
                        onKeyDown={(event) => {
                          if (event.key !== "Escape") return;
                          event.preventDefault();
                          cancelRename();
                        }}
                      >
                        <input
                          aria-label={`New name for ${tree.title || "family"}`}
                          autoFocus
                          maxLength={TREE_DATA_LIMITS.maxTitleCharacters}
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                        />
                        <button
                          type="submit"
                          className="library-icon-button"
                          aria-label="Save family name"
                        >
                          <Check size={15} />
                        </button>
                        <button
                          type="button"
                          className="library-icon-button"
                          onClick={cancelRename}
                          aria-label="Cancel renaming"
                        >
                          <X size={15} />
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="family-name-button"
                        onClick={() => onOpen(tree.id)}
                        aria-label={`Open ${tree.title || "Untitled family"}${isActive ? ", currently open" : ""}${reviewCount ? `, ${reviewCount} ${reviewCount === 1 ? "item" : "items"} to review` : ""}`}
                      >
                        <span className="family-name-text">{tree.title || "Untitled family"}</span>
                        {(isActive || reviewCount > 0) && (
                          <span className="family-name-badges">
                            {isActive && <small className="family-open-badge">Open now</small>}
                            {reviewCount > 0 && (
                              <small
                                className="family-review-warning"
                                title={`${reviewCount} import or recovery item${reviewCount === 1 ? "" : "s"} need review`}
                              >
                                {reviewCount} {reviewCount === 1 ? "review" : "reviews"}
                              </small>
                            )}
                          </span>
                        )}
                      </button>
                    )}
                  </div>
                  <span className="family-last-changed" role="cell">
                    <span className="family-last-changed-label">Added</span>
                    {displayDate(familyAddedDate(tree))}
                  </span>
                  {!isRenaming && (
                    <span className="family-row-actions" role="cell">
                      <button
                        type="button"
                        className="library-row-action"
                        onClick={() => startRename(tree)}
                        title={`Rename ${tree.title || "family"}`}
                        aria-label={`Rename ${tree.title || "family"}`}
                      >
                        <Pencil size={14} />
                        <span className="library-row-action-label">Rename</span>
                      </button>
                      <button
                        type="button"
                        className="library-row-action danger"
                        onClick={() => setPendingDelete(tree)}
                        title={`Move ${tree.title || "family"} to Trash`}
                        aria-label={`Move ${tree.title || "family"} to Trash`}
                      >
                        <Trash2 size={14} />
                        <span className="library-row-action-label">Delete</span>
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {!filteredTrees.length && (
            <p className="family-library-empty">
              {trees.length
                ? "No family matches that search."
                : "No families yet. Create a new family or import a GEDCOM file."}
            </p>
          )}

          {trashOpen && (
            <section
              id="family-library-trash"
              className="family-library-trash"
              aria-labelledby="family-library-trash-title"
            >
              <div className="family-library-trash-heading">
                <h3 id="family-library-trash-title">Trash</h3>
                <button type="button" onClick={() => setTrashOpen(false)}>
                  Close Trash
                </button>
              </div>
              {trashedTrees.length ? (
                <div className="family-trash-list" role="list">
                  {trashedTrees.map((tree) => {
                    const retention = commercialMode
                      ? {
                          expired: false,
                          label: "Restore eligibility checked securely",
                        }
                      : trashRetention(tree);
                    const busy = trashAction.id === tree.id;
                    return (
                      <div className="family-trash-row" role="listitem" key={tree.id}>
                        <div className="family-trash-details">
                          <strong>{tree.title || "Untitled family"}</strong>
                          <span className={retention.expired ? "expired" : ""}>
                            {retention.label}
                          </span>
                        </div>
                        <div className="family-trash-actions">
                          <button
                            type="button"
                            className="library-row-action"
                            onClick={() => restoreFromTrash(tree)}
                            disabled={busy || retention.expired}
                            aria-label={`Restore ${tree.title || "family"}`}
                            title={
                              retention.expired
                                ? "The 30-day restore period has expired"
                                : "Restore family"
                            }
                          >
                            <ArchiveRestore size={14} />
                            <span className="library-row-action-label">
                              {busy && trashAction.type === "restore" ? "Restoring..." : "Restore"}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="library-row-action danger"
                            onClick={() => setPendingPermanentDelete(tree)}
                            disabled={busy}
                            aria-label={`Delete ${tree.title || "family"} forever`}
                            title="Delete forever"
                          >
                            <Trash2 size={14} />
                            <span className="library-row-action-label">Delete forever</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="family-library-empty">Trash is empty.</p>
              )}
            </section>
          )}
        </section>
      </div>

      {creationOpen && (
        <div className="library-dialog-backdrop" role="presentation">
          <form
            className="library-dialog family-creation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-family-title"
            onSubmit={submitCreation}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeCreation();
            }}
          >
            <div className="library-dialog-heading">
              <div>
                <p className="library-kicker">New family</p>
                <h2 id="create-family-title">Set up the first person</h2>
              </div>
              <button
                type="button"
                className="library-icon-button"
                onClick={closeCreation}
                aria-label="Cancel creating family"
              >
                <X size={16} />
              </button>
            </div>
            <p className="library-dialog-intro">Add a family name and its first person.</p>
            <label className="library-dialog-field full-width">
              <span>Family name</span>
              <input
                autoFocus
                maxLength={TREE_DATA_LIMITS.maxTitleCharacters}
                required
                value={creationDraft.title}
                onChange={(event) =>
                  setCreationDraft((current) => ({ ...current, title: event.target.value }))
                }
                placeholder="e.g. Borg family"
              />
            </label>
            <div className="library-dialog-fields">
              <label className="library-dialog-field">
                <span>Given name(s)</span>
                <input
                  required
                  value={creationDraft.givenNames}
                  onChange={(event) =>
                    setCreationDraft((current) => ({
                      ...current,
                      givenNames: event.target.value,
                    }))
                  }
                  autoComplete="off"
                />
              </label>
              <label className="library-dialog-field">
                <span>Surname</span>
                <input
                  required
                  value={creationDraft.surname}
                  onChange={(event) =>
                    setCreationDraft((current) => ({ ...current, surname: event.target.value }))
                  }
                  autoComplete="off"
                />
              </label>
            </div>
            <fieldset className="library-sex-options">
              <legend>Sex</legend>
              {["Female", "Male", "Other"].map((sex) => (
                <label key={sex}>
                  <input
                    type="radio"
                    name="new-family-sex"
                    value={sex}
                    checked={creationDraft.sex === sex}
                    onChange={(event) =>
                      setCreationDraft((current) => ({ ...current, sex: event.target.value }))
                    }
                    required
                  />
                  <span>{sex}</span>
                </label>
              ))}
            </fieldset>
            <fieldset className="library-workspace-mode-options">
              <legend>Start as</legend>
              <label>
                <input
                  type="radio"
                  name="new-family-workspace-mode"
                  value={TREE_WORKSPACE_MODES.FAMILY_TREE}
                  checked={creationDraft.workspaceMode === TREE_WORKSPACE_MODES.FAMILY_TREE}
                  onChange={(event) =>
                    setCreationDraft((current) => ({
                      ...current,
                      workspaceMode: event.target.value,
                    }))
                  }
                />
                <span>
                  <b>Family tree only</b>
                  <small>
                    Build relationships and print at any time. No legal or tax warnings.
                  </small>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="new-family-workspace-mode"
                  value={TREE_WORKSPACE_MODES.PROPERTY_TAX}
                  checked={creationDraft.workspaceMode === TREE_WORKSPACE_MODES.PROPERTY_TAX}
                  onChange={(event) =>
                    setCreationDraft((current) => ({
                      ...current,
                      workspaceMode: event.target.value,
                    }))
                  }
                />
                <span>
                  <b>Property, succession &amp; tax</b>
                  <small>Start ownership and inheritance calculations immediately.</small>
                </span>
              </label>
            </fieldset>
            <div className="library-dialog-actions">
              <button type="button" className="library-secondary-button" onClick={closeCreation}>
                Cancel
              </button>
              <button type="submit" className="library-primary-button" disabled={creationBusy}>
                <FolderPlus size={16} /> {creationBusy ? "Creating..." : "Create family"}
              </button>
            </div>
          </form>
        </div>
      )}

      {passwordDialogOpen && onChangePassword && (
        <AccountPasswordDialog
          onChangePassword={onChangePassword}
          onClose={() => setPasswordDialogOpen(false)}
        />
      )}

      {pendingDelete && (
        <div className="library-dialog-backdrop" role="presentation">
          <section
            className="library-dialog library-delete-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-family-title"
            aria-describedby="delete-family-description"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !deleteBusy) setPendingDelete(null);
            }}
          >
            <div className="library-dialog-heading">
              <div>
                <p className="library-kicker">Move to Trash</p>
                <h2 id="delete-family-title">
                  Move {pendingDelete.title || "this family"} to Trash?
                </h2>
              </div>
              <button
                type="button"
                className="library-icon-button"
                onClick={() => setPendingDelete(null)}
                aria-label="Cancel deleting family"
                disabled={deleteBusy}
              >
                <X size={16} />
              </button>
            </div>
            <p id="delete-family-description" className="library-dialog-intro">
              You can restore this family from Trash for 30 days.
            </p>
            <div className="library-dialog-actions">
              <button
                type="button"
                className="library-secondary-button"
                onClick={() => setPendingDelete(null)}
                disabled={deleteBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="library-danger-button"
                onClick={confirmDelete}
                disabled={deleteBusy}
              >
                <Trash2 size={16} /> {deleteBusy ? "Moving..." : "Move to Trash"}
              </button>
            </div>
          </section>
        </div>
      )}

      {pendingPermanentDelete && (
        <div className="library-dialog-backdrop" role="presentation">
          <section
            className="library-dialog library-delete-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="permanent-delete-family-title"
            aria-describedby="permanent-delete-family-description"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !trashAction.id) setPendingPermanentDelete(null);
            }}
          >
            <div className="library-dialog-heading">
              <div>
                <p className="library-kicker">Permanent deletion</p>
                <h2 id="permanent-delete-family-title">
                  Delete {pendingPermanentDelete.title || "this family"} forever?
                </h2>
              </div>
              <button
                type="button"
                className="library-icon-button"
                onClick={() => setPendingPermanentDelete(null)}
                aria-label="Cancel permanently deleting family"
                disabled={Boolean(trashAction.id)}
              >
                <X size={16} />
              </button>
            </div>
            <p id="permanent-delete-family-description" className="library-dialog-intro">
              This permanently removes the family. It cannot be restored.
            </p>
            <div className="library-dialog-actions">
              <button
                type="button"
                className="library-secondary-button"
                onClick={() => setPendingPermanentDelete(null)}
                disabled={Boolean(trashAction.id)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="library-danger-button"
                onClick={confirmPermanentDelete}
                disabled={Boolean(trashAction.id)}
              >
                <Trash2 size={16} />
                {trashAction.type === "delete" ? "Deleting..." : "Delete forever"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
