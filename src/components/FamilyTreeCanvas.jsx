import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Printer } from "lucide-react";
import {
  hasAnyDesignation,
  hasDesignation,
  personDesignations,
  personDisplayName,
} from "../domain/people.js";
import { openA3PrintPreview } from "../domain/a3PrintPreview.js";
import { DesignationFamilyTree } from "./familyTree/DesignationFamilyTree.jsx";
import { shouldUseDenseChildrenLayout } from "./familyTree/DenseChildrenBranch.jsx";
import { FamilyPersonCard } from "./familyTree/FamilyPersonCard.jsx";
import {
  alignFamilyGenerationRows,
  familyGenerationById,
  widestFamilyGeneration,
} from "./familyTree/generationRows.js";
import { RelationalFamilyTree } from "./familyTree/RelationalFamilyTree.jsx";
import { personCardName } from "./familyTree/treePresentation.js";
import { usePinchZoom } from "./familyTree/usePinchZoom.js";

function hasRelationalData(person) {
  return Boolean(
    person.id ||
    person.fullName ||
    person.fatherId ||
    person.motherId ||
    person.spouseIds?.length ||
    person.siblingIds?.length ||
    personDesignations(person).length,
  );
}

function hasRelationalLinks(person) {
  return Boolean(
    person.fatherId || person.motherId || person.spouseIds?.length || person.siblingIds?.length,
  );
}

function TreePanel({ title, eyebrow, treeRef, onPrint, relational, helperText, children }) {
  return (
    <section className="tree-panel">
      <header className="tree-toolbar">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <button type="button" className="secondary-button" onClick={() => onPrint(treeRef.current)}>
          <Printer size={16} /> Print preview
        </button>
      </header>
      <div className="family-chart" ref={treeRef}>
        <div className={`family-canvas ${relational ? "relational-canvas" : ""}`}>
          <h2 className="family-chart-title">{title}</h2>
          {children}
        </div>
      </div>
      <p className="helper-text">{helperText}</p>
    </section>
  );
}

export function FamilyTreeCanvas({
  treeTitle = "",
  people = [],
  ownershipByPerson = {},
  causaMortisCoverageByPerson = {},
  onPrint,
  selectedPersonId,
  onSelectPerson,
  personCardFields,
  propertyValue = 0,
  zoom = 100,
  onZoomChange,
}) {
  const treeRef = useRef(null);
  const cleanPeople = useMemo(
    () =>
      people.filter((person) => person.id || person.fullName || personDesignations(person).length),
    [people],
  );
  const peopleById = useMemo(
    () => new Map(cleanPeople.map((person) => [person.id, person])),
    [cleanPeople],
  );
  const displayNamesById = useMemo(
    () => new Map(cleanPeople.map((person) => [person.id, personDisplayName(person, cleanPeople)])),
    [cleanPeople],
  );
  const deceased = cleanPeople.find(
    (person) => person.isDeceased || hasDesignation(person, "Deceased"),
  );
  const displayName = (person) =>
    displayNamesById.get(person?.id) || personDisplayName(person, cleanPeople);
  const cardName = (person) => personCardName(person, cleanPeople, peopleById, displayNamesById);
  const title =
    String(treeTitle).trim() ||
    (deceased ? `Family Tree of ${displayName(deceased)}` : "Family tree");
  const printHandler = onPrint || ((node) => openA3PrintPreview(node, title));
  const relationalPeople = people.filter(hasRelationalData);
  const usesRelationalLayout = relationalPeople.some(hasRelationalLinks);
  const usesStackedLegalCards = shouldUseDenseChildrenLayout(relationalPeople.length);
  const generationByPerson = useMemo(
    () => familyGenerationById(relationalPeople),
    [relationalPeople],
  );
  const widestGeneration = useMemo(
    () => widestFamilyGeneration(generationByPerson),
    [generationByPerson],
  );

  useEffect(() => {
    if (!selectedPersonId || !treeRef.current) return;

    const selectedNode = [...treeRef.current.querySelectorAll("[data-person-id]")].find(
      (element) => element.dataset.personId === selectedPersonId,
    );
    selectedNode?.scrollIntoView?.({
      behavior: "smooth",
      block: "center",
      inline: "center",
    });
  }, [people, selectedPersonId]);

  usePinchZoom(treeRef, zoom, onZoomChange, usesRelationalLayout);

  useLayoutEffect(() => {
    if (!usesRelationalLayout || !treeRef.current) return undefined;

    const alignRows = () => alignFamilyGenerationRows(treeRef.current);
    let clearAlignment = alignRows();
    const realign = () => {
      clearAlignment();
      clearAlignment = alignRows();
    };
    const settlingTimers = [80, 220, 500].map((delay) => window.setTimeout(realign, delay));
    window.addEventListener("resize", realign);

    return () => {
      settlingTimers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("resize", realign);
      clearAlignment();
    };
  }, [
    causaMortisCoverageByPerson,
    generationByPerson,
    ownershipByPerson,
    personCardFields,
    propertyValue,
    usesRelationalLayout,
  ]);

  const renderCard = (person, variant = "") => (
    <FamilyPersonCard
      key={person.id}
      person={person}
      variant={variant}
      people={cleanPeople}
      cardName={cardName}
      ownershipByPerson={ownershipByPerson}
      causaMortisCoverageByPerson={causaMortisCoverageByPerson}
      personCardFields={personCardFields}
      propertyValue={propertyValue}
      selectedPersonId={selectedPersonId}
      onSelectPerson={onSelectPerson}
      stackedLegalDetails={usesStackedLegalCards}
      generation={generationByPerson.get(person.id) || 0}
      isWidestGeneration={generationByPerson.get(person.id) === widestGeneration}
    />
  );

  if (usesRelationalLayout) {
    return (
      <TreePanel
        title={title}
        eyebrow="Relational family record"
        treeRef={treeRef}
        onPrint={printHandler}
        relational
        helperText="Select a person in the index to locate and highlight them in this tree."
      >
        <RelationalFamilyTree
          people={relationalPeople}
          displayName={displayName}
          cardName={cardName}
          renderCard={renderCard}
        />
      </TreePanel>
    );
  }

  const related = (designations) =>
    cleanPeople.filter(
      (person) =>
        !person.isDeceased &&
        !hasDesignation(person, "Deceased") &&
        hasAnyDesignation(person, designations),
    );

  return (
    <TreePanel
      title={title}
      eyebrow="Visual family record"
      treeRef={treeRef}
      onPrint={printHandler}
      helperText="The diagram is a working visual aid. Dashed entries are connectors added only when a relative is needed to make another branch intelligible."
    >
      <DesignationFamilyTree
        deceased={deceased}
        focalPerson={deceased || cleanPeople[0]}
        spouses={related(["Surviving Spouse"])}
        children={related(["Child", "Children"])}
        grandchildren={related(["Grandchild", "Grandchildren"])}
        greatGrandchildren={related(["Great-Grandchild", "Great-Grandchildren"])}
        parents={related(["Parent", "Father", "Mother"])}
        grandparents={related(["Grandparent"])}
        siblings={related(["Sibling"])}
        nephews={related(["Nephew or Niece"])}
        uncles={related(["Uncle or Aunt"])}
        cousins={related(["Cousin"])}
        renderCard={renderCard}
      />
    </TreePanel>
  );
}
