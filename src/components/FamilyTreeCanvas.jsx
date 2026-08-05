import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Move, Printer } from "lucide-react";
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
  gestureSurfaceRef,
  onPrint,
  relational,
  helperText,
  toolbar,
  navigation,
  navigator,
  children,
}) {
  return (
    <section className="tree-panel" ref={gestureSurfaceRef}>
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
  const gestureSurfaceRef = useRef(null);
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
    const gestureSurface = gestureSurfaceRef.current;
    if (!chart || !gestureSurface) return undefined;
    let suppressClickUntil = 0;
    const beginDrag = ({ id, pointerType, clientX, clientY }) => {
      dragRef.current = {
        id,
        pointerType,
        x: clientX,
        y: clientY,
        left: chart.scrollLeft,
        top: chart.scrollTop,
        moved: false,
      };
      chart.classList.add("is-panning");
      setPanHintVisible(false);
    };
    const moveDrag = (clientX, clientY, event) => {
      const state = dragRef.current;
      if (!state) return;
      const deltaX = clientX - state.x;
      const deltaY = clientY - state.y;
      if (state.pointerType !== "mouse" && !state.moved && Math.hypot(deltaX, deltaY) < 4) return;
      state.moved = true;
      event.preventDefault();
      chart.scrollLeft = state.left - deltaX;
      chart.scrollTop = state.top - deltaY;
      setPanHintVisible(false);
    };
    const finishDrag = () => {
      const movedByTouch =
        dragRef.current?.pointerType === "touch" && dragRef.current.moved === true;
      dragRef.current = null;
      chart.classList.remove("is-panning");
      if (movedByTouch) suppressClickUntil = Date.now() + 500;
    };
    const startPointerDrag = (event) => {
      if (event.pointerType === "touch") return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (event.target.closest("button, input, select, textarea, a, label")) return;
      beginDrag({
        id: event.pointerId,
        pointerType: event.pointerType || "mouse",
        clientX: event.clientX,
        clientY: event.clientY,
      });
      chart.setPointerCapture?.(event.pointerId);
    };
    const movePointerDrag = (event) => {
      const state = dragRef.current;
      if (!state || state.pointerType === "touch" || state.id !== event.pointerId) return;
      moveDrag(event.clientX, event.clientY, event);
    };
    const stopPointerDrag = (event) => {
      const state = dragRef.current;
      if (!state || state.pointerType === "touch" || state.id !== event.pointerId) return;
      finishDrag();
      chart.releasePointerCapture?.(event.pointerId);
    };
    const startTouchDrag = (event) => {
      if (event.touches.length !== 1) {
        if (dragRef.current?.pointerType === "touch") finishDrag();
        return;
      }
      const touch = event.touches[0];
      beginDrag({
        id: touch.identifier,
        pointerType: "touch",
        clientX: touch.clientX,
        clientY: touch.clientY,
      });
    };
    const moveTouchDrag = (event) => {
      const state = dragRef.current;
      if (!state || state.pointerType !== "touch" || event.touches.length !== 1) return;
      const touch = Array.from(event.touches).find((item) => item.identifier === state.id);
      if (!touch) return;
      moveDrag(touch.clientX, touch.clientY, event);
    };
    const stopTouchDrag = (event) => {
      const state = dragRef.current;
      if (!state || state.pointerType !== "touch") return;
      const touchStillActive = Array.from(event.touches).some(
        (item) => item.identifier === state.id,
      );
      if (!touchStillActive) finishDrag();
    };
    const suppressClickAfterPan = (event) => {
      if (Date.now() > suppressClickUntil) return;
      suppressClickUntil = 0;
      event.preventDefault();
      event.stopPropagation();
    };
    gestureSurface.addEventListener("pointerdown", startPointerDrag);
    gestureSurface.addEventListener("pointermove", movePointerDrag);
    gestureSurface.addEventListener("pointerup", stopPointerDrag);
    gestureSurface.addEventListener("pointercancel", stopPointerDrag);
    gestureSurface.addEventListener("touchstart", startTouchDrag, { passive: true });
    gestureSurface.addEventListener("touchmove", moveTouchDrag, { passive: false });
    gestureSurface.addEventListener("touchend", stopTouchDrag, { passive: true });
    gestureSurface.addEventListener("touchcancel", stopTouchDrag, { passive: true });
    gestureSurface.addEventListener("click", suppressClickAfterPan, true);
    return () => {
      gestureSurface.removeEventListener("pointerdown", startPointerDrag);
      gestureSurface.removeEventListener("pointermove", movePointerDrag);
      gestureSurface.removeEventListener("pointerup", stopPointerDrag);
      gestureSurface.removeEventListener("pointercancel", stopPointerDrag);
      gestureSurface.removeEventListener("touchstart", startTouchDrag);
      gestureSurface.removeEventListener("touchmove", moveTouchDrag);
      gestureSurface.removeEventListener("touchend", stopTouchDrag);
      gestureSurface.removeEventListener("touchcancel", stopTouchDrag);
      gestureSurface.removeEventListener("click", suppressClickAfterPan, true);
    };
  }, []);

  useEffect(() => {
    if (!selectedPersonId || !treeRef.current) return;

    centerPerson(selectedPersonId);
  }, [centerPerson, people, selectedPersonId]);

  usePinchZoom(gestureSurfaceRef, treeRef, zoom, onZoomChange, usesRelationalLayout);

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
        gestureSurfaceRef={gestureSurfaceRef}
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
      gestureSurfaceRef={gestureSurfaceRef}
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
