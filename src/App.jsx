import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Calculator,
  GitBranch,
  House,
  Landmark,
  MousePointerClick,
  Printer,
  X,
} from "lucide-react";
import { AdminConsole } from "./components/AdminConsole.jsx";
import { AnnouncementBanner } from "./components/AnnouncementBanner.jsx";
import { FamilyLibrary } from "./components/FamilyLibrary.jsx";
import { FamilyTreeCanvas } from "./components/FamilyTreeCanvas.jsx";
import { FractionCalculator } from "./components/FractionCalculator.jsx";
import { EditableTreeTitle } from "./components/EditableTreeTitle.jsx";
import {
  DashboardResizeHandle,
  readDashboardPanelWidth,
  storeDashboardPanelWidth,
} from "./components/DashboardResizeHandle.jsx";
import { PersonInspector } from "./components/PersonInspector.jsx";
import { PersonFinder } from "./components/PersonFinder.jsx";
import { Properties } from "./components/Properties.jsx";
import { observeStickyNavOffset } from "./components/stickyNavOffset.js";
import { TreeWorkspaceModeControl } from "./components/TreeWorkspaceModeControl.jsx";
import { TaxReadinessGuideBar, taxReadinessIssueControl } from "./components/TaxReadinessGuide.jsx";
import { WorkspaceSaveStatus } from "./components/WorkspaceSaveStatus.jsx";
import { buildCausaMortisShareCoverage } from "./domain/causaMortisCoverage.js";
import {
  casePersonDependencyLabels,
  createFamilyGroup,
  findFamilyGroupsForPerson,
  normaliseCase,
  reconcilePeopleUpdate,
  removePersonFromFamilyGroup,
} from "./domain/caseModel.js";
import { assertGedcomFileSize, parseGedcom } from "./domain/gedcom.js";
import { createPerson } from "./domain/people.js";
import {
  buildTreeCardHistoricalWarningsByPerson,
  buildTreeCardOwnershipByPerson,
  buildTreeCardOwnershipFractionsByPerson,
  normalisePersonCardFields,
} from "./domain/personCardDisplay.js";
import {
  buildCurrentOwnerPresentations,
  ownerPresentationsById,
} from "./domain/ownershipPresentation.js";
import {
  assignInitialOwnerPerson,
  buildPropertyVendorTaxReport,
  buildTaxCalculationReport,
  setDonationAcquisitionValue,
  setLivingInitialOwnerAcquisitionDate,
} from "./domain/propertyVendorTax.js";
import {
  beginStatusToggleSession,
  endStatusToggleSession,
  statusToggleSession,
} from "./domain/statusToggleSessions.js";
import { TREE_DATA_LIMITS, prepareTreeForPersistence } from "./domain/treeData.js";
import {
  DEFAULT_NEW_TREE_WORKSPACE_MODE,
  TREE_WORKSPACE_MODES,
  normaliseTreeWorkspaceMode,
  propertyTaxWorkspaceEnabled,
} from "./domain/treeWorkspaceMode.js";
import {
  buildTaxReadinessPlan,
  nextTaxReadinessPerson,
  normaliseTaxReadinessSession,
} from "./domain/taxReadinessGuide.js";
import { workspaceBackupFilename, workspaceBackupJson } from "./domain/workspaceBackup.js";
import {
  createFamilyTree,
  familyTreeSaveFingerprint,
  isFamilyTreeListValidationError,
  isTreeSaveConflictError,
  listFamilyTrees,
  listTrashedFamilyTrees,
  permanentlyDeleteFamilyTree,
  rebaseFamilyTreeListStorageRevision,
  rebaseFamilyTreeStorageRevision,
  restoreFamilyTree,
  saveFamilyTree,
  trashFamilyTree,
} from "./services/familyTrees.js";
import { createCloudSaveQueue } from "./services/cloudSaveQueue.js";
import {
  INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES,
  acknowledgeInitialOwnershipDraftSave,
  compareInitialOwnershipDraftToTree,
  dismissInitialOwnershipDraft,
  initialOwnershipDraftWriterId,
  initialOwnershipOwnersFingerprint,
  listInitialOwnershipDrafts,
  markInitialOwnershipDraftSubmitted,
  markInitialOwnershipTreeDeleted,
  recoverInitialOwnershipDraftTree,
  writeInitialOwnershipDraft,
} from "./services/initialOwnershipDraftJournal.js";
import {
  TREE_DRAFT_ERROR_CODES,
  TREE_DRAFT_RECOVERY_STATES,
  acknowledgeTreeDraftSave,
  compareTreeDraftToServer,
  dismissTreeDraft,
  listTreeDrafts,
  markTreeDraftDeleted,
  recoverTreeDraftTree,
  treeDraftFingerprint,
  treeDraftWriterId,
  writeTreeDraft,
} from "./services/treeDraftJournal.js";
import {
  isLocalTrashExpired,
  loadLocalWorkspace,
  readLocalWorkspaceRecovery,
  saveLocalWorkspace,
  upsertWorkspaceTree,
} from "./services/localWorkspace.js";
import {
  DEFAULT_FREE_TREE_LIMIT,
  defaultTreeEntitlement,
  isTreePaymentRequiredError,
  loadTreeEntitlement,
  startTreeCreditCheckout,
} from "./services/treeBilling.js";
import { isPlatformAdmin } from "./services/adminConsole.js";

const makePrimaryProperty = (id = crypto.randomUUID()) => ({
  id,
  address: "",
  saleValue: "",
  owners: [],
  declarations: [],
  transfers: [],
  saleLots: [],
});

const familyViewKey = (groupId) => `family:${groupId}`;

const localRecoveryReplacementPrompt = (action, recoveryAvailable) =>
  recoveryAvailable
    ? `The previous local workspace is unreadable. A recovery copy has been kept. ${action} and replace the active saved data?`
    : `The previous local workspace is unreadable and a recovery copy could not be created. ${action} and permanently replace the active saved data?`;

const activeTreeSnapshot = (value) => {
  const active = { ...value };
  delete active.deletedAt;
  delete active.deleted_at;
  return active;
};

const cloudQueueSnapshotIsSaved = (queue, snapshot) =>
  typeof queue?.isSnapshotSaved === "function"
    ? queue.isSnapshotSaved(snapshot)
    : !queue?.hasUnsavedChanges?.();

// Tree-kind items are excluded here: their "safe" vs "multiple" state is
// decided once, definitively, when drafts are first inventoried (there is no
// row-level replay to re-derive it from), so dynamically re-keying them by
// the absent ownersFingerprint field would incorrectly collapse a genuinely
// still-conflicting draft back to "safe" whenever an unrelated item is
// discarded.
const reclassifyCloudOwnershipRecoveryChoices = (items = []) => {
  const replayableStates = new Set(["safe", "multiple"]);
  const fingerprintsByProperty = new Map();
  items.forEach((item) => {
    if (item.kind === "tree" || !replayableStates.has(item.state) || !item.draft) return;
    const key = `${item.treeId}:${item.propertyId}`;
    const fingerprints = fingerprintsByProperty.get(key) || new Set();
    fingerprints.add(item.draft.ownersFingerprint);
    fingerprintsByProperty.set(key, fingerprints);
  });
  return items.map((item) => {
    if (item.kind === "tree" || !replayableStates.has(item.state) || !item.draft) return item;
    const fingerprints = fingerprintsByProperty.get(`${item.treeId}:${item.propertyId}`);
    return { ...item, state: fingerprints?.size > 1 ? "multiple" : "safe" };
  });
};

const migratedProperties = (value) => {
  if (Array.isArray(value.properties) && value.properties.length) return value.properties;
  const legacy =
    value.property && typeof value.property === "object" && !Array.isArray(value.property)
      ? value.property
      : {};
  const collection = (field) => {
    if (Object.prototype.hasOwnProperty.call(legacy, field)) {
      return Array.isArray(legacy[field]) ? legacy[field] : [];
    }
    return Array.isArray(value[field]) ? value[field] : [];
  };
  const owners = collection("owners");
  const declarations = collection("declarations");
  const transfers = collection("transfers");
  const saleLots = collection("saleLots");
  const hasLegacyRecords =
    owners.length || declarations.length || transfers.length || saleLots.length;
  if (
    !(
      legacy.address ||
      legacy.description ||
      legacy.marketValue ||
      legacy.marketValueAtDeath ||
      legacy.saleValue
    ) &&
    !hasLegacyRecords
  ) {
    return [makePrimaryProperty("primary-property")];
  }
  return [
    {
      ...legacy,
      id: legacy.id || "legacy-property",
      address: legacy.address || "",
      description: legacy.description || "",
      marketValue: legacy.marketValue ?? legacy.marketValueAtDeath ?? "",
      saleValue: legacy.saleValue || "",
      owners,
      declarations,
      transfers,
      saleLots,
    },
  ];
};

const normaliseTree = (value) => {
  let caseData = normaliseCase(value);
  if (!caseData.people.length) {
    const rootPerson = createPerson();
    caseData = createFamilyGroup({ ...caseData, people: [rootPerson] }, rootPerson, {
      title: "Family tree 1",
    });
  }
  const defaultProperty = {
    address: "",
    description: "",
    marketValueAtDeath: "",
    saleValue: "",
    deceasedOwnershipPercent: 100,
    rightPercent: 100,
  };
  const defaultSuccession = {
    basis: "intestacy",
    dateOfDeath: "",
    willDate: "",
    notaryName: "",
    deedWithinSixMonths: false,
    heirs: [],
  };
  const defaultSettings = {
    shareDisplay: "both",
    showOwnershipOnTree: true,
    treeZoom: 100,
    workspaceMode: TREE_WORKSPACE_MODES.PROPERTY_TAX,
  };
  const properties = migratedProperties(caseData);
  const requestedActivePropertyId = caseData.settings?.activePropertyId;
  const activePropertyId = properties.some((property) => property.id === requestedActivePropertyId)
    ? requestedActivePropertyId
    : properties[0]?.id || "";
  const workspaceMode = normaliseTreeWorkspaceMode(caseData.settings?.workspaceMode);
  const settings = {
    ...defaultSettings,
    ...(caseData.settings || {}),
    activePropertyId,
    workspaceMode,
  };
  return {
    ...caseData,
    createdAt: caseData.createdAt || caseData.created_at || caseData.updated_at || "",
    title: caseData.title || "Untitled family",
    property: { ...defaultProperty, ...(caseData.property || {}) },
    properties,
    succession: { ...defaultSuccession, ...(caseData.succession || {}) },
    declarations: caseData.declarations || [],
    outsideParties: caseData.outsideParties || [],
    transfers: caseData.transfers || [],
    saleLots: caseData.saleLots || [],
    settings: {
      ...settings,
      personCardFields: normalisePersonCardFields(settings),
    },
  };
};

const initialTree = (seed = {}) => {
  const caseId = crypto.randomUUID();
  const title = String(seed.title || "").trim() || "New family";
  const workspaceMode = normaliseTreeWorkspaceMode(
    seed.workspaceMode,
    DEFAULT_NEW_TREE_WORKSPACE_MODE,
  );
  const rootPerson = {
    ...createPerson(),
    givenNames: String(seed.givenNames || "").trim(),
    surname: String(seed.surname || "").trim(),
    sex: String(seed.sex || "").trim(),
  };
  return normaliseTree({
    id: caseId,
    createdAt: new Date().toISOString(),
    title,
    people: [rootPerson],
    familyGroups: [
      {
        id: `${caseId}:family-group:1`,
        title,
        rootPersonId: rootPerson.id,
        personIds: [rootPerson.id],
      },
    ],
    activeFamilyGroupId: `${caseId}:family-group:1`,
    properties: [makePrimaryProperty()],
    settings: { workspaceMode },
  });
};

export function caseActivationState(value) {
  const caseData = normaliseTree(value);
  const activeFamilyGroup =
    caseData.familyGroups.find((group) => group.id === caseData.activeFamilyGroupId) ||
    caseData.familyGroups[0];
  return {
    caseData,
    activeFamilyGroupId: activeFamilyGroup?.id || "",
    activeView: familyViewKey(activeFamilyGroup?.id || ""),
    selectedPersonId: activeFamilyGroup?.rootPersonId || activeFamilyGroup?.personIds[0] || "",
    zoom: Number(caseData.settings?.treeZoom) || 100,
  };
}

