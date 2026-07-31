import { useEffect, useMemo, useRef, useState } from "react";
import "family-chart/styles/family-chart.css";
import { buildFamilyChartData, familyChartRelationship } from "./familyChartData.js";
import "./OpenSourceFamilyChart.css";

function relationDatumIds(linkDatum) {
  const source = Array.isArray(linkDatum?.source) ? linkDatum.source[0] : linkDatum?.source;
  const target = Array.isArray(linkDatum?.target) ? linkDatum.target[0] : linkDatum?.target;
  return [source?.data?.id, target?.data?.id];
}

function styleRelationshipLinks(host, relationshipByPair) {
  host.querySelectorAll("path.link").forEach((path) => {
    const datum = path.__data__;
    path.classList.toggle("genealogy-union-link", Boolean(datum?.spouse));
    path.classList.toggle("genealogy-descent-link", !datum?.spouse);
    if (!datum?.spouse) return;

    const [firstId, secondId] = relationDatumIds(datum);
    const relationship = familyChartRelationship(relationshipByPair, firstId, secondId);
    path.classList.toggle("marriage", relationship.type !== "partnership");
    path.classList.toggle("partnership", relationship.type === "partnership");
  });

  host.querySelectorAll("g.link-text").forEach((label) => {
    const nodes = label.__data__?.nodes || [];
    const relationship = familyChartRelationship(
      relationshipByPair,
      nodes[0]?.data?.id,
      nodes[1]?.data?.id,
    );
    label.classList.toggle("marriage", relationship.type !== "partnership");
    label.classList.toggle("partnership", relationship.type === "partnership");
  });
}

function sortByName(first, second) {
  return String(first?.data?.sortName || "").localeCompare(
    String(second?.data?.sortName || ""),
    "en-MT",
  );
}

function centerPersonCard(host, personId) {
  const scroller = host.closest(".family-chart");
  const cards = [...host.querySelectorAll("[data-person-id]")];
  const card = cards.find((candidate) => candidate.dataset.personId === personId) || cards[0];
  if (!scroller || !card) return;

  const scrollerRect = scroller.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  scroller.scrollLeft +=
    cardRect.left + cardRect.width / 2 - (scrollerRect.left + scroller.clientWidth / 2);
  scroller.scrollTop = Math.max(
    0,
    scroller.scrollTop + cardRect.top - scrollerRect.top - Math.min(150, scroller.clientHeight / 4),
  );
}

function layoutCoversEveryPerson(familyChart, prepared) {
  const probe = familyChart.createStore({
    data: prepared.data,
    main_id: prepared.rootId,
    node_separation: 124,
    level_separation: 150,
    single_parent_empty_card: false,
    is_horizontal: false,
    show_siblings_of_main: true,
  });
  probe.updateTree();
  const renderedIds = probe.getTree()?.data.map((datum) => datum.data.id) || [];
  return (
    renderedIds.length === prepared.data.length &&
    new Set(renderedIds).size === prepared.data.length
  );
}

/**
 * Dense genealogy view backed by the MIT-licensed family-chart layout engine.
 * The engine supplies proven spouse/descendant geometry; the application still
 * owns every card, click action, legal field, ownership figure and print flow.
 */
