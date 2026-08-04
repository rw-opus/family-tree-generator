import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpToLine, GitBranch, LocateFixed, Maximize2, Move, Printer } from "lucide-react";
import {
  hasAnyDesignation,
  hasDesignation,
  personDesignations,
  personDisplayName,
} from "../domain/people.js";
import { openA3PrintPreview } from "../domain/a3PrintPreview.js";
import { DesignationFamilyTree } from "./familyTree/DesignationFamilyTree.jsx";
import { FamilyPersonCard } from "./familyTree/FamilyPersonCard.jsx";
import { familyGenerationById, widestFamilyGeneration } from "./familyTree/generationRows.js";
import { LayeredFamilyTree } from "./familyTree/LayeredFamilyTree.jsx";
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

function TreePanel({
  treeRef,
  onPrint,
  relational,
  helperText,
  toolbar,
  navigation,
  navigator,
  children,
}) {
  return (
    <section className="tree-panel">
      <header className="tree-stage-toolbar tree-stage-toolbar-unified tree-panel-fixed-controls">
        {toolbar}
        <button type="button" className="secondary-button" onClick={() => onPrint(treeRef.current)}>
          <Printer size={16} /> Print preview
        </button>
        <p className="tree-required-data-key">
          <span aria-hidden="true" />
          <strong>Red means action required:</strong> open that person&apos;s card and update the
          missing detail.
        </p>
      </header>
      {navigation}
      <div className="family-chart tree-canvas-scroll-region" ref={treeRef}>
        <div className={`family-canvas ${relational ? "relational-canvas" : ""}`}>{children}</div>
      </div>
      {navigator}
      <p className="helper-text">{helperText}</p>
    </section>
  );
}

