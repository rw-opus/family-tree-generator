import { useEffect, useMemo, useState } from "react";
import {
  Cloud,
  CloudOff,
  FileText,
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
import { CaseSummary } from "./components/CaseSummary.jsx";
import { FamilyTreeCanvas } from "./components/FamilyTreeCanvas.jsx";
import { FractionCalculator } from "./components/FractionCalculator.jsx";
import { PersonInspector } from "./components/PersonInspector.jsx";
import { PropertyCalculator } from "./components/PropertyCalculator.jsx";
import { SettingsPanel } from "./components/SettingsPanel.jsx";
import { buildOwnershipLedger } from "./domain/ownership.js";
import { createPerson } from "./domain/people.js";
import { listFamilyTrees, saveFamilyTree } from "./services/familyTrees.js";
import { supabase, supabaseConfigured } from "./supabaseClient.js";

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

const normaliseTree = (value) => {
  const defaults = initialTree();
  return {
    ...defaults,
    ...value,
    people: value.people || defaults.people,
    property: { ...defaults.property, ...(value.property || {}) },
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
  { key: "summary", label: "Summary", icon: FileText },
  { key: "settings", label: "Settings", icon: Settings2 },
];

export function App() {
  const [tree, setTree] = useState(initialTree);
  const [trees, setTrees] = useState([]);
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState(
    supabaseConfigured
      ? "Connecting to secure storage..."
      : "Local draft only · cloud storage is not configured.",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showLogin, setShowLogin] = useState(false);
  const [panelTab, setPanelTab] = useState("person");
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const [zoom, setZoom] = useState(100);

  const currentTree = normaliseTree(tree);
  const ownershipByPerson = useMemo(() => {
    const normalised = normaliseTree(tree);
    const ledger = buildOwnershipLedger(
      normalised.succession.heirs,
      normalised.outsideParties,
      normalised.transfers,
      normalised.people,
    );
    return Object.fromEntries(
      ledger.owners
        .filter((owner) => owner.personId)
        .map((owner) => [owner.personId, owner.share]),
    );
  }, [tree]);
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
    if (!supabase) return undefined;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    return supabase.auth.onAuthStateChange((_event, nextSession) =>
      setSession(nextSession)).data.subscription.unsubscribe;
  }, []);

  useEffect(() => {
    if (!session) return;
    listFamilyTrees()
      .then((items) => {
        setTrees(items);
        if (items[0]) setTree(normaliseTree(items[0]));
        setStatus("Saved securely to your workspace.");
      })
      .catch((error) => setStatus(`Cloud storage needs attention: ${error.message}`));
  }, [session]);

  const treeCount = useMemo(
    () => trees.length + (trees.some((item) => item.id === tree.id) ? 0 : 1),
    [tree.id, trees],
  );

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

  const save = async () => {
    if (!session) {
      if (supabaseConfigured) setShowLogin(true);
      else setStatus("This draft remains in this browser until cloud storage is configured.");
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
        <label className="workbench-title">
          <span>Tree name</span>
          <input
            value={tree.title}
            onChange={(event) => setTree({ ...tree, title: event.target.value })}
          />
        </label>
        <div className="workbench-actions">
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
                <CloudOff size={15} /> {supabaseConfigured ? "Not signed in" : "Local draft"}
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
                ownershipByPerson={ownershipByPerson}
                selectedPersonId={selectedPersonId}
                shareDisplay={currentTree.settings.shareDisplay}
                caseDependencyLabels={selectedCaseDependencyLabels}
                onSelectPerson={selectPerson}
                onChange={(people) => setTree({ ...currentTree, people })}
              />
            )}
            {panelTab === "case" && (
              <PropertyCalculator caseData={currentTree} onChange={setTree} />
            )}
            {panelTab === "summary" && <CaseSummary tree={currentTree} />}
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
