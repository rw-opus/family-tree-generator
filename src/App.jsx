import { useEffect, useMemo, useState } from "react";
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
import { FamilyTreeCanvas } from "./components/FamilyTreeCanvas.jsx";
import { FractionCalculator } from "./components/FractionCalculator.jsx";
import { PersonInspector } from "./components/PersonInspector.jsx";
import { Properties } from "./components/Properties.jsx";
import { SettingsPanel } from "./components/SettingsPanel.jsx";
import { buildCausaMortisShareCoverage } from "./domain/causaMortisCoverage.js";
import {
  assignSolePartnersAsMissingParents,
  createPerson,
} from "./domain/people.js";
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

const initialTree = () => ({
  id: crypto.randomUUID(),
  title: "New property succession",
  people: [createPerson()],
  property: {
    address: "",
    description: "",
    marketValueAtDeath: "",
    saleValue: "",
    deceasedOwnershipPercent: 100,
    rightPercent: 100,
  },
  properties: [makePrimaryProperty()],
  succession: {
    basis: "intestacy",
    dateOfDeath: "",
    willDate: "",
    notaryName: "",
    deedWithinSixMonths: false,
    heirs: [],
  },
  declarations: [],
  outsideParties: [],
  transfers: [],
  saleLots: [],
  settings: {
    shareDisplay: "both",
    showOwnershipOnTree: true,
    treeZoom: 100,
  },
});

const migratedProperties = (value) => {
  if (value.properties?.length) return value.properties;
  const legacy = value.property;
  if (
    !legacy ||
    !(
      legacy.address ||
      legacy.description ||
      legacy.marketValueAtDeath ||
      legacy.saleValue
    )
  ) {
    return [makePrimaryProperty("primary-property")];
  }
  return [
    {
      id: "legacy-property",
      address: legacy.address || "",
      description: legacy.description || "",
      marketValue: legacy.marketValueAtDeath || "",
      saleValue: legacy.saleValue || "",
      owners: [],
      declarations: [],
      transfers: [],
      saleLots: [],
    },
  ];
};

const normaliseTree = (value) => {
  const defaults = initialTree();
  return {
    ...defaults,
    ...value,
    people: assignSolePartnersAsMissingParents(
      value.people || defaults.people,
    ),
    property: { ...defaults.property, ...(value.property || {}) },
    properties: migratedProperties(value),
    succession: { ...defaults.succession, ...(value.succession || {}) },
    declarations: value.declarations || [],
    outsideParties: value.outsideParties || [],
    transfers: value.transfers || [],
    saleLots: value.saleLots || [],
    settings: { ...defaults.settings, ...(value.settings || {}) },
  };
};

const dashboardTabs = [
  { key: "person", label: "Person", icon: UserRound },
  { key: "case", label: "Property & tax", icon: Landmark },
  { key: "settings", label: "Settings", icon: Settings2 },
];