export function FamilyTreeCanvas({
  treeTitle = "",
  people = [],
  ownershipByPerson = {},
  ownershipFractionsByPerson = {},
  currentOwnershipByPerson = {},
  causaMortisCoverageByPerson = {},
  onPrint,
  selectedPersonId,
  onSelectPerson,
  onFocusPerson,
  personCardFields,
  propertyValue = 0,
  ownershipSnapshotActive = false,
  zoom = 100,
  onZoomChange,
  toolbar,
}) {
  const treeRef = useRef(null);
  const dragRef = useRef(null);
  const [panHintVisible, setPanHintVisible] = useState(true);
  const [navigatorState, setNavigatorState] = useState({
    visible: false,
    left: 0,
    top: 0,
    width: 100,
    height: 100,
  });
  const cleanPeople = useMemo(
    () =>
      people.filter((person) => person.id || person.fullName || personDesignations(person).length),
    [people],
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
  const cardName = (person) => personCardName(person, cleanPeople, displayNamesById);
  const title =
    String(treeTitle).trim() ||
    (deceased ? `Family Tree of ${displayName(deceased)}` : "Family tree");
  const printHandler = onPrint || ((node) => openA3PrintPreview(node, title));
  const relationalPeople = people.filter(hasRelationalData);
  const usesRelationalLayout = relationalPeople.some(hasRelationalLinks);
  const usesStackedLegalCards = personCardFields?.stackLegalDetails === true;
  const generationByPerson = useMemo(
    () => familyGenerationById(relationalPeople),
    [relationalPeople],
  );
  const widestGeneration = useMemo(
    () => widestFamilyGeneration(generationByPerson),
    [generationByPerson],
  );

  const centerPerson = useCallback(
    (personId = selectedPersonId, behavior = "smooth") => {
      const chart = treeRef.current;
      if (!chart || !personId) return false;
      const selectedNode = [...chart.querySelectorAll("[data-person-id]")].find(
        (element) => element.dataset.personId === personId,
      );
      if (!selectedNode) return false;

      const chartRect = chart.getBoundingClientRect();
      const nodeRect = selectedNode.getBoundingClientRect();
      const left = Math.max(
        0,
        chart.scrollLeft +
          nodeRect.left -
          chartRect.left -
          (chart.clientWidth - nodeRect.width) / 2,
      );
      const top = Math.max(
        0,
        chart.scrollTop + nodeRect.top - chartRect.top - (chart.clientHeight - nodeRect.height) / 2,
      );
      if (typeof chart.scrollTo === "function") chart.scrollTo({ left, top, behavior });
      else {
        chart.scrollLeft = left;
        chart.scrollTop = top;
      }
      return true;
    },
    [selectedPersonId],
  );

  const afterZoom = useCallback((callback) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(callback));
  }, []);

  const fitWholeTree = useCallback(() => {
    const chart = treeRef.current;
    if (!chart || !onZoomChange) return;
    const renderedTree = chart.querySelector(".layered-family-tree");
    const canvas = chart.querySelector(".family-canvas");
    const currentScale = Math.max(0.1, Number(zoom) / 100 || 1);
    const rawWidth = renderedTree
      ? Number.parseFloat(renderedTree.style.width) || renderedTree.scrollWidth
      : Math.max(1, canvas?.scrollWidth || chart.scrollWidth) / currentScale;
    const rawHeight = renderedTree
      ? Number.parseFloat(renderedTree.style.height) || renderedTree.scrollHeight
      : Math.max(1, canvas?.scrollHeight || chart.scrollHeight) / currentScale;
    const availableWidth = Math.max(240, chart.clientWidth - 96);
    const availableHeight = Math.max(220, chart.clientHeight - 120);
    const nextZoom = Math.max(
      20,
      Math.min(
        140,
        Math.floor(Math.min(availableWidth / rawWidth, availableHeight / rawHeight) * 100),
      ),
    );
    onZoomChange(nextZoom);
    afterZoom(() => {
      const left = Math.max(0, (chart.scrollWidth - chart.clientWidth) / 2);
      if (typeof chart.scrollTo === "function")
        chart.scrollTo({ left, top: 0, behavior: "smooth" });
      else {
        chart.scrollLeft = left;
        chart.scrollTop = 0;
      }
    });
  }, [afterZoom, onZoomChange, zoom]);

  const selectedBranchIds = useMemo(() => {
    if (!selectedPersonId) return new Set();
    const ids = new Set([selectedPersonId]);
    const queue = [selectedPersonId];
    while (queue.length) {
      const parentId = queue.shift();
      cleanPeople.forEach((person) => {
        if ((person.fatherId === parentId || person.motherId === parentId) && !ids.has(person.id)) {
          ids.add(person.id);
          queue.push(person.id);
        }
      });
    }
    cleanPeople
      .filter((person) => ids.has(person.id))
      .flatMap((person) => person.spouseIds || [])
      .forEach((personId) => ids.add(personId));
    return ids;
  }, [cleanPeople, selectedPersonId]);

  const fitSelectedBranch = useCallback(() => {
    const chart = treeRef.current;
    if (!chart || !selectedPersonId || !onZoomChange) {
      fitWholeTree();
      return;
    }
    const nodes = [...chart.querySelectorAll("[data-person-id]")].filter((node) =>
      selectedBranchIds.has(node.dataset.personId),
    );
    if (!nodes.length) {
      fitWholeTree();
      return;
    }
    const rectangles = nodes.map((node) => node.getBoundingClientRect());
    const bounds = {
      left: Math.min(...rectangles.map((rect) => rect.left)),
      right: Math.max(...rectangles.map((rect) => rect.right)),
      top: Math.min(...rectangles.map((rect) => rect.top)),
      bottom: Math.max(...rectangles.map((rect) => rect.bottom)),
    };
    const branchWidth = Math.max(1, bounds.right - bounds.left);
    const branchHeight = Math.max(1, bounds.bottom - bounds.top);
    const factor = Math.min(
      Math.max(240, chart.clientWidth - 100) / branchWidth,
      Math.max(220, chart.clientHeight - 130) / branchHeight,
    );
    const nextZoom = Math.max(25, Math.min(160, Math.floor(Number(zoom) * factor)));
    onZoomChange(nextZoom);
    afterZoom(() => centerPerson(selectedPersonId));
  }, [
    afterZoom,
    centerPerson,
    fitWholeTree,
    onZoomChange,
    selectedBranchIds,
    selectedPersonId,
    zoom,
  ]);

  const updateNavigator = useCallback(() => {
    const chart = treeRef.current;
    if (!chart) return;
    const scrollWidth = Math.max(1, chart.scrollWidth);
    const scrollHeight = Math.max(1, chart.scrollHeight);
    setNavigatorState({
      visible: scrollWidth > chart.clientWidth + 2 || scrollHeight > chart.clientHeight + 2,
      left: (chart.scrollLeft / scrollWidth) * 100,
      top: (chart.scrollTop / scrollHeight) * 100,
      width: Math.min(100, (chart.clientWidth / scrollWidth) * 100),
      height: Math.min(100, (chart.clientHeight / scrollHeight) * 100),
    });
  }, []);

  useEffect(() => {
    const chart = treeRef.current;
    if (!chart) return undefined;
    const frame = window.requestAnimationFrame(updateNavigator);
    chart.addEventListener("scroll", updateNavigator, { passive: true });
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(updateNavigator) : null;
    observer?.observe(chart);
    return () => {
      window.cancelAnimationFrame(frame);
      chart.removeEventListener("scroll", updateNavigator);
      observer?.disconnect();
    };
  }, [people, updateNavigator, zoom]);

  useEffect(() => {
    const chart = treeRef.current;
    if (!chart) return undefined;
    const activeTouchPointers = new Set();
    let suppressClickUntil = 0;
    const startDrag = (event) => {
      const mousePointer = event.pointerType === "mouse";
      if (mousePointer && event.button !== 0) return;
      if (mousePointer && event.target.closest("button, input, select, textarea, a, label")) return;
      if (!mousePointer) {
        activeTouchPointers.add(event.pointerId);
        if (activeTouchPointers.size > 1) {
          const activeDrag = dragRef.current;
          if (activeDrag) chart.releasePointerCapture?.(activeDrag.pointerId);
          dragRef.current = null;
          chart.classList.remove("is-panning");
          return;
        }
      }
      dragRef.current = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        x: event.clientX,
        y: event.clientY,
        left: chart.scrollLeft,
        top: chart.scrollTop,
        moved: false,
      };
      chart.setPointerCapture?.(event.pointerId);
      chart.classList.add("is-panning");
      setPanHintVisible(false);
    };
    const drag = (event) => {
      const state = dragRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      if (state.pointerType !== "mouse" && activeTouchPointers.size > 1) return;
      const deltaX = event.clientX - state.x;
      const deltaY = event.clientY - state.y;
      if (state.pointerType !== "mouse" && !state.moved && Math.hypot(deltaX, deltaY) < 4) return;
      state.moved = true;
      event.preventDefault();
      chart.scrollLeft = state.left - deltaX;
      chart.scrollTop = state.top - deltaY;
      setPanHintVisible(false);
    };
    const stopDrag = (event) => {
      if (event.pointerType !== "mouse") activeTouchPointers.delete(event.pointerId);
      if (dragRef.current?.pointerId !== event.pointerId) return;
      const movedByTouch =
        dragRef.current.pointerType !== "mouse" && dragRef.current.moved === true;
      dragRef.current = null;
      chart.classList.remove("is-panning");
      chart.releasePointerCapture?.(event.pointerId);
      if (movedByTouch) suppressClickUntil = Date.now() + 500;
    };
    const suppressClickAfterPan = (event) => {
      if (Date.now() > suppressClickUntil) return;
      suppressClickUntil = 0;
      event.preventDefault();
      event.stopPropagation();
    };
    chart.addEventListener("pointerdown", startDrag);
    chart.addEventListener("pointermove", drag);
    chart.addEventListener("pointerup", stopDrag);
    chart.addEventListener("pointercancel", stopDrag);
    chart.addEventListener("click", suppressClickAfterPan, true);
    return () => {
      chart.removeEventListener("pointerdown", startDrag);
      chart.removeEventListener("pointermove", drag);
      chart.removeEventListener("pointerup", stopDrag);
      chart.removeEventListener("pointercancel", stopDrag);
      chart.removeEventListener("click", suppressClickAfterPan, true);
    };
  }, []);

  useEffect(() => {
    if (!selectedPersonId || !treeRef.current) return;

    centerPerson(selectedPersonId);
  }, [centerPerson, people, selectedPersonId]);

  usePinchZoom(treeRef, zoom, onZoomChange, usesRelationalLayout);

  const handleCardKeyDown = (event, personId) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const chart = treeRef.current;
    if (!chart) return;
    const current = [...chart.querySelectorAll("[data-person-id]")].find(
      (node) => node.dataset.personId === personId,
    );
    if (!current) return;
    const currentRect = current.getBoundingClientRect();
    const currentCentre = {
      x: currentRect.left + currentRect.width / 2,
      y: currentRect.top + currentRect.height / 2,
    };
    const candidates = [...chart.querySelectorAll("[data-person-id]")]
      .filter((node) => node !== current)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const dx = rect.left + rect.width / 2 - currentCentre.x;
        const dy = rect.top + rect.height / 2 - currentCentre.y;
        const eligible =
          (event.key === "ArrowLeft" && dx < -2) ||
          (event.key === "ArrowRight" && dx > 2) ||
          (event.key === "ArrowUp" && dy < -2) ||
          (event.key === "ArrowDown" && dy > 2);
        if (!eligible) return null;
        const primary =
          event.key === "ArrowLeft" || event.key === "ArrowRight" ? Math.abs(dx) : Math.abs(dy);
        const secondary =
          event.key === "ArrowLeft" || event.key === "ArrowRight" ? Math.abs(dy) : Math.abs(dx);
        return { node, score: primary + secondary * 0.45 };
      })
      .filter(Boolean)
      .sort((left, right) => left.score - right.score);
    const target = candidates[0]?.node;
    if (!target) return;
    event.preventDefault();
    const targetId = target.dataset.personId;
    (onFocusPerson || onSelectPerson)?.(targetId);
    window.requestAnimationFrame(() => {
      const next = [...(treeRef.current?.querySelectorAll("[data-person-id]") || [])].find(
        (node) => node.dataset.personId === targetId,
      );
      next?.focus({ preventScroll: true });
    });
  };

  const keyboardFocusId = cleanPeople.some((person) => person.id === selectedPersonId)
    ? selectedPersonId
    : cleanPeople[0]?.id;

  const scrollToTreeTop = () => {
    const chart = treeRef.current;
    if (!chart) return;
    if (typeof chart.scrollTo === "function") {
      chart.scrollTo({ left: chart.scrollLeft, top: 0, behavior: "smooth" });
    } else {
      chart.scrollTop = 0;
    }
  };

  const renderCard = (person, variant = "") => (
    <FamilyPersonCard
      key={person.id}
      person={person}
      variant={variant}
      people={cleanPeople}
      cardName={cardName}
      ownershipByPerson={ownershipByPerson}
      ownershipFractionsByPerson={ownershipFractionsByPerson}
      currentOwnershipByPerson={currentOwnershipByPerson}
      causaMortisCoverageByPerson={causaMortisCoverageByPerson}
      personCardFields={personCardFields}
      propertyValue={propertyValue}
      ownershipSnapshotActive={ownershipSnapshotActive}
      selectedPersonId={selectedPersonId}
      onSelectPerson={onSelectPerson}
      tabIndex={person.id === keyboardFocusId ? 0 : -1}
      onKeyDown={(event) => handleCardKeyDown(event, person.id)}
      stackedLegalDetails={usesStackedLegalCards}
      generation={generationByPerson.get(person.id) || 0}
      isWidestGeneration={generationByPerson.get(person.id) === widestGeneration}
    />
  );

  const navigation = (
    <div className="tree-navigation-tools" aria-label="Tree view controls">
      <button type="button" onClick={fitWholeTree} title="Fit the whole tree in view">
        <Maximize2 size={15} /> <span>Fit tree</span>
      </button>
      <button type="button" onClick={scrollToTreeTop} title="Move to the top of the tree">
        <ArrowUpToLine size={15} /> <span>Top</span>
      </button>
      <button
        type="button"
        onClick={fitSelectedBranch}
        disabled={!selectedPersonId}
        title="Fit the selected person and descendants in view"
      >
        <GitBranch size={15} /> <span>Fit branch</span>
      </button>
      <button
        type="button"
        onClick={() => centerPerson()}
        disabled={!selectedPersonId}
        title="Centre the selected person"
      >
        <LocateFixed size={15} /> <span>Centre</span>
      </button>
      {panHintVisible && (
        <span className="tree-pan-hint">
          <Move size={14} /> Drag or swipe to move
        </span>
      )}
    </div>
  );

  const navigator = navigatorState.visible ? (
    <button
      type="button"
      className="tree-mini-map"
      aria-label="Tree overview. Select a point to move there."
      title="Tree overview"
      onClick={(event) => {
        const chart = treeRef.current;
        if (!chart) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        chart.scrollTo({
          left: Math.max(0, x * chart.scrollWidth - chart.clientWidth / 2),
          top: Math.max(0, y * chart.scrollHeight - chart.clientHeight / 2),
          behavior: "smooth",
        });
      }}
    >
      <span
        className="tree-mini-map-viewport"
        style={{
          left: `${navigatorState.left}%`,
          top: `${navigatorState.top}%`,
          width: `${navigatorState.width}%`,
          height: `${navigatorState.height}%`,
        }}
      />
    </button>
  ) : null;

  if (usesRelationalLayout) {
    return (
      <TreePanel
        treeRef={treeRef}
        onPrint={printHandler}
        relational
        helperText="Select a person in the index to locate and highlight them in this tree."
        toolbar={toolbar}
        navigation={navigation}
        navigator={navigator}
      >
        <LayeredFamilyTree people={relationalPeople} renderCard={renderCard} zoom={zoom} />
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
      treeRef={treeRef}
      onPrint={printHandler}
      helperText="The diagram is a working visual aid. Dashed entries are connectors added only when a relative is needed to make another branch intelligible."
      toolbar={toolbar}
      navigation={navigation}
      navigator={navigator}
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
