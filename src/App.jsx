import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, GitBranch, House, Landmark, Settings2, UserRound, X } from "lucide-react";
import { familyViewKey } from "./components/CaseViewTabs.jsx";
import { FamilyLibrary } from "./components/FamilyLibrary.jsx";
import { FamilyTreeCanvas } from "./components/FamilyTreeCanvas.jsx";
import { FractionCalculator } from "./components/FractionCalculator.jsx";
import { PersonInspector } from "./components/PersonInspector.jsx";
import { Properties } from "./components/Properties.jsx";
import { SettingsPanel } from "./components/SettingsPanel.jsx";
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
import { normalisePersonCardFields } from "./domain/personCardDisplay.js";
import { buildPropertyVendorTaxReport } from "./domain/propertyVendorTax.js";
import {
  createFamilyTree,
  listFamilyTrees,
  removeFamilyTree,
  saveFamilyTree,
} from "./services/familyTrees.js";
import {
  loadLocalWorkspace,
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
  const settings = { ...defaultSettings, ...(caseData.settings || {}) };
  return {
    ...caseData,
    createdAt: caseData.createdAt || caseData.created_at || caseData.updated_at || "",
    title: caseData.title || "Untitled family",
    property: { ...defaultProperty, ...(caseData.property || {}) },
    properties: migratedProperties(caseData),
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

const initialTree = () => {
  const caseId = crypto.randomUUID();
  const rootPerson = createPerson();
  return normaliseTree({
    id: caseId,
    createdAt: new Date().toISOString(),
    title: "New family",
    people: [rootPerson],
    familyGroups: [
      {
        id: `${caseId}:family-group:1`,
        title: "New family",
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

const dashboardTabs = [
  { key: "person", label: "Details", icon: UserRound },
  { key: "settings", label: "Settings", icon: Settings2 },
];

export function App({ localOnlyMode = true, session = null, onSignOut = () => {} }) {
  const cloudMode = Boolean(session?.user?.id) && !localOnlyMode;
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
    startupWorkspace.trees.length
      ? "Recovered automatically from this device."
      : cloudMode
        ? "Connecting to secure storage..."
        : "Automatically saved on this device.",
  );
  const [entitlement, setEntitlement] = useState(localOnlyMode ? defaultTreeEntitlement : null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingMessage, setBillingMessage] = useState("");
  const [showLibrary, setShowLibrary] = useState(true);
  const [workspaceView, setWorkspaceView] = useState("tree");
  const [activeTreeIsListed, setActiveTreeIsListed] = useState(
    () => startupWorkspace.trees.length > 0,
  );
  const [panelTab, setPanelTab] = useState("person");
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const [zoom, setZoom] = useState(() => Number(tree.settings?.treeZoom) || 100);
  const [activeFamilyGroupId, setActiveFamilyGroupId] = useState(
    () => normaliseTree(tree).activeFamilyGroupId,
  );
  const activateCase = useCallback((value, options = {}) => {
    const activation = caseActivationState(value);
    setTree(activation.caseData);
    setZoom(activation.zoom);
    setActiveFamilyGroupId(activation.activeFamilyGroupId);
    setSelectedPersonId(activation.selectedPersonId);
    setPanelTab("person");
    if (options.openDashboard) setDashboardOpen(true);
    return activation.caseData;
  }, []);

  const refreshTreeEntitlement = useCallback(async () => {
    if (!cloudMode) {
      setEntitlement(defaultTreeEntitlement);
      return defaultTreeEntitlement;
    }
    const nextEntitlement = await loadTreeEntitlement(session.user.id);
    setEntitlement(nextEntitlement);
    return nextEntitlement;
  }, [cloudMode, session]);

  const currentTree = normaliseTree(tree);
  const requestedActiveFamilyGroup = currentTree.familyGroups.find(
    (group) => group.id === activeFamilyGroupId,
  );
  const activeFamilyGroup =
    requestedActiveFamilyGroup ||
    currentTree.familyGroups.find((group) => group.id === currentTree.activeFamilyGroupId) ||
    currentTree.familyGroups[0];
  const activePersonIds = new Set(activeFamilyGroup?.personIds || []);
  const visiblePeople = currentTree.people.filter((person) => activePersonIds.has(person.id));
  const activeProperty = currentTree.properties[0] || makePrimaryProperty("primary-property");
  const activeProperties = useMemo(() => [activeProperty], [activeProperty]);
  const propertyReport = useMemo(
    () =>
      buildPropertyVendorTaxReport(activeProperty, currentTree.people, currentTree.outsideParties),
    [activeProperty, currentTree.outsideParties, currentTree.people],
  );
  const ownershipByPerson = useMemo(() => {
    if (!propertyReport.startingOwnership.isComplete) return {};
    return Object.fromEntries(
      propertyReport.ledger.owners
        .filter((owner) => owner.personId)
        .map((owner) => [owner.personId, owner.share]),
    );
  }, [propertyReport.ledger.owners, propertyReport.startingOwnership.isComplete]);
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
  const selectedCaseDependencyLabels = useMemo(() => {
    const relationshipLabels = new Set([
      "a child relationship",
      "a partner relationship",
      "a sibling relationship",
    ]);
    return casePersonDependencyLabels(tree, selectedPersonId).filter(
      (label) => !relationshipLabels.has(label),
    );
  }, [selectedPersonId, tree]);

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
    if (!visiblePeople.some((person) => person.id === selectedPersonId)) {
      setSelectedPersonId(
        visiblePeople.find((person) => person.id === activeFamilyGroup.rootPersonId)?.id ||
          visiblePeople[0].id,
      );
    }
  }, [activeFamilyGroup, activeFamilyGroupId, selectedPersonId, visiblePeople]);

  useEffect(() => {
    if (!activeTreeIsListed) return;
    setTrees((items) => upsertWorkspaceTree(items, normaliseTree(tree)));
  }, [activeTreeIsListed, tree]);

  useEffect(() => {
    if (cloudMode) return;
    const saved = saveLocalWorkspace(trees, activeTreeIsListed ? tree.id : "");
    setStatus(
      saved
        ? "Automatically saved on this device."
        : "This browser could not save the current tree. Keep this page open.",
    );
  }, [activeTreeIsListed, cloudMode, tree.id, trees]);

  useEffect(() => {
    if (!cloudMode) return;
    Promise.all([listFamilyTrees(session.user.id), refreshTreeEntitlement()])
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
  }, [activateCase, cloudMode, refreshTreeEntitlement, session]);

  useEffect(() => {
    if (!cloudMode || !activeTreeIsListed) return undefined;
    const timeout = window.setTimeout(() => {
      setStatus("Saving securely...");
      saveFamilyTree(normaliseTree(tree), session.user.id)
        .then(() => setStatus("Saved securely to your workspace."))
        .catch((error) => setStatus(`Cloud save needs attention: ${error.message}`));
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [activeTreeIsListed, cloudMode, session, tree]);

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
          if (nextEntitlement.paidTreeCredits > 0) {
            setBillingMessage("Payment confirmed. Your new tree credit is ready to use.");
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
    () => (activeTreeIsListed ? upsertWorkspaceTree(trees, normaliseTree(tree)) : trees),
    [activeTreeIsListed, tree, trees],
  );

  const selectPerson = (personId) => {
    const targetGroup =
      findFamilyGroupsForPerson(currentTree, personId).find(
        (group) => group.id === activeFamilyGroupId,
      ) || findFamilyGroupsForPerson(currentTree, personId)[0];
    if (targetGroup && !activePersonIds.has(personId)) {
      setActiveFamilyGroupId(targetGroup.id);
      setTree({ ...currentTree, activeFamilyGroupId: targetGroup.id });
    }
    setSelectedPersonId(personId);
    setPanelTab("person");
    setDashboardOpen(true);
  };

  const updateZoom = (nextZoom) => {
    const boundedZoom = Math.min(140, Math.max(25, Math.round(Number(nextZoom) / 5) * 5));
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
      setBillingMessage("Your five free trees have been used. Buy one tree credit for €30.");
      await refreshTreeEntitlement().catch(() => {});
      return;
    }
    setStatus(`Could not create family: ${error.message}`);
  };

  const createNewTree = async () => {
    const nextTree = initialTree();
    if (!cloudMode) {
      openCreatedTree(nextTree, { openDashboard: true });
      return;
    }
    setStatus("Creating secure family tree...");
    try {
      const saved = await createFamilyTree(nextTree);
      setTrees((items) => upsertWorkspaceTree(items, saved));
      openCreatedTree(saved, { openDashboard: true });
      await refreshTreeEntitlement();
      setStatus("New family created and saved securely.");
    } catch (error) {
      await handleCreationError(error);
    }
  };

  const importNewTree = async (file) => {
    try {
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
      setStatus(`Imported ${result.individualCount} people and ${result.familyCount} families.`);
    } catch (error) {
      if (isTreePaymentRequiredError(error)) await handleCreationError(error);
      else setStatus(`Could not import GEDCOM: ${error.message}`);
      throw error;
    }
  };

  const buyTreeCredit = async () => {
    if (!cloudMode || billingBusy) return;
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

  const openTree = (treeId, view = "tree") => {
    const selectedTree = treeOptions.find((item) => item.id === treeId);
    if (!selectedTree) return;
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
      const saved = await saveFamilyTree(renamed, session.user.id);
      setTrees((items) => items.map((item) => (item.id === treeId ? saved : item)));
      if (treeId === currentTree.id) setTree(saved);
      setStatus("Saved securely to your workspace.");
    } catch (error) {
      setStatus(`Could not rename family: ${error.message}`);
    }
  };

  const removeTree = async (treeId) => {
    const selectedTree = treeOptions.find((item) => item.id === treeId);
    if (
      !selectedTree ||
      !window.confirm(`Remove ${selectedTree.title || "this family"}? This cannot be undone.`)
    ) {
      return;
    }

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
    if (!cloudMode) return;

    setStatus("Removing family...");
    try {
      await removeFamilyTree(treeId, session.user.id);
      setStatus("Family removed. Its free or paid generation credit is not restored.");
    } catch (error) {
      setTrees((items) => upsertWorkspaceTree(items, selectedTree));
      if (removedCurrentTree) {
        setActiveTreeIsListed(true);
        activateCase(selectedTree);
      }
      setStatus(`Could not remove family: ${error.message}`);
    }
  };

  const updatePeople = (people, options) => {
    setTree((current) =>
      reconcilePeopleUpdate(normaliseTree(current), activeFamilyGroupId, people, options),
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

  const updatePropertyWorkspace = (patch) => {
    setTree({
      ...currentTree,
      properties: patch.properties || currentTree.properties,
      outsideParties: patch.outsideParties || currentTree.outsideParties,
    });
  };

  const returnHome = async () => {
    setDashboardOpen(false);
    setWorkspaceView("tree");
    setShowLibrary(true);
    if (!cloudMode) {
      setStatus("Automatically saved on this device.");
      return;
    }
    setStatus("Saving before returning Home...");
    try {
      const saved = await saveFamilyTree(currentTree, session.user.id);
      setTree(saved);
      setTrees((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
      setStatus("Saved securely to your workspace.");
    } catch (error) {
      setStatus(`Could not save: ${error.message}`);
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
        onCreate={createNewTree}
        onImport={importNewTree}
        onOpen={openTree}
        onOpenProperty={(treeId) => openTree(treeId, "property")}
        onRename={renameTree}
        onRemove={removeTree}
        onBuyTree={buyTreeCredit}
        onSignOut={onSignOut}
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
        <section className="property-workspace-property">
          <label>
            Property address
            <input
              value={activeProperty.address || ""}
              onChange={(event) =>
                updatePropertyWorkspace({
                  properties: [
                    { ...activeProperty, address: event.target.value },
                    ...currentTree.properties.slice(1),
                  ],
                })
              }
              placeholder="Full address"
            />
          </label>
        </section>
        <nav className="property-workspace-tabs" aria-label="Property workspace sections">
          <button
            type="button"
            className={workspaceView === "property" ? "active" : ""}
            onClick={() => setWorkspaceView("property")}
          >
            <Landmark size={16} /> Property &amp; initial owners
          </button>
          <button
            type="button"
            className={workspaceView === "ownership" ? "active" : ""}
            onClick={() => setWorkspaceView("ownership")}
          >
            <GitBranch size={16} /> Owners &amp; transfers
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
            onChange={updatePropertyWorkspace}
          />
        </section>
      </main>
    );
  }

  return (
    <main className="tree-workbench">
      <div className="workbench-body">
        <aside className={`context-dashboard ${dashboardOpen ? "open" : ""}`}>
          <div className="dashboard-topline">
            <div>
              <p className="eyebrow">Person Details</p>
              <strong>
                {currentTree.people.find((person) => person.id === selectedPersonId)?.fullName ||
                  "New person"}
              </strong>
            </div>
            <button
              type="button"
              className="dashboard-close"
              onClick={() => setDashboardOpen(false)}
              aria-label="Close dashboard"
            >
              <X size={19} />
            </button>
          </div>
          <nav className="dashboard-tabs" aria-label="Dashboard sections">
            {dashboardTabs.map(({ key, label, icon: Icon }) => (
              <button
                type="button"
                className={panelTab === key ? "active" : ""}
                key={key}
                onClick={() => setPanelTab(key)}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </nav>
          <div className={`dashboard-content dashboard-${panelTab}`}>
            {panelTab === "person" && (
              <PersonInspector
                people={currentTree.people}
                outsideParties={currentTree.outsideParties}
                familyPersonIds={activeFamilyGroup?.personIds || []}
                properties={activeProperties}
                ownershipByPerson={ownershipByPerson}
                causaMortisCoverage={causaMortisCoverage.byPerson[selectedPersonId] || []}
                selectedPersonId={selectedPersonId}
                shareDisplay={currentTree.settings.shareDisplay}
                onShareDisplayChange={(shareDisplay) =>
                  setTree({
                    ...currentTree,
                    settings: { ...currentTree.settings, shareDisplay },
                  })
                }
                caseDependencyLabels={selectedCaseDependencyLabels}
                personFamilyGroupCount={
                  findFamilyGroupsForPerson(currentTree, selectedPersonId).length
                }
                onSelectPerson={selectPerson}
                onDeletePerson={removePerson}
                onBackToTree={() => setDashboardOpen(false)}
                onChange={updatePeople}
                onOutsidePartiesChange={(outsideParties) =>
                  setTree((current) => ({ ...normaliseTree(current), outsideParties }))
                }
              />
            )}
            {panelTab === "settings" && (
              <SettingsPanel
                settings={currentTree.settings}
                zoom={zoom}
                onZoomChange={updateZoom}
                onChange={(settings) => setTree({ ...currentTree, settings })}
              />
            )}
          </div>
          <p className="dashboard-status" aria-live="polite">
            {status}
          </p>
        </aside>

        <section className="tree-stage" style={{ "--tree-zoom": zoom / 100 }}>
          {activeFamilyGroup && (
            <>
              <div className="tree-stage-toolbar tree-stage-toolbar-minimal">
                <button type="button" className="tree-home-button" onClick={returnHome}>
                  <House size={16} /> Back to Home
                </button>
                <label className="stage-family-title">
                  <span>Tree name</span>
                  <input
                    aria-label="Tree name"
                    value={currentTree.title}
                    onChange={(event) => updateTreeTitle(event.target.value)}
                  />
                </label>
                <label className="tree-zoom-slider">
                  <span>Zoom</span>
                  <input
                    aria-label="Tree zoom"
                    type="range"
                    min="25"
                    max="140"
                    step="5"
                    value={zoom}
                    onChange={(event) => updateZoom(event.target.value)}
                  />
                  <output>{zoom}%</output>
                </label>
              </div>
              <FamilyTreeCanvas
                treeTitle={currentTree.title}
                people={visiblePeople}
                ownershipByPerson={ownershipByPerson}
                causaMortisCoverageByPerson={causaMortisCoverage.byPerson}
                selectedPersonId={selectedPersonId}
                onSelectPerson={selectPerson}
                zoom={zoom}
                onZoomChange={updateZoom}
                personCardFields={currentTree.settings.personCardFields}
                propertyValue={activeProperty.saleValue}
              />
            </>
          )}
        </section>
      </div>
      <FractionCalculator />
    </main>
  );
}
