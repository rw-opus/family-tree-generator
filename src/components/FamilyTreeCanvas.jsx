import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Move, Printer } from "lucide-react";
import {
  hasAnyDesignation,
  hasDesignation,
  personDesignations,
  personDisplayName,
} from "../domain/people.js";
import { openA3PrintPreview } from "../domain/a3PrintPreview.js";
import {
  buildCurrentOwnerPresentations,
  ownerPresentationsById,
  ownershipShare,
} from "../domain/ownershipPresentation.js";
import { requiredSpouseDeathDatePersonIds } from "../domain/familyOwnership.js";
import { DesignationFamilyTree } from "./familyTree/DesignationFamilyTree.jsx";
import { FamilyPersonCard, familyPersonCardState } from "./familyTree/FamilyPersonCard.jsx";
import { familyGenerationById, widestFamilyGeneration } from "./familyTree/generationRows.js";
import { LayeredFamilyTree } from "./familyTree/LayeredFamilyTree.jsx";
import { capitalisedName, personCardName } from "./familyTree/treePresentation.js";
import { usePinchZoom } from "./familyTree/usePinchZoom.js";
import { PersonCardDisplayControl } from "./PersonCardDisplayControl.jsx";

// Shared frozen defaults. Written inline as `= {}` these produced a fresh
// object on every render, which alone was enough to defeat the memo on every
// person card below.
const NO_PEOPLE = Object.freeze([]);
const NO_LOOKUP = Object.freeze({});

function reuseUnchangedCardState(previous, next) {
  if (Object.is(previous, next)) return previous;
  if (Array.isArray(previous) && Array.isArray(next)) {
    if (previous.length !== next.length) return next;
    const values = next.map((value, index) => reuseUnchangedCardState(previous[index], value));
    return values.every((value, index) => value === previous[index]) ? previous : values;
  }
  if (
    !previous ||
    !next ||
    typeof previous !== "object" ||
    typeof next !== "object" ||
    Array.isArray(previous) ||
    Array.isArray(next)
  ) {
    return next;
  }
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  if (previousKeys.length !== nextKeys.length) return next;
  const values = {};
  let unchanged = true;
  for (const key of nextKeys) {
    if (!Object.prototype.hasOwnProperty.call(previous, key)) return next;
    const value = reuseUnchangedCardState(previous[key], next[key]);
    values[key] = value;
    if (value !== previous[key]) unchanged = false;
  }
  return unchanged ? previous : values;
}

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
  title,
  relational,
  helperText,
  toolbar,
  navigation,
  navigator,
  showActionRequiredKey,
  children,
}) {
  return (
    <section className="tree-panel" ref={gestureSurfaceRef}>
      <header className="tree-stage-toolbar tree-stage-toolbar-unified tree-panel-fixed-controls">
        {toolbar}
        <button
          type="button"
          className="secondary-button"
          aria-label="Print preview"
          title="Print the family tree at any stage"
          onClick={() => onPrint(treeRef.current)}
        >
          <Printer size={16} /> <span>Print preview</span>
        </button>
        {showActionRequiredKey && (
          <p className="tree-required-data-key">
            <span aria-hidden="true" />
            Red means action required
          </p>
        )}
      </header>
      {navigation}
      <div className="family-chart tree-canvas-scroll-region" ref={treeRef}>
        <div className={`family-canvas ${relational ? "relational-canvas" : ""}`}>
          <h2 className="family-chart-title family-chart-print-title">{title}</h2>
          {children}
        </div>
      </div>
      {navigator}
      <p className="helper-text">{helperText}</p>
    </section>
  );
}

