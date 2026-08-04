import { useState } from "react";
import {
  Check,
  CreditCard,
  Download,
  FileUp,
  FolderOpen,
  FolderPlus,
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
  commercialMode = false,
  entitlement = null,
  canCreate = true,
  billingBusy = false,
  billingMessage = "",
  storageStatus = "",
  recoveryAvailable = false,
  onCreate,
  onImport,
  onOpen,
  onRename,
  onRemove,
  onBuyTree,
  onSignOut,
  onDownloadRecovery,
  onDownloadBackup,
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
  const allowanceLoading = commercialMode && !entitlement;

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
    if (!canCreate) {
      setImportStatus("Your five free trees have been used. Buy a €30 tree credit first.");
      event.target.value = "";
      return;
    }
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
          {signedIn ? "Secure workspace" : "Development workspace"}
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
            {commercialMode && entitlement && (
              <>
                <div>
                  <dt>Trees generated</dt>
                  <dd>{entitlement.totalTreesCreated}</dd>
                </div>
                <div>
                  <dt>Free trees remaining</dt>
                  <dd>
                    {entitlement.freeTreesRemaining} of {entitlement.freeTreeLimit}
                  </dd>
                </div>
                <div>
                  <dt>Paid tree credits</dt>
                  <dd>{entitlement.paidTreeCredits}</dd>
                </div>
              </>
            )}
          </dl>
          {signedIn && (
            <button type="button" className="library-account-action" onClick={onSignOut}>
              <LogOut size={15} /> Sign out
            </button>
          )}
          <button type="button" className="library-account-action" onClick={onDownloadBackup}>
            <Download size={15} /> Download workspace backup
          </button>
          {commercialMode && (
            <div
              className={`tree-pricing-card ${
                allowanceLoading ? "loading" : canCreate ? "available" : "payment-needed"
              }`}
            >
              <span className="tree-pricing-icon">
                <CreditCard size={18} />
              </span>
              <div>
                <strong>
                  {allowanceLoading
                    ? "Checking your tree allowance..."
                    : canCreate
                      ? "Tree creation available"
                      : "Additional tree · €30"}
                </strong>
                <p>
                  The first five lifetime trees are free. Each later creation or GEDCOM import uses
                  one paid credit. Editing remains free.
                </p>
              </div>
              {!allowanceLoading && !canCreate && (
                <button
                  type="button"
                  className="library-primary-button"
                  onClick={onBuyTree}
                  disabled={billingBusy}
                >
                  {billingBusy ? "Opening checkout..." : "Buy one tree · €30"}
                </button>
              )}
            </div>
          )}
          {billingMessage && (
            <p className="library-billing-message" aria-live="polite">
              {billingMessage}
            </p>
          )}
          {storageStatus && (
            <p className="library-storage-message" aria-live="polite">
              {storageStatus}
            </p>
          )}
          {recoveryAvailable && (
            <button type="button" className="library-account-action" onClick={onDownloadRecovery}>
              Download recovery copy
            </button>
          )}
          <nav className="library-legal-links" aria-label="Legal and privacy information">
            <a href="/?legal=terms">Terms and tax disclaimer</a>
            <a href="/?legal=privacy">Privacy Notice</a>
          </nav>
        </section>

        <section className="family-library" aria-labelledby="families-title">
          <div className="family-library-heading">
            <div>
              <p className="library-kicker">Your work</p>
              <h2 id="families-title">Families</h2>
              <p>Choose a family to open its tree, people and property work.</p>
            </div>
            <div className="library-create-actions">
              <button
                type="button"
                className="library-primary-button"
                onClick={onCreate}
                disabled={!canCreate}
                title={canCreate ? "Create new family" : "Buy a tree credit to continue"}
              >
                <FolderPlus size={16} /> Create new family
              </button>
              <label
                className={`library-secondary-button ${canCreate ? "" : "disabled"}`}
                title={canCreate ? "Import GEDCOM" : "Buy a tree credit to continue"}
              >
                <FileUp size={16} /> Import GEDCOM
                <input
                  className="library-file-input"
                  type="file"
                  accept=".ged,.gedcom,text/plain"
                  onChange={importGedcom}
                  disabled={!canCreate}
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
                    {(tree.dataWarnings?.length > 0 || tree.importWarnings?.length > 0) && (
                      <small className="family-review-warning">
                        {(tree.dataWarnings?.length || 0) + (tree.importWarnings?.length || 0)}{" "}
                        import /recovery item(s) need review
                      </small>
                    )}
                  </button>
                )}
                <span className="family-last-changed" role="cell">
                  {displayDate(familyAddedDate(tree))}
                </span>
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
                    onClick={() => onRemove(tree.id)}
                    title={`Delete ${tree.title || "family"}`}
                    aria-label={`Delete ${tree.title || "family"}`}
                  >
                    <Trash2 size={14} />
                    <span className="library-row-action-label">Delete</span>
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
          {commercialMode && (
            <p className="library-credit-policy">
              Tree credits are consumed when a tree is generated. Deleting a tree does not restore
              its free or paid credit.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
