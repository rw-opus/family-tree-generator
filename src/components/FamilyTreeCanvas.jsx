import { useEffect, useRef } from "react";
import { Printer } from "lucide-react";
import {
  formattedDate,
  hasAnyDesignation,
  hasDesignation,
  personDesignations,
  personDisplayName,
} from "../domain/people.js";
import { approximateFraction } from "../domain/ownership.js";

function printTree(node) {
  const popup = window.open("", "_blank", "noopener,noreferrer");
  if (!popup) return window.print();
  popup.document.write(`<!doctype html><html><head><title>Family Tree</title><style>${document.querySelector("style")?.textContent || ""}</style></head><body><main class="print-tree">${node.innerHTML}</main></body></html>`);
  popup.document.close();
  popup.focus();
  popup.print();
}

export function FamilyTreeCanvas({
  people,
  ownershipByPerson = {},
  causaMortisCoverageByPerson = {},
  onPrint = printTree,
  selectedPersonId,
  onSelectPerson,
  shareDisplay = "both",
  showOwnership = true,
}) {
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
  const displayName = (person) => personDisplayName(person, cleanPeople);
  const title = deceased ? `Family Tree of ${displayName(deceased)}` : "Family tree";
  const card = (person, variant = "") => {
    const isDeceased = Boolean(person.isDeceased) || hasDesignation(person, "Deceased") || variant === "deceased";
    const incompleteCausaMortis = (
      causaMortisCoverageByPerson[person.id] || []
    ).filter((row) => row.status !== "complete");
    const sexClass = ["Male", "Female"].includes(person.sex) ? person.sex.toLowerCase() : "";
    const hasOwnership = Object.prototype.hasOwnProperty.call(ownershipByPerson, person.id);
    const ownership = hasOwnership ? ownershipByPerson[person.id] : 0;
    const ownershipFraction = approximateFraction(ownership);
    const fractionText = `${ownershipFraction.numerator}/${ownershipFraction.denominator}`;
    const percentageText = `${(ownership * 100).toLocaleString("en-MT", { maximumFractionDigits: 4 })}%`;
    const ownershipText =
      ownership === 0
        ? "0%"
        : shareDisplay === "fraction"
        ? fractionText
        : shareDisplay === "percentage"
          ? percentageText
          : `${fractionText} · ${percentageText}`;
    const name = person.isPlaceholder ? person.fullName : displayName(person);
    return <button type="button" key={person.id} data-person-id={person.id} aria-label={`Open ${name}`} onClick={() => onSelectPerson?.(person.id)} className={`family-node ${sexClass} ${isDeceased ? "deceased" : ""} ${incompleteCausaMortis.length ? "cm-share-incomplete" : ""} ${person.isPlaceholder ? "placeholder" : ""} ${selectedPersonId === person.id ? "selected" : ""}`}>
      <div className="family-node-name" title={name}>{name}</div>
      {!person.isPlaceholder && showOwnership && hasOwnership && <div className="family-node-ownership">{ownershipText} ownership</div>}
      {!person.isPlaceholder && incompleteCausaMortis.map((row) => {
        const required = approximateFraction(row.requiredShare);
        const declared = approximateFraction(row.declaredShare);
        return <div className="family-node-cm-alert" key={row.propertyId}>
          CM share {declared.numerator}/{declared.denominator} of {required.numerator}/{required.denominator}
        </div>;
      })}
      {isDeceased && person.dateOfDeath && <div className="family-node-meta">d. {formattedDate(person.dateOfDeath)}</div>}
      {!isDeceased && !person.isPlaceholder && <div className="family-node-meta">{personDesignations(person).join(" + ") || "No relationship selected"}</div>}
      {person.isPlaceholder && <div className="family-node-meta">{personDesignations(person)[0]}</div>}
    </button>;
  };
  const row = (members) => members.length ? <div className={`family-branch-row ${members.length === 1 ? "single" : ""}`}>{members.map((person) => <div className="family-branch-item" key={person.id}>{card(person)}</div>)}</div> : null;
  const generation = (label, members) => members.length ? <><div className="family-down-line" /><div className="family-generation-label">{label}</div>{row(members)}</> : null;
  const branch = (top, lower, topLabel, lowerLabel) => (top.length || lower.length) ? <div className="family-side-branch"><div className="family-generation-label">{topLabel}</div><div className="family-row">{top.map(card)}</div>{lower.length > 0 && <><div className="family-down-line" /><div className="family-generation-label">{lowerLabel}</div>{row(lower)}</>}</div> : null;
  const relationalPeople = (people || []).filter((person) =>
    person.id ||
    person.fullName ||
    person.fatherId ||
    person.motherId ||
    (person.spouseIds || []).length ||
    (person.siblingIds || []).length ||
    personDesignations(person).length
  );
  const hasRelationalLinks = relationalPeople.some((person) =>
    person.fatherId ||
    person.motherId ||
    (person.spouseIds || []).length ||
    (person.siblingIds || []).length
  );
  if (hasRelationalLinks) {
    const personMap = new Map(relationalPeople.map((person) => [person.id, person]));
    const childrenByParent = new Map();
    relationalPeople.forEach((person) => {
      [person.fatherId, person.motherId]
        .filter((id) => personMap.has(id))
        .forEach((parentId) => {
          if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
          childrenByParent.get(parentId).push(person);
        });
    });
    const unionNeighbours = (personId) => {
      const ids = new Set(personMap.get(personId)?.spouseIds || []);
      relationalPeople.forEach((candidate) => {
        if ((candidate.spouseIds || []).includes(personId)) ids.add(candidate.id);
      });
      (childrenByParent.get(personId) || []).forEach((child) => {
        [child.fatherId, child.motherId].forEach((parentId) => {
          if (parentId && parentId !== personId && personMap.has(parentId)) {
            ids.add(parentId);
          }
        });
      });
      ids.delete(personId);
      return [...ids].filter((id) => personMap.has(id));
    };
    const partnershipComponent = (startId) => {
      const component = new Set();
      const queue = [startId];
      while (queue.length) {
        const personId = queue.shift();
        if (!personId || component.has(personId)) continue;
        component.add(personId);
        unionNeighbours(personId).forEach((partnerId) => {
          if (!component.has(partnerId)) queue.push(partnerId);
        });
      }
      return [...component];
    };
    const pairKey = (ids) => [...ids].sort().join("::");
    const rendered = new Set();

    const renderHousehold = (startId, trail = new Set()) => {
      if (!personMap.has(startId) || rendered.has(startId) || trail.has(startId)) {
        return null;
      }
      const memberIds = partnershipComponent(startId);
      const memberSet = new Set(memberIds);
      memberIds.forEach((id) => rendered.add(id));

      const childGroups = new Map();
      relationalPeople.forEach((child) => {
        if (memberSet.has(child.id)) return;
        const parentIds = [child.fatherId, child.motherId].filter((id) =>
          memberSet.has(id),
        );
        if (!parentIds.length) return;
        const key = pairKey(parentIds);
        if (!childGroups.has(key)) {
          childGroups.set(key, { parentIds: [...new Set(parentIds)], children: [] });
        }
        childGroups.get(key).children.push(child);
      });

      const unionGroups = new Map(childGroups);
      memberIds.forEach((personId) => {
        unionNeighbours(personId).forEach((partnerId) => {
          if (!memberSet.has(partnerId)) return;
          const parentIds = [personId, partnerId].sort();
          const key = pairKey(parentIds);
          if (!unionGroups.has(key)) {
            unionGroups.set(key, { parentIds, children: [] });
          }
        });
      });
      if (!unionGroups.size) {
        unionGroups.set(startId, {
          parentIds: [startId],
          children: [],
        });
      }

      const nextTrail = new Set(trail);
      memberIds.forEach((id) => nextTrail.add(id));
      return (
        <div className="family-household" key={`household-${startId}`}>
          <div className={`family-household-unions ${unionGroups.size > 1 ? "multiple" : ""}`}>
            {[...unionGroups.entries()].map(([key, group]) => {
              const parentPeople = group.parentIds
                .map((id) => personMap.get(id))
                .filter(Boolean);
              const sortedChildren = [...group.children].sort((a, b) =>
                displayName(a).localeCompare(displayName(b)),
              );
              return (
                <div className="family-union-block" key={key}>
                  <div className={`family-parent-row ${parentPeople.length === 1 ? "single-parent" : ""}`}>
                    {parentPeople.map((person, index) => (
                      <span className="family-parent-node" key={`${key}-${person.id}`}>
                        {index > 0 && (
                          <span className="family-partner-link" aria-hidden="true" />
                        )}
                        {card(person)}
                      </span>
                    ))}
                  </div>
                  {sortedChildren.length > 0 && (
                    <>
                      <span className="family-union-stem" aria-hidden="true" />
                      <div
                        className={`family-children-branch ${sortedChildren.length === 1 ? "single" : ""}`}
                      >
                        {sortedChildren.map((child) => (
                          <div className="family-child-branch-item" key={child.id}>
                            <span
                              className="family-child-stem"
                              aria-hidden="true"
                            />
                            {renderHousehold(child.id, nextTrail) || card(child)}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    };

    const roots = relationalPeople
      .filter(
        (person) =>
          ![person.fatherId, person.motherId].some((id) => personMap.has(id)),
      )
      .sort((a, b) => displayName(a).localeCompare(displayName(b)));
    const forest = [];
    [...roots, ...relationalPeople].forEach((person) => {
      const household = renderHousehold(person.id);
      if (household) forest.push(household);
    });
    return <section className="tree-panel">
      <header className="tree-toolbar"><div><p className="eyebrow">Relational family record</p><h2>Family tree</h2></div><button type="button" className="secondary-button" onClick={() => onPrint(treeRef.current)}><Printer size={16} /> Print</button></header>
      <div className="family-chart" ref={treeRef}><div className="family-canvas relational-canvas"><h2 className="family-chart-title">Family tree</h2><div className="relational-forest">{forest}</div></div></div>
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
