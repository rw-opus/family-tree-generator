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
import { familyViewKey } from "./components/CaseViewTabs.jsx";
import { FamilyLibrary } from "./components/FamilyLibrary.jsx";
import { FamilyTreeCanvas } from "./components/FamilyTreeCanvas.jsx";
import { FractionCalculator } from "./components/FractionCalculator.jsx";
import { EditableTreeTitle } from "./components/EditableTreeTitle.jsx";
import { PersonInspector } from "./components/PersonInspector.jsx";
import { PersonFinder } from "./components/PersonFinder.jsx";
import { Properties } from "./components/Properties.jsx";
import { TreePropertyPanel } from "./components/TreePropertyPanel.jsx";
import { buildCausaMortisShareCoverage } from "./domain/causaMortisCoverage.js";
import {
  casePersonDependencyLabels,
  createFamilyGroup,
  findFamilyGroupsForPerson,
  normaliseCase,
  reconcilePeopleUpdate,
  removePersonFromFamilyGroup,
} from "./domain/caseModel.js";
import { parseGedcom } from "./domain/gedcom.js";
import { createPerson } from "./domain/people.js";
import {
  buildTreeCardHistoricalWarningsByPerson,
  buildTreeCardOwnershipByPerson,
  buildTreeCardOwnershipFractionsByPerson,
  normalisePersonCardFields,
} from "./domain/personCardDisplay.js";
import {
  assignInitialOwnerPerson,
  buildPropertyVendorTaxReport,
  buildTaxCalculationReport,
  propertyStartingOwnershipStatus,
} from "./domain/propertyVendorTax.js";
import {
  beginStatusToggleSession,
  endStatusToggleSession,
  statusToggleSession,
} from "./domain/statusToggleSessions.js";
import { workspaceBackupFilename, workspaceBackupJson } from "./domain/workspaceBackup.js";
import {
  createFamilyTree,
  listFamilyTrees,
  removeFamilyTree,
  saveFamilyTree,
} from "./services/familyTrees.js";
import { createCloudSaveQueue } from "./services/cloudSaveQueue.js";
import {
  loadLocalWorkspace,
  readLocalWorkspaceRecovery,
  saveLocalWorkspace,
  upsertWorkspaceTree,
} from "./services/localWorkspace.js";
import {
  defaultTreeEntitlement,
  isTreePaymentRequiredError,
  loadTreeEntitlement,
  startTreeCreditCheckout,
} from "./services/treeBilling.js";

