import { useState } from "react";
import {
  Check,
  Calculator,
  FileUp,
  FolderOpen,
  FolderPlus,
  LogIn,
  LogOut,
  Pencil,
  Search,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { isoDateToDisplay } from "../domain/dateFormat.js";

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

export function FamilyLibrary({
  trees,
  activeTreeId,
  session,
  supabaseConfigured,
  onCreate,
  onImport,
  onOpen,
  onOpenProperty,
  onRename,
  onRemove,
  onSignIn,
  onSignOut,
}) {
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const filteredTrees = trees.filter((tree) =>
    String(tree.title || "Untitled family")
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const signedIn = Boolean(session);

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
      <header className="family-library-header">
        <div className="family-library-brand">
          <FolderOpen size={22} aria-hidden="true" />
          <span>Family Tree Generator</span>
        </div>
        <span className={`library-storage-state ${signedIn ? "connected" : ""}`}>
          {signedIn
            ? "Secure workspace"
            : supabaseConfigured
              ? "Not signed in"
              : "Saved on this device"}
        </span>
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
            <div>
              <dt>Storage</dt>
              <dd>{signedIn ? "Secure cloud workspace" : "This device"}</dd>
            </div>
          </dl>
          {!signedIn && supabaseConfigured && (
            <button type="button" className="library-account-action" onClick={onSignIn}>
              <LogIn size={15} /> Sign in to your workspace
            </button>
          )}
          {signedIn && (
            <button type="button" className="library-account-action" onClick={onSignOut}>
              <LogOut size={15} /> Sign out
            </button>
          )}
        </section>

        <section className="family-library" aria-labelledby="families-title">
          <div className="family-library-heading">
            <div>
              <p className="library-kicker">Your work</p>
              <h2 id="families-title">Families</h2>
              <p>Choose a family to open its tree, people and property work.</p>
            </div>
            <div className="library-create-actions">
              <button type="button" className="library-primary-button" onClick={onCreate}>
                <FolderPlus size={16} /> Create new family
              </button>
              <label className="library-secondary-button">
                <FileUp size={16} /> Import GEDCOM
                <input
                  className="library-file-input"
                  type="file"
                  accept=".ged,.gedcom,text/plain"
                  onChange={importGedcom}
                />
              </label>
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
            {filteredTrees.map((tree) => (
              <div className="family-library-row" role="row" key={tree.id}>
                {renamingId === tree.id ? (
                  <form
                    className="family-rename-form"
                    onSubmit={(event) => submitRename(event, tree.id)}
                  >
                    <input
                      aria-label={`New name for ${tree.title || "family"}`}
                      autoFocus
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
                  >
                    <span>{tree.title || "Untitled family"}</span>
                    {tree.id === activeTreeId && <small>Open now</small>}
                  </button>
                )}
                <span className="family-last-changed" role="cell">
                  {displayDate(familyAddedDate(tree))}
                </span>
                <span className="family-row-actions" role="cell">
                  <button
                    type="button"
                    className="library-row-action"
                    onClick={() => onOpenProperty(tree.id)}
                    title={`Open property and tax for ${tree.title || "family"}`}
                    aria-label={`Open property and tax for ${tree.title || "family"}`}
                  >
                    <Calculator size={14} /> Property &amp; tax
                  </button>
                  <button
                    type="button"
                    className="library-row-action"
                    onClick={() => startRename(tree)}
                    title={`Rename ${tree.title || "family"}`}
                    aria-label={`Rename ${tree.title || "family"}`}
                  >
                    <Pencil size={14} /> Rename
                  </button>
                  <button
                    type="button"
                    className="library-row-action danger"
                    onClick={() => onRemove(tree.id)}
                    title={`Delete ${tree.title || "family"}`}
                    aria-label={`Delete ${tree.title || "family"}`}
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </span>
              </div>
            ))}
          </div>
          {!filteredTrees.length && (
            <p className="family-library-empty">
              {trees.length
                ? "No family matches that search."
                : "No families yet. Create a new family or import a GEDCOM file."}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
