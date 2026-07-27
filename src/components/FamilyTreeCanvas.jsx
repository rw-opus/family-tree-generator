import { useEffect, useRef } from "react";
import { Printer } from "lucide-react";
import { formattedDate, hasAnyDesignation, hasDesignation, personDesignations } from "../domain/people.js";
import { approximateFraction } from "../domain/ownership.js";

function printTree(node) {
  const popup = window.open("", "_blank", "noopener,noreferrer");
  if (!popup) return window.print();
  popup.document.write(`<!doctype html><html><head><title>Family Tree</title><style>${document.querySelector("style")?.textContent || ""}</style></head><body><main class="print-tree">${node.innerHTML}</main></body></html>`);
  popup.document.close();
  popup.focus();
  popup.print();
}

export function FamilyTreeCanvas({ people, ownershipByPerson = {}, onPrint = printTree, selectedPersonId, onSelectPerson, shareDisplay = "both", showOwnership = true }) {
  const treeRef = useRef(null);
  useEffect(() => {
    if (!selectedPersonId || !treeRef.current) return;
    const node = [...treeRef.current.querySelectorAll("[data-person-id]")].find((element) => element.dataset.personId === selectedPersonId);
    node?.scrollIntoView?.({ behavior: "smooth", block: "center", inline: "center" });
  }, [people, selectedPersonId]);
  const cleanPeople = (people || []).filter((person) => person.id || person.fullName || personDesignations(person).length);
  const deceased = cleanPeople.find((person) => person.isDeceased || hasDesignation(person, "Deceased"));
  const focalPerson = deceased || cleanPeople[0];
  const related = (names) => cleanPeople.filter((person) => !person.isDeceased && !hasDesignation(person, "Deceased") && hasAnyDesignation(person, names));
  const spouses = related(["Surviving Spouse"]);
  const children = related(["Child", "Children"]);
  const grandchildren = related(["Grandchild", "Grandchildren"]);
  const greatGrandchildren = related(["Great-Grandchild", "Great-Grandchildren"]);
  const parents = related(["Parent", "Father", "Mother"]);
  const grandparents = related(["Grandparent"]);
  const siblings = related(["Sibling"]);
  const nephews = related(["Nephew or Niece"]);
  const uncles = related(["Uncle or Aunt"]);
  const cousins = related(["Cousin"]);
  const placeholder = (id, fullName, label) => ({ id, fullName, designations: [label], isPlaceholder: true });
  const siblingConnectors = siblings.length ? siblings : (nephews.length ? [placeholder("nephew-parent", "Brother/Sister", "Parent of nephew/niece")] : []);
  const cousinConnectors = uncles.length ? uncles : (cousins.length ? [placeholder("cousin-parent", "Uncle/Aunt", "Parent of cousin")] : []);
  const childGeneration = children.length ? children : ((grandchildren.length || greatGrandchildren.length) ? [placeholder("child-line", "Child", "Child")] : []);
  const grandchildGeneration = grandchildren.length ? grandchildren : (greatGrandchildren.length ? [placeholder("grandchild-line", "Grandchild", "Grandchild")] : []);
  const title = deceased ? `Family Tree of ${deceased.fullName || "the deceased person"}` : "Family tree";
  const card = (person, variant = "") => {
    const isDeceased = Boolean(person.isDeceased) || hasDesignation(person, "Deceased") || variant === "deceased";
    const sexClass = ["Male", "Female"].includes(person.sex) ? person.sex.toLowerCase() : "";
    const ownership = ownershipByPerson[person.id] || 0;
    const ownershipFraction = approximateFraction(ownership);
    const fractionText = `${ownershipFraction.numerator}/${ownershipFraction.denominator}`;
    const percentageText = `${(ownership * 100).toLocaleString("en-MT", { maximumFractionDigits: 4 })}%`;
    const ownershipText =
      shareDisplay === "fraction"
        ? fractionText
        : shareDisplay === "percentage"
          ? percentageText
          : `${fractionText} · ${percentageText}`;
    return <button type="button" key={person.id} data-person-id={person.id} aria-label={`Open ${person.fullName || "unnamed person"}`} onClick={() => onSelectPerson?.(person.id)} className={`family-node ${sexClass} ${isDeceased ? "deceased" : ""} ${person.isPlaceholder ? "placeholder" : ""} ${selectedPersonId === person.id ? "selected" : ""}`}>
      <div className="family-node-name" title={person.fullName || "Unnamed person"}>{person.fullName || "Unnamed person"}</div>
      {!person.isPlaceholder && showOwnership && <div className="family-node-ownership">{ownershipText} ownership</div>}
      {isDeceased && person.dateOfDeath && <div className="family-node-meta">d. {formattedDate(person.dateOfDeath)}</div>}
      {!isDeceased && !person.isPlaceholder && <div className="family-node-meta">{personDesignations(person).join(" + ") || "No relationship selected"}</div>}
      {person.isPlaceholder && <div className="family-node-meta">{personDesignations(person)[0]}</div>}
    </button>;
  };
  const row = (members) => members.length ? <div className={`family-branch-row ${members.length === 1 ? "single" : ""}`}>{members.map((person) => <div className="family-branch-item" key={person.id}>{card(person)}</div>)}</div> : null;
  const generation = (label, members) => members.length ? <><div className="family-down-line" /><div className="family-generation-label">{label}</div>{row(members)}</> : null;
  const branch = (top, lower, topLabel, lowerLabel) => (top.length || lower.length) ? <div className="family-side-branch"><div className="family-generation-label">{topLabel}</div><div className="family-row">{top.map(card)}</div>{lower.length > 0 && <><div className="family-down-line" /><div className="family-generation-label">{lowerLabel}</div>{row(lower)}</>}</div> : null;
  const relationalPeople = (people || []).filter((person) =>
    person.fullName ||
    person.fatherId ||
    person.motherId ||
    (person.spouseIds || []).length ||
    personDesignations(person).length
  );
  const hasRelationalLinks = relationalPeople.some((person) => person.fatherId || person.motherId);
  if (hasRelationalLinks) {
    const personMap = new Map(relationalPeople.map((person) => [person.id, person]));
    const depthMemo = new Map();
    const depthOf = (person, trail = new Set()) => {
      if (depthMemo.has(person.id)) return depthMemo.get(person.id);
      if (trail.has(person.id)) return 0;
      const parents = [personMap.get(person.fatherId), personMap.get(person.motherId)].filter(Boolean);
      const depth = parents.length ? Math.max(...parents.map((parent) => depthOf(parent, new Set(trail).add(person.id)))) + 1 : 0;
      depthMemo.set(person.id, depth);
      return depth;
    };
    const generations = new Map();
    relationalPeople.forEach((person) => { const depth = depthOf(person); if (!generations.has(depth)) generations.set(depth, []); generations.get(depth).push(person); });
    return <section className="tree-panel">
      <header className="tree-toolbar"><div><p className="eyebrow">Relational family record</p><h2>Family tree</h2></div><button type="button" className="secondary-button" onClick={() => onPrint(treeRef.current)}><Printer size={16} /> Print</button></header>
      <div className="family-chart" ref={treeRef}><div className="family-canvas relational-canvas"><h2 className="family-chart-title">Family tree</h2>{[...generations.entries()].sort(([a], [b]) => a - b).map(([depth, members], index) => <div className="relational-generation" key={depth}>{index > 0 && <div className="family-down-line" />}<div className="family-branch-row">{members.sort((a, b) => (a.fullName || "").localeCompare(b.fullName || "")).map((person) => <div className="family-branch-item" key={person.id}>{card(person)}</div>)}</div></div>)}</div></div>
      <p className="helper-text">Select a person in the index to locate and highlight them in this tree.</p>
    </section>;
  }
  const hasRelations = spouses.length || children.length || grandchildren.length || greatGrandchildren.length || parents.length || grandparents.length || siblings.length || nephews.length || uncles.length || cousins.length;
  return <section className="tree-panel">
    <header className="tree-toolbar"><div><p className="eyebrow">Visual family record</p><h2>{title}</h2></div><button type="button" className="secondary-button" onClick={() => onPrint(treeRef.current)}><Printer size={16} /> Print</button></header>
    <div className="family-chart" ref={treeRef}><div className="family-canvas"><h2 className="family-chart-title">{title}</h2>
      {grandparents.length > 0 && <><div className="family-generation-label">Grandparents</div>{row(grandparents)}<div className="family-down-line" /></>}
      {parents.length > 0 && <><div className="family-generation-label">Parents</div>{row(parents)}<div className="family-down-line" /></>}
      <div className="family-main-stage"><div className="family-side-slot left">{(siblingConnectors.length > 0 || nephews.length > 0) && <><div className="family-side-stack">{branch(siblingConnectors, nephews, nephews.length ? "Brother / Sister Line" : "Siblings", "Nephews / Nieces")}</div><span className="family-side-line" /></>}</div><div className="family-union">{focalPerson ? card(focalPerson, deceased ? "deceased" : "") : <div className="family-empty">Add a person to start the tree.</div>}{spouses.filter((person) => person.id !== focalPerson?.id).map((person) => <span className="family-spouse" key={person.id}><span className="family-spouse-line" />{card(person)}</span>)}</div><div className="family-side-slot right">{(cousinConnectors.length > 0 || cousins.length > 0) && <><span className="family-side-line" /><div className="family-side-stack">{branch(cousinConnectors, cousins, cousins.length ? "Uncle / Aunt Line" : "Uncles / Aunts", "Cousins")}</div></>}</div></div>
      {generation("Children", childGeneration)}{generation("Grandchildren", grandchildGeneration)}{generation("Great-Grandchildren", greatGrandchildren)}
      {!hasRelations && <div className="family-empty">Add relationship designations to show people in the tree.</div>}
    </div></div>
    <p className="helper-text">The diagram is a working visual aid. Dashed entries are connectors added only when a relative is needed to make another branch intelligible.</p>
  </section>;
}