export function App() {
  const [startupWorkspace] = useState(() => loadLocalWorkspace());
  const [tree, setTree] = useState(() => {
    const restoredTree =
      startupWorkspace.trees.find(
        (item) => item.id === startupWorkspace.activeTreeId,
      ) || startupWorkspace.trees[0];
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
  const [zoom, setZoom] = useState(100);

  const currentTree = normaliseTree(tree);
  const activeProperty =
    currentTree.properties[0] || makePrimaryProperty("primary-property");
  const activeProperties = useMemo(() => [activeProperty], [activeProperty]);
  const ownershipByPerson = useMemo(
    () =>
      Object.fromEntries(
        buildPropertyVendorTaxReport(
          activeProperty,
          currentTree.people,
          currentTree.outsideParties,
        ).ledger.owners
          .filter((owner) => owner.personId)
          .map((owner) => [owner.personId, owner.share]),
      ),
    [activeProperty, currentTree.outsideParties, currentTree.people],
  );
  const causaMortisCoverage = useMemo(
    () =>
      buildCausaMortisShareCoverage(
        currentTree.people,
        activeProperties,
      ),
    [activeProperties, currentTree.people],
  );
  const selectedCaseDependencyLabels = useMemo(() => {
    const labels = [];
    if (
      currentTree.succession.heirs.some(
        (heir) => heir.personId === selectedPersonId,
      )
    ) {
      labels.push("the linked heir record");
    }
    if (
      currentTree.transfers.some(
        (transfer) =>
          transfer.sellerId === selectedPersonId ||
          transfer.buyerId === selectedPersonId,
      )
    ) {
      labels.push("the linked ownership transfer");
    }
    return labels;
  }, [currentTree.succession.heirs, currentTree.transfers, selectedPersonId]);

  useEffect(() => {
    if (!currentTree.people.length) {
      setSelectedPersonId("");
      return;
    }
    if (!currentTree.people.some((person) => person.id === selectedPersonId)) {
      setSelectedPersonId(currentTree.people[0].id);
    }
  }, [currentTree.people, selectedPersonId]);

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
    return supabase.auth.onAuthStateChange((_event, nextSession) =>
      setSession(nextSession)).data.subscription.unsubscribe;
  }, []);

  useEffect(() => {
    if (!session) return;
    listFamilyTrees()
      .then((items) => {
        setTrees((currentItems) => [
          ...items,
          ...currentItems.filter(
            (item) => !items.some((cloudTree) => cloudTree.id === item.id),
          ),
        ]);
        if (!startupWorkspace.trees.length && items[0]) {
          setTree(normaliseTree(items[0]));
        }
        setStatus("Saved securely to your workspace.");
      })
      .catch((error) => setStatus(`Cloud storage needs attention: ${error.message}`));
  }, [session, startupWorkspace.trees.length]);

  const treeOptions = useMemo(
    () => upsertWorkspaceTree(trees, normaliseTree(tree)),
    [tree, trees],
  );
  const treeCount = treeOptions.length;

  const selectPerson = (personId) => {
    setSelectedPersonId(personId);
    setPanelTab("person");
    setDashboardOpen(true);
  };

  const updateZoom = (nextZoom) => {
    const boundedZoom = Math.min(140, Math.max(65, Number(nextZoom)));
    setZoom(boundedZoom);
    setTree({
      ...currentTree,
      settings: { ...currentTree.settings, treeZoom: boundedZoom },
    });
  };

  const createNewTree = () => {
    const nextTree = initialTree();
    setTree(nextTree);
    setSelectedPersonId(nextTree.people[0].id);
    setPanelTab("person");
    setDashboardOpen(true);
  };

  const openTree = (treeId) => {
    const selectedTree = treeOptions.find((item) => item.id === treeId);
    if (!selectedTree) return;
    setTree(normaliseTree(selectedTree));
    setSelectedPersonId(selectedTree.people?.[0]?.id || "");
    setPanelTab("person");
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
      properties: [
        nextProperty,
        ...currentTree.properties.slice(1),
      ],
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
      properties: [
        nextProperty,
        ...currentTree.properties.slice(1),
      ],
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
      const saved = await saveFamilyTree(tree);
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
            <span>Tree name</span>
            <input
              value={tree.title}
              onChange={(event) =>
                setTree({ ...tree, title: event.target.value })
              }
            />
          </label>
          <label className="property-header-address">
            <span>Property address</span>
            <input
              aria-label="Property address"
              value={activeProperty.address || ""}
              onChange={(event) =>
                updateActiveProperty({ address: event.target.value })
              }
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
                onChange={(event) =>
                  updateActiveProperty({ saleValue: event.target.value })
                }
                placeholder="0"
              />
            </span>
          </label>
        </div>
        <div className="workbench-actions">
          <label className="saved-tree-picker">
            <span>Saved trees</span>
            <select
              aria-label="Saved family trees"
              value={tree.id}
              onChange={(event) => openTree(event.target.value)}
            >
              {treeOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title || "Untitled family tree"}
                </option>
              ))}
            </select>
          </label>
          <span className="tree-count">
            {treeCount} {treeCount === 1 ? "tree" : "trees"}
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
            <Plus size={16} /> New
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
          <button
            type="button"
            className="secondary-button"
            onClick={() => setShowLogin(false)}
          >
            Cancel
          </button>
        </form>
      )}

      <div className="workbench-body">
        <aside className={`context-dashboard ${dashboardOpen ? "open" : ""}`}>
          <div className="dashboard-topline">
            <div>
              <p className="eyebrow">Case dashboard</p>
              <strong>{tree.title}</strong>
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
                properties={activeProperties}
                ownershipByPerson={ownershipByPerson}
                causaMortisCoverage={
                  causaMortisCoverage.byPerson[selectedPersonId] || []
                }
                selectedPersonId={selectedPersonId}
                shareDisplay={currentTree.settings.shareDisplay}
                caseDependencyLabels={selectedCaseDependencyLabels}
                onSelectPerson={selectPerson}
                onChange={(people) => setTree({ ...currentTree, people })}
              />
            )}
            {panelTab === "case" && (
              <Properties
                properties={activeProperties}
                people={currentTree.people}
                outsideParties={currentTree.outsideParties}
                singleProperty
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
          <div className="tree-stage-toolbar">
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
                {currentTree.people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName || "Unnamed person"}
                  </option>
                ))}
              </select>
            </label>
            <div className="zoom-controls" aria-label="Tree zoom">
              <button
                type="button"
                onClick={() => updateZoom(zoom - 10)}
                aria-label="Zoom out"
              >
                <Minus size={16} />
              </button>
              <span>{zoom}%</span>
              <button
                type="button"
                onClick={() => updateZoom(zoom + 10)}
                aria-label="Zoom in"
              >
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
            people={currentTree.people}
            ownershipByPerson={ownershipByPerson}
            causaMortisCoverageByPerson={causaMortisCoverage.byPerson}
            selectedPersonId={selectedPersonId}
            onSelectPerson={selectPerson}
            shareDisplay={currentTree.settings.shareDisplay}
            showOwnership={currentTree.settings.showOwnershipOnTree}
          />
        </section>
      </div>
      <FractionCalculator />
    </main>
  );
}