export function App({
  localOnlyMode = true,
  session = null,
  onChangePassword,
  onSignOut = () => {},
}) {
  // Supabase emits TOKEN_REFRESHED with a new Session object for the same user.
  // Cloud hydration must follow the authenticated identity, not object identity,
  // otherwise every token rotation reloads (and reactivates) the first saved tree.
  const authenticatedUserId = session?.user?.id || "";
  const cloudMode = Boolean(authenticatedUserId) && !localOnlyMode;
  const [startupWorkspace] = useState(() =>
    cloudMode ? { trees: [], trashedTrees: [], activeTreeId: "" } : loadLocalWorkspace(),
  );
  const [tree, setTree] = useState(() => {
    const restoredTree =
      startupWorkspace.trees.find((item) => item.id === startupWorkspace.activeTreeId) ||
      startupWorkspace.trees[0];
    return restoredTree ? normaliseTree(restoredTree) : initialTree();
  });
  const [trees, setTrees] = useState(startupWorkspace.trees);
  const [trashedTrees, setTrashedTrees] = useState(startupWorkspace.trashedTrees || []);
  const [status, setStatus] = useState(
    startupWorkspace.loadError
      ? startupWorkspace.loadError
      : startupWorkspace.trees.length
        ? "Recovered automatically from this device."
        : cloudMode
          ? "Connecting to secure storage..."
          : "Automatically saved on this device.",
  );
  const [saveState, setSaveState] = useState(() => ({
    phase: cloudMode ? "saving" : startupWorkspace.loadError ? "error" : "saved",
    detail: cloudMode
      ? "Connecting to secure storage."
      : startupWorkspace.loadError || "Saved on this device.",
  }));
  const [cloudListState, setCloudListState] = useState(() => ({
    complete: !cloudMode,
    warning: "",
  }));
  const [localRecoveryBlocked, setLocalRecoveryBlocked] = useState(() =>
    Boolean(startupWorkspace.loadError),
  );
  const [entitlement, setEntitlement] = useState(localOnlyMode ? defaultTreeEntitlement : null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingMessage, setBillingMessage] = useState("");
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [adminConsoleOpen, setAdminConsoleOpen] = useState(false);
  const [showLibrary, setShowLibrary] = useState(true);
  const [workspaceView, setWorkspaceView] = useState("tree");
  const [propertyWorkspaceSection, setPropertyWorkspaceSection] = useState("setup");
  const [activeTreeIsListed, setActiveTreeIsListed] = useState(
    () => startupWorkspace.trees.length > 0,
  );
  const [pendingTrashActivationId, setPendingTrashActivationId] = useState("");
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [dashboardPanelWidth, setDashboardPanelWidth] = useState(readDashboardPanelWidth);
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const [selectedOutsideOwnerId, setSelectedOutsideOwnerId] = useState("");
  const [initialOwnerPick, setInitialOwnerPick] = useState(null);
  const [zoom, setZoom] = useState(() => Number(tree.settings?.treeZoom) || 100);
  const cloudSaveQueueRef = useRef(null);
  const initialOwnershipDraftWriterIdRef = useRef("");
  if (!initialOwnershipDraftWriterIdRef.current) {
    initialOwnershipDraftWriterIdRef.current = initialOwnershipDraftWriterId();
  }
  const treeDraftWriterIdRef = useRef("");
  if (!treeDraftWriterIdRef.current) {
    treeDraftWriterIdRef.current = treeDraftWriterId();
  }
  const initialOwnershipDraftCacheRef = useRef(new Map());
  const skipNextCloudPersistenceEffectRef = useRef("");
  const recoveredInitialOwnershipDraftsRef = useRef(new Map());
  const recoveredTreeDraftsRef = useRef(new Map());
  const latestTreeRef = useRef(tree);
  const latestTreesRef = useRef(trees);
  const latestTrashedTreesRef = useRef(trashedTrees);
  const activeTreeIsListedRef = useRef(activeTreeIsListed);
  const failedDirectSaveIdsRef = useRef(new Set());
  const directSavePromisesRef = useRef(new Map());
  const propertyWorkspaceRef = useRef(null);
  const propertyWorkspaceNavRef = useRef(null);
  const initialOwnershipFlushRef = useRef(null);
  const [activeFamilyGroupId, setActiveFamilyGroupId] = useState(
    () => normaliseTree(tree).activeFamilyGroupId,
  );
  const [cloudPendingRecoveries, setCloudPendingRecoveries] = useState([]);
  const activateCase = useCallback((value, options = {}) => {
    const activation = caseActivationState(value);
    if (options.acknowledgeCloudSave) {
      cloudSaveQueueRef.current?.acknowledge?.(activation.caseData);
    }
    setTree(activation.caseData);
    setZoom(activation.zoom);
    setActiveFamilyGroupId(activation.activeFamilyGroupId);
    setSelectedPersonId(activation.selectedPersonId);
    setSelectedOutsideOwnerId("");
    setInitialOwnerPick(null);
    if (options.openDashboard) setDashboardOpen(true);
    return activation.caseData;
  }, []);

  // The Property & Tax menu is sticky and wraps onto more lines as the screen
  // narrows, so the room each section must keep clear is measured rather than
  // guessed. Without this a jumped-to heading hides behind the menu.
  useEffect(
    () => observeStickyNavOffset(propertyWorkspaceRef.current, propertyWorkspaceNavRef.current),
    [workspaceView],
  );

  useEffect(() => storeDashboardPanelWidth(dashboardPanelWidth), [dashboardPanelWidth]);

  const initialOwnershipDraftCacheKey = (treeId, propertyId) => `${treeId}:${propertyId}`;
  const journalInitialOwnershipChanges = useCallback(
    (baseTree, nextTree) => {
      const changedProperties = (nextTree.properties || []).filter((property) => {
        const baseProperty = (baseTree.properties || []).find(
          (candidate) => candidate.id === property.id,
        );
        if (!baseProperty) return false;
        return (
          initialOwnershipOwnersFingerprint(baseProperty.owners || []) !==
          initialOwnershipOwnersFingerprint(property.owners || [])
        );
      });
      const drafts = [];
      changedProperties.forEach((property) => {
        const cacheKey = initialOwnershipDraftCacheKey(nextTree.id, property.id);
        const hasCurrentWriterDraft = initialOwnershipDraftCacheRef.current.has(cacheKey);
        const recovered = recoveredInitialOwnershipDraftsRef.current.get(nextTree.id);
        const recoveryBaseTree =
          recovered && !hasCurrentWriterDraft ? normaliseTree(recovered.serverTree) : baseTree;
        const baseProperty = recoveryBaseTree.properties.find(
          (candidate) => candidate.id === property.id,
        );
        if (!baseProperty) {
          throw new Error("The property being edited is not present in the saved cloud family.");
        }
        const draft = writeInitialOwnershipDraft(
          authenticatedUserId,
          {
            treeId: nextTree.id,
            propertyId: property.id,
            baseStorageRevision: recoveryBaseTree.storageRevision,
            baseOwners: baseProperty.owners || [],
            owners: property.owners || [],
            baseOutsideParties: recoveryBaseTree.outsideParties || [],
            outsideParties: nextTree.outsideParties || [],
            knownAncestorOwnerFingerprints:
              recovered && !hasCurrentWriterDraft
                ? [
                    initialOwnershipOwnersFingerprint(
                      baseTree.properties.find((candidate) => candidate.id === property.id)
                        ?.owners || [],
                    ),
                  ]
                : [],
          },
          { writerId: initialOwnershipDraftWriterIdRef.current },
        );
        initialOwnershipDraftCacheRef.current.set(cacheKey, draft);
        drafts.push(draft);
      });
      return drafts;
    },
    [authenticatedUserId],
  );

  // Whole-tree sibling of journalInitialOwnershipChanges. Runs on every
  // durable commit (not just ownership-row edits) so a local recovery
  // snapshot exists the instant an edit is made, independent of whether the
  // debounced cloud save ever completes before the tab is backgrounded,
  // put to sleep, or discarded.
  const journalTreeDraft = useCallback(
    (nextTree) => {
      const baseStorageRevision = Number(nextTree.storageRevision);
      if (!Number.isSafeInteger(baseStorageRevision) || baseStorageRevision <= 0) return null;
      return writeTreeDraft(
        authenticatedUserId,
        {
          treeId: nextTree.id,
          baseStorageRevision,
          tree: prepareTreeForPersistence(nextTree),
        },
        { writerId: treeDraftWriterIdRef.current },
      );
    },
    [authenticatedUserId],
  );

  const registerInitialOwnershipFlush = useCallback((controller) => {
    initialOwnershipFlushRef.current = controller;
    return () => {
      if (initialOwnershipFlushRef.current === controller) {
        initialOwnershipFlushRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!cloudMode) return undefined;
    const queue = createCloudSaveQueue(
      (snapshot) => saveFamilyTree(snapshot, authenticatedUserId),
      {
        rebaseSnapshot: rebaseFamilyTreeStorageRevision,
        snapshotFingerprint: familyTreeSaveFingerprint,
        isConflictError: isTreeSaveConflictError,
        onStateChange: (queueState) => {
          const detail =
            queueState.phase === "conflict"
              ? queueState.error?.message
              : queueState.phase === "error"
                ? queueState.error?.message || "The latest changes could not be saved."
                : queueState.phase === "saving"
                  ? "Changes are being secured."
                  : "All changes are saved securely.";
          setSaveState({ phase: queueState.phase, detail });
        },
        onSaveStart: (submittedSnapshot) => {
          (submittedSnapshot.properties || []).forEach((property) => {
            const cacheKey = initialOwnershipDraftCacheKey(submittedSnapshot.id, property.id);
            const cached = initialOwnershipDraftCacheRef.current.get(cacheKey);
            if (!cached) return;
            const submittedFingerprint = initialOwnershipOwnersFingerprint(property.owners || []);
            if (
              cached.ownersFingerprint !== submittedFingerprint &&
              !cached.submittedOwnerFingerprints.includes(submittedFingerprint)
            ) {
              return;
            }
            try {
              const marked = markInitialOwnershipDraftSubmitted(
                authenticatedUserId,
                submittedSnapshot.id,
                property.id,
                submittedFingerprint,
                { writerId: initialOwnershipDraftWriterIdRef.current },
              );
              if (marked) initialOwnershipDraftCacheRef.current.set(cacheKey, marked);
            } catch (error) {
              setStatus(
                `The cloud save was stopped because its initial-ownership recovery lineage could not be recorded: ${error.message}`,
              );
              throw error;
            }
          });
        },
        onSaveSuccess: (savedTree, savedSnapshot) => {
          const recovered = recoveredInitialOwnershipDraftsRef.current.get(savedSnapshot.id);
          const recoveryCleanupWarnings = [];
          try {
            (savedSnapshot.properties || []).forEach((property) => {
              const cacheKey = initialOwnershipDraftCacheKey(savedSnapshot.id, property.id);
              const cached = initialOwnershipDraftCacheRef.current.get(cacheKey);
              if (!cached) return;
              const savedOwnersFingerprint = initialOwnershipOwnersFingerprint(
                property.owners || [],
              );
              if (
                cached.ownersFingerprint !== savedOwnersFingerprint &&
                !cached.submittedOwnerFingerprints.includes(savedOwnersFingerprint)
              ) {
                return;
              }
              const acknowledgement = acknowledgeInitialOwnershipDraftSave(
                authenticatedUserId,
                savedSnapshot.id,
                property.id,
                savedOwnersFingerprint,
                savedSnapshot.storageRevision,
                savedTree.storageRevision,
                { writerId: initialOwnershipDraftWriterIdRef.current },
              );
              if (acknowledgement.draft) {
                initialOwnershipDraftCacheRef.current.set(cacheKey, acknowledgement.draft);
              } else {
                initialOwnershipDraftCacheRef.current.delete(cacheKey);
              }
            });
          } catch (error) {
            recoveryCleanupWarnings.push(error.message);
          }
          (recovered?.sources || []).forEach((source) => {
            try {
              const dismissed = dismissInitialOwnershipDraft(
                authenticatedUserId,
                source.treeId,
                source.propertyId,
                source.recordFingerprint,
                { writerId: source.writerId },
              );
              if (!dismissed) {
                recoveryCleanupWarnings.push(
                  "A source browser record changed while this save completed and will need review on the next reload.",
                );
              }
            } catch (error) {
              recoveryCleanupWarnings.push(error.message);
            }
          });
          if (recovered) recoveredInitialOwnershipDraftsRef.current.delete(savedSnapshot.id);
          try {
            acknowledgeTreeDraftSave(
              authenticatedUserId,
              savedSnapshot.id,
              treeDraftFingerprint(prepareTreeForPersistence(savedSnapshot)),
              { writerId: treeDraftWriterIdRef.current },
            );
          } catch (error) {
            recoveryCleanupWarnings.push(error.message);
          }
          const recoveredTreeDraft = recoveredTreeDraftsRef.current.get(savedSnapshot.id);
          if (recoveredTreeDraft) {
            try {
              const dismissed = dismissTreeDraft(
                authenticatedUserId,
                recoveredTreeDraft.source.treeId,
                recoveredTreeDraft.source.recordFingerprint,
                { writerId: recoveredTreeDraft.source.writerId },
              );
              if (!dismissed) {
                recoveryCleanupWarnings.push(
                  "A source browser record changed while this save completed and will need review on the next reload.",
                );
              }
            } catch (error) {
              recoveryCleanupWarnings.push(error.message);
            }
            recoveredTreeDraftsRef.current.delete(savedSnapshot.id);
          }
          if (recoveryCleanupWarnings.length) {
            setStatus(
              `Saved securely, but local recovery data still needs review: ${[
                ...new Set(recoveryCleanupWarnings),
              ].join(" ")}`,
            );
          }
          setTree((current) => rebaseFamilyTreeStorageRevision(current, savedTree));
          setTrees((items) => rebaseFamilyTreeListStorageRevision(items, savedTree));
        },
        onSaveError: (error) =>
          setStatus(
            isTreeSaveConflictError(error)
              ? `Conflict detected: ${error.message}`
              : `Save failed: ${error?.message || "Unknown error"}`,
          ),
      },
    );
    cloudSaveQueueRef.current = queue;
    return () => {
      if (cloudSaveQueueRef.current === queue) {
        // Parent effect cleanups run before InitialOwnershipEditor's cleanup.
        // Capture its still-focused field while this queue can both journal and
        // schedule the final snapshot, then make the queue unavailable.
        initialOwnershipFlushRef.current?.flush?.();
        cloudSaveQueueRef.current = null;
      }
      queue.dispose();
    };
  }, [authenticatedUserId, cloudMode]);

  useEffect(() => {
    const warnAboutUnsavedCloudChanges = (event) => {
      const ownershipFlushSucceeded = initialOwnershipFlushRef.current?.flush?.() !== false;
      const ownershipStillPending = Boolean(initialOwnershipFlushRef.current?.hasPending?.());
      const cloudChangesPending = Boolean(
        cloudMode && cloudSaveQueueRef.current?.hasUnsavedChanges(),
      );
      if (ownershipFlushSucceeded && !ownershipStillPending && !cloudChangesPending) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnAboutUnsavedCloudChanges);
    return () => window.removeEventListener("beforeunload", warnAboutUnsavedCloudChanges);
  }, [cloudMode]);

  const refreshTreeEntitlement = useCallback(async () => {
    if (!cloudMode) {
      setEntitlement(defaultTreeEntitlement);
      return defaultTreeEntitlement;
    }
    const nextEntitlement = await loadTreeEntitlement(authenticatedUserId);
    setEntitlement(nextEntitlement);
    return nextEntitlement;
  }, [authenticatedUserId, cloudMode]);

  useEffect(() => {
    if (!cloudMode) return undefined;
    const refreshEntitlementWhenActive = () => {
      if (document.visibilityState === "hidden") return;
      refreshTreeEntitlement().catch((error) => {
        setBillingMessage(
          `Account allowance could not be refreshed: ${error?.message || "Unknown error"}`,
        );
      });
    };
    window.addEventListener("focus", refreshEntitlementWhenActive);
    document.addEventListener("visibilitychange", refreshEntitlementWhenActive);
    return () => {
      window.removeEventListener("focus", refreshEntitlementWhenActive);
      document.removeEventListener("visibilitychange", refreshEntitlementWhenActive);
    };
  }, [cloudMode, refreshTreeEntitlement]);

  useEffect(() => {
    if (!cloudMode) {
      setPlatformAdmin(false);
      return undefined;
    }
    let live = true;
    isPlatformAdmin().then((admin) => {
      if (live) setPlatformAdmin(admin);
    });
    return () => {
      live = false;
    };
  }, [authenticatedUserId, cloudMode]);

  const currentTree = useMemo(() => normaliseTree(tree), [tree]);
  latestTreeRef.current = currentTree;
  latestTreesRef.current = trees;
  latestTrashedTreesRef.current = trashedTrees;
  activeTreeIsListedRef.current = activeTreeIsListed;
  const legalWorkspaceEnabled = propertyTaxWorkspaceEnabled(currentTree.settings.workspaceMode);
  const requestedActiveFamilyGroup = currentTree.familyGroups.find(
    (group) => group.id === activeFamilyGroupId,
  );
  const activeFamilyGroup =
    requestedActiveFamilyGroup ||
    currentTree.familyGroups.find((group) => group.id === currentTree.activeFamilyGroupId) ||
    currentTree.familyGroups[0];
  const activePersonIds = new Set(activeFamilyGroup?.personIds || []);
  const visiblePeople = currentTree.people.filter((person) => activePersonIds.has(person.id));
  const activeProperty =
    currentTree.properties.find(
      (property) => property.id === currentTree.settings.activePropertyId,
    ) ||
    currentTree.properties[0] ||
    makePrimaryProperty("primary-property");
  const deceasedStatusSession = statusToggleSession(currentTree, "deceased", selectedPersonId);
  const interVivosStatusSession = statusToggleSession(currentTree, "inter-vivos", selectedPersonId);
  const activeProperties = useMemo(() => [activeProperty], [activeProperty]);
  const propertyReport = useMemo(
    () =>
      legalWorkspaceEnabled
        ? buildPropertyVendorTaxReport(
            activeProperty,
            currentTree.people,
            currentTree.outsideParties,
          )
        : null,
    [activeProperty, currentTree.outsideParties, currentTree.people, legalWorkspaceEnabled],
  );
  const taxCalculationReport = useMemo(
    () =>
      legalWorkspaceEnabled && propertyReport
        ? buildTaxCalculationReport(
            activeProperty,
            currentTree.people,
            currentTree.outsideParties,
            propertyReport,
          )
        : null,
    [
      activeProperty,
      currentTree.outsideParties,
      currentTree.people,
      legalWorkspaceEnabled,
      propertyReport,
    ],
  );
  const ownershipByPerson = useMemo(() => {
    if (!propertyReport) return {};
    return buildTreeCardOwnershipByPerson(
      propertyReport.ledger.owners,
      propertyReport.ownership.transmissions,
    );
  }, [propertyReport]);
  const ownershipFractionsByPerson = useMemo(() => {
    if (!propertyReport) return {};
    return buildTreeCardOwnershipFractionsByPerson(
      propertyReport.ledger.owners,
      propertyReport.ownership.transmissions,
    );
  }, [propertyReport]);
  const historicalLawWarningsByPerson = useMemo(
    () =>
      propertyReport
        ? buildTreeCardHistoricalWarningsByPerson(propertyReport.ownership.transmissions)
        : {},
    [propertyReport],
  );
  const currentOwnerPresentationsByPerson = useMemo(() => {
    if (!propertyReport) return {};
    const presentations = buildCurrentOwnerPresentations(
      propertyReport.ledger.owners,
      activeProperty.saleValue,
      taxCalculationReport,
    ).filter((owner) => owner.personId);
    return ownerPresentationsById(presentations.map((owner) => ({ ...owner, id: owner.personId })));
  }, [activeProperty.saleValue, propertyReport, taxCalculationReport]);
  const causaMortisCoverage = useMemo(
    () =>
      legalWorkspaceEnabled && propertyReport
        ? buildCausaMortisShareCoverage(
            currentTree.people,
            propertyReport.startingOwnership.isComplete ? activeProperties : [],
            currentTree.outsideParties,
            { casePropertyIds: currentTree.properties.map((property) => property.id) },
          )
        : { byPerson: {} },
    [
      activeProperties,
      currentTree.outsideParties,
      currentTree.people,
      currentTree.properties,
      legalWorkspaceEnabled,
      propertyReport,
    ],
  );
  const taxReadinessPlan = useMemo(
    () =>
      legalWorkspaceEnabled && propertyReport?.startingOwnership?.isComplete
        ? buildTaxReadinessPlan({
            property: activeProperty,
            people: currentTree.people,
            outsideParties: currentTree.outsideParties,
            propertyReport,
            taxCalculationReport,
            causaMortisCoverage,
          })
        : { order: [], issuesByPerson: {}, pendingPersonIds: [] },
    [
      activeProperty,
      causaMortisCoverage,
      currentTree.people,
      currentTree.outsideParties,
      legalWorkspaceEnabled,
      propertyReport,
      taxCalculationReport,
    ],
  );
  const hasSavedTaxReadinessSession = Boolean(activeProperty.taxReadinessGuide);
  const taxReadinessSession = useMemo(
    () =>
      normaliseTaxReadinessSession(
        activeProperty.taxReadinessGuide,
        taxReadinessPlan,
        activeProperty.id,
      ),
    [activeProperty.id, activeProperty.taxReadinessGuide, taxReadinessPlan],
  );
  const taxReadinessOutstandingPersonIds = taxReadinessPlan.pendingPersonIds.filter(
    (personId) => !taxReadinessSession.reviewedPersonIds.includes(personId),
  );
  const taxReadinessSkippedPersonIds = taxReadinessSession.skippedPersonIds.filter((personId) =>
    taxReadinessOutstandingPersonIds.includes(personId),
  );
  const taxReadinessGuideSummary = {
    status: hasSavedTaxReadinessSession ? taxReadinessSession.status : "not-started",
    pendingCount: taxReadinessOutstandingPersonIds.length,
    skippedCount: taxReadinessSkippedPersonIds.length,
    canContinue: Boolean(
      ["active", "paused"].includes(taxReadinessSession.status) &&
      taxReadinessSession.currentPersonId,
    ),
  };
  const activeTaxReadinessPersonId =
    taxReadinessSession.status === "active" ? taxReadinessSession.currentPersonId : "";
  const activeTaxReadinessIssues = activeTaxReadinessPersonId
    ? taxReadinessPlan.issuesByPerson[activeTaxReadinessPersonId] || []
    : [];
  const activeTaxReadinessPerson = currentTree.people.find(
    (person) => person.id === activeTaxReadinessPersonId,
  );
  const taxReadinessGuidePosition = taxReadinessSession.historyPersonIds.length + 1;
  const taxReadinessGuideTotal =
    taxReadinessGuidePosition +
    taxReadinessOutstandingPersonIds.filter(
      (personId) =>
        personId !== activeTaxReadinessPersonId &&
        !taxReadinessSession.historyPersonIds.includes(personId),
    ).length;
  const selectedRetainedIdentityLabels = useMemo(() => {
    const relationshipLabels = new Set([
      "a child relationship",
      "a partner relationship",
      "a sibling relationship",
    ]);
    return casePersonDependencyLabels(currentTree, selectedPersonId).filter(
      (label) => !relationshipLabels.has(label),
    );
  }, [currentTree, selectedPersonId]);

  useEffect(() => {
    if (!activeFamilyGroup) {
      setActiveFamilyGroupId("");
      return;
    }
    if (activeFamilyGroup.id !== activeFamilyGroupId) {
      setActiveFamilyGroupId(activeFamilyGroup.id);
    }
    if (!visiblePeople.length) {
      setSelectedPersonId("");
      return;
    }
    if (selectedPersonId && !visiblePeople.some((person) => person.id === selectedPersonId)) {
      setSelectedPersonId(
        visiblePeople.find((person) => person.id === activeFamilyGroup.rootPersonId)?.id ||
          visiblePeople[0].id,
      );
    }
  }, [activeFamilyGroup, activeFamilyGroupId, selectedPersonId, visiblePeople]);

  useEffect(() => {
    if (!activeTreeIsListed) return;
    setTrees((items) => upsertWorkspaceTree(items, currentTree));
  }, [activeTreeIsListed, currentTree]);

  useEffect(() => {
    if (!pendingTrashActivationId) return undefined;
    let cancelled = false;
    const remainingTrees = trees.filter((item) => item.id !== pendingTrashActivationId);
    const nextTree = remainingTrees.find(
      (item) => !cloudPendingRecoveries.some((recovery) => recovery.treeId === item.id),
    );
    const pendingRecoveryOnly = !nextTree && remainingTrees.length > 0;
    const pendingDirectSave = nextTree ? directSavePromisesRef.current.get(nextTree.id) : undefined;

    const finishActivation = async () => {
      let activationTree = nextTree;
      let acknowledgeCloudSave = cloudMode;
      if (pendingDirectSave) {
        try {
          activationTree = await pendingDirectSave;
        } catch {
          // Keep the optimistic record open, but do not tell the queue that its
          // failed save is a trusted server base. Scheduling the activated tree
          // below will retry it through the active queue.
          acknowledgeCloudSave = false;
        }
      }
      if (cancelled) return;
      setPendingTrashActivationId("");
      if (activationTree) {
        setActiveTreeIsListed(true);
        const recovered = cloudMode
          ? recoveredInitialOwnershipDraftsRef.current.get(activationTree.id)
          : null;
        if (recovered) cloudSaveQueueRef.current?.acknowledge?.(recovered.serverTree);
        activateCase(activationTree, { acknowledgeCloudSave: acknowledgeCloudSave && !recovered });
      } else {
        setActiveTreeIsListed(false);
        activateCase(initialTree(), { acknowledgeCloudSave: cloudMode });
        if (pendingRecoveryOnly) {
          setShowLibrary(true);
          setStatus(
            "Review the pending browser version before opening the remaining cloud family.",
          );
        }
      }
    };
    void finishActivation();
    return () => {
      cancelled = true;
    };
  }, [activateCase, cloudMode, cloudPendingRecoveries, pendingTrashActivationId, trees]);

  useEffect(() => {
    if (cloudMode) return;
    if (localRecoveryBlocked) {
      setStatus(startupWorkspace.loadError || "Local recovery is required before saving.");
      return;
    }
    const saved = saveLocalWorkspace(
      trees,
      activeTreeIsListed ? tree.id : "",
      undefined,
      trashedTrees,
    );
    setSaveState({
      phase: saved ? "saved" : "error",
      detail: saved
        ? "Saved on this device."
        : "This browser could not save the latest changes. Keep this page open.",
    });
    setStatus(
      saved
        ? "Automatically saved on this device."
        : "This browser could not save the current tree. Keep this page open.",
    );
  }, [
    activeTreeIsListed,
    cloudMode,
    localRecoveryBlocked,
    startupWorkspace.loadError,
    tree.id,
    trees,
    trashedTrees,
  ]);

  useEffect(() => {
    if (!cloudMode) return;
    let cancelled = false;
    setCloudListState({ complete: false, warning: "" });
    const safeFamilyList = (request) =>
      request
        .then((items) => ({ items, error: null }))
        .catch((error) => ({
          items: isFamilyTreeListValidationError(error) ? error.trees : [],
          error,
        }));

    Promise.all([
      safeFamilyList(listFamilyTrees(authenticatedUserId)),
      safeFamilyList(listTrashedFamilyTrees(authenticatedUserId)),
      refreshTreeEntitlement()
        .then(() => ({ error: null }))
        .catch((error) => ({ error })),
    ])
      .then(([activeResult, trashResult, entitlementResult]) => {
        if (cancelled) return;
        let activationTree = activeResult.items[0] || null;
        let activationServerTree = activationTree;
        let recoveredPendingDraft = false;
        const recoveryWarnings = [];
        const recoveryItems = [];
        const recoveredByTree = new Map();
        try {
          // Tree drafts (general edits) are recovered before ownership drafts
          // (initial-owner rows) so the finer-grained, more-recently-journaled
          // ownership state can still layer on top for the tree being opened.
          const serverTreesById = new Map(activeResult.items.map((item) => [item.id, item]));
          const treeDraftInventory = listTreeDrafts(authenticatedUserId);
          treeDraftInventory.invalidRecords.forEach((record, index) => {
            recoveryItems.push({
              id: `tree-invalid:${index}:${record.key}`,
              kind: "tree",
              treeId: "",
              writerId: "",
              title: "Unreadable family recovery record",
              savedAt: "",
              state: "invalid",
              draft: null,
              serverTree: null,
              storageKey: record.key,
              raw: record.raw,
              error: record.error,
            });
          });
          const treeDraftsByTree = new Map();
          treeDraftInventory.drafts.forEach((draft) => {
            const entries = treeDraftsByTree.get(draft.treeId) || [];
            entries.push(draft);
            treeDraftsByTree.set(draft.treeId, entries);
          });
          treeDraftsByTree.forEach((drafts, treeId) => {
            const serverTree = serverTreesById.get(treeId);
            if (!serverTree) {
              const trashedTree = trashResult.items.find((candidate) => candidate.id === treeId);
              drafts.forEach((draft) => {
                recoveryItems.push({
                  id: `tree:${draft.treeId}:${draft.writerId}:${draft.recordFingerprint}`,
                  kind: "tree",
                  treeId: draft.treeId,
                  writerId: draft.writerId,
                  title: trashedTree?.title || "Deleted or unavailable family",
                  savedAt: draft.savedAt,
                  state: trashedTree ? "trashed" : "orphan",
                  draft,
                  serverTree: trashedTree || null,
                });
              });
              return;
            }
            const comparisons = drafts.map((draft) => ({
              draft,
              comparison: compareTreeDraftToServer(draft, serverTree),
            }));
            comparisons.forEach(({ draft, comparison }) => {
              if (comparison.state === TREE_DRAFT_RECOVERY_STATES.IDENTICAL) {
                try {
                  dismissTreeDraft(authenticatedUserId, treeId, draft.recordFingerprint, {
                    writerId: draft.writerId,
                  });
                } catch {
                  // A harmless race with another tab clearing the same record.
                }
                return;
              }
              if (comparison.state === TREE_DRAFT_RECOVERY_STATES.CONFLICT) {
                recoveryItems.push({
                  id: `tree:${draft.treeId}:${draft.writerId}:${draft.recordFingerprint}`,
                  kind: "tree",
                  treeId: draft.treeId,
                  writerId: draft.writerId,
                  title: serverTree.title || "Family",
                  savedAt: draft.savedAt,
                  state: "conflict",
                  draft,
                  serverTree,
                });
              }
            });
            const restorable = comparisons.filter(
              ({ comparison }) => comparison.state === TREE_DRAFT_RECOVERY_STATES.SAFE_TO_RESTORE,
            );
            if (!restorable.length) return;
            // Different tabs can each hold their own unsaved draft for the same
            // tree. Only the newest is offered automatically; the rest stay
            // listed so nothing from another tab is silently discarded.
            const [newest, ...rest] = [...restorable].sort((first, second) =>
              second.draft.savedAt.localeCompare(first.draft.savedAt),
            );
            rest.forEach(({ draft }) =>
              recoveryItems.push({
                id: `tree:${draft.treeId}:${draft.writerId}:${draft.recordFingerprint}`,
                kind: "tree",
                treeId: draft.treeId,
                writerId: draft.writerId,
                title: serverTree.title || "Family",
                savedAt: draft.savedAt,
                state: "multiple",
                draft,
                serverTree,
              }),
            );
            if (treeId === activationTree?.id) {
              try {
                const recoveredTree = prepareTreeForPersistence(
                  normaliseTree(recoverTreeDraftTree(newest.draft, serverTree)),
                );
                activationTree = recoveredTree;
                activationServerTree = serverTree;
                serverTreesById.set(treeId, recoveredTree);
                recoveredTreeDraftsRef.current.set(treeId, { serverTree, source: newest.draft });
                recoveredPendingDraft = true;
              } catch (error) {
                recoveryItems.push({
                  id: `tree:${newest.draft.treeId}:${newest.draft.writerId}:${newest.draft.recordFingerprint}`,
                  kind: "tree",
                  treeId: newest.draft.treeId,
                  writerId: newest.draft.writerId,
                  title: serverTree.title || "Family",
                  savedAt: newest.draft.savedAt,
                  state: "safe",
                  draft: newest.draft,
                  serverTree,
                });
                recoveryWarnings.push(
                  `A pending local version could not be restored automatically: ${error.message}`,
                );
              }
            } else {
              recoveryItems.push({
                id: `tree:${newest.draft.treeId}:${newest.draft.writerId}:${newest.draft.recordFingerprint}`,
                kind: "tree",
                treeId: newest.draft.treeId,
                writerId: newest.draft.writerId,
                title: serverTree.title || "Family",
                savedAt: newest.draft.savedAt,
                state: "safe",
                draft: newest.draft,
                serverTree,
              });
            }
          });

          const safeDraftsByProperty = new Map();
          const pendingInventory = listInitialOwnershipDrafts(authenticatedUserId);
          pendingInventory.invalidRecords.forEach((record, index) => {
            recoveryItems.push({
              id: `invalid:${index}:${record.key}`,
              kind: "ownership",
              treeId: "",
              propertyId: "",
              writerId: "",
              title: "Unreadable initial-ownership recovery record",
              savedAt: "",
              state: "invalid",
              draft: null,
              serverTree: null,
              storageKey: record.key,
              raw: record.raw,
              error: record.error,
            });
          });
          pendingInventory.drafts.forEach((draft) => {
            const serverTree = serverTreesById.get(draft.treeId);
            if (!serverTree) {
              const trashedTree = trashResult.items.find(
                (candidate) => candidate.id === draft.treeId,
              );
              recoveryItems.push({
                id: `${draft.treeId}:${draft.propertyId}:${draft.writerId}:${draft.recordFingerprint}`,
                kind: "ownership",
                treeId: draft.treeId,
                propertyId: draft.propertyId,
                writerId: draft.writerId,
                title: trashedTree?.title || "Deleted or unavailable family",
                savedAt: draft.savedAt,
                state: trashedTree ? "trashed" : "orphan",
                draft,
                serverTree: trashedTree || null,
              });
              return;
            }
            const comparison = compareInitialOwnershipDraftToTree(draft, serverTree);
            if (comparison.state === INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES.IDENTICAL) {
              dismissInitialOwnershipDraft(
                authenticatedUserId,
                draft.treeId,
                draft.propertyId,
                draft.recordFingerprint,
                { writerId: draft.writerId },
              );
              return;
            }
            if (comparison.state === INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES.SAFE_TO_REPLAY) {
              const propertyKey = `${draft.treeId}:${draft.propertyId}`;
              const entries = safeDraftsByProperty.get(propertyKey) || [];
              entries.push({ draft, serverTree, comparison });
              safeDraftsByProperty.set(propertyKey, entries);
              return;
            }
            recoveryItems.push({
              id: `${draft.treeId}:${draft.propertyId}:${draft.writerId}:${draft.recordFingerprint}`,
              kind: "ownership",
              treeId: draft.treeId,
              propertyId: draft.propertyId,
              writerId: draft.writerId,
              title: serverTree.title || "Family",
              savedAt: draft.savedAt,
              state: "conflict",
              draft,
              serverTree,
            });
          });

          const replayCandidatesByTree = new Map();
          safeDraftsByProperty.forEach((entries) => {
            const fingerprintGroups = new Map();
            entries.forEach((entry) => {
              const group = fingerprintGroups.get(entry.draft.ownersFingerprint) || [];
              group.push(entry);
              fingerprintGroups.set(entry.draft.ownersFingerprint, group);
            });
            if (fingerprintGroups.size > 1) {
              entries.forEach((entry) =>
                recoveryItems.push({
                  id: `${entry.draft.treeId}:${entry.draft.propertyId}:${entry.draft.writerId}:${entry.draft.recordFingerprint}`,
                  kind: "ownership",
                  treeId: entry.draft.treeId,
                  propertyId: entry.draft.propertyId,
                  writerId: entry.draft.writerId,
                  title: entry.serverTree.title || "Family",
                  savedAt: entry.draft.savedAt,
                  state: "multiple",
                  draft: entry.draft,
                  serverTree: entry.serverTree,
                }),
              );
              return;
            }
            const candidates = [...entries].sort((first, second) =>
              second.draft.savedAt.localeCompare(first.draft.savedAt),
            );
            const representative = {
              ...candidates[0],
              sources: candidates.map((item) => item.draft),
            };
            const treeEntries = replayCandidatesByTree.get(representative.draft.treeId) || [];
            treeEntries.push(representative);
            replayCandidatesByTree.set(representative.draft.treeId, treeEntries);
          });

          replayCandidatesByTree.forEach((entries, treeId) => {
            const serverTree = entries[0].serverTree;
            try {
              const recoveredTree = prepareTreeForPersistence(
                normaliseTree(
                  entries.reduce(
                    (candidate, entry) => recoverInitialOwnershipDraftTree(entry.draft, candidate),
                    serverTree,
                  ),
                ),
              );
              const recovered = {
                serverTree,
                sources: entries.flatMap((entry) => entry.sources),
                tree: recoveredTree,
              };
              recoveredByTree.set(treeId, recovered);
              if (activationTree?.id === treeId) {
                activationServerTree = serverTree;
                activationTree = recoveredTree;
                recoveredPendingDraft = true;
              }
            } catch (error) {
              entries.forEach((entry) =>
                recoveryItems.push({
                  id: `${entry.draft.treeId}:${entry.draft.propertyId}:${entry.draft.writerId}:${entry.draft.recordFingerprint}`,
                  kind: "ownership",
                  treeId: entry.draft.treeId,
                  propertyId: entry.draft.propertyId,
                  writerId: entry.draft.writerId,
                  title: entry.serverTree.title || "Family",
                  savedAt: entry.draft.savedAt,
                  state: "safe",
                  draft: entry.draft,
                  serverTree: entry.serverTree,
                }),
              );
              recoveryWarnings.push(
                `Pending initial ownership could not be prepared automatically: ${error.message}`,
              );
            }
          });
        } catch (error) {
          recoveryWarnings.push(`Pending local changes need attention: ${error.message}`);
        }

        recoveredInitialOwnershipDraftsRef.current = recoveredByTree;
        setCloudPendingRecoveries(recoveryItems);
        if (recoveryItems.length) {
          recoveryWarnings.push(
            `${recoveryItems.length} pending local version${recoveryItems.length === 1 ? " needs" : "s need"} review in the family library.`,
          );
        }

        setTrees(
          activeResult.items.map(
            (candidate) => recoveredByTree.get(candidate.id)?.tree || candidate,
          ),
        );
        setTrashedTrees(trashResult.items);
        if (activationTree) {
          setActiveTreeIsListed(true);
          if (recoveredPendingDraft) {
            cloudSaveQueueRef.current?.acknowledge?.(activationServerTree);
            activateCase(activationTree);
          } else {
            activateCase(activationTree, { acknowledgeCloudSave: true });
          }
        } else {
          setActiveTreeIsListed(false);
        }
        const collectionWarnings = [
          activeResult.error ? `Saved families need attention: ${activeResult.error.message}` : "",
          trashResult.error ? `Trash needs attention: ${trashResult.error.message}` : "",
          ...recoveryWarnings,
        ].filter(Boolean);
        const collectionWarning = collectionWarnings.join(" ");
        setCloudListState({
          complete: !collectionWarning,
          warning: collectionWarning,
        });
        const warnings = [
          ...collectionWarnings,
          entitlementResult.error
            ? `Account allowance needs attention: ${entitlementResult.error.message}`
            : "",
        ].filter(Boolean);
        if (warnings.length) {
          setStatus(warnings.join(" "));
          setSaveState({ phase: "error", detail: warnings.join(" ") });
        } else if (recoveredPendingDraft) {
          setStatus("Recovered pending changes from this device. Saving them securely now...");
          setSaveState({ phase: "saving", detail: "Recovered changes are being secured." });
        } else {
          setStatus("Saved securely to your workspace.");
          setSaveState({ phase: "saved", detail: "All changes are saved securely." });
        }
      })
      .catch((error) => {
        if (cancelled) return;
        const warning = `Cloud family lists could not be verified: ${error.message}`;
        setCloudListState({ complete: false, warning });
        setStatus(warning);
        setSaveState({ phase: "error", detail: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [activateCase, authenticatedUserId, cloudMode, refreshTreeEntitlement]);

  useEffect(() => {
    if (!cloudMode || !activeTreeIsListed) return undefined;
    if (skipNextCloudPersistenceEffectRef.current === currentTree.id) {
      skipNextCloudPersistenceEffectRef.current = "";
      return undefined;
    }
    cloudSaveQueueRef.current?.schedule(currentTree);
    return undefined;
  }, [activeTreeIsListed, cloudMode, currentTree]);

  useEffect(() => {
    const persistLatestBeforeLeaving = () => {
      initialOwnershipFlushRef.current?.flush?.();
      if (!activeTreeIsListedRef.current) return;
      const latestTree = normaliseTree(latestTreeRef.current);
      if (cloudMode) {
        const queue = cloudSaveQueueRef.current;
        if (!cloudQueueSnapshotIsSaved(queue, latestTree)) {
          queue?.schedule(latestTree);
          void queue?.flush().catch(() => undefined);
        }
        return;
      }
      if (localRecoveryBlocked) return;
      const latestTrees = upsertWorkspaceTree(latestTreesRef.current, latestTree);
      saveLocalWorkspace(latestTrees, latestTree.id, undefined, latestTrashedTreesRef.current);
    };
    const persistWhenHidden = () => {
      if (document.visibilityState === "hidden") persistLatestBeforeLeaving();
    };
    window.addEventListener("pagehide", persistLatestBeforeLeaving);
    document.addEventListener("visibilitychange", persistWhenHidden);
    return () => {
      window.removeEventListener("pagehide", persistLatestBeforeLeaving);
      document.removeEventListener("visibilitychange", persistWhenHidden);
    };
  }, [cloudMode, localRecoveryBlocked]);

  useEffect(() => {
    if (!cloudMode) return undefined;
    const returnUrl = new URL(window.location.href);
    const checkoutState = returnUrl.searchParams.get("checkout");
    let cancelled = false;
    let retryTimer;

    const clearCheckoutParameters = () => {
      returnUrl.searchParams.delete("checkout");
      returnUrl.searchParams.delete("session_id");
      window.history.replaceState(
        {},
        "",
        `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`,
      );
    };

    if (checkoutState === "success") {
      setBillingMessage("Payment received. Your tree credit is being confirmed.");
      let attempts = 0;
      const pollForCredit = async () => {
        attempts += 1;
        try {
          const nextEntitlement = await refreshTreeEntitlement();
          if (cancelled) return;
          if (nextEntitlement.paidTreeCredits > 0 || nextEntitlement.unlimitedTrees) {
            setBillingMessage("Your account is ready to create a new tree.");
            return;
          }
        } catch {
          // A short retry handles normal webhook and network delays after Stripe redirects back.
        }
        if (!cancelled && attempts < 10) {
          retryTimer = window.setTimeout(pollForCredit, 2000);
        } else if (!cancelled) {
          setBillingMessage(
            "Payment is still being confirmed. Refresh shortly; you will not be charged twice.",
          );
        }
      };
      pollForCredit();
      clearCheckoutParameters();
    } else if (checkoutState === "cancelled") {
      setBillingMessage("Checkout was cancelled. No payment was taken.");
      clearCheckoutParameters();
    }
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [cloudMode, refreshTreeEntitlement]);

  const treeOptions = useMemo(
    () => (activeTreeIsListed ? upsertWorkspaceTree(trees, currentTree) : trees),
    [activeTreeIsListed, currentTree, trees],
  );

  const commitDurableTreeChange = (updater, { flushCloud = false } = {}) => {
    const base = normaliseTree(latestTreeRef.current);
    const proposed = typeof updater === "function" ? updater(base) : updater;
    const nextTree = normaliseTree(proposed);
    if (nextTree.id !== base.id) {
      setStatus("The family update was stopped because it targeted a different record.");
      return null;
    }

    if (cloudMode) {
      try {
        const queue = cloudSaveQueueRef.current;
        if (!queue) throw new Error("The secure save queue is unavailable.");
        journalInitialOwnershipChanges(base, nextTree);
        let treeDraftFallbackError = null;
        try {
          journalTreeDraft(nextTree);
        } catch (error) {
          const cloudFallbackCodes = new Set([
            TREE_DRAFT_ERROR_CODES.TOO_LARGE,
            TREE_DRAFT_ERROR_CODES.STORAGE_UNAVAILABLE,
            TREE_DRAFT_ERROR_CODES.STORAGE_FAILURE,
          ]);
          if (!cloudFallbackCodes.has(error?.code)) throw error;
          treeDraftFallbackError = error;
        }
        queue.schedule(nextTree);
        skipNextCloudPersistenceEffectRef.current = nextTree.id;
        if (flushCloud || treeDraftFallbackError) void queue.flush().catch(() => undefined);
        if (treeDraftFallbackError) {
          setStatus(
            "The change was applied and sent to the cloud immediately because this browser could not keep an additional recovery copy.",
          );
        }
      } catch (error) {
        setStatus(
          `The change was not applied because it could not be secured locally: ${error.message}`,
        );
        setSaveState({ phase: "error", detail: error.message });
        return null;
      }
    } else if (activeTreeIsListedRef.current && !localRecoveryBlocked) {
      const nextTrees = upsertWorkspaceTree(latestTreesRef.current, nextTree);
      const saved = saveLocalWorkspace(
        nextTrees,
        nextTree.id,
        undefined,
        latestTrashedTreesRef.current,
      );
      if (!saved) {
        setStatus("The change was not applied because this browser could not save it safely.");
        setSaveState({
          phase: "error",
          detail: "The latest change could not be saved on this device.",
        });
        return null;
      }
      latestTreesRef.current = nextTrees;
      setTrees(nextTrees);
    }

    latestTreeRef.current = nextTree;
    setTree(nextTree);
    return nextTree;
  };

  const selectPerson = (personId) => {
    setSelectedOutsideOwnerId("");
    const base = normaliseTree(latestTreeRef.current);
    const targetGroup =
      findFamilyGroupsForPerson(base, personId).find((group) => group.id === activeFamilyGroupId) ||
      findFamilyGroupsForPerson(base, personId)[0];
    if (targetGroup && !activePersonIds.has(personId)) {
      const nextTree = { ...base, activeFamilyGroupId: targetGroup.id };
      setActiveFamilyGroupId(targetGroup.id);
      latestTreeRef.current = nextTree;
      setTree(nextTree);
    }
    setSelectedPersonId(personId);
    setDashboardOpen(true);
  };

  const persistTaxReadinessSession = (nextSession) =>
    commitDurableTreeChange(
      (base) => ({
        ...base,
        properties: base.properties.map((property) =>
          property.id === activeProperty.id
            ? { ...property, taxReadinessGuide: nextSession }
            : property,
        ),
      }),
      { flushCloud: true },
    );

  const openTaxReadinessPerson = (personId) => {
    if (!personId) return;
    setWorkspaceView("tree");
    setPropertyWorkspaceSection("ownership");
    selectPerson(personId);
  };

  const startTaxReadinessGuide = () => {
    const now = new Date().toISOString();
    const baseSession = normaliseTaxReadinessSession(
      activeProperty.taxReadinessGuide,
      taxReadinessPlan,
      activeProperty.id,
    );
    const resumableCurrent =
      ["active", "paused"].includes(baseSession.status) &&
      taxReadinessPlan.order.includes(baseSession.currentPersonId)
        ? baseSession.currentPersonId
        : "";
    const unskippedNext = resumableCurrent || nextTaxReadinessPerson(taxReadinessPlan, baseSession);
    const nextPersonId =
      unskippedNext ||
      nextTaxReadinessPerson(taxReadinessPlan, baseSession, { includeSkipped: true });
    if (!nextPersonId) {
      setStatus("No missing person-card information is currently detected for this property.");
      return;
    }
    const nextSession = {
      ...baseSession,
      status: "active",
      currentPersonId: nextPersonId,
      historyPersonIds: resumableCurrent ? baseSession.historyPersonIds : [],
      skippedPersonIds: baseSession.skippedPersonIds.filter(
        (personId) => personId !== nextPersonId,
      ),
      skippedIssueKeys: Object.fromEntries(
        Object.entries(baseSession.skippedIssueKeys || {}).filter(
          ([personId]) => personId !== nextPersonId,
        ),
      ),
      reviewingSkipped: resumableCurrent
        ? baseSession.reviewingSkipped
        : !nextTaxReadinessPerson(taxReadinessPlan, baseSession),
      skippedReviewVisitedPersonIds: resumableCurrent
        ? baseSession.skippedReviewVisitedPersonIds
        : [],
      startedAt: baseSession.startedAt || now,
      updatedAt: now,
    };
    if (!persistTaxReadinessSession(nextSession)) return;
    openTaxReadinessPerson(nextPersonId);
    setStatus("Guided tax setup started. Complete this card or choose Skip for now.");
  };

  const advanceTaxReadinessGuide = ({ skip = false } = {}) => {
    const currentPersonId = taxReadinessSession.currentPersonId;
    if (!currentPersonId) return;
    const historyPersonIds = [
      ...taxReadinessSession.historyPersonIds.filter((personId) => personId !== currentPersonId),
      currentPersonId,
    ];
    const reviewedPersonIds = skip
      ? taxReadinessSession.reviewedPersonIds.filter((personId) => personId !== currentPersonId)
      : [
          ...taxReadinessSession.reviewedPersonIds.filter(
            (personId) => personId !== currentPersonId,
          ),
          currentPersonId,
        ];
    const skippedPersonIds = skip
      ? [
          ...taxReadinessSession.skippedPersonIds.filter(
            (personId) => personId !== currentPersonId,
          ),
          currentPersonId,
        ]
      : taxReadinessSession.skippedPersonIds.filter((personId) => personId !== currentPersonId);
    const skippedIssueKeys = { ...(taxReadinessSession.skippedIssueKeys || {}) };
    if (skip) {
      skippedIssueKeys[currentPersonId] = activeTaxReadinessIssues.map((issue) => issue.key).sort();
    } else {
      delete skippedIssueKeys[currentPersonId];
    }
    const provisional = {
      ...taxReadinessSession,
      historyPersonIds,
      reviewedPersonIds,
      skippedPersonIds,
      skippedIssueKeys,
    };
    const nextUnskippedPersonId = nextTaxReadinessPerson(taxReadinessPlan, provisional);
    const skippedReviewVisitedPersonIds = taxReadinessSession.reviewingSkipped
      ? [
          ...new Set([
            ...(taxReadinessSession.skippedReviewVisitedPersonIds || []),
            currentPersonId,
          ]),
        ]
      : [];
    const nextSkippedPersonId = taxReadinessSession.reviewingSkipped
      ? taxReadinessPlan.pendingPersonIds.find(
          (personId) =>
            personId !== currentPersonId &&
            provisional.skippedPersonIds.includes(personId) &&
            !skippedReviewVisitedPersonIds.includes(personId),
        ) || ""
      : "";
    const nextPersonId = nextUnskippedPersonId || nextSkippedPersonId;
    const now = new Date().toISOString();
    const nextSession = {
      ...provisional,
      status: nextPersonId ? "active" : skippedPersonIds.length ? "paused" : "complete",
      currentPersonId: nextPersonId,
      reviewingSkipped: Boolean(nextPersonId && taxReadinessSession.reviewingSkipped),
      skippedReviewVisitedPersonIds: nextPersonId ? skippedReviewVisitedPersonIds : [],
      updatedAt: now,
    };
    if (!persistTaxReadinessSession(nextSession)) return;
    if (nextPersonId) {
      openTaxReadinessPerson(nextPersonId);
      setStatus(skip ? "Skipped for now. The next card is open." : "The next card is open.");
      return;
    }
    setDashboardOpen(false);
    setSelectedPersonId("");
    setWorkspaceView("property");
    setPropertyWorkspaceSection("ownership");
    setStatus(
      skippedPersonIds.length
        ? "First pass complete. Resume the guide when you are ready to review skipped cards."
        : "Guided tax setup complete for the currently detected person-card requirements.",
    );
  };

  const previousTaxReadinessPerson = () => {
    const history = [...taxReadinessSession.historyPersonIds];
    const previousPersonId = history.pop();
    if (!previousPersonId) return;
    const nextSession = {
      ...taxReadinessSession,
      status: "active",
      currentPersonId: previousPersonId,
      historyPersonIds: history,
      reviewedPersonIds: taxReadinessSession.reviewedPersonIds.filter(
        (personId) => personId !== previousPersonId,
      ),
      updatedAt: new Date().toISOString(),
    };
    if (!persistTaxReadinessSession(nextSession)) return;
    openTaxReadinessPerson(previousPersonId);
  };

  const pauseTaxReadinessGuide = () => {
    const nextSession = {
      ...taxReadinessSession,
      status: "paused",
      updatedAt: new Date().toISOString(),
    };
    if (!persistTaxReadinessSession(nextSession)) return;
    setStatus("Guided tax setup paused. Resume it from Property & initial ownership.");
  };

  const goToTaxReadinessSection = (issueOrSection) => {
    const issue =
      issueOrSection && typeof issueOrSection === "object"
        ? issueOrSection
        : { section: issueOrSection };
    const section = issue.section;
    if (section === "identity") {
      const editButton = document.querySelector(
        '.person-inspector .person-edit-button[aria-pressed="false"]',
      );
      editButton?.click();
    }
    const focusIssueControl = () => {
      const target = document.querySelector(`.person-inspector [data-person-section="${section}"]`);
      const preferredControl =
        taxReadinessIssueControl(target, issue) ||
        (String(issue.code || "").startsWith("causa-mortis-")
          ? target?.querySelector(
              ".causa-mortis-card input:not([disabled]), .causa-mortis-card select:not([disabled]), .causa-mortis-card button:not([disabled])",
            )
          : null);
      const transferEditor =
        section === "donation" && issue.targetId
          ? target?.querySelector(".person-donation-form")
          : null;
      const fallbackTarget = transferEditor || target;
      const control =
        preferredControl ||
        fallbackTarget?.querySelector(
          "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])",
        );
      if (control?.classList?.contains("causa-mortis-summary")) {
        control.click();
        window.requestAnimationFrame(focusIssueControl);
        return;
      }
      (control || fallbackTarget)?.scrollIntoView({ behavior: "auto", block: "center" });
      control?.focus({ preventScroll: true });
    };
    window.requestAnimationFrame(() => {
      if (section === "donation" && issue.targetId) {
        const records = document.querySelectorAll(
          ".person-inspector [data-tax-readiness-transfer-id]",
        );
        const record = [...records].find(
          (candidate) => candidate.dataset.taxReadinessTransferId === issue.targetId,
        );
        const summary = record?.querySelector(".lifetime-transfer-summary");
        if (summary?.getAttribute("aria-expanded") !== "true") {
          summary?.click();
          window.requestAnimationFrame(focusIssueControl);
          return;
        }
      }
      focusIssueControl();
    });
  };

  const selectOutsideOwner = (ownerId) => {
    setSelectedOutsideOwnerId(ownerId);
    if (!ownerId) return;
    setSelectedPersonId("");
    setDashboardOpen(false);
    setPropertyWorkspaceSection("ownership");
    setWorkspaceView("property");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document
          .getElementById("property-workspace-ownership")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  };

  const focusPersonOnTree = (personId) => {
    const base = normaliseTree(latestTreeRef.current);
    const targetGroup =
      findFamilyGroupsForPerson(base, personId).find((group) => group.id === activeFamilyGroupId) ||
      findFamilyGroupsForPerson(base, personId)[0];
    if (targetGroup && !activePersonIds.has(personId)) {
      const nextTree = { ...base, activeFamilyGroupId: targetGroup.id };
      setActiveFamilyGroupId(targetGroup.id);
      latestTreeRef.current = nextTree;
      setTree(nextTree);
    }
    setSelectedPersonId(personId);
    setDashboardOpen(false);
  };

  const closePersonCard = () => {
    setSelectedPersonId("");
    setDashboardOpen(false);
  };

  const updateZoom = (nextZoom) => {
    const boundedZoom = Math.min(200, Math.max(10, Math.round(Number(nextZoom))));
    setZoom(boundedZoom);
    setTree({
      ...currentTree,
      settings: { ...currentTree.settings, treeZoom: boundedZoom },
    });
  };

  const openCreatedTree = (nextTree, options = {}) => {
    setActiveTreeIsListed(true);
    activateCase(nextTree, options);
    setShowLibrary(false);
  };

  const handleCreationError = async (error) => {
    if (isTreePaymentRequiredError(error)) {
      const nextEntitlement = await refreshTreeEntitlement().catch(() => null);
      const freeLimit = nextEntitlement?.freeTreeLimit ?? DEFAULT_FREE_TREE_LIMIT;
      setBillingMessage(
        nextEntitlement?.unlimitedTrees
          ? "Unlimited tree creation is active. Please try creating the tree again."
          : `Your ${freeLimit} free tree${freeLimit === 1 ? " has" : "s have"} been used. Buy one tree credit for €30.`,
      );
      return;
    }
    setStatus(`Could not create family: ${error.message}`);
  };

  const createNewTree = async (seed = {}) => {
    if (
      !cloudMode &&
      localRecoveryBlocked &&
      !window.confirm(
        localRecoveryReplacementPrompt(
          "Create a new workspace",
          Boolean(startupWorkspace.recoveryKey),
        ),
      )
    ) {
      return false;
    }
    let nextTree;
    try {
      nextTree = prepareTreeForPersistence(initialTree(seed));
    } catch (error) {
      setStatus(`Could not create family: ${error.message}`);
      return false;
    }
    if (!cloudMode) {
      if (localRecoveryBlocked) setLocalRecoveryBlocked(false);
      openCreatedTree(nextTree, { openDashboard: true });
      return true;
    }
    setStatus("Creating secure family tree...");
    try {
      const saved = await createFamilyTree(nextTree);
      setTrees((items) => upsertWorkspaceTree(items, saved));
      openCreatedTree(saved, { openDashboard: true, acknowledgeCloudSave: true });
      await refreshTreeEntitlement();
      setStatus("New family created and saved securely.");
      return true;
    } catch (error) {
      await handleCreationError(error);
      return false;
    }
  };

  const importNewTree = async (file) => {
    try {
      if (
        !cloudMode &&
        localRecoveryBlocked &&
        !window.confirm(
          localRecoveryReplacementPrompt(
            "Import into a new workspace",
            Boolean(startupWorkspace.recoveryKey),
          ),
        )
      ) {
        return;
      }
      assertGedcomFileSize(file?.size);
      const result = parseGedcom(await file.text());
      if (!result.people.length) throw new Error("No individual records were found.");

      const baseTree = initialTree();
      const familyGroupId = baseTree.activeFamilyGroupId;
      const importedTitle =
        file.name
          .replace(/\.(ged|gedcom)$/i, "")
          .replace(/[_-]+/g, " ")
          .trim() || "Imported family";
      const importedTree = reconcilePeopleUpdate(baseTree, familyGroupId, result.people, {
        replaceFamilyGroup: true,
      });
      const nextTree = prepareTreeForPersistence({
        ...importedTree,
        title: importedTitle,
        importWarnings: result.structuralWarnings || result.warnings || [],
        legalImportWarnings: result.legalWarnings || [],
        familyGroups: importedTree.familyGroups.map((group) =>
          group.id === familyGroupId ? { ...group, title: importedTitle } : group,
        ),
      });

      if (cloudMode) {
        setStatus("Importing and securing this family tree...");
        const saved = await createFamilyTree(nextTree);
        setTrees((items) => upsertWorkspaceTree(items, saved));
        openCreatedTree(saved, { acknowledgeCloudSave: true });
        await refreshTreeEntitlement();
      } else {
        if (localRecoveryBlocked) setLocalRecoveryBlocked(false);
        openCreatedTree(nextTree);
      }
      const visibleImportWarnings = result.structuralWarnings || result.warnings || [];
      setStatus(
        `Imported ${result.individualCount} people and ${result.familyCount} families.${
          visibleImportWarnings.length
            ? ` ${visibleImportWarnings.length} item${visibleImportWarnings.length === 1 ? "" : "s"} need manual review.`
            : ""
        }`,
      );
    } catch (error) {
      if (isTreePaymentRequiredError(error)) await handleCreationError(error);
      else setStatus(`Could not import GEDCOM: ${error.message}`);
      throw error;
    }
  };

  const buyTreeCredit = async () => {
    if (!cloudMode || billingBusy) return;
    setBillingBusy(true);
    setBillingMessage("Checking the latest account allowance...");
    try {
      const latestEntitlement = await refreshTreeEntitlement();
      if (latestEntitlement.unlimitedTrees) {
        setBillingMessage("Unlimited tree creation is active for this account.");
        setBillingBusy(false);
        return;
      }
      if (latestEntitlement.canCreate) {
        setBillingMessage("Tree creation is available. You can create the new family now.");
        setBillingBusy(false);
        return;
      }
      setBillingMessage("Opening secure Stripe checkout...");
      const checkoutUrl = await startTreeCreditCheckout();
      window.location.assign(checkoutUrl);
    } catch (error) {
      setBillingMessage(`Could not open checkout: ${error.message}`);
      setBillingBusy(false);
    }
  };

  const downloadLocalRecovery = () => {
    const payload = readLocalWorkspaceRecovery(startupWorkspace.recoveryKey);
    if (!payload) {
      setStatus("The local recovery copy could not be read.");
      return;
    }
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "family-tree-workspace-recovery.json";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const downloadCloudPendingRecovery = (recoveryId) => {
    const recovery = cloudPendingRecoveries.find((item) => item.id === recoveryId);
    if (!recovery) return;
    const isTreeKind = recovery.kind === "tree";
    const payload =
      recovery.state === "invalid"
        ? recovery.raw
        : JSON.stringify(
            isTreeKind
              ? {
                  exportedAt: new Date().toISOString(),
                  reason: recovery.state,
                  savedAt: recovery.savedAt,
                  treeId: recovery.treeId,
                  tree: recovery.draft.tree,
                }
              : {
                  exportedAt: new Date().toISOString(),
                  reason: recovery.state,
                  savedAt: recovery.savedAt,
                  treeId: recovery.treeId,
                  propertyId: recovery.propertyId,
                  owners: recovery.draft.owners,
                  outsideParties: recovery.draft.outsideParties,
                },
            null,
            2,
          );
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `pending-${isTreeKind ? "family" : "initial-ownership"}-${recovery.treeId || "unreadable"}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus(
      `Downloaded the selected pending ${isTreeKind ? "family" : "initial-ownership"} record. Keep it secure.`,
    );
  };

  const removeCloudRecoveryItem = (recoveryId) => {
    setCloudPendingRecoveries((items) => {
      const next = reclassifyCloudOwnershipRecoveryChoices(
        items.filter((item) => item.id !== recoveryId),
      );
      if (!next.length) {
        setCloudListState((state) => ({
          complete: !/Saved families|Trash needs attention/i.test(state.warning || ""),
          warning: /Saved families|Trash needs attention/i.test(state.warning || "")
            ? state.warning
            : "",
        }));
      }
      return next;
    });
  };

  const discardCloudPendingRecovery = (recoveryId) => {
    const recovery = cloudPendingRecoveries.find((item) => item.id === recoveryId);
    if (!recovery) return false;
    try {
      if (recovery.state === "invalid") {
        const storage = globalThis.localStorage;
        if (!storage || storage.getItem(recovery.storageKey) !== recovery.raw) return false;
        storage.removeItem(recovery.storageKey);
        if (storage.getItem(recovery.storageKey) !== null) return false;
      } else if (recovery.kind === "tree") {
        const dismissed = dismissTreeDraft(
          authenticatedUserId,
          recovery.treeId,
          recovery.draft.recordFingerprint,
          { writerId: recovery.writerId },
        );
        if (!dismissed) {
          setStatus(
            "That browser copy changed before it could be dismissed. Reload the family library to review the newer version.",
          );
          return false;
        }
      } else {
        const dismissed = dismissInitialOwnershipDraft(
          authenticatedUserId,
          recovery.treeId,
          recovery.propertyId,
          recovery.draft.recordFingerprint,
          { writerId: recovery.writerId },
        );
        if (!dismissed) {
          setStatus(
            "That browser copy changed before it could be dismissed. Reload the family library to review the newer version.",
          );
          return false;
        }
      }
    } catch (error) {
      setStatus(`The browser copy could not be dismissed safely: ${error.message}`);
      return false;
    }
    removeCloudRecoveryItem(recoveryId);
    setStatus(
      `The selected ${recovery.kind === "tree" ? "family" : "initial-ownership"} record was hidden without changing the cloud family. It will reappear if its source records newer changes.`,
    );
    return true;
  };

  const applyCloudPendingRecovery = async (recoveryId) => {
    const recovery = cloudPendingRecoveries.find((item) => item.id === recoveryId);
    if (!recovery?.serverTree || recovery.state !== "safe") return false;
    if (recovery.treeId !== currentTree.id) {
      try {
        await cloudSaveQueueRef.current?.flush();
      } catch (error) {
        setStatus(`Could not switch family before saving: ${error.message}`);
        return false;
      }
    }
    try {
      const isTreeKind = recovery.kind === "tree";
      const recoveredTree = prepareTreeForPersistence(
        normaliseTree(
          isTreeKind
            ? recoverTreeDraftTree(recovery.draft, recovery.serverTree)
            : recoverInitialOwnershipDraftTree(recovery.draft, recovery.serverTree),
        ),
      );
      if (isTreeKind) {
        recoveredTreeDraftsRef.current.set(recovery.treeId, {
          serverTree: recovery.serverTree,
          source: recovery.draft,
        });
      } else {
        recoveredInitialOwnershipDraftsRef.current.set(recovery.treeId, {
          sources: [recovery.draft],
          serverTree: recovery.serverTree,
          tree: recoveredTree,
        });
      }
      setTrees((items) =>
        items.map((item) => (item.id === recovery.treeId ? recoveredTree : item)),
      );
      cloudSaveQueueRef.current?.acknowledge?.(recovery.serverTree);
      activateCase(recoveredTree);
      setActiveTreeIsListed(true);
      setShowLibrary(false);
      removeCloudRecoveryItem(recoveryId);
      setStatus(
        `Opened the recovered ${isTreeKind ? "family" : "initial ownership"}. Its small browser safety record remains intact until the cloud save is acknowledged.`,
      );
      return true;
    } catch (error) {
      setStatus(`The pending change could not be opened safely: ${error.message}`);
      return false;
    }
  };

  const downloadWorkspaceBackup = () => {
    if (cloudMode && !cloudListState.complete) {
      setStatus(
        cloudListState.warning ||
          "The complete cloud family and Trash lists must load before a backup can be created.",
      );
      return;
    }
    try {
      const payload = workspaceBackupJson(treeOptions, undefined, trashedTrees);
      const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = workspaceBackupFilename();
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStatus(
        `Downloaded a workspace backup containing ${treeOptions.length} active and ${trashedTrees.length} trashed famil${
          treeOptions.length + trashedTrees.length === 1 ? "y" : "ies"
        }. Keep it secure because it contains personal and financial information.`,
      );
    } catch (error) {
      setStatus(`The workspace backup could not be downloaded: ${error.message}`);
    }
  };

  const openTree = async (treeId, view = "tree") => {
    const selectedTree = treeOptions.find((item) => item.id === treeId);
    if (!selectedTree) return;
    if (cloudMode && cloudPendingRecoveries.some((item) => item.treeId === treeId)) {
      setShowLibrary(true);
      setStatus(
        "Review the pending initial ownership for this family before opening or changing the cloud copy.",
      );
      return;
    }
    if (cloudMode && treeId !== currentTree.id) {
      try {
        await cloudSaveQueueRef.current?.flush();
      } catch (error) {
        setStatus(`Could not open another family before saving: ${error.message}`);
        return;
      }
    }
    setActiveTreeIsListed(true);
    const recovered = cloudMode ? recoveredInitialOwnershipDraftsRef.current.get(treeId) : null;
    if (recovered) cloudSaveQueueRef.current?.acknowledge?.(recovered.serverTree);
    const activatedTree = activateCase(selectedTree, {
      acknowledgeCloudSave: cloudMode && !recovered,
    });
    const legalViewAvailable = propertyTaxWorkspaceEnabled(activatedTree.settings?.workspaceMode);
    setPropertyWorkspaceSection(
      view === "tax" ? "tax" : view === "ownership" ? "ownership" : "setup",
    );
    setWorkspaceView(view === "tree" || !legalViewAvailable ? "tree" : "property");
    setShowLibrary(false);
  };

  const renameTree = async (treeId, title) => {
    const selectedTree = treeOptions.find((item) => item.id === treeId);
    const nextTitle = String(title || "").trim();
    const retryingFailedSave = failedDirectSaveIdsRef.current.has(treeId);
    if (cloudMode && cloudPendingRecoveries.some((item) => item.treeId === treeId)) {
      setStatus(
        "Review the pending initial ownership for this family before renaming the cloud copy.",
      );
      return false;
    }
    if (
      cloudMode &&
      treeId !== currentTree.id &&
      recoveredInitialOwnershipDraftsRef.current.has(treeId)
    ) {
      setStatus(
        "Open this recovered family before renaming it so its pending ownership is saved first.",
      );
      return false;
    }
    if ([...nextTitle].length > TREE_DATA_LIMITS.maxTitleCharacters) {
      setStatus(`Family names are limited to ${TREE_DATA_LIMITS.maxTitleCharacters} characters.`);
      return false;
    }
    if (!selectedTree || !nextTitle || (nextTitle === selectedTree.title && !retryingFailedSave)) {
      return;
    }

    const selectedActiveGroupId =
      selectedTree.activeFamilyGroupId || selectedTree.familyGroups?.[0]?.id || "";
    const renamed = normaliseTree({
      ...selectedTree,
      title: nextTitle,
      familyGroups: (selectedTree.familyGroups || []).map((group) =>
        group.id === selectedActiveGroupId ? { ...group, title: nextTitle } : group,
      ),
    });
    setTrees((items) => items.map((item) => (item.id === treeId ? renamed : item)));
    if (treeId === currentTree.id) setTree(renamed);
    if (!cloudMode) return;

    const usesActiveSaveQueue = treeId === currentTree.id && cloudSaveQueueRef.current;
    let directSavePromise;
    setStatus("Saving family name...");
    if (!usesActiveSaveQueue) {
      setSaveState({ phase: "saving", detail: "Saving the family name." });
    }
    try {
      let saved;
      if (usesActiveSaveQueue) {
        const normalizedRenamed = normaliseTree(renamed);
        cloudSaveQueueRef.current.schedule(normalizedRenamed);
        skipNextCloudPersistenceEffectRef.current = normalizedRenamed.id;
        saved = await cloudSaveQueueRef.current.flush();
      } else {
        directSavePromise = saveFamilyTree(renamed, authenticatedUserId);
        directSavePromisesRef.current.set(treeId, directSavePromise);
        saved = await directSavePromise;
      }
      if (treeId !== currentTree.id) {
        setTrees((items) => items.map((item) => (item.id === treeId ? saved : item)));
        setSaveState({ phase: "saved", detail: "All changes are saved securely." });
      }
      failedDirectSaveIdsRef.current.delete(treeId);
      setStatus("Saved securely to your workspace.");
    } catch (error) {
      if (!usesActiveSaveQueue) failedDirectSaveIdsRef.current.add(treeId);
      setSaveState({
        phase: isTreeSaveConflictError(error) ? "conflict" : "error",
        detail: error.message,
      });
      setStatus(`Could not rename family: ${error.message}`);
    } finally {
      if (directSavePromise && directSavePromisesRef.current.get(treeId) === directSavePromise) {
        directSavePromisesRef.current.delete(treeId);
      }
    }
  };

  const removeTree = async (treeId) => {
    const selectedTree = treeOptions.find((item) => item.id === treeId);
    if (!selectedTree) return false;
    if (cloudMode && cloudPendingRecoveries.some((item) => item.treeId === treeId)) {
      setStatus(
        "Review or dismiss the pending initial ownership before moving this family to Trash.",
      );
      return false;
    }
    if (
      cloudMode &&
      treeId !== currentTree.id &&
      recoveredInitialOwnershipDraftsRef.current.has(treeId)
    ) {
      setStatus(
        "Open this recovered family first so its initial ownership can be saved before moving it to Trash.",
      );
      return false;
    }

    let treeToTrash = selectedTree;
    if (cloudMode) {
      setStatus("Saving family before moving it to Trash...");
      try {
        if (treeId === currentTree.id) {
          const saved = await cloudSaveQueueRef.current?.flush();
          if (!saved) throw new Error("The secure save queue is unavailable.");
          treeToTrash = rebaseFamilyTreeStorageRevision(selectedTree, saved);
        } else if (directSavePromisesRef.current.has(treeId)) {
          treeToTrash = await directSavePromisesRef.current.get(treeId);
        } else if (failedDirectSaveIdsRef.current.has(treeId)) {
          treeToTrash = await saveFamilyTree(selectedTree, authenticatedUserId);
          failedDirectSaveIdsRef.current.delete(treeId);
        }
      } catch (error) {
        setSaveState({
          phase: isTreeSaveConflictError(error) ? "conflict" : "error",
          detail: error.message,
        });
        setStatus(`Could not move family to Trash before saving: ${error.message}`);
        return false;
      }
    }

    const applyTrashToClient = (trashed) => {
      const removedCurrentTree = treeId === currentTree.id;
      setTrees((items) => items.filter((item) => item.id !== treeId));
      setTrashedTrees((items) => upsertWorkspaceTree(items, trashed));
      if (!removedCurrentTree) return;
      setActiveTreeIsListed(false);
      setPendingTrashActivationId(treeId);
    };

    if (!cloudMode) {
      applyTrashToClient({
        ...treeToTrash,
        deletedAt: new Date().toISOString(),
      });
      setStatus("Family moved to Trash. It can be restored for 30 days.");
      return true;
    }

    setStatus("Moving family to Trash...");
    try {
      const trashed = await trashFamilyTree(treeToTrash);
      applyTrashToClient(trashed);
      setStatus(
        entitlement?.unlimitedTrees
          ? "Family moved to Trash. It can be restored for 30 days."
          : "Family moved to Trash for 30 days. Its generation credit is not restored.",
      );
      return true;
    } catch (error) {
      setStatus(`Could not move family to Trash: ${error.message}`);
      return false;
    }
  };

  const restoreTree = async (treeId) => {
    const selectedTree = trashedTrees.find((item) => item.id === treeId);
    if (!selectedTree) return false;
    if (!cloudMode && isLocalTrashExpired(selectedTree)) {
      setTrashedTrees((items) => items.filter((item) => item.id !== treeId));
      setStatus("This family has been in Trash for 30 days and can no longer be restored.");
      return false;
    }

    setStatus("Restoring family...");
    try {
      const restored = cloudMode ? await restoreFamilyTree(selectedTree) : selectedTree;
      const active = activeTreeSnapshot(restored);
      setTrashedTrees((items) => items.filter((item) => item.id !== treeId));
      setTrees((items) => upsertWorkspaceTree(items, active));
      if (cloudMode) {
        setCloudPendingRecoveries((items) => {
          const reclassified = items.flatMap((item) => {
            if (item.treeId !== treeId || !item.draft) return [item];
            if (item.kind === "tree") {
              try {
                const comparison = compareTreeDraftToServer(item.draft, active);
                if (comparison.state === TREE_DRAFT_RECOVERY_STATES.IDENTICAL) {
                  dismissTreeDraft(authenticatedUserId, item.treeId, item.draft.recordFingerprint, {
                    writerId: item.writerId,
                  });
                  return [];
                }
                return [
                  {
                    ...item,
                    state:
                      comparison.state === TREE_DRAFT_RECOVERY_STATES.SAFE_TO_RESTORE
                        ? "safe"
                        : "conflict",
                    serverTree: active,
                  },
                ];
              } catch (error) {
                return [{ ...item, state: "conflict", serverTree: active, error }];
              }
            }
            try {
              const comparison = compareInitialOwnershipDraftToTree(item.draft, active);
              if (comparison.state === INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES.IDENTICAL) {
                dismissInitialOwnershipDraft(
                  authenticatedUserId,
                  item.treeId,
                  item.propertyId,
                  item.draft.recordFingerprint,
                  { writerId: item.writerId },
                );
                return [];
              }
              return [
                {
                  ...item,
                  state:
                    comparison.state === INITIAL_OWNERSHIP_DRAFT_RECOVERY_STATES.SAFE_TO_REPLAY
                      ? "safe"
                      : "conflict",
                  serverTree: active,
                },
              ];
            } catch (error) {
              return [{ ...item, state: "conflict", serverTree: active, error }];
            }
          });
          const next = reclassifyCloudOwnershipRecoveryChoices(reclassified);
          if (!next.length) {
            setCloudListState((state) => ({
              complete: !/Saved families|Trash needs attention/i.test(state.warning || ""),
              warning: /Saved families|Trash needs attention/i.test(state.warning || "")
                ? state.warning
                : "",
            }));
          }
          return next;
        });
      }
      setStatus(cloudMode ? "Family restored securely." : "Family restored on this device.");
      return true;
    } catch (error) {
      setStatus(`Could not restore family: ${error.message}`);
      return false;
    }
  };

  const permanentlyDeleteTree = async (treeId) => {
    const selectedTree = trashedTrees.find((item) => item.id === treeId);
    if (!selectedTree) return false;

    setStatus("Permanently deleting family...");
    try {
      if (cloudMode) await permanentlyDeleteFamilyTree(selectedTree);
      let browserCleanupError = null;
      if (cloudMode) {
        try {
          markInitialOwnershipTreeDeleted(authenticatedUserId, treeId);
        } catch (error) {
          browserCleanupError = error;
        }
        try {
          markTreeDraftDeleted(authenticatedUserId, treeId);
        } catch (error) {
          browserCleanupError = browserCleanupError || error;
        }
        recoveredInitialOwnershipDraftsRef.current.delete(treeId);
        recoveredTreeDraftsRef.current.delete(treeId);
        for (const cacheKey of initialOwnershipDraftCacheRef.current.keys()) {
          if (cacheKey.startsWith(`${treeId}:`)) {
            initialOwnershipDraftCacheRef.current.delete(cacheKey);
          }
        }
        setCloudPendingRecoveries((items) => {
          const next = browserCleanupError
            ? items.map((item) =>
                item.treeId === treeId ? { ...item, state: "orphan", serverTree: null } : item,
              )
            : items.filter((item) => item.treeId !== treeId);
          if (!next.length) {
            setCloudListState((state) => ({
              complete: !/Saved families|Trash needs attention/i.test(state.warning || ""),
              warning: /Saved families|Trash needs attention/i.test(state.warning || "")
                ? state.warning
                : "",
            }));
          }
          return next;
        });
      }
      setTrashedTrees((items) => items.filter((item) => item.id !== treeId));
      setStatus(
        browserCleanupError
          ? `Family permanently deleted from secure storage, but this browser could not clear its initial-ownership recovery data: ${browserCleanupError.message}`
          : "Family permanently deleted. Its initial-ownership recovery data was removed from this browser.",
      );
      return true;
    } catch (error) {
      setStatus(`Could not permanently delete family: ${error.message}`);
      return false;
    }
  };

  const updatePeople = (people, options) => {
    setTree((current) =>
      reconcilePeopleUpdate(normaliseTree(current), activeFamilyGroupId, people, options),
    );
  };

  const changeDeceasedStatus = ({ checked, personId, people, patch }) => {
    setTree((current) => {
      let next = normaliseTree(current);
      if (checked) {
        next = beginStatusToggleSession(next, { type: "deceased", personId });
        next = reconcilePeopleUpdate(next, activeFamilyGroupId, people);
        return normaliseTree({
          ...next,
          people: next.people.map((person) =>
            person.id === personId ? { ...person, ...patch } : person,
          ),
        });
      }

      next = reconcilePeopleUpdate(next, activeFamilyGroupId, people);
      return normaliseTree(
        endStatusToggleSession(next, {
          type: "deceased",
          personId,
          activeFamilyGroupId,
        }),
      );
    });
    setStatus(
      checked
        ? "Deceased status opened. Uncheck it to restore the earlier record."
        : "Deceased status and its session records were removed.",
    );
  };

  const changeInterVivosStatus = ({ checked, personId, propertyId }) => {
    setTree((current) => {
      const next = normaliseTree(current);
      return normaliseTree(
        checked
          ? beginStatusToggleSession(next, {
              type: "inter-vivos",
              personId,
              propertyId,
            })
          : endStatusToggleSession(next, {
              type: "inter-vivos",
              personId,
              propertyId,
              activeFamilyGroupId,
            }),
      );
    });
    setStatus(
      checked
        ? "Property transfer opened. Uncheck it to restore the earlier ownership position."
        : "Transfer records created under this status were removed.",
    );
  };

  const removePerson = (personId) => {
    const nextTree = removePersonFromFamilyGroup(currentTree, activeFamilyGroupId, personId);
    const nextGroup =
      nextTree.familyGroups.find((group) => group.id === activeFamilyGroupId) ||
      nextTree.familyGroups[0];
    setTree(nextTree);
    setSelectedPersonId(nextGroup?.rootPersonId || nextGroup?.personIds[0] || "");
  };

  const updateTreeTitle = (title) => {
    if ([...String(title || "")].length > TREE_DATA_LIMITS.maxTitleCharacters) {
      setStatus(`Family names are limited to ${TREE_DATA_LIMITS.maxTitleCharacters} characters.`);
      return;
    }
    setTree({
      ...currentTree,
      title,
      familyGroups: currentTree.familyGroups.map((group) =>
        group.id === activeFamilyGroupId ? { ...group, title } : group,
      ),
    });
  };

  const updateWorkspaceMode = (workspaceMode) => {
    const nextMode = normaliseTreeWorkspaceMode(workspaceMode);
    const changed = commitDurableTreeChange((base) => ({
      ...base,
      settings: { ...base.settings, workspaceMode: nextMode },
      properties:
        nextMode === TREE_WORKSPACE_MODES.FAMILY_TREE
          ? base.properties.map((property) =>
              property.taxReadinessGuide?.status === "active"
                ? {
                    ...property,
                    taxReadinessGuide: {
                      ...property.taxReadinessGuide,
                      status: "paused",
                      updatedAt: new Date().toISOString(),
                    },
                  }
                : property,
            )
          : base.properties,
    }));
    if (!changed) return;
    if (nextMode === TREE_WORKSPACE_MODES.FAMILY_TREE) {
      setSelectedOutsideOwnerId("");
      setInitialOwnerPick(null);
      setWorkspaceView("tree");
      setStatus(
        "Family-tree-only mode is on. Legal and tax records are retained but their checks are hidden.",
      );
    } else {
      setStatus("Property, succession and tax tools are now available.");
    }
  };

  // A donation or sale from the person card may create the acquirer and record the transfer
  // at once. Both changes go through one functional update so neither overwrites the other.
  const recordDonation = ({ people, outsideParties, propertyId, transfer }) => {
    setTree((current) => {
      const base = reconcilePeopleUpdate(normaliseTree(current), activeFamilyGroupId, people);
      return {
        ...base,
        outsideParties: outsideParties || base.outsideParties,
        properties: (base.properties || []).map((property) =>
          property.id === propertyId
            ? { ...property, transfers: [...(property.transfers || []), transfer] }
            : property,
        ),
      };
    });
    setStatus(transfer.kind === "donation" ? "Donation recorded." : "Sale recorded.");
  };

  const updateInterVivosTransfer = ({
    people,
    outsideParties,
    propertyId,
    transferId,
    transfer,
  }) => {
    setTree((current) => {
      const base = reconcilePeopleUpdate(normaliseTree(current), activeFamilyGroupId, people);
      return {
        ...base,
        outsideParties: outsideParties || base.outsideParties,
        properties: (base.properties || []).map((property) =>
          property.id === propertyId
            ? {
                ...property,
                transfers: (property.transfers || []).map((candidate) =>
                  candidate.id === transferId ? { ...transfer, id: transferId } : candidate,
                ),
              }
            : property,
        ),
      };
    });
    setStatus(transfer.kind === "donation" ? "Donation updated." : "Sale updated.");
  };

  const deleteInterVivosTransfer = ({ propertyId, transferId }) => {
    setTree((current) => {
      const base = normaliseTree(current);
      return {
        ...base,
        properties: (base.properties || []).map((property) =>
          property.id === propertyId
            ? {
                ...property,
                transfers: (property.transfers || []).filter(
                  (transfer) => transfer.id !== transferId,
                ),
              }
            : property,
        ),
      };
    });
    setStatus("Transfer record deleted.");
  };

  const updatePropertyWorkspace = (patch) => {
    const base = normaliseTree(latestTreeRef.current);
    const nextProperties = patch.properties || base.properties;
    return commitDurableTreeChange({
      ...base,
      properties: nextProperties,
      outsideParties: patch.outsideParties || base.outsideParties,
    });
  };

  const confirmInitialOwnerAcquisition = ({ propertyId, personId, row, acquisitionDate }) => {
    const property = currentTree.properties.find((candidate) => candidate.id === propertyId);
    if (!property) {
      setStatus("The property could not be found.");
      return;
    }
    const result = setLivingInitialOwnerAcquisitionDate(
      property,
      currentTree.people,
      personId,
      acquisitionDate,
      currentTree.outsideParties,
      row?.originalOwnerRecordId || "",
      row?.sourceTransferId || "",
    );
    if (result.error) {
      setStatus(result.error);
      return;
    }
    updatePropertyWorkspace({
      properties: currentTree.properties.map((candidate) =>
        candidate.id === propertyId ? result.property : candidate,
      ),
    });
    setStatus("Original acquisition date saved.");
  };

  const confirmDonationAcquisitionValue = ({
    propertyId,
    personId,
    row,
    acquisitionValue,
    acquisitionValueBasis,
  }) => {
    const property = currentTree.properties.find((candidate) => candidate.id === propertyId);
    if (!property) {
      setStatus("The property could not be found.");
      return;
    }
    const result = setDonationAcquisitionValue(
      property,
      personId,
      row?.sourceTransferId || "",
      acquisitionValue,
      acquisitionValueBasis,
    );
    if (result.error) {
      setStatus(result.error);
      return;
    }
    updatePropertyWorkspace({
      properties: currentTree.properties.map((candidate) =>
        candidate.id === propertyId ? result.property : candidate,
      ),
    });
    setStatus("Donation Value saved.");
  };

  const beginInitialOwnerTreePick = (ownerId) => {
    setInitialOwnerPick({ propertyId: activeProperty.id, ownerId });
    setPropertyWorkspaceSection("setup");
    setSelectedPersonId("");
    setDashboardOpen(false);
    setStatus("Select a person on the family tree to make them an initial owner.");
  };

  const cancelInitialOwnerTreePick = ({ reopenWorkspace = true } = {}) => {
    setInitialOwnerPick(null);
    if (reopenWorkspace) {
      setPropertyWorkspaceSection("setup");
      setWorkspaceView("property");
    }
    setStatus("Initial-owner selection cancelled.");
  };

  const handleTreePersonSelection = (personId) => {
    if (!initialOwnerPick) {
      selectPerson(personId);
      return;
    }

    const targetPerson = currentTree.people.find((person) => person.id === personId);
    const targetProperty = currentTree.properties.find(
      (property) => property.id === initialOwnerPick.propertyId,
    );
    const ownerExists = targetProperty?.owners?.some(
      (owner) => owner.id === initialOwnerPick.ownerId,
    );
    if (!targetPerson || !targetProperty || !ownerExists) {
      cancelInitialOwnerTreePick();
      return;
    }

    const savedTree = commitDurableTreeChange(
      (base) => ({
        ...base,
        properties: base.properties.map((property) =>
          property.id === initialOwnerPick.propertyId
            ? {
                ...property,
                owners: assignInitialOwnerPerson(
                  property.owners || [],
                  initialOwnerPick.ownerId,
                  personId,
                ),
              }
            : property,
        ),
      }),
      { flushCloud: true },
    );
    if (!savedTree) return;
    setInitialOwnerPick(null);
    setSelectedPersonId("");
    setDashboardOpen(false);
    setPropertyWorkspaceSection("setup");
    setWorkspaceView("property");
    setStatus(`${targetPerson.fullName || "Selected person"} assigned as an initial owner.`);
  };

  const updatePrimaryPropertyWorkspace = (patch, propertyId = "") => {
    const base = normaliseTree(latestTreeRef.current);
    const requestedActivePropertyId = propertyId || base.settings.activePropertyId;
    return updatePropertyWorkspace({
      ...patch,
      properties: patch.properties
        ? base.properties.map((property) =>
            property.id === requestedActivePropertyId ? patch.properties[0] || property : property,
          )
        : base.properties,
    });
  };

  const flushPendingInitialOwnership = (
    message = "Finish or correct the pending initial-ownership share before leaving this page.",
  ) => {
    const controller = initialOwnershipFlushRef.current;
    const flushed = controller?.flush?.() !== false;
    if (flushed && !controller?.hasPending?.()) return true;
    setStatus(message);
    return false;
  };

  const returnHome = async () => {
    if (!flushPendingInitialOwnership()) return;
    setInitialOwnerPick(null);
    setSelectedOutsideOwnerId("");
    if (!cloudMode) {
      setDashboardOpen(false);
      setWorkspaceView("tree");
      setShowLibrary(true);
      setStatus("Automatically saved on this device.");
      return;
    }
    setStatus("Saving before returning Home...");
    try {
      cloudSaveQueueRef.current?.schedule(normaliseTree(latestTreeRef.current));
      const saved = await cloudSaveQueueRef.current?.flush();
      if (!saved) throw new Error("The secure save queue is unavailable.");
      // Do not replace the live editor with the response snapshot: the user may
      // have made a newer change while this request was in flight. The queue
      // retains the returned server revision and rebases that newer snapshot.
      setTrees((items) => rebaseFamilyTreeListStorageRevision(items, saved));
      setStatus("Saved securely to your workspace.");
      setDashboardOpen(false);
      setWorkspaceView("tree");
      setShowLibrary(true);
    } catch (error) {
      setStatus(`Could not save: ${error.message}`);
      setDashboardOpen(true);
    }
  };

  const signOutSafely = async () => {
    if (!cloudMode) {
      await onSignOut();
      return;
    }
    setStatus("Saving before signing out...");
    try {
      await cloudSaveQueueRef.current?.flush();
      await onSignOut();
    } catch (error) {
      setStatus(`Could not sign out before saving: ${error.message}`);
    }
  };

  const closeAdminConsole = () => {
    setAdminConsoleOpen(false);
    refreshTreeEntitlement().catch((error) => {
      setBillingMessage(
        `Account allowance could not be refreshed: ${error?.message || "Unknown error"}`,
      );
    });
  };

  if (adminConsoleOpen) {
    return <AdminConsole onClose={closeAdminConsole} />;
  }

  if (showLibrary) {
    return (
      <FamilyLibrary
        trees={treeOptions}
        trashedTrees={trashedTrees}
        activeTreeId={activeTreeIsListed ? currentTree.id : ""}
        session={session}
        commercialMode={cloudMode}
        entitlement={entitlement}
        canCreate={!cloudMode || Boolean(entitlement?.canCreate)}
        billingBusy={billingBusy}
        billingMessage={billingMessage}
        storageStatus={cloudListState.warning || status}
        saveState={saveState}
        backupDisabled={cloudMode && !cloudListState.complete}
        recoveryAvailable={Boolean(startupWorkspace.recoveryKey)}
        pendingCloudRecoveries={cloudPendingRecoveries.map((item) => ({
          id: item.id,
          kind: item.kind,
          treeId: item.treeId,
          title: item.title,
          savedAt: item.savedAt,
          state: item.state,
          propertyLabel: (() => {
            if (!item.propertyId || !item.serverTree?.properties) return "";
            const propertyIndex = item.serverTree.properties.findIndex(
              (property) => property.id === item.propertyId,
            );
            const property = item.serverTree.properties[propertyIndex];
            return property?.address || property?.description || `Property ${propertyIndex + 1}`;
          })(),
        }))}
        isPlatformAdmin={platformAdmin}
        onOpenAdminConsole={() => setAdminConsoleOpen(true)}
        onDownloadRecovery={downloadLocalRecovery}
        onDownloadBackup={downloadWorkspaceBackup}
        onApplyCloudRecovery={applyCloudPendingRecovery}
        onDiscardCloudRecovery={discardCloudPendingRecovery}
        onDownloadCloudRecovery={downloadCloudPendingRecovery}
        onCreate={createNewTree}
        onImport={importNewTree}
        onOpen={openTree}
        onRename={renameTree}
        onRemove={removeTree}
        onRestore={restoreTree}
        onPermanentDelete={permanentlyDeleteTree}
        onBuyTree={buyTreeCredit}
        onChangePassword={onChangePassword}
        onSignOut={signOutSafely}
      />
    );
  }

  if (workspaceView !== "tree" && legalWorkspaceEnabled) {
    const workspaceSectionLinks = [
      { id: "setup", label: "Property & initial ownership", icon: Landmark },
      { id: "ownership", label: "Current ownership & history", icon: GitBranch },
      { id: "tax", label: "Tax Calculation", icon: Calculator },
    ];
    const showPropertySection = (sectionId) => {
      setPropertyWorkspaceSection(sectionId);
      window.requestAnimationFrame(() => {
        document
          .getElementById(`property-workspace-${sectionId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };
    return (
      <main className="property-workspace-page" ref={propertyWorkspaceRef}>
        <AnnouncementBanner localOnlyMode={!cloudMode} />
        <div
          ref={propertyWorkspaceNavRef}
          className={`property-workspace-nav-shell${
            currentTree.properties.length > 1 ? " has-property-selector" : ""
          }`}
        >
          <header className="property-workspace-header">
            <button
              type="button"
              className="property-tree-button property-back-button"
              onClick={() => {
                if (!flushPendingInitialOwnership()) return;
                setSelectedOutsideOwnerId("");
                setInitialOwnerPick(null);
                closePersonCard();
                setWorkspaceView("tree");
              }}
            >
              <ArrowLeft size={16} /> Back to Tree
            </button>
            <div className="property-workspace-title">
              <p className="eyebrow">Property &amp; Tax</p>
              <h1>{currentTree.title}</h1>
              <WorkspaceSaveStatus state={saveState} />
            </div>
            <div className="property-workspace-header-actions">
              <button
                type="button"
                className="property-tree-button property-print-button"
                aria-label="Print current generator screen"
                title="Print the current Property and Tax screen"
                onClick={() => window.print()}
              >
                <Printer size={16} /> Print
              </button>
              <button type="button" className="tree-home-button" onClick={returnHome}>
                <House size={16} /> Home
              </button>
            </div>
          </header>
          <nav className="property-workspace-menu" aria-label="Property and Tax sections">
            {workspaceSectionLinks.map(({ id, label, icon: Icon }) => (
              <button
                type="button"
                className={propertyWorkspaceSection === id ? "active" : ""}
                aria-current={propertyWorkspaceSection === id ? "location" : undefined}
                key={id}
                onClick={() => showPropertySection(id)}
              >
                <Icon size={16} /> {label}
              </button>
            ))}
          </nav>
          {currentTree.properties.length > 1 && (
            <label className="property-workspace-property-selector">
              <span>Property</span>
              <select
                value={activeProperty.id}
                onChange={(event) => {
                  if (
                    !flushPendingInitialOwnership(
                      "Finish or correct the pending initial-ownership share before switching property.",
                    )
                  )
                    return;
                  setSelectedOutsideOwnerId("");
                  commitDurableTreeChange((base) => ({
                    ...base,
                    settings: {
                      ...base.settings,
                      activePropertyId: event.target.value,
                    },
                  }));
                }}
              >
                {currentTree.properties.map((property, index) => (
                  <option value={property.id} key={property.id}>
                    {property.address || `Property ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <section className="property-workspace-content">
          <Properties
            properties={activeProperties}
            people={currentTree.people}
            familyPersonIds={activeFamilyGroup?.personIds || []}
            outsideParties={currentTree.outsideParties}
            singleProperty
            selectedOutsideOwnerId={selectedOutsideOwnerId}
            onSelectOutsideOwner={selectOutsideOwner}
            onSelectPerson={(personId) => {
              if (!flushPendingInitialOwnership()) return;
              setSelectedOutsideOwnerId("");
              setWorkspaceView("tree");
              selectPerson(personId);
            }}
            onPickInitialOwner={(ownerId) => {
              beginInitialOwnerTreePick(ownerId);
              setWorkspaceView("tree");
            }}
            onRegisterInitialOwnershipFlush={registerInitialOwnershipFlush}
            taxReadinessGuideSummary={taxReadinessGuideSummary}
            onStartTaxReadinessGuide={startTaxReadinessGuide}
            onChange={(patch) => updatePrimaryPropertyWorkspace(patch, activeProperty.id)}
          />
        </section>
      </main>
    );
  }

  return (
    <main className="tree-workbench">
      <AnnouncementBanner localOnlyMode={!cloudMode} />
      <div
        className={`workbench-body ${dashboardOpen && selectedPersonId ? "person-card-open" : "person-card-closed"}`}
        style={
          dashboardOpen && selectedPersonId
            ? { "--panel-width": `${dashboardPanelWidth}px` }
            : undefined
        }
      >
        {dashboardOpen && selectedPersonId && (
          <aside className="context-dashboard open">
            <DashboardResizeHandle width={dashboardPanelWidth} onChange={setDashboardPanelWidth} />
            <div className="dashboard-topline">
              <p className="eyebrow">Person Details</p>
              <button type="button" className="dashboard-back-button" onClick={closePersonCard}>
                <ArrowLeft size={16} /> Back to Tree
              </button>
            </div>
            <div className="dashboard-content dashboard-person">
              {activeTaxReadinessPersonId === selectedPersonId && activeTaxReadinessPerson && (
                <TaxReadinessGuideBar
                  personId={activeTaxReadinessPerson.id}
                  personName={
                    activeTaxReadinessPerson.fullName ||
                    [activeTaxReadinessPerson.givenNames, activeTaxReadinessPerson.surname]
                      .filter(Boolean)
                      .join(" ") ||
                    "Unnamed person"
                  }
                  position={taxReadinessGuidePosition}
                  total={Math.max(taxReadinessGuidePosition, taxReadinessGuideTotal)}
                  issues={activeTaxReadinessIssues}
                  canGoBack={taxReadinessSession.historyPersonIds.length > 0}
                  onGoToSection={goToTaxReadinessSection}
                  onBack={previousTaxReadinessPerson}
                  onNext={() => advanceTaxReadinessGuide()}
                  onSkip={() => advanceTaxReadinessGuide({ skip: true })}
                  onPause={pauseTaxReadinessGuide}
                />
              )}
              <PersonInspector
                people={currentTree.people}
                legalWorkspaceEnabled={legalWorkspaceEnabled}
                outsideParties={currentTree.outsideParties}
                familyPersonIds={activeFamilyGroup?.personIds || []}
                properties={activeProperties}
                vendorReport={propertyReport}
                taxCalculationReport={taxCalculationReport}
                ownershipByPerson={ownershipByPerson}
                ownershipFractionsByPerson={ownershipFractionsByPerson}
                currentOwnerPresentationsByPerson={currentOwnerPresentationsByPerson}
                causaMortisCoverage={causaMortisCoverage.byPerson[selectedPersonId] || []}
                selectedPersonId={selectedPersonId}
                shareDisplay={currentTree.settings.shareDisplay}
                onShareDisplayChange={(shareDisplay) =>
                  setTree({
                    ...currentTree,
                    settings: { ...currentTree.settings, shareDisplay },
                  })
                }
                retainedIdentityLabels={selectedRetainedIdentityLabels}
                personFamilyGroupCount={
                  findFamilyGroupsForPerson(currentTree, selectedPersonId).length
                }
                onSelectPerson={selectPerson}
                onSelectOutsideOwner={selectOutsideOwner}
                onDeletePerson={removePerson}
                onChange={updatePeople}
                onRecordDonation={recordDonation}
                onUpdateInterVivosTransfer={updateInterVivosTransfer}
                onDeleteInterVivosTransfer={deleteInterVivosTransfer}
                deceasedStatusSession={deceasedStatusSession}
                interVivosStatusSession={interVivosStatusSession}
                onDeceasedStatusChange={legalWorkspaceEnabled ? changeDeceasedStatus : undefined}
                onInterVivosStatusChange={
                  legalWorkspaceEnabled ? changeInterVivosStatus : undefined
                }
                onConfirmInitialAcquisition={confirmInitialOwnerAcquisition}
                onConfirmDonationAcquisitionValue={confirmDonationAcquisitionValue}
                onOutsidePartiesChange={(outsideParties) =>
                  setTree((current) => ({ ...normaliseTree(current), outsideParties }))
                }
              />
            </div>
            <p className="dashboard-status" aria-live="polite">
              {status}
            </p>
          </aside>
        )}

        <section
          className={`tree-stage ${initialOwnerPick ? "initial-owner-pick-active" : ""}`}
          style={{ "--tree-zoom": zoom / 100 }}
        >
          {activeFamilyGroup && (
            <div className="tree-stage-main">
              {initialOwnerPick && (
                <div className="initial-owner-tree-picker" role="status">
                  <MousePointerClick size={18} />
                  <span>
                    <strong>Select an initial owner</strong>
                    <small>Tap the person on the family tree.</small>
                  </span>
                  <button
                    type="button"
                    aria-label="Cancel selecting an initial owner"
                    onClick={() => cancelInitialOwnerTreePick()}
                  >
                    <X size={15} /> Cancel
                  </button>
                </div>
              )}
              <FamilyTreeCanvas
                treeTitle={currentTree.title}
                people={visiblePeople}
                legalWorkspaceEnabled={legalWorkspaceEnabled}
                ownershipByPerson={ownershipByPerson}
                ownershipFractionsByPerson={ownershipFractionsByPerson}
                currentOwnerPresentationsByPerson={currentOwnerPresentationsByPerson}
                historicalLawWarningsByPerson={historicalLawWarningsByPerson}
                causaMortisCoverageByPerson={causaMortisCoverage.byPerson}
                selectedPersonId={selectedPersonId}
                onSelectPerson={handleTreePersonSelection}
                onFocusPerson={focusPersonOnTree}
                zoom={zoom}
                onZoomChange={updateZoom}
                personCardFields={currentTree.settings.personCardFields}
                onPersonCardFieldsChange={(personCardFields) =>
                  setTree({
                    ...currentTree,
                    settings: { ...currentTree.settings, personCardFields },
                  })
                }
                propertyId={activeProperty.id}
                toolbar={
                  <>
                    <button
                      type="button"
                      className="tree-home-button"
                      aria-label="Back to Home"
                      title="Back to Home"
                      onClick={returnHome}
                    >
                      <House size={16} />
                      <span className="tree-home-label-full">Back to Home</span>
                      <span className="tree-home-label-short">Home</span>
                    </button>
                    <TreeWorkspaceModeControl
                      mode={currentTree.settings.workspaceMode}
                      onChange={updateWorkspaceMode}
                    />
                    {legalWorkspaceEnabled && (
                      <button
                        type="button"
                        className="ownership-tax-button"
                        aria-label="Property & Tax"
                        title="Open Property and Tax workspace"
                        onClick={() => {
                          setPropertyWorkspaceSection("setup");
                          setSelectedOutsideOwnerId("");
                          setInitialOwnerPick(null);
                          closePersonCard();
                          setWorkspaceView("property");
                        }}
                      >
                        <Landmark size={16} />
                        <span>Property &amp; Tax</span>
                      </button>
                    )}
                    <EditableTreeTitle
                      value={currentTree.title}
                      onChange={updateTreeTitle}
                      trailing={<WorkspaceSaveStatus state={saveState} />}
                    />
                    <PersonFinder people={visiblePeople} onSelectPerson={focusPersonOnTree} />
                    <label className="tree-zoom-slider">
                      <span>Zoom</span>
                      <input
                        aria-label="Tree zoom"
                        type="range"
                        min="10"
                        max="200"
                        step="1"
                        value={zoom}
                        onChange={(event) => updateZoom(event.target.value)}
                      />
                      <output>{zoom}%</output>
                    </label>
                  </>
                }
              />
            </div>
          )}
        </section>
      </div>
      {legalWorkspaceEnabled && <FractionCalculator />}
    </main>
  );
}
