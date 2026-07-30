import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Cloud,
  CloudOff,
  FolderTree,
  Landmark,
  LogIn,
  Menu,
  Minus,
  Plus,
  Save,
  Settings2,
  UserRound,
  X,
  ZoomIn,
} from "lucide-react";
import {
  CaseViewTabs,
  familyViewKey,
  ownerViewKey,
  vendorTaxViewKey,
} from "./components/CaseViewTabs.jsx";
import { ExternalOwnerDirectory } from "./components/ExternalOwnerDirectory.jsx";
import { FamilyTreeCanvas } from "./components/FamilyTreeCanvas.jsx";
import { FractionCalculator } from "./components/FractionCalculator.jsx";
import { PersonInspector } from "./components/PersonInspector.jsx";
import { Properties } from "./components/Properties.jsx";
import { SettingsPanel } from "./components/SettingsPanel.jsx";
import { buildCausaMortisShareCoverage } from "./domain/causaMortisCoverage.js";
import {
  createFamilyGroup,
  findFamilyGroupsForPerson,
  normaliseCase,
  promoteOutsideIndividual,
  reconcilePeopleUpdate,
} from "./domain/caseModel.js";
import { createPerson } from "./domain/people.js";
import { buildPropertyVendorTaxReport } from "./domain/propertyVendorTax.js";
import { listFamilyTrees, saveFamilyTree } from "./services/familyTrees.js";
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
  return {
    ...caseData,
    title: caseData.title || "New property succession",
    property: { ...defaultProperty, ...(caseData.property || {}) },
    properties: migratedProperties(caseData),
    succession: { ...defaultSuccession, ...(caseData.succession || {}) },
    declarations: caseData.declarations || [],
    outsideParties: caseData.outsideParties || [],
    transfers: caseData.transfers || [],
    saleLots: caseData.saleLots || [],
    settings: { ...defaultSettings, ...(caseData.settings || {}) },
  };
};