const makePrimaryProperty = (id = crypto.randomUUID()) => ({
  id,
  address: "",
  saleValue: "",
  owners: [],
  declarations: [],
  transfers: [],
  saleLots: [],
});

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
    cloudMode ? { trees: [], activeTreeId: "" } : loadLocalWorkspace(),
  );
  const [tree, setTree] = useState(() => {
    const restoredTree =
      startupWorkspace.trees.find((item) => item.id === startupWorkspace.activeTreeId) ||
      startupWorkspace.trees[0];
    return restoredTree ? normaliseTree(restoredTree) : initialTree();
  });
  const [trees, setTrees] = useState(startupWorkspace.trees);
  const [status, setStatus] = useState(
    startupWorkspace.loadError
      ? startupWorkspace.loadError
      : startupWorkspace.trees.length
        ? "Recovered automatically from this device."
        : cloudMode
          ? "Connecting to secure storage..."
          : "Automatically saved on this device.",
  );
  const [localRecoveryBlocked, setLocalRecoveryBlocked] = useState(() =>
    Boolean(startupWorkspace.loadError),
  );
  const [entitlement, setEntitlement] = useState(localOnlyMode ? defaultTreeEntitlement : null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingMessage, setBillingMessage] = useState("");
  const [showLibrary, setShowLibrary] = useState(true);
  const [workspaceView, setWorkspaceView] = useState("tree");
  const [activeTreeIsListed, setActiveTreeIsListed] = useState(
    () => startupWorkspace.trees.length > 0,
  );
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const [traceOwnershipSnapshot, setTraceOwnershipSnapshot] = useState(null);
  const [traceOwnershipFractionSnapshot, setTraceOwnershipFractionSnapshot] = useState(null);
  const [propertyPanelExpanded, setPropertyPanelExpanded] = useState(false);
  const [initialOwnerPick, setInitialOwnerPick] = useState(null);
  const [zoom, setZoom] = useState(() => Number(tree.settings?.treeZoom) || 100);
  const cloudSaveQueueRef = useRef(null);
  const [activeFamilyGroupId, setActiveFamilyGroupId] = useState(
    () => normaliseTree(tree).activeFamilyGroupId,
  );
  const activateCase = useCallback((value, options = {}) => {
    const activation = caseActivationState(value);
    setTree(activation.caseData);
    setZoom(activation.zoom);
    setActiveFamilyGroupId(activation.activeFamilyGroupId);
    setSelectedPersonId(activation.selectedPersonId);
    setTraceOwnershipSnapshot(null);
    setTraceOwnershipFractionSnapshot(null);
    setPropertyPanelExpanded(false);
    setInitialOwnerPick(null);
    if (options.openDashboard) setDashboardOpen(true);
    return activation.caseData;
  }, []);

  useEffect(() => {
    if (!cloudMode) return undefined;
    const queue = createCloudSaveQueue(
      (snapshot) => saveFamilyTree(snapshot, authenticatedUserId),
      {
        onSaveStart: () => setStatus("Saving securely..."),
        onSaveSuccess: () => setStatus("Saved securely to your workspace."),
        onSaveError: (error) =>
          setStatus(`Cloud save needs attention: ${error?.message || "Unknown error"}`),
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
  const currentOwnershipByPerson = useMemo(
    () =>
      Object.fromEntries(
        (propertyReport.ledger.owners || [])
          .filter((owner) => owner.personId && Number(owner.share) > 0)
          .map((owner) => [owner.personId, owner.share]),
      ),
    [propertyReport.ledger.owners],
  );
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
    if (cloudMode) return;
    if (localRecoveryBlocked) {
      setStatus(startupWorkspace.loadError || "Local recovery is required before saving.");
      return;
    }
    const saved = saveLocalWorkspace(trees, activeTreeIsListed ? tree.id : "");
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
  ]);

  useEffect(() => {
    if (!cloudMode) return;
    Promise.all([listFamilyTrees(authenticatedUserId), refreshTreeEntitlement()])
      .then(([items]) => {
        setTrees(items);
        if (items[0]) {
          setActiveTreeIsListed(true);
          activateCase(items[0]);
        } else {
          setActiveTreeIsListed(false);
        }
        setStatus("Saved securely to your workspace.");
      })
      .catch((error) => setStatus(`Cloud storage needs attention: ${error.message}`));
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
    // Entering edit mode always returns the cards to the current legal position.
    // Otherwise a previously selected history step can mask the user's edits.
    setTraceOwnershipSnapshot(null);
    setTraceOwnershipFractionSnapshot(null);
    setPropertyPanelExpanded(false);
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

  const showTraceEventOnTree = (event) => {
    setTraceOwnershipSnapshot(event?.ownershipSnapshot || null);
    setTraceOwnershipFractionSnapshot(event?.ownershipFractionSnapshot || null);
    if (event?.personId) {
      focusPersonOnTree(event.personId);
      return;
    }
    closePersonCard();
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
      setBillingMessage(
        nextEntitlement?.unlimitedTrees
          ? "Unlimited tree creation is active. Please try creating the tree again."
          : "Your five free trees have been used. Buy one tree credit for €30.",
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
        "The previous local workspace is unreadable. A recovery copy has been kept. Create a new workspace and replace the active saved data?",
      )
    ) {
      return false;
    }
    if (!cloudMode && localRecoveryBlocked) setLocalRecoveryBlocked(false);
    const nextTree = initialTree(seed);
    if (!cloudMode) {
      openCreatedTree(nextTree, { openDashboard: true });
      return true;
    }
    setStatus("Creating secure family tree...");
    try {
      const saved = await createFamilyTree(nextTree);
      setTrees((items) => upsertWorkspaceTree(items, saved));
      openCreatedTree(saved, { openDashboard: true });
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
          "The previous local workspace is unreadable. A recovery copy has been kept. Import into a new workspace and replace the active saved data?",
        )
      ) {
        return;
      }
      if (!cloudMode && localRecoveryBlocked) setLocalRecoveryBlocked(false);
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
      const nextTree = {
        ...importedTree,
        title: importedTitle,
        importWarnings: result.warnings || [],
        familyGroups: importedTree.familyGroups.map((group) =>
          group.id === familyGroupId ? { ...group, title: importedTitle } : group,
        ),
      };

      if (cloudMode) {
        setStatus("Importing and securing this family tree...");
        const saved = await createFamilyTree(nextTree);
        setTrees((items) => upsertWorkspaceTree(items, saved));
        openCreatedTree(saved);
        await refreshTreeEntitlement();
      } else {
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
    try {
      const payload = workspaceBackupJson(treeOptions);
      const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = workspaceBackupFilename();
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStatus(
        `Downloaded a workspace backup containing ${treeOptions.length} famil${
          treeOptions.length === 1 ? "y" : "ies"
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
    activateCase(selectedTree);
    setWorkspaceView(view);
    setShowLibrary(false);
  };

  const renameTree = async (treeId, title) => {
    const selectedTree = treeOptions.find((item) => item.id === treeId);
    const nextTitle = String(title || "").trim();
    if (!selectedTree || !nextTitle || nextTitle === selectedTree.title) return;

    const selectedActiveGroupId =
      selectedTree.activeFamilyGroupId || selectedTree.familyGroups?.[0]?.id || "";
    const renamed = {
      ...selectedTree,
      title: nextTitle,
      familyGroups: (selectedTree.familyGroups || []).map((group) =>
        group.id === selectedActiveGroupId ? { ...group, title: nextTitle } : group,
      ),
    };
    setTrees((items) => items.map((item) => (item.id === treeId ? renamed : item)));
    if (treeId === currentTree.id) setTree(renamed);
    if (!cloudMode) return;

    setStatus("Saving family name...");
    try {
      let saved;
      if (treeId === currentTree.id && cloudSaveQueueRef.current) {
        cloudSaveQueueRef.current.schedule(normaliseTree(renamed));
        saved = await cloudSaveQueueRef.current.flush();
      } else {
        saved = await saveFamilyTree(renamed, authenticatedUserId);
      }
      setTrees((items) => items.map((item) => (item.id === treeId ? saved : item)));
      if (treeId === currentTree.id) setTree(saved);
      setStatus("Saved securely to your workspace.");
    } catch (error) {
      setStatus(`Could not rename family: ${error.message}`);
    }
  };

  const removeTree = async (treeId) => {
    const selectedTree = treeOptions.find((item) => item.id === treeId);
    if (!selectedTree) return false;

    const remainingTrees = treeOptions.filter((item) => item.id !== treeId);
    const removedCurrentTree = treeId === currentTree.id;
    setTrees(remainingTrees);
    if (removedCurrentTree) {
      if (remainingTrees[0]) {
        setActiveTreeIsListed(true);
        activateCase(remainingTrees[0]);
      } else {
        setActiveTreeIsListed(false);
        activateCase(initialTree());
      }
    }
    if (!cloudMode) return true;

    setStatus("Removing family...");
    try {
      await removeFamilyTree(treeId, authenticatedUserId);
      setStatus(
        entitlement?.unlimitedTrees
          ? "Family removed."
          : "Family removed. Its free or paid generation credit is not restored.",
      );
      return true;
    } catch (error) {
      setTrees((items) => upsertWorkspaceTree(items, selectedTree));
      if (removedCurrentTree) {
        setActiveTreeIsListed(true);
        activateCase(selectedTree);
      }
      setStatus(`Could not remove family: ${error.message}`);
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
  const recordDonation = ({ people, propertyId, transfer }) => {
    setTree((current) => {
      const base = reconcilePeopleUpdate(normaliseTree(current), activeFamilyGroupId, people);
      return {
        ...base,
        properties: (base.properties || []).map((property) =>
          property.id === propertyId
            ? { ...property, transfers: [...(property.transfers || []), transfer] }
            : property,
        ),
      };
    });
    setStatus(transfer.kind === "donation" ? "Donation recorded." : "Sale recorded.");
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

  const updateActiveProperty = (patch) =>
    updatePropertyWorkspace({
      properties: currentTree.properties.map((property) =>
        property.id === activeProperty.id ? { ...property, ...patch } : property,
      ),
    });

  const beginInitialOwnerTreePick = (ownerId) => {
    setInitialOwnerPick({ propertyId: activeProperty.id, ownerId });
    setTraceOwnershipSnapshot(null);
    setTraceOwnershipFractionSnapshot(null);
    setPropertyPanelExpanded(true);
    setSelectedPersonId("");
    setDashboardOpen(false);
    setStatus("Select a person on the family tree to make them an initial owner.");
  };

  const cancelInitialOwnerTreePick = ({ reopenPanel = true } = {}) => {
    setInitialOwnerPick(null);
    setPropertyPanelExpanded(reopenPanel);
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
    setSelectedPersonId(personId);
    setDashboardOpen(false);
    setPropertyPanelExpanded(true);
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
    setTraceOwnershipSnapshot(null);
    setTraceOwnershipFractionSnapshot(null);
    setPropertyPanelExpanded(false);
    setInitialOwnerPick(null);
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
      setTree(saved);
      setTrees((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
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

  if (showLibrary) {
    return (
      <FamilyLibrary
        trees={treeOptions}
        activeTreeId={activeTreeIsListed ? currentTree.id : ""}
        session={session}
        commercialMode={cloudMode}
        entitlement={entitlement}
        canCreate={!cloudMode || Boolean(entitlement?.canCreate)}
        billingBusy={billingBusy}
        billingMessage={billingMessage}
        storageStatus={status}
        recoveryAvailable={Boolean(startupWorkspace.recoveryKey)}
        onDownloadRecovery={downloadLocalRecovery}
        onDownloadBackup={downloadWorkspaceBackup}
        onCreate={createNewTree}
        onImport={importNewTree}
        onOpen={openTree}
        onRename={renameTree}
        onRemove={removeTree}
        onBuyTree={buyTreeCredit}
        onChangePassword={onChangePassword}
        onSignOut={signOutSafely}
      />
    );
  }

  if (workspaceView !== "tree") {
    return (
      <main className="property-workspace-page">
        <header className="property-workspace-header">
          <button type="button" className="tree-home-button" onClick={returnHome}>
            <House size={16} /> Back to Home
          </button>
          <div className="property-workspace-title">
            <p className="eyebrow">Property ownership and final withholding tax</p>
            <h1>{currentTree.title}</h1>
          </div>
          <button
            type="button"
            className="property-tree-button"
            onClick={() => setWorkspaceView("tree")}
          >
            <GitBranch size={16} /> Open family tree
          </button>
        </header>
        <nav className="property-workspace-tabs" aria-label="Property workspace sections">
          <button
            type="button"
            className={workspaceView === "property" ? "active" : ""}
            onClick={() => setWorkspaceView("property")}
          >
            <Landmark size={16} /> Setup
          </button>
          <button
            type="button"
            className={workspaceView === "ownership" ? "active" : ""}
            onClick={() => setWorkspaceView("ownership")}
          >
            <GitBranch size={16} /> Transfers
          </button>
          <button
            type="button"
            className={workspaceView === "tax" ? "active" : ""}
            onClick={() => setWorkspaceView("tax")}
          >
            <Calculator size={16} /> Tax Calculation
          </button>
        </nav>
        <section className="property-workspace-content">
          <Properties
            properties={activeProperties}
            people={currentTree.people}
            outsideParties={currentTree.outsideParties}
            singleProperty
            section={workspaceView}
            onSelectPerson={(personId) => {
              setWorkspaceView("tree");
              selectPerson(personId);
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
                onDeletePerson={removePerson}
                onChange={updatePeople}
                onRecordDonation={recordDonation}
                onDeleteInterVivosTransfer={deleteInterVivosTransfer}
                deceasedStatusSession={deceasedStatusSession}
                interVivosStatusSession={interVivosStatusSession}
                onDeceasedStatusChange={changeDeceasedStatus}
                onInterVivosStatusChange={changeInterVivosStatus}
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
                ownershipByPerson={traceOwnershipSnapshot || ownershipByPerson}
                ownershipFractionsByPerson={
                  traceOwnershipSnapshot
                    ? traceOwnershipFractionSnapshot || {}
                    : ownershipFractionsByPerson
                }
                currentOwnershipByPerson={traceOwnershipSnapshot || currentOwnershipByPerson}
                historicalLawWarningsByPerson={historicalLawWarningsByPerson}
                causaMortisCoverageByPerson={causaMortisCoverage.byPerson}
                selectedPersonId={selectedPersonId}
                onSelectPerson={handleTreePersonSelection}
                onFocusPerson={focusPersonOnTree}
                zoom={zoom}
                onZoomChange={updateZoom}
                personCardFields={
                  traceOwnershipSnapshot
                    ? {
                        ...currentTree.settings.personCardFields,
                        ownershipFraction: true,
                        ownershipPercentage: true,
                        ownershipValue: true,
                      }
                    : currentTree.settings.personCardFields
                }
                propertyValue={activeProperty.saleValue}
                propertyId={activeProperty.id}
                ownershipSnapshotActive={Boolean(traceOwnershipSnapshot)}
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
                      aria-controls="ownership-tax-details"
                      aria-expanded={propertyPanelExpanded}
                      onClick={() => setPropertyPanelExpanded((expanded) => !expanded)}
                    >
                      <Landmark size={16} />
                      <span>Ownership &amp; Tax</span>
                    </button>
                    <EditableTreeTitle value={currentTree.title} onChange={updateTreeTitle} />
                    <PersonFinder
                      people={currentTree.people}
                      onSelectPerson={(personId) => {
                        setPropertyPanelExpanded(false);
                        focusPersonOnTree(personId);
                      }}
                    />
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
              <TreePropertyPanel
                property={activeProperty}
                properties={currentTree.properties}
                activePropertyId={activeProperty.id}
                people={currentTree.people}
                outsideParties={currentTree.outsideParties}
                propertyReport={propertyReport}
                taxReport={taxCalculationReport}
                cardFields={currentTree.settings.personCardFields}
                onCardFieldsChange={(personCardFields) =>
                  setTree({
                    ...currentTree,
                    settings: { ...currentTree.settings, personCardFields },
                  })
                }
                onPropertyChange={updateActiveProperty}
                onPropertySelect={(activePropertyId) => {
                  setTraceOwnershipSnapshot(null);
                  setTraceOwnershipFractionSnapshot(null);
                  setTree({
                    ...currentTree,
                    settings: { ...currentTree.settings, activePropertyId },
                  });
                }}
                onFocusEvent={showTraceEventOnTree}
                expanded={propertyPanelExpanded}
                initialOwnerSelectionActive={Boolean(initialOwnerPick)}
                hideCollapsedTrigger
                onOpenProperty={() => {
                  setTraceOwnershipSnapshot(null);
                  setTraceOwnershipFractionSnapshot(null);
                  setPropertyPanelExpanded(false);
                  setWorkspaceView("property");
                }}
                onOpenTax={() => {
                  setTraceOwnershipSnapshot(null);
                  setTraceOwnershipFractionSnapshot(null);
                  setPropertyPanelExpanded(false);
                  setWorkspaceView("tax");
                }}
                onSelectPerson={selectPerson}
                onPickInitialOwner={beginInitialOwnerTreePick}
                onExpandedChange={(expanded) => {
                  setPropertyPanelExpanded(expanded);
                  if (expanded && initialOwnerPick) setInitialOwnerPick(null);
                }}
              />
            </div>
          )}
        </section>
      </div>
      <FractionCalculator />
    </main>
  );
}