export function OpenSourceFamilyChart({
  people,
  renderCard,
  onSelectPerson,
  focusPersonId = "",
  fallback = null,
}) {
  const hostRef = useRef(null);
  const renderCardRef = useRef(renderCard);
  const onSelectPersonRef = useRef(onSelectPerson);
  const focusPersonIdRef = useRef(focusPersonId);
  const [fallbackStructureKey, setFallbackStructureKey] = useState("");
  const prepared = useMemo(() => buildFamilyChartData(people), [people]);
  const fallbackRequired = fallbackStructureKey === prepared.structureKey;

  useEffect(() => {
    renderCardRef.current = renderCard;
    onSelectPersonRef.current = onSelectPerson;
    focusPersonIdRef.current = focusPersonId;
  }, [focusPersonId, onSelectPerson, renderCard]);

  useEffect(() => {
    if (fallbackRequired) return undefined;
    const host = hostRef.current;
    if (!host || !prepared.data.length) return undefined;

    let disposed = false;
    host.replaceChildren();
    host.dataset.loading = "true";

    const mountChart = async () => {
      const [familyChart, { renderToStaticMarkup }] = await Promise.all([
        import("family-chart"),
        import("react-dom/server"),
      ]);
      if (disposed) return;
      if (!layoutCoversEveryPerson(familyChart, prepared)) {
        setFallbackStructureKey(prepared.structureKey);
        return;
      }

      const chart = familyChart
        .createChart(host, prepared.data)
        .setTransitionTime(0)
        .setOrientationVertical()
        .setSingleParentEmptyCard(false)
        .setShowSiblingsOfMain(true)
        .setCardXSpacing(124)
        .setCardYSpacing(210)
        .setSortChildrenFunction(sortByName)
        .setSortSpousesFunction((datum, data) => {
          datum.rels.spouses.sort((firstId, secondId) => {
            const firstRelationship = familyChartRelationship(
              prepared.relationshipByPair,
              datum.id,
              firstId,
            );
            const secondRelationship = familyChartRelationship(
              prepared.relationshipByPair,
              datum.id,
              secondId,
            );
            const dateComparison = String(firstRelationship.startDate || "").localeCompare(
              String(secondRelationship.startDate || ""),
            );
            if (dateComparison) return dateComparison;
            return sortByName(
              data.find((person) => person.id === firstId),
              data.find((person) => person.id === secondId),
            );
          });
        })
        .setLinkSpouseText(
          (first, second) =>
            familyChartRelationship(prepared.relationshipByPair, first.data.id, second.data.id)
              .annotation,
        );

      chart
        .setCardHtml()
        .setCardDim({ width: 112, height: 42, height_auto: true })
        .setCardInnerHtmlCreator((datum) => {
          const person = datum.data.data.person;
          return person ? renderToStaticMarkup(renderCardRef.current(person)) : "";
        })
        .setOnCardClick((event, datum) => {
          event.preventDefault();
          onSelectPersonRef.current?.(datum.data.id);
        });

      const zoomCanvas = host.querySelector("#f3Canvas");
      zoomCanvas?.__zoomObj?.filter?.(() => false);

      chart.setAfterUpdate(() => {
        styleRelationshipLinks(host, prepared.relationshipByPair);
      });
      chart.updateTree({ initial: true, transition_time: 0 });

      const cardHeights = [...host.querySelectorAll("[data-person-id]")].map(
        (card) => card.getBoundingClientRect().height,
      );
      const tallestCard = cardHeights.length ? Math.max(...cardHeights) : 70;
      chart.setCardYSpacing(Math.min(210, Math.max(116, Math.ceil(tallestCard + 38))));
      chart.updateTree({ tree_position: "fit", transition_time: 0 });

      const dimensions = chart.store.getTree()?.dim;
      if (dimensions) {
        host.style.width = `${Math.ceil(dimensions.width + 96)}px`;
        host.style.height = `${Math.ceil(dimensions.height + 96)}px`;
        chart.updateTree({ tree_position: "fit", transition_time: 0 });
      }

      delete host.dataset.loading;
      host.dataset.ready = "true";
      window.requestAnimationFrame(() => {
        if (!disposed) centerPersonCard(host, focusPersonIdRef.current || prepared.rootId);
      });
    };

    mountChart().catch(() => {
      if (disposed) return;
      delete host.dataset.loading;
      host.dataset.error = "true";
      host.textContent = "The genealogy layout could not be loaded.";
    });

    return () => {
      disposed = true;
      host.replaceChildren();
      host.style.removeProperty("width");
      host.style.removeProperty("height");
      delete host.dataset.loading;
      delete host.dataset.ready;
      delete host.dataset.error;
    };
  }, [fallbackRequired, prepared]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !focusPersonId) return undefined;

    const frame = window.requestAnimationFrame(() => {
      if (host.dataset.ready === "true") centerPersonCard(host, focusPersonId);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusPersonId]);

  if (fallbackRequired) return fallback;

  return (
    <div className="genealogy-layout-shell" data-genealogy-renderer="family-chart">
      <div className="f3 genealogy-layout" ref={hostRef} />
    </div>
  );
}
