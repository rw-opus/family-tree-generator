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
import { listFamilyTrees, removeFamilyTree, saveFamilyTree } from "./services/familyTrees.js";
import {
  loadLocalWorkspace,
  saveLocalWorkspace,
  upsertWorkspaceTree,
} from "./services/localWorkspace.js";
import { supabase, supabaseConfigured } from "./supabaseClient.js";

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

export function App() {
  const [startupWorkspace] = useState(() => loadLocalWorkspace());
  const [tree, setTree] = useState(() => {
    const restoredTree =
      startupWorkspace.trees.find((item) => item.id === startupWorkspace.activeTreeId) ||
      startupWorkspace.trees[0];
    return restoredTree ? normaliseTree(restoredTree) : initialTree();
  });
  const [trees, setTrees] = useState(startupWorkspace.trees);
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState(
    startupWorkspace.trees.length
      ? "Recovered automatically from this device."
      : supabaseConfigured
        ? "Connecting to secure storage..."
        : "Automatically saved on this device.",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showLogin, setShowLogin] = useState(false);
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
    const saved = saveLocalWorkspace(trees, activeTreeIsListed ? tree.id : "");
    if (!session) {
      setStatus(
        saved
          ? "Automatically saved on this device."
          : "This browser could not save the current tree. Keep this page open and use cloud save when available.",
      );
    }
  }, [activeTreeIsListed, session, tree.id, trees]);

  useEffect(() => {
    if (!supabase) return undefined;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    return supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession)).data
      .subscription.unsubscribe;
  }, []);

  useEffect(() => {
    if (!session) return;
    listFamilyTrees()
      .then((items) => {
        setTrees((currentItems) => [
          ...items,
          ...currentItems.filter((item) => !items.some((cloudTree) => cloudTree.id === item.id)),
        ]);
        if (!startupWorkspace.trees.length && items[0]) {
          setActiveTreeIsListed(true);
          activateCase(items[0]);
        }
        setStatus("Saved securely to your workspace.");
      })
      .catch((error) => setStatus(`Cloud storage needs attention: ${error.message}`));
  }, [activateCase, session, startupWorkspace.trees.length]);

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

  const createNewTree = () => {
    const nextTree = initialTree();
    setActiveTreeIsListed(true);
    activateCase(nextTree, { openDashboard: true });
    setShowLibrary(false);
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

      activateCase(nextTree);
      setActiveTreeIsListed(true);
      setShowLibrary(false);
      setStatus(`Imported ${result.individualCount} people and ${result.familyCount} families.`);
    } catch (error) {
      setStatus(`Could not import GEDCOM: ${error.message}`);
      throw error;
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
    if (!session) return;

    setStatus("Saving family name...");
    try {
      const saved = await saveFamilyTree(renamed);
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
    if (!session) return;

    setStatus("Removing family...");
    try {
      await removeFamilyTree(treeId);
      setStatus("Family removed from your secure workspace.");
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
    if (!session) {
      setStatus("Automatically saved on this device.");
      return;
    }
    setStatus("Saving before returning Home...");
    try {
      const saved = await saveFamilyTree(currentTree);
      setTree(saved);
      setTrees((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
      setStatus("Saved securely to your workspace.");
    } catch (error) {
      setStatus(`Could not save: ${error.message}`);
    }
  };

  const signIn = async (event) => {
    event.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setStatus(error.message);
    else {
      setShowLogin(false);
      setStatus("Signed in. Loading your family trees...");
    }
  };

  const signOut = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      setStatus(`Could not sign out: ${error.message}`);
      return;
    }
    setSession(null);
    setStatus("Signed out. Families remain saved on this device.");
  };

  if (showLibrary) {
    return (
      <FamilyLibrary
        trees={treeOptions}
        activeTreeId={activeTreeIsListed ? currentTree.id : ""}
        session={session}
        supabaseConfigured={supabaseConfigured}
        onCreate={createNewTree}
        onImport={importNewTree}
        onOpen={openTree}
        onOpenProperty={(treeId) => openTree(treeId, "property")}
        onRename={renameTree}
        onRemove={removeTree}
        onSignIn={() => {
          setShowLibrary(false);
          setShowLogin(true);
        }}
        onSignOut={signOut}
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
          <label>
            Selling price (€)
            <input
              type="number"
              min="0"
              value={activeProperty.saleValue || ""}
              onChange={(event) =>
                updatePropertyWorkspace({
                  properties: [
                    { ...activeProperty, saleValue: event.target.value },
                    ...currentTree.properties.slice(1),
                  ],
                })
              }
            />
          </label>
        </section>
        <nav className="property-workspace-tabs" aria-label="Property workspace sections">
          <button
            type="button"
            className={workspaceView === "property" ? "active" : ""}
            onClick={() => setWorkspaceView("property")}
          >
            <Landmark size={16} /> Property &amp; declarations
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
            <Calculator size={16} /> Vendors &amp; Article 5A tax
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
      {showLogin && supabaseConfigured && (
        <form className="workbench-login" onSubmit={signIn}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button className="primary-button" type="submit">
            Sign in
          </button>
          <button type="button" className="secondary-button" onClick={() => setShowLogin(false)}>
            Cancel
          </button>
        </form>
      )}

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