export function FamilyTreeCanvas({
  treeTitle = "",
  people = NO_PEOPLE,
  legalWorkspaceEnabled = true,
  ownershipByPerson = NO_LOOKUP,
  ownershipFractionsByPerson = NO_LOOKUP,
  currentOwnershipByPerson = NO_LOOKUP,
  currentOwnerPresentationsByPerson = null,
  historicalLawWarningsByPerson = NO_LOOKUP,
  causaMortisCoverageByPerson = NO_LOOKUP,
  onPrint,
  selectedPersonId,
  onSelectPerson,
  onFocusPerson,
  personCardFields,
  onPersonCardFieldsChange,
  propertyValue = null,
  propertyId = "",
  ownershipSnapshotActive = false,
  zoom = 100,
  onZoomChange,
  toolbar,
}) {
  // These arrive as fresh closures on every render of the parent. Every person
  // card receives them, so reading them through a ref keeps the handlers the
  // cards actually see stable and lets their memo hold.
  const onSelectPersonRef = useRef(onSelectPerson);
  onSelectPersonRef.current = onSelectPerson;
  const onFocusPersonRef = useRef(onFocusPerson);
  onFocusPersonRef.current = onFocusPerson;
  const selectPerson = useCallback((personId) => onSelectPersonRef.current?.(personId), []);

  const treeRef = useRef(null);
  const gestureSurfaceRef = useRef(null);
  const dragRef = useRef(null);
  const lastCentredPersonRef = useRef("");
  const [panHintVisible, setPanHintVisible] = useState(true);
  const [navigatorState, setNavigatorState] = useState({ visible: false });
  const navigatorViewportRef = useRef(null);
  const cleanPeople = useMemo(
    () =>
      people.filter((person) => person.id || person.fullName || personDesignations(person).length),
    [people],
  );
  const displayNameCacheRef = useRef(new Map());
  const displayNamesById = useMemo(() => {
    const previousNames = displayNameCacheRef.current;
    const names = new Map();
    cleanPeople.forEach((person) => {
      const previous = previousNames.get(person.id);
      const name =
        previous?.person === person ? previous.name : personDisplayName(person, cleanPeople);
      names.set(person.id, name);
    });
    displayNameCacheRef.current = new Map(
      cleanPeople.map((person) => [person.id, { person, name: names.get(person.id) }]),
    );
    return names;
  }, [cleanPeople]);
  const deceased = cleanPeople.find(
    (person) => person.isDeceased || hasDesignation(person, "Deceased"),
  );
  const displayName = useCallback(
    (person) => displayNamesById.get(person?.id) || personDisplayName(person, cleanPeople),
    [cleanPeople, displayNamesById],
  );
  // Handed to every card, so a fresh identity here would defeat their memo.
  const cardName = useCallback(
    (person) => personCardName(person, cleanPeople, displayNamesById),
    [cleanPeople, displayNamesById],
  );
  const cardNameCacheRef = useRef(new Map());
  const cardNamesById = useMemo(() => {
    const previousNames = cardNameCacheRef.current;
    const names = new Map();
    cleanPeople.forEach((person) => {
      const previous = previousNames.get(person.id);
      const name = previous?.person === person ? previous.name : cardName(person);
      names.set(person.id, name);
    });
    cardNameCacheRef.current = new Map(
      cleanPeople.map((person) => [person.id, { person, name: names.get(person.id) }]),
    );
    return names;
  }, [cardName, cleanPeople]);
  const title =
    String(treeTitle).trim() ||
    (deceased ? `Family Tree of ${displayName(deceased)}` : "Family tree");
  const printHandler = onPrint || ((node) => openA3PrintPreview(node, title));
  const resolvedCurrentOwnerPresentationsByPerson = useMemo(() => {
    if (currentOwnerPresentationsByPerson) return currentOwnerPresentationsByPerson;
    const owners = Object.entries(currentOwnershipByPerson).map(([id, share]) => {
      const candidateFraction = ownershipFractionsByPerson[id];
      const exactShare = candidateFraction ? ownershipShare(share, candidateFraction) : Number.NaN;
      return {
        id,
        personId: id,
        share,
        shareFraction:
          Number.isFinite(exactShare) && Math.abs(exactShare - Number(share)) < 1e-12
            ? candidateFraction
            : null,
      };
    });
    return ownerPresentationsById(buildCurrentOwnerPresentations(owners, propertyValue));
  }, [
    currentOwnerPresentationsByPerson,
    currentOwnershipByPerson,
    ownershipFractionsByPerson,
    propertyValue,
  ]);
  // This array is the input to the tree layout engine and to the generation
  // maps below. Rebuilding it on every render gave it a fresh identity each
  // time, so every unrelated re-render -- a keystroke in the person inspector,
  // opening a dialog -- recomputed the whole tree geometry from scratch.
  const relationalPeople = useMemo(() => people.filter(hasRelationalData), [people]);
  const usesRelationalLayout = useMemo(
    () => relationalPeople.some(hasRelationalLinks),
    [relationalPeople],
  );
  const usesStackedLegalCards =
    legalWorkspaceEnabled && personCardFields?.stackLegalDetails === true;
  const generationByPerson = useMemo(
    () => familyGenerationById(relationalPeople),
    [relationalPeople],
  );
  const widestGeneration = useMemo(
    () => widestFamilyGeneration(generationByPerson),
    [generationByPerson],
  );
  const requiredSpouseDeathDateIds = useMemo(
    () => (legalWorkspaceEnabled ? requiredSpouseDeathDatePersonIds(cleanPeople) : new Set()),
    [cleanPeople, legalWorkspaceEnabled],
  );
  /**
   * Each person's legal card state, derived once per change to the family.
   *
   * Deriving it reads the whole people list (partner links, will chronology),
   * so doing it per card makes a render quadratic in the size of the tree --
   * and it used to be done twice over, once here for the legend and again
   * inside every card. The cards read their entry from this map instead.
   *
   * Keyed on the default (empty) variant. The designation layout renders its
   * focal person with variant "deceased", and that card derives its own state.
   */
  const cardStateCacheRef = useRef(new Map());
  const cardStateById = useMemo(() => {
    const previousStates = cardStateCacheRef.current;
    const states = new Map();
    cleanPeople.forEach((person) => {
      const nextState = familyPersonCardState({
        person,
        people: cleanPeople,
        legalWorkspaceEnabled,
        deathDateMissing: requiredSpouseDeathDateIds.has(person.id),
        historicalLawWarnings: historicalLawWarningsByPerson[person.id] || [],
        causaMortisCoverage: causaMortisCoverageByPerson[person.id] || [],
      });
      const excludedLinkedSpouseNames = nextState.excludedLinkedSpouses.map((spouse) =>
        capitalisedName(displayNamesById.get(spouse.id) || personDisplayName(spouse, cleanPeople)),
      );
      states.set(
        person.id,
        reuseUnchangedCardState(previousStates.get(person.id), {
          ...nextState,
          excludedLinkedSpouseNames,
        }),
      );
    });
    cardStateCacheRef.current = states;
    return states;
  }, [
    causaMortisCoverageByPerson,
    cleanPeople,
    displayNamesById,
    historicalLawWarningsByPerson,
    legalWorkspaceEnabled,
    requiredSpouseDeathDateIds,
  ]);

  const showActionRequiredKey = useMemo(
    () =>
      legalWorkspaceEnabled && [...cardStateById.values()].some((state) => state.redActionRequired),
    [cardStateById, legalWorkspaceEnabled],
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

  /**
   * The mini-map follows the scroll position, so this runs on every scroll
   * event — during a pan, that is every frame, on the same main thread that is
   * moving the tree. Two things stop it making the pan stutter on a phone.
   *
   * It coalesces to one animation frame, since a phone can deliver several
   * scroll events per frame and each one used to schedule work. And it
   * compares against what was last published: the previous version always
   * built a fresh object, so React could never bail out and re-rendered every
   * person card on every frame even when the mini-map had not visibly moved.
   */
  const navigatorFrameRef = useRef(0);
  const measureNavigator = useCallback(() => {
    const chart = treeRef.current;
    if (!chart) return;
    const scrollWidth = Math.max(1, chart.scrollWidth);
    const scrollHeight = Math.max(1, chart.scrollHeight);
    // A tenth of a percent is finer than the mini-map can draw, so sub-pixel
    // drift no longer costs a render of the whole tree.
    const round = (value) => Math.round(value * 10) / 10;
    const viewport = navigatorViewportRef.current;
    if (viewport) {
      viewport.style.left = `${round((chart.scrollLeft / scrollWidth) * 100)}%`;
      viewport.style.top = `${round((chart.scrollTop / scrollHeight) * 100)}%`;
      viewport.style.width = `${round(Math.min(100, (chart.clientWidth / scrollWidth) * 100))}%`;
      viewport.style.height = `${round(Math.min(100, (chart.clientHeight / scrollHeight) * 100))}%`;
    }

    // Only whether the mini-map exists at all is React's business. That changes
    // when the tree outgrows the viewport, not while a finger is moving.
    const visible = scrollWidth > chart.clientWidth + 2 || scrollHeight > chart.clientHeight + 2;
    setNavigatorState((current) => (current.visible === visible ? current : { visible }));
  }, []);

  const updateNavigator = useCallback(() => {
    if (navigatorFrameRef.current) return;
    navigatorFrameRef.current = window.requestAnimationFrame(() => {
      navigatorFrameRef.current = 0;
      measureNavigator();
    });
  }, [measureNavigator]);

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
    // A phone can deliver several touchmove events per displayed frame, and
    // writing scrollLeft forces layout each time. The latest position is kept
    // and applied once per frame instead, so the work per frame is constant
    // however fast the finger reports.
    let panFrame = 0;
    let panTarget = null;
    const applyPan = () => {
      panFrame = 0;
      if (!panTarget) return;
      chart.scrollLeft = panTarget.left;
      chart.scrollTop = panTarget.top;
      panTarget = null;
    };
    const moveDrag = (clientX, clientY, event) => {
      const state = dragRef.current;
      if (!state) return;
      const deltaX = clientX - state.x;
      const deltaY = clientY - state.y;
      // The same small threshold applies to every pointer type, so the slight
      // wobble of an ordinary click still selects the person underneath.
      if (!state.moved && Math.hypot(deltaX, deltaY) < 4) return;
      if (!state.moved) setPanHintVisible(false);
      state.moved = true;
      event.preventDefault();
      panTarget = { left: state.left - deltaX, top: state.top - deltaY };
      if (!panFrame) panFrame = window.requestAnimationFrame(applyPan);
    };
    const finishDrag = () => {
      // A pan that actually moved must not also select whatever it started on,
      // whichever pointer type made it.
      const panned = dragRef.current?.moved === true;
      dragRef.current = null;
      // Land on the last reported position rather than wherever the coalescing
      // frame happened to leave it.
      if (panFrame) window.cancelAnimationFrame(panFrame);
      applyPan();
      chart.classList.remove("is-panning");
      if (panned) suppressClickUntil = Date.now() + 500;
    };
    const startsInCardDisplayControl = (target) =>
      Boolean(target?.closest?.(".person-card-display-control"));
    const startPointerDrag = (event) => {
      if (event.pointerType === "touch") return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (startsInCardDisplayControl(event.target)) return;
      // Person cards are buttons and cover most of the canvas, so refusing to
      // pan from a button would leave dragging working only in the gaps.
      if (event.target.closest("input, select, textarea, a, label")) return;
      const button = event.target.closest("button");
      if (button && !button.hasAttribute("data-person-id")) return;
      beginDrag({
        id: event.pointerId,
        pointerType: event.pointerType || "mouse",
        clientX: event.clientX,
        clientY: event.clientY,
      });
    };
    const movePointerDrag = (event) => {
      const state = dragRef.current;
      if (!state || state.pointerType === "touch" || state.id !== event.pointerId) return;
      const wasPanning = state.moved;
      moveDrag(event.clientX, event.clientY, event);
      // Capture only once a pan has really started. Capturing on pointerdown
      // retargets the click to the chart, which stopped a plain click on a
      // person card from selecting that person.
      if (!wasPanning && dragRef.current?.moved) chart.setPointerCapture?.(event.pointerId);
    };
    const stopPointerDrag = (event) => {
      const state = dragRef.current;
      if (!state || state.pointerType === "touch" || state.id !== event.pointerId) return;
      finishDrag();
      if (chart.hasPointerCapture?.(event.pointerId)) chart.releasePointerCapture(event.pointerId);
    };
    const startTouchDrag = (event) => {
      if (event.touches.length !== 1) {
        if (dragRef.current?.pointerType === "touch") finishDrag();
        return;
      }
      // This disclosure and its scrollable checklist sit over the canvas, so
      // their touch gestures must never become tree pans.
      if (startsInCardDisplayControl(event.target)) return;
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
      if (panFrame) window.cancelAnimationFrame(panFrame);
    };
  }, []);

  // Centring follows the selection, never the person's data. Re-centring on
  // every people change dragged the view back to the selected card on each
  // keystroke, so a pan made while editing could not be held.
  useEffect(() => {
    if (!selectedPersonId) {
      lastCentredPersonRef.current = "";
      return;
    }
    if (!treeRef.current || lastCentredPersonRef.current === selectedPersonId) return;
    // A person added moments ago may not be rendered yet; the retry on the next
    // people change centres them once the card exists.
    if (centerPerson(selectedPersonId)) lastCentredPersonRef.current = selectedPersonId;
  }, [centerPerson, people, selectedPersonId]);

  usePinchZoom(gestureSurfaceRef, treeRef, zoom, onZoomChange, usesRelationalLayout);

  const handleCardKeyDown = useCallback((event, personId) => {
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
    (onFocusPersonRef.current || onSelectPersonRef.current)?.(targetId);
    window.requestAnimationFrame(() => {
      const next = [...(treeRef.current?.querySelectorAll("[data-person-id]") || [])].find(
        (node) => node.dataset.personId === targetId,
      );
      next?.focus({ preventScroll: true });
    });
  }, []);

  const keyboardFocusId = cleanPeople.some((person) => person.id === selectedPersonId)
    ? selectedPersonId
    : cleanPeople[0]?.id;

  // Stable across renders: LayeredFamilyTree re-measures every card in a layout
  // effect keyed on this function, so a fresh identity forced a full DOM
  // measuring pass and a rebuilt ResizeObserver on every render.
  const renderCard = useCallback(
    (person, variant = "") => (
      <FamilyPersonCard
        key={person.id}
        person={person}
        legalWorkspaceEnabled={legalWorkspaceEnabled}
        variant={typeof variant === "string" ? variant : ""}
        // Only the default variant is precomputed above; anything else derives
        // its own state inside the card.
        cardState={variant ? undefined : cardStateById.get(person.id)}
        // Default relational cards receive a precomputed state and display
        // strings. Keeping the full people array off their props lets React
        // retain every unaffected card after a small edit elsewhere.
        people={variant ? cleanPeople : undefined}
        displayName={displayNamesById.get(person.id) || ""}
        deathDateMissing={requiredSpouseDeathDateIds.has(person.id)}
        cardName={cardNamesById.get(person.id) || ""}
        ownershipByPerson={ownershipByPerson}
        ownershipFractionsByPerson={ownershipFractionsByPerson}
        currentOwnerPresentationsByPerson={resolvedCurrentOwnerPresentationsByPerson}
        propertyValue={propertyValue}
        historicalLawWarningsByPerson={historicalLawWarningsByPerson}
        causaMortisCoverageByPerson={causaMortisCoverageByPerson}
        personCardFields={personCardFields}
        propertyId={propertyId}
        ownershipSnapshotActive={ownershipSnapshotActive}
        // A boolean rather than the selected id, so changing the selection
        // re-renders the two cards that actually change, not all of them.
        isSelected={person.id === selectedPersonId}
        onSelectPerson={selectPerson}
        tabIndex={person.id === keyboardFocusId ? 0 : -1}
        onKeyDown={handleCardKeyDown}
        stackedLegalDetails={usesStackedLegalCards}
        generation={generationByPerson.get(person.id) || 0}
        isWidestGeneration={generationByPerson.get(person.id) === widestGeneration}
      />
    ),
    [
      cardNamesById,
      cardStateById,
      causaMortisCoverageByPerson,
      cleanPeople,
      displayNamesById,
      generationByPerson,
      handleCardKeyDown,
      historicalLawWarningsByPerson,
      keyboardFocusId,
      legalWorkspaceEnabled,
      ownershipByPerson,
      ownershipFractionsByPerson,
      ownershipSnapshotActive,
      propertyValue,
      personCardFields,
      propertyId,
      requiredSpouseDeathDateIds,
      resolvedCurrentOwnerPresentationsByPerson,
      selectPerson,
      selectedPersonId,
      usesStackedLegalCards,
      widestGeneration,
    ],
  );

  const navigation = (
    <div className="tree-navigation-tools" aria-label="Tree view controls">
      {onPersonCardFieldsChange && (
        <PersonCardDisplayControl
          fields={personCardFields}
          onChange={onPersonCardFieldsChange}
          legalWorkspaceEnabled={legalWorkspaceEnabled}
        />
      )}
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
      {/* Position is written straight to this node during a pan rather than
          held in state. It changes every frame, so as state it re-rendered the
          canvas and every person card on every frame of every drag. */}
      <span ref={navigatorViewportRef} className="tree-mini-map-viewport" />
    </button>
  ) : null;

  if (usesRelationalLayout) {
    return (
      <TreePanel
        treeRef={treeRef}
        gestureSurfaceRef={gestureSurfaceRef}
        onPrint={printHandler}
        title={title}
        relational
        helperText="Select a person in the index to locate and highlight them in this tree."
        toolbar={toolbar}
        navigation={navigation}
        navigator={navigator}
        showActionRequiredKey={showActionRequiredKey}
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
      title={title}
      helperText="The diagram is a working visual aid. Dashed entries are connectors added only when a relative is needed to make another branch intelligible."
      toolbar={toolbar}
      navigation={navigation}
      navigator={navigator}
      showActionRequiredKey={showActionRequiredKey}
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
