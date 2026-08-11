import { useState } from "react";
import {
  Check,
  CreditCard,
  Download,
  FileUp,
  FolderOpen,
  FolderPlus,
  KeyRound,
  LogOut,
  Pencil,
  Search,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { AccountPasswordDialog } from "./AccountPasswordDialog.jsx";
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
  onChangePassword,
  onSignOut,
  onDownloadRecovery,
  onDownloadBackup,
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
  });
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
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
  const unlimitedTrees = entitlement?.unlimitedTrees === true;

  const closeCreation = () => {
    if (creationBusy) return;
    setCreationOpen(false);
    setCreationDraft({ title: "", givenNames: "", surname: "", sex: "" });
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
      });
      if (created !== false) {
        setCreationOpen(false);
        setCreationDraft({ title: "", givenNames: "", surname: "", sex: "" });
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
                {unlimitedTrees ? (
                  <div>
                    <dt>Tree allowance</dt>
                    <dd>Unlimited</dd>
                  </div>
                ) : (
                  <>
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
              </>
            )}
          </dl>
          <div className="library-account-actions">
            {signedIn && (
              <>
                {onChangePassword && (
                  <button
                    type="button"
                    className="library-account-action"
                    onClick={() => setPasswordDialogOpen(true)}
                  >
                    <KeyRound size={15} /> Change password
                  </button>
                )}
                <button type="button" className="library-account-action" onClick={onSignOut}>
                  <LogOut size={15} /> Sign out
                </button>
              </>
            )}
            <button type="button" className="library-account-action" onClick={onDownloadBackup}>
              <Download size={15} /> Download workspace backup
            </button>
          </div>
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
                    : unlimitedTrees
                      ? "Unlimited tree creation"
                      : canCreate
                        ? "Tree creation available"
                        : "Additional tree · €30"}
                </strong>
                <p>
                  {unlimitedTrees
                    ? "This account can create and import any number of family trees."
                    : "The first five lifetime trees are free. Each later creation or GEDCOM import uses one paid credit. Editing remains free."}
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
                onClick={() => setCreationOpen(true)}
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
            {filteredTrees.map((tree) => {
              const reviewCount =
                (tree.dataWarnings?.length || 0) + (tree.importWarnings?.length || 0);
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
                            {isActive && <small>Open now</small>}
                            {reviewCount > 0 && (
                              <small
                                className="family-review-warning"
                                title={`${reviewCount} import or recovery item${reviewCount === 1 ? "" : "s"} need review`}
                              >
                                {reviewCount} {reviewCount === 1 ? "item" : "items"} to review
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
                        title={`Delete ${tree.title || "family"}`}
                        aria-label={`Delete ${tree.title || "family"}`}
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
          {commercialMode && (
            <p className="library-credit-policy">
              {unlimitedTrees
                ? "This account has unlimited tree creation."
                : "Tree credits are consumed when a tree is generated. Deleting a tree does not restore its free or paid credit."}
            </p>
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
            <p className="library-dialog-intro">
              Name the family and add its first person. You can add parents, partners, children and
              other details after creation.
            </p>
            <label className="library-dialog-field full-width">
              <span>Family name</span>
              <input
                autoFocus
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
            {commercialMode && (
              <p className="library-credit-notice">
                {unlimitedTrees
                  ? "This account has unlimited tree creation."
                  : entitlement?.freeTreesRemaining > 0
                    ? "Creating this family uses one of your remaining free trees. Deleting it later will not restore that credit."
                    : "Creating this family uses one paid tree credit. Deleting it later will not restore that credit."}
              </p>
            )}
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
                <p className="library-kicker">Delete family</p>
                <h2 id="delete-family-title">Delete {pendingDelete.title || "this family"}?</h2>
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
              This permanently removes the family and cannot be undone.
              {commercialMode && !unlimitedTrees
                ? " Its free or paid tree credit will not be restored."
                : ""}
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
                <Trash2 size={16} /> {deleteBusy ? "Deleting..." : "Delete family"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
