import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Calculator,
  GitBranch,
  House,
  Landmark,
  MousePointerClick,
  X,
} from "lucide-react";
import { AdminConsole } from "./components/AdminConsole.jsx";
import { FamilyLibrary } from "./components/FamilyLibrary.jsx";
import { FamilyTreeCanvas } from "./components/FamilyTreeCanvas.jsx";
import { FractionCalculator } from "./components/FractionCalculator.jsx";
import { EditableTreeTitle } from "./components/EditableTreeTitle.jsx";
import { PersonInspector } from "./components/PersonInspector.jsx";
import { PersonFinder } from "./components/PersonFinder.jsx";
import { Properties } from "./components/Properties.jsx";
import { observeStickyNavOffset } from "./components/stickyNavOffset.js";
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
  propertyStartingOwnershipStatus,
  setDonationAcquisitionValue,
  setLivingInitialOwnerAcquisitionDate,
} from "./domain/propertyVendorTax.js";
import {
  beginStatusToggleSession,
  endStatusToggleSession,
  statusToggleSession,
} from "./domain/statusToggleSessions.js";
import { TREE_DATA_LIMITS, prepareTreeForPersistence } from "./domain/treeData.js";
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
  };
  const properties = migratedProperties(caseData);
  const requestedActivePropertyId = caseData.settings?.activePropertyId;
  const activePropertyId = properties.some((property) => property.id === requestedActivePropertyId)
    ? requestedActivePropertyId
    : properties[0]?.id || "";
  const settings = { ...defaultSettings, ...(caseData.settings || {}), activePropertyId };
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
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const [selectedOutsideOwnerId, setSelectedOutsideOwnerId] = useState("");
  const [initialOwnerPick, setInitialOwnerPick] = useState(null);
  const [zoom, setZoom] = useState(() => Number(tree.settings?.treeZoom) || 100);
  const cloudSaveQueueRef = useRef(null);
  const failedDirectSaveIdsRef = useRef(new Set());
  const directSavePromisesRef = useRef(new Map());
  const propertyWorkspaceRef = useRef(null);
  const propertyWorkspaceNavRef = useRef(null);
  const [activeFamilyGroupId, setActiveFamilyGroupId] = useState(
    () => normaliseTree(tree).activeFamilyGroupId,
  );
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
        onSaveSuccess: (savedTree) => {
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
      if (cloudSaveQueueRef.current === queue) cloudSaveQueueRef.current = null;
      queue.dispose();
    };
  }, [authenticatedUserId, cloudMode]);

  useEffect(() => {
    if (!cloudMode) return undefined;
    const warnAboutUnsavedCloudChanges = (event) => {
      if (!cloudSaveQueueRef.current?.hasUnsavedChanges()) return;
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
      buildPropertyVendorTaxReport(activeProperty, currentTree.people, currentTree.outsideParties),
    [activeProperty, currentTree.outsideParties, currentTree.people],
  );
  const taxCalculationReport = useMemo(
    () =>
      buildTaxCalculationReport(
        activeProperty,
        currentTree.people,
        currentTree.outsideParties,
        propertyReport,
      ),
    [activeProperty, currentTree.outsideParties, currentTree.people, propertyReport],
  );
  const ownershipByPerson = useMemo(() => {
    return buildTreeCardOwnershipByPerson(
      propertyReport.ledger.owners,
      propertyReport.ownership.transmissions,
    );
  }, [propertyReport.ledger.owners, propertyReport.ownership.transmissions]);
  const ownershipFractionsByPerson = useMemo(() => {
    return buildTreeCardOwnershipFractionsByPerson(
      propertyReport.ledger.owners,
      propertyReport.ownership.transmissions,
    );
  }, [propertyReport.ledger.owners, propertyReport.ownership.transmissions]);
  const historicalLawWarningsByPerson = useMemo(
    () => buildTreeCardHistoricalWarningsByPerson(propertyReport.ownership.transmissions),
    [propertyReport.ownership.transmissions],
  );
  const currentOwnerPresentationsByPerson = useMemo(() => {
    const presentations = buildCurrentOwnerPresentations(
      propertyReport.ledger.owners,
      activeProperty.saleValue,
      taxCalculationReport,
    ).filter((owner) => owner.personId);
    return ownerPresentationsById(presentations.map((owner) => ({ ...owner, id: owner.personId })));
  }, [activeProperty.saleValue, propertyReport.ledger.owners, taxCalculationReport]);
  const completeProperties = useMemo(
    () =>
      currentTree.properties.filter(
        (property) => propertyStartingOwnershipStatus(property).isComplete,
      ),
    [currentTree.properties],
  );
  // Ownership blocks person deletion per-property (not just the primary property) so a
  // second property's recorded owners can't be silently orphaned by deleting a person.
  const anyPropertyOwnershipPersonIds = useMemo(() => {
    const ids = new Set();
    completeProperties.forEach((property) => {
      const report = buildPropertyVendorTaxReport(
        property,
        currentTree.people,
        currentTree.outsideParties,
      );
      report.ledger.owners.forEach((owner) => {
        if (owner.personId && Number(owner.share) > 0) ids.add(owner.personId);
      });
    });
    return ids;
  }, [completeProperties, currentTree.outsideParties, currentTree.people]);
  const causaMortisCoverage = useMemo(
    () =>
      buildCausaMortisShareCoverage(
        currentTree.people,
        propertyReport.startingOwnership.isComplete ? activeProperties : [],
        currentTree.outsideParties,
      ),
    [
      activeProperties,
      currentTree.outsideParties,
      currentTree.people,
      propertyReport.startingOwnership.isComplete,
    ],
  );
  const selectedCaseDependencies = useMemo(() => {
    const relationshipLabels = new Set([
      "a child relationship",
      "a partner relationship",
      "a sibling relationship",
    ]);
    const legalLabels = casePersonDependencyLabels(currentTree, selectedPersonId).filter(
      (label) => !relationshipLabels.has(label),
    );
    const retainedIdentityLabels = legalLabels.filter(
      (label) => label === "a causa mortis declarant record",
    );
    return {
      blockingLabels: legalLabels.filter((label) => label !== "a causa mortis declarant record"),
      retainedIdentityLabels,
    };
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
    const nextTree = remainingTrees[0];
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
        activateCase(activationTree, { acknowledgeCloudSave });
      } else {
        setActiveTreeIsListed(false);
        activateCase(initialTree(), { acknowledgeCloudSave: cloudMode });
      }
    };
    void finishActivation();
    return () => {
      cancelled = true;
    };
  }, [activateCase, cloudMode, pendingTrashActivationId, trees]);

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
        setTrees(activeResult.items);
        setTrashedTrees(trashResult.items);
        if (activeResult.items[0]) {
          setActiveTreeIsListed(true);
          activateCase(activeResult.items[0], { acknowledgeCloudSave: true });
        } else {
          setActiveTreeIsListed(false);
        }
        const collectionWarnings = [
          activeResult.error ? `Saved families need attention: ${activeResult.error.message}` : "",
          trashResult.error ? `Trash needs attention: ${trashResult.error.message}` : "",
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
    cloudSaveQueueRef.current?.schedule(currentTree);
    return undefined;
  }, [activeTreeIsListed, cloudMode, currentTree]);

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

  const selectPerson = (personId) => {
    setSelectedOutsideOwnerId("");
    const targetGroup =
      findFamilyGroupsForPerson(currentTree, personId).find(
        (group) => group.id === activeFamilyGroupId,
      ) || findFamilyGroupsForPerson(currentTree, personId)[0];
    if (targetGroup && !activePersonIds.has(personId)) {
      setActiveFamilyGroupId(targetGroup.id);
      setTree({ ...currentTree, activeFamilyGroupId: targetGroup.id });
    }
    setSelectedPersonId(personId);
    setDashboardOpen(true);
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
    const targetGroup =
      findFamilyGroupsForPerson(currentTree, personId).find(
        (group) => group.id === activeFamilyGroupId,
      ) || findFamilyGroupsForPerson(currentTree, personId)[0];
    if (targetGroup && !activePersonIds.has(personId)) {
      setActiveFamilyGroupId(targetGroup.id);
      setTree({ ...currentTree, activeFamilyGroupId: targetGroup.id });
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
        importWarnings: result.warnings || [],
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
      setStatus(
        `Imported ${result.individualCount} people and ${result.familyCount} families.${
          result.warnings?.length
            ? ` ${result.warnings.length} item${result.warnings.length === 1 ? "" : "s"} need manual review.`
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
    if (entitlement?.unlimitedTrees) {
      setBillingMessage("This account already has unlimited tree creation.");
      return;
    }
    setBillingBusy(true);
    setBillingMessage("Opening secure Stripe checkout...");
    try {
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
    if (cloudMode && treeId !== currentTree.id) {
      try {
        await cloudSaveQueueRef.current?.flush();
      } catch (error) {
        setStatus(`Could not open another family before saving: ${error.message}`);
        return;
      }
    }
    setActiveTreeIsListed(true);
    activateCase(selectedTree, { acknowledgeCloudSave: cloudMode });
    setPropertyWorkspaceSection(
      view === "tax" ? "tax" : view === "ownership" ? "ownership" : "setup",
    );
    setWorkspaceView(view === "tree" ? "tree" : "property");
    setShowLibrary(false);
  };

  const renameTree = async (treeId, title) => {
    const selectedTree = treeOptions.find((item) => item.id === treeId);
    const nextTitle = String(title || "").trim();
    const retryingFailedSave = failedDirectSaveIdsRef.current.has(treeId);
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
        cloudSaveQueueRef.current.schedule(normaliseTree(renamed));
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
      setTrashedTrees((items) => items.filter((item) => item.id !== treeId));
      setStatus("Family permanently deleted.");
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
    setTree({
      ...currentTree,
      properties: patch.properties || currentTree.properties,
      outsideParties: patch.outsideParties || currentTree.outsideParties,
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

    setTree({
      ...currentTree,
      properties: currentTree.properties.map((property) =>
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
    });
    setInitialOwnerPick(null);
    setSelectedPersonId("");
    setDashboardOpen(false);
    setPropertyWorkspaceSection("setup");
    setWorkspaceView("property");
    setStatus(`${targetPerson.fullName || "Selected person"} assigned as an initial owner.`);
  };

  const updatePrimaryPropertyWorkspace = (patch) =>
    updatePropertyWorkspace({
      ...patch,
      properties: patch.properties
        ? currentTree.properties.map((property) =>
            property.id === activeProperty.id ? patch.properties[0] || property : property,
          )
        : currentTree.properties,
    });

  const returnHome = async () => {
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
      cloudSaveQueueRef.current?.schedule(normaliseTree(currentTree));
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

  if (adminConsoleOpen) {
    return <AdminConsole onClose={() => setAdminConsoleOpen(false)} />;
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
        isPlatformAdmin={platformAdmin}
        onOpenAdminConsole={() => setAdminConsoleOpen(true)}
        onDownloadRecovery={downloadLocalRecovery}
        onDownloadBackup={downloadWorkspaceBackup}
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

  if (workspaceView !== "tree") {
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
            <button type="button" className="tree-home-button" onClick={returnHome}>
              <House size={16} /> Home
            </button>
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
                  setSelectedOutsideOwnerId("");
                  setTree({
                    ...currentTree,
                    settings: {
                      ...currentTree.settings,
                      activePropertyId: event.target.value,
                    },
                  });
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
            outsideParties={currentTree.outsideParties}
            singleProperty
            selectedOutsideOwnerId={selectedOutsideOwnerId}
            onSelectOutsideOwner={selectOutsideOwner}
            onSelectPerson={(personId) => {
              setSelectedOutsideOwnerId("");
              setWorkspaceView("tree");
              selectPerson(personId);
            }}
            onPickInitialOwner={(ownerId) => {
              beginInitialOwnerTreePick(ownerId);
              setWorkspaceView("tree");
            }}
            onChange={updatePrimaryPropertyWorkspace}
          />
        </section>
      </main>
    );
  }

  return (
    <main className="tree-workbench">
      <div
        className={`workbench-body ${dashboardOpen && selectedPersonId ? "person-card-open" : "person-card-closed"}`}
      >
        {dashboardOpen && selectedPersonId && (
          <aside className="context-dashboard open">
            <div className="dashboard-topline">
              <p className="eyebrow">Person Details</p>
              <button type="button" className="dashboard-back-button" onClick={closePersonCard}>
                <ArrowLeft size={16} /> Back to Tree
              </button>
            </div>
            <div className="dashboard-content dashboard-person">
              <PersonInspector
                people={currentTree.people}
                outsideParties={currentTree.outsideParties}
                familyPersonIds={activeFamilyGroup?.personIds || []}
                properties={activeProperties}
                vendorReport={propertyReport}
                taxCalculationReport={taxCalculationReport}
                ownershipByPerson={ownershipByPerson}
                ownershipFractionsByPerson={ownershipFractionsByPerson}
                currentOwnerPresentationsByPerson={currentOwnerPresentationsByPerson}
                hasAnyPropertyOwnership={anyPropertyOwnershipPersonIds.has(selectedPersonId)}
                causaMortisCoverage={causaMortisCoverage.byPerson[selectedPersonId] || []}
                selectedPersonId={selectedPersonId}
                shareDisplay={currentTree.settings.shareDisplay}
                onShareDisplayChange={(shareDisplay) =>
                  setTree({
                    ...currentTree,
                    settings: { ...currentTree.settings, shareDisplay },
                  })
                }
                caseDependencyLabels={selectedCaseDependencies.blockingLabels}
                retainedIdentityLabels={selectedCaseDependencies.retainedIdentityLabels}
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
                onDeceasedStatusChange={changeDeceasedStatus}
                onInterVivosStatusChange={changeInterVivosStatus}
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
                    <button type="button" className="tree-home-button" onClick={returnHome}>
                      <House size={16} />
                      <span className="tree-home-label-full">Back to Home</span>
                      <span className="tree-home-label-short">Home</span>
                    </button>
                    <button
                      type="button"
                      className="ownership-tax-button"
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
                    <EditableTreeTitle
                      value={currentTree.title}
                      onChange={updateTreeTitle}
                      trailing={<WorkspaceSaveStatus state={saveState} />}
                    />
                    <PersonFinder people={currentTree.people} onSelectPerson={focusPersonOnTree} />
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
      <FractionCalculator />
    </main>
  );
}