const initialTree = () => {
  const caseId = crypto.randomUUID();
  const rootPerson = createPerson();
  return normaliseTree({
    id: caseId,
    title: "New property succession",
    people: [rootPerson],
    familyGroups: [
      {
        id: `${caseId}:family-group:1`,
        title: "Family tree 1",
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
  { key: "person", label: "Person", icon: UserRound },
  { key: "case", label: "Property", icon: Landmark },
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
  const [panelTab, setPanelTab] = useState("person");
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const [zoom, setZoom] = useState(() => Number(tree.settings?.treeZoom) || 100);
  const [activeFamilyGroupId, setActiveFamilyGroupId] = useState(
    () => normaliseTree(tree).activeFamilyGroupId,
  );
  const [activeView, setActiveView] = useState(() =>
    familyViewKey(normaliseTree(tree).activeFamilyGroupId),
  );
  const activateCase = useCallback((value, options = {}) => {
    const activation = caseActivationState(value);
    setTree(activation.caseData);
    setZoom(activation.zoom);
    setActiveFamilyGroupId(activation.activeFamilyGroupId);
    setActiveView(activation.activeView);
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
  const ownershipByPerson = useMemo(
    () =>
      Object.fromEntries(
        propertyReport.ledger.owners
          .filter((owner) => owner.personId)
          .map((owner) => [owner.personId, owner.share]),
      ),
    [propertyReport.ledger.owners],
  );
  const causaMortisCoverage = useMemo(
    () => buildCausaMortisShareCoverage(currentTree.people, activeProperties),
    [activeProperties, currentTree.people],
  );
  const selectedCaseDependencyLabels = useMemo(() => {
    const labels = [];
    if (currentTree.succession.heirs.some((heir) => heir.personId === selectedPersonId)) {
      labels.push("the linked heir record");
    }
    if (
      (activeProperty.transfers || []).some(
        (transfer) =>
          transfer.sellerId === selectedPersonId || transfer.buyerId === selectedPersonId,
      )
    ) {
      labels.push("the linked ownership transfer");
    }
    if ((activeProperty.saleLots || []).some((lot) => lot.ownerId === selectedPersonId)) {
      labels.push("the linked vendor tax lot");
    }
    return labels;
  }, [
    activeProperty.saleLots,
    activeProperty.transfers,
    currentTree.succession.heirs,
    selectedPersonId,
  ]);

  useEffect(() => {
    if (!activeFamilyGroup) {
      setActiveFamilyGroupId("");
      if (activeView.startsWith("family:")) {
        setActiveView(familyViewKey(""));
      }
      return;
    }
    if (activeFamilyGroup.id !== activeFamilyGroupId) {
      setActiveFamilyGroupId(activeFamilyGroup.id);
      if (activeView.startsWith("family:")) {
        setActiveView(familyViewKey(activeFamilyGroup.id));
      }
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
  }, [activeFamilyGroup, activeFamilyGroupId, activeView, selectedPersonId, visiblePeople]);

  useEffect(() => {
    setTrees((items) => upsertWorkspaceTree(items, normaliseTree(tree)));
  }, [tree]);

  useEffect(() => {
    const saved = saveLocalWorkspace(trees, tree.id);
    if (!session) {
      setStatus(
        saved
          ? "Automatically saved on this device."
          : "This browser could not save the current tree. Keep this page open and use cloud save when available.",
      );
    }
  }, [session, tree.id, trees]);

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
          activateCase(items[0]);
        }
        setStatus("Saved securely to your workspace.");
      })
      .catch((error) => setStatus(`Cloud storage needs attention: ${error.message}`));
  }, [activateCase, session, startupWorkspace.trees.length]);

  const treeOptions = useMemo(() => upsertWorkspaceTree(trees, normaliseTree(tree)), [tree, trees]);
  const treeCount = treeOptions.length;

  const selectPerson = (personId) => {
    const targetGroup =
      findFamilyGroupsForPerson(currentTree, personId).find(
        (group) => group.id === activeFamilyGroupId,
      ) || findFamilyGroupsForPerson(currentTree, personId)[0];
    if (targetGroup && !activePersonIds.has(personId)) {
      setActiveFamilyGroupId(targetGroup.id);
      setActiveView(familyViewKey(targetGroup.id));
      setTree({ ...currentTree, activeFamilyGroupId: targetGroup.id });
    }
    setSelectedPersonId(personId);
    setPanelTab("person");
    setDashboardOpen(true);
  };

  const selectFamilyGroup = (groupId) => {
    const group = currentTree.familyGroups.find((candidate) => candidate.id === groupId);
    if (!group) return;
    setActiveFamilyGroupId(group.id);
    setActiveView(familyViewKey(group.id));
    setSelectedPersonId(
      group.personIds.find((personId) => personId === group.rootPersonId) ||
        group.personIds[0] ||
        "",
    );
    setTree({ ...currentTree, activeFamilyGroupId: group.id });
  };

  const selectCaseView = (viewKey) => {
    if (viewKey.startsWith("family:")) {
      selectFamilyGroup(viewKey.slice("family:".length));
      return;
    }
    setActiveView(viewKey);
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
    activateCase(nextTree, { openDashboard: true });
  };

  const createNewFamilyTree = () => {
    const rootPerson = createPerson();
    const nextTree = createFamilyGroup(currentTree, rootPerson, {
      title: `Family tree ${currentTree.familyGroups.length + 1}`,
    });
    setTree(nextTree);
    setActiveFamilyGroupId(nextTree.activeFamilyGroupId);
    setActiveView(familyViewKey(nextTree.activeFamilyGroupId));
    setSelectedPersonId(rootPerson.id);
    setPanelTab("person");
    setDashboardOpen(true);
  };

  const openTree = (treeId) => {
    const selectedTree = treeOptions.find((item) => item.id === treeId);
    if (!selectedTree) return;
    activateCase(selectedTree);
  };

  const updatePeople = (people, options) => {
    setTree(reconcilePeopleUpdate(currentTree, activeFamilyGroupId, people, options));
  };

  const updateFamilyGroupTitle = (title) => {
    setTree({
      ...currentTree,
      familyGroups: currentTree.familyGroups.map((group) =>
        group.id === activeFamilyGroupId ? { ...group, title } : group,
      ),
    });
  };

  const createFamilyTreeForOutsideParty = (party) => {
    const nextTree = promoteOutsideIndividual(currentTree, party.id, {
      title: `${party.name || "New owner"} family`,
    });
    if (nextTree.outsideParties.some((candidate) => candidate.id === party.id)) return;
    setTree(nextTree);
    setActiveFamilyGroupId(nextTree.activeFamilyGroupId);
    setActiveView(familyViewKey(nextTree.activeFamilyGroupId));
    setSelectedPersonId(party.id);
    setPanelTab("person");
    setDashboardOpen(true);
  };

  const updateActiveProperty = (patch) => {
    const nextProperty = { ...activeProperty, ...patch };
    setTree({
      ...currentTree,
      property: {
        ...currentTree.property,
        address: nextProperty.address || "",
        saleValue: nextProperty.saleValue || "",
      },
      properties: [nextProperty, ...currentTree.properties.slice(1)],
    });
  };

  const updatePropertyCase = (patch) => {
    const nextProperty = patch.properties?.[0] || activeProperty;
    setTree({
      ...currentTree,
      ...patch,
      property: {
        ...currentTree.property,
        address: nextProperty.address || "",
        saleValue: nextProperty.saleValue || "",
      },
      properties: [nextProperty, ...currentTree.properties.slice(1)],
    });
  };

  const save = async () => {
    if (!session) {
      if (supabaseConfigured) setShowLogin(true);
      else setStatus("This tree is already saved automatically on this device.");
      return;
    }
    setStatus("Saving...");
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

  return (
    <main className="tree-workbench">
      <header className="workbench-header">
        <div className="workbench-brand">
          <FolderTree size={23} />
          <div>
            <strong>Property Succession</strong>
            <span>Family ownership workspace</span>
          </div>
        </div>
        <div className="workbench-case-fields">
          <label className="workbench-title">
            <span>Case name</span>
            <input
              value={currentTree.title}
              onChange={(event) => setTree({ ...currentTree, title: event.target.value })}
            />
          </label>
          <label className="property-header-address">
            <span>Property address</span>
            <input
              aria-label="Property address"
              value={activeProperty.address || ""}
              onChange={(event) => updateActiveProperty({ address: event.target.value })}
              placeholder="Property address"
            />
          </label>
          <label className="property-header-price">
            <span>Selling price</span>
            <span className="header-currency-input">
              <b>€</b>
              <input
                aria-label="Property selling price"
                type="number"
                min="0"
                step="any"
                value={activeProperty.saleValue || ""}
                onChange={(event) => updateActiveProperty({ saleValue: event.target.value })}
                placeholder="0"
              />
            </span>
          </label>
        </div>
        <div className="workbench-actions">
          <label className="saved-tree-picker">
            <span>Saved cases</span>
            <select
              aria-label="Saved property cases"
              value={currentTree.id}
              onChange={(event) => openTree(event.target.value)}
            >
              {treeOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title || "Untitled property case"}
                </option>
              ))}
            </select>
          </label>
          <span className="tree-count">
            {treeCount} {treeCount === 1 ? "case" : "cases"}
          </span>
          <span className="cloud-state">
            {session ? (
              <>
                <Cloud size={15} /> Saved workspace
              </>
            ) : (
              <>
                <CloudOff size={15} /> {supabaseConfigured ? "Not signed in" : "Auto-saved"}
              </>
            )}
          </span>
          <button type="button" className="secondary-button compact" onClick={createNewTree}>
            <Plus size={16} /> New case
          </button>
          <button type="button" className="primary-button compact" onClick={save}>
            <Save size={16} /> Save
          </button>
          {supabaseConfigured && !session && (
            <button
              type="button"
              className="secondary-button compact"
              onClick={() => setShowLogin(true)}
            >
              <LogIn size={16} /> Sign in
            </button>
          )}
          <button
            type="button"
            className="mobile-dashboard-button"
            onClick={() => setDashboardOpen(true)}
            aria-label="Open dashboard"
          >
            <Menu size={20} />
          </button>
        </div>
      </header>

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
              <p className="eyebrow">Case dashboard</p>
              <strong>{currentTree.title}</strong>
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
                familyPersonIds={activeFamilyGroup?.personIds || []}
                properties={activeProperties}
                ownershipByPerson={ownershipByPerson}
                causaMortisCoverage={causaMortisCoverage.byPerson[selectedPersonId] || []}
                selectedPersonId={selectedPersonId}
                shareDisplay={currentTree.settings.shareDisplay}
                caseDependencyLabels={selectedCaseDependencyLabels}
                onSelectPerson={selectPerson}
                onChange={updatePeople}
              />
            )}
            {panelTab === "case" && (
              <Properties
                properties={activeProperties}
                people={currentTree.people}
                outsideParties={currentTree.outsideParties}
                singleProperty
                section="property"
                onChange={updatePropertyCase}
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
          <CaseViewTabs
            familyGroups={currentTree.familyGroups}
            activeView={activeView}
            onSelectView={selectCaseView}
            onAddFamilyTree={createNewFamilyTree}
          />
          {activeView.startsWith("family:") && activeFamilyGroup && (
            <>
              <div className="tree-stage-toolbar">
                <label className="stage-family-title">
                  <span>Family tree name</span>
                  <input
                    aria-label="Family tree name"
                    value={activeFamilyGroup.title}
                    onChange={(event) => updateFamilyGroupTitle(event.target.value)}
                  />
                </label>
                <div className="stage-context">
                  <p className="eyebrow">Interactive family tree</p>
                  <strong>Tap a person to view or edit their details</strong>
                </div>
                <label className="stage-person-picker">
                  <span>Find person</span>
                  <select
                    value={selectedPersonId}
                    onChange={(event) => selectPerson(event.target.value)}
                  >
                    {visiblePeople.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.fullName || "Unnamed person"}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="zoom-controls" aria-label="Tree zoom">
                  <button type="button" onClick={() => updateZoom(zoom - 10)} aria-label="Zoom out">
                    <Minus size={16} />
                  </button>
                  <span>{zoom}%</span>
                  <button type="button" onClick={() => updateZoom(zoom + 10)} aria-label="Zoom in">
                    <ZoomIn size={16} />
                  </button>
                </div>
                <button
                  type="button"
                  className="stage-dashboard-button"
                  onClick={() => setDashboardOpen(true)}
                >
                  <Menu size={16} /> Dashboard
                </button>
              </div>
              <FamilyTreeCanvas
                treeTitle={activeFamilyGroup.title}
                people={visiblePeople}
                ownershipByPerson={ownershipByPerson}
                causaMortisCoverageByPerson={causaMortisCoverage.byPerson}
                selectedPersonId={selectedPersonId}
                onSelectPerson={selectPerson}
                zoom={zoom}
                onZoomChange={updateZoom}
                shareDisplay={currentTree.settings.shareDisplay}
                showOwnership={currentTree.settings.showOwnershipOnTree}
              />
            </>
          )}
          {activeView === ownerViewKey && (
            <div className="case-workspace-view">
              <header className="case-workspace-header">
                <div>
                  <p className="eyebrow">Property-wide ownership</p>
                  <h1>Owners and transfer history</h1>
                </div>
                <button
                  type="button"
                  className="stage-dashboard-button"
                  onClick={() => setDashboardOpen(true)}
                >
                  <Menu size={16} /> Dashboard
                </button>
              </header>
              <Properties
                properties={activeProperties}
                people={currentTree.people}
                outsideParties={currentTree.outsideParties}
                singleProperty
                section="ownership"
                onChange={updatePropertyCase}
              />
              <ExternalOwnerDirectory
                outsideParties={currentTree.outsideParties}
                currentOwners={propertyReport.ledger.owners}
                onCreateFamilyTree={createFamilyTreeForOutsideParty}
              />
            </div>
          )}
          {activeView === vendorTaxViewKey && (
            <div className="case-workspace-view">
              <header className="case-workspace-header">
                <div>
                  <p className="eyebrow">Every current owner</p>
                  <h1>Vendors and tax</h1>
                </div>
                <button
                  type="button"
                  className="stage-dashboard-button"
                  onClick={() => setDashboardOpen(true)}
                >
                  <Menu size={16} /> Dashboard
                </button>
              </header>
              <Properties
                properties={activeProperties}
                people={currentTree.people}
                outsideParties={currentTree.outsideParties}
                singleProperty
                section="tax"
                onChange={updatePropertyCase}
              />
            </div>
          )}
        </section>
      </div>
      <FractionCalculator />
    </main>
  );
}
