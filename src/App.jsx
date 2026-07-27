import { useEffect, useMemo, useState } from "react";
import { Cloud, CloudOff, Eye, EyeOff, FolderTree, LogIn, Plus, Save } from "lucide-react";
import { FamilyTreeCanvas } from "./components/FamilyTreeCanvas.jsx";
import { PeopleEditor } from "./components/PeopleEditor.jsx";
import { PropertyCalculator } from "./components/PropertyCalculator.jsx";
import { FractionCalculator } from "./components/FractionCalculator.jsx";
import { CaseSummary } from "./components/CaseSummary.jsx";
import { buildOwnershipLedger } from "./domain/ownership.js";
import { createPerson } from "./domain/people.js";
import { listFamilyTrees, saveFamilyTree } from "./services/familyTrees.js";
import { supabase, supabaseConfigured } from "./supabaseClient.js";

const initialTree = () => ({
  id: crypto.randomUUID(), title: "New property succession", people: [createPerson("Deceased")],
  property: { address: "", description: "", marketValueAtDeath: "", saleValue: "", deceasedOwnershipPercent: 100, rightPercent: 100 },
  succession: { basis: "intestacy", dateOfDeath: "", willDate: "", notaryName: "", deedWithinSixMonths: false, heirs: [] },
  declarations: [], outsideParties: [], transfers: [], saleLots: [],
});
const normaliseTree = (value) => {
  const defaults = initialTree();
  return { ...defaults, ...value, property: { ...defaults.property, ...(value.property || {}) }, succession: { ...defaults.succession, ...(value.succession || {}) }, declarations: value.declarations || [], outsideParties: value.outsideParties || [], transfers: value.transfers || [], saleLots: value.saleLots || [] };
};

export function App() {
  const [tree, setTree] = useState(initialTree);
  const [trees, setTrees] = useState([]);
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState(supabaseConfigured ? "Connecting to secure storage..." : "Local draft only - add Supabase settings when ready.");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showLogin, setShowLogin] = useState(false);
  const [view, setView] = useState("calculator");
  const [showSummary, setShowSummary] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const ownershipByPerson = useMemo(() => {
    const normalised = normaliseTree(tree);
    const ledger = buildOwnershipLedger(normalised.succession.heirs, normalised.outsideParties, normalised.transfers, normalised.people);
    return Object.fromEntries(ledger.owners.filter((owner) => owner.personId).map((owner) => [owner.personId, owner.share]));
  }, [tree]);
  useEffect(() => {
    if (!supabase) return undefined;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    return supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession)).data.subscription.unsubscribe;
  }, []);
  useEffect(() => {
    if (!session) return;
    listFamilyTrees().then((items) => { setTrees(items); if (items[0]) setTree(normaliseTree(items[0])); setStatus("Saved securely to your workspace."); }).catch((error) => setStatus(`Cloud storage needs attention: ${error.message}`));
  }, [session]);
  const treeCount = useMemo(() => trees.length + (trees.some((item) => item.id === tree.id) ? 0 : 1), [tree.id, trees]);
  const save = async () => {
    if (!session) { setShowLogin(true); return; }
    setStatus("Saving...");
    try { const saved = await saveFamilyTree(tree); setTree(saved); setTrees((items) => [saved, ...items.filter((item) => item.id !== saved.id)]); setStatus("Saved securely to your workspace."); } catch (error) { setStatus(`Could not save: ${error.message}`); }
  };
  const signIn = async (event) => { event.preventDefault(); const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) setStatus(error.message); else { setShowLogin(false); setStatus("Signed in. Loading your family trees..."); } };
  return <main className="app-shell"><header className="app-header"><div><div className="brand"><FolderTree size={24} /> Property Succession Calculator</div><p>Trace inherited ownership and estimate Maltese property taxes.</p></div><div className="cloud-state">{session ? <><Cloud size={16} /> Signed in</> : <><CloudOff size={16} /> {supabaseConfigured ? "Not signed in" : "Cloud setup pending"}</>}</div></header>
    <section className="workspace-toolbar"><label>Family tree name<input value={tree.title} onChange={(event) => setTree({ ...tree, title: event.target.value })} /></label><span className="tree-count">{treeCount} {treeCount === 1 ? "tree" : "trees"}</span><button type="button" className="secondary-button" onClick={() => setShowSummary((visible) => !visible)}>{showSummary ? <EyeOff size={16} /> : <Eye size={16} />} {showSummary ? "Hide summary" : "Show summary"}</button><button type="button" className="secondary-button" onClick={() => setTree(initialTree())}><Plus size={16} /> New tree</button><button type="button" className="primary-button" onClick={save}><Save size={16} /> Save</button>{supabaseConfigured && !session && <button type="button" className="secondary-button" onClick={() => setShowLogin(true)}><LogIn size={16} /> Sign in</button>}</section>
    <p className="save-status" aria-live="polite">{status}</p>{showLogin && supabaseConfigured && <form className="login-panel" onSubmit={signIn}><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><button className="primary-button" type="submit">Sign in</button></form>}
    {showSummary && <CaseSummary tree={normaliseTree(tree)} />}
    <nav className="view-tabs" aria-label="Case views"><button type="button" className={view === "calculator" ? "active" : ""} onClick={() => setView("calculator")}>Ownership & tax</button><button type="button" className={view === "tree" ? "active" : ""} onClick={() => setView("tree")}>Family tree</button></nav>
    {view === "calculator" ? <PropertyCalculator caseData={normaliseTree(tree)} onChange={setTree} /> : <div className="workspace-grid"><PeopleEditor people={tree.people} ownershipByPerson={ownershipByPerson} onChange={(people) => setTree({ ...tree, people })} selectedPersonId={selectedPersonId} onSelectPerson={setSelectedPersonId} /><FamilyTreeCanvas people={tree.people} ownershipByPerson={ownershipByPerson} selectedPersonId={selectedPersonId} onSelectPerson={setSelectedPersonId} /></div>}
    <FractionCalculator />
  </main>;
}
