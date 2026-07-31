import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { partnerRelationshipAnnotation } from "./partnerRelationship.js";
import { SvgPartnerRelationshipPath } from "./SvgPartnerRelationshipPath.jsx";
import "./MultiplePartnerHousehold.css";

export function anchoredBranchOffset(anchorRect, branchRect, scaleX = 1) {
  const anchorCenter = anchorRect.left + anchorRect.width / 2;
  const branchCenter = branchRect.left + branchRect.width / 2;
  return (anchorCenter - branchCenter) / (scaleX || 1);
}

export function anchoredIncomingPath(anchorRect, layoutRect, scaleX = 1, scaleY = 1) {
  const anchorCenter = (anchorRect.left - layoutRect.left + anchorRect.width / 2) / (scaleX || 1);
  const anchorTop = (anchorRect.top - layoutRect.top) / (scaleY || 1);

  return anchorTop > 0 ? `M ${anchorCenter} 0 V ${anchorTop}` : "";
}

export function descendantChildPath({
  junctionX,
  junctionY,
  descendantsCenter,
  descendantsTop,
  denseLayout,
}) {
  if (!denseLayout) return `M ${junctionX} ${junctionY} V ${descendantsTop}`;

  const approachY = Math.max(junctionY, descendantsTop - 12);
  return `M ${junctionX} ${junctionY} V ${approachY} H ${descendantsCenter} V ${descendantsTop}`;
}

function rectanglesOverlapHorizontally(first, second) {
  return Math.min(first.right, second.right) > Math.max(first.left, second.left);
}

export function denseDescendantLaneOffsets(columns, verticalGap = 6) {
  const placedCards = [];
  const offsets = {};

  [...columns]
    .sort((first, second) => first.left - second.left)
    .forEach((column) => {
      const forbiddenOffsets = [];

      column.cards.forEach((card) => {
        placedCards.forEach((placedCard) => {
          if (!rectanglesOverlapHorizontally(card, placedCard)) return;

          const start = placedCard.top - verticalGap - card.bottom;
          const end = placedCard.bottom + verticalGap - card.top;
          if (end > 0) forbiddenOffsets.push({ start, end });
        });
      });

      let offset = 0;
      forbiddenOffsets
        .sort((first, second) => first.start - second.start || first.end - second.end)
        .forEach((interval) => {
          if (offset >= interval.start && offset < interval.end) {
            offset = interval.end;
          }
        });
      offset = Math.max(0, Math.ceil(offset));
      offsets[column.key] = offset;
      column.cards.forEach((card) => {
        placedCards.push({
          ...card,
          top: card.top + offset,
          bottom: card.bottom + offset,
        });
      });
    });

  return offsets;
}

function laneOffsetsChanged(current, next) {
  const keys = new Set([...Object.keys(current), ...Object.keys(next)]);
  return [...keys].some((key) => (current[key] || 0) !== (next[key] || 0));
}

function relationshipOrder(group) {
  const relationship = group.relationship || {};
  return (
    relationship.startDate || (relationship.startYear ? `${relationship.startYear}-00-00` : "")
  );
}

export function MultiplePartnerHousehold({
  anchor,
  branchAnchor = anchor,
  denseLayout = false,
  groups,
  renderCard,
}) {
  const layoutRef = useRef(null);
  const [connectorGeometry, setConnectorGeometry] = useState({
    width: 0,
    height: 0,
    incomingPath: "",
    unions: {},
  });
  const [descendantLaneOffsets, setDescendantLaneOffsets] = useState({});
  const orderedGroups = useMemo(
    () =>
      [...groups].sort((first, second) => {
        const firstDate = relationshipOrder(first);
        const secondDate = relationshipOrder(second);
        if (firstDate && secondDate && firstDate !== secondDate) {
          return firstDate.localeCompare(secondDate);
        }
        if (firstDate !== secondDate) return firstDate ? -1 : 1;
        return first.partnerName.localeCompare(second.partnerName);
      }),
    [groups],
  );
  const leftCount = Math.floor(orderedGroups.length / 2);
  const positionedGroups = useMemo(
    () => [
      ...orderedGroups.slice(0, leftCount).map((group, sideIndex) => ({
        ...group,
        side: "left",
        sideIndex: leftCount - sideIndex - 1,
      })),
      ...orderedGroups.slice(leftCount).map((group, sideIndex) => ({
        ...group,
        side: "right",
        sideIndex,
      })),
    ],
    [leftCount, orderedGroups],
  );
  const railLevels = Math.max(leftCount, orderedGroups.length - leftCount) - 1;

  useLayoutEffect(() => {
    const layout = layoutRef.current;
    if (!layout) return undefined;

    const measure = () => {
      const anchorNode = layout.querySelector(".family-multi-anchor-node > [data-person-id]");
      if (!anchorNode || !layout.offsetWidth || !layout.offsetHeight) return;

      const layoutRect = layout.getBoundingClientRect();
      const scaleX = layoutRect.width / layout.offsetWidth || 1;
      const scaleY = layoutRect.height / layout.offsetHeight || 1;
      const anchorRect = anchorNode.getBoundingClientRect();
      const anchorTop = (anchorRect.top - layoutRect.top) / scaleY;
      const anchorMiddle = anchorTop + anchorRect.height / scaleY / 2;
      const anchorLeft = (anchorRect.left - layoutRect.left) / scaleX;
      const anchorRight = anchorLeft + anchorRect.width / scaleX;
      const nextUnions = {};
      if (denseLayout) {
        const descendantColumns = positionedGroups
          .map((group) => {
            const descendants = [
              ...layout.querySelectorAll("[data-remarriage-descendants-key]"),
            ].find((element) => element.dataset.remarriageDescendantsKey === group.key);
            if (!descendants) return null;

            const currentOffset = descendantLaneOffsets[group.key] || 0;
            const descendantsRect = descendants.getBoundingClientRect();
            const cards = [...descendants.querySelectorAll("[data-person-id]")].map((card) => {
              const rect = card.getBoundingClientRect();
              return {
                left: (rect.left - layoutRect.left) / scaleX,
                right: (rect.right - layoutRect.left) / scaleX,
                top: (rect.top - layoutRect.top) / scaleY - currentOffset,
                bottom: (rect.bottom - layoutRect.top) / scaleY - currentOffset,
              };
            });

            return {
              key: group.key,
              left: (descendantsRect.left - layoutRect.left) / scaleX,
              cards,
            };
          })
          .filter(Boolean);
        const nextLaneOffsets = denseDescendantLaneOffsets(descendantColumns);

        if (laneOffsetsChanged(descendantLaneOffsets, nextLaneOffsets)) {
          setDescendantLaneOffsets(nextLaneOffsets);
          return;
        }
      }
      const branchItem = layout.closest(".family-child-branch-item");
      const branchAnchorNode = [...layout.querySelectorAll("[data-person-id]")].find(
        (element) => element.dataset.personId === branchAnchor.id,
      );
      let incomingPath = "";
      if (branchItem && branchAnchorNode) {
        const branchAnchorRect = branchAnchorNode.getBoundingClientRect();
        branchItem.style.setProperty(
          "--branch-anchor-offset",
          `${anchoredBranchOffset(branchAnchorRect, branchItem.getBoundingClientRect(), scaleX)}px`,
        );
        incomingPath = anchoredIncomingPath(branchAnchorRect, layoutRect, scaleX, scaleY);
      }

      positionedGroups.forEach((group) => {
        const union = [...layout.querySelectorAll("[data-remarriage-key]")].find(
          (element) => element.dataset.remarriageKey === group.key,
        );
        const partnerNode = [...(union?.querySelectorAll("[data-person-id]") || [])].find(
          (element) => element.dataset.personId === group.partner.id,
        );
        if (!partnerNode) return;

        const partnerRect = partnerNode.getBoundingClientRect();
        const partnerTop = (partnerRect.top - layoutRect.top) / scaleY;
        const partnerMiddle = partnerTop + partnerRect.height / scaleY / 2;
        const partnerLeft = (partnerRect.left - layoutRect.left) / scaleX;
        const partnerRight = partnerLeft + partnerRect.width / scaleX;
        const startsOnLeft = group.side === "left";
        const startX = startsOnLeft ? anchorLeft : anchorRight;
        const endX = startsOnLeft ? partnerRight : partnerLeft;
        let junctionX;
        let junctionY;
        let partnerPath;

        if (group.sideIndex === 0 && Math.abs(anchorMiddle - partnerMiddle) < 1) {
          junctionX = startX + (endX - startX) / 2;
          junctionY = anchorMiddle;
          partnerPath = `M ${startX} ${anchorMiddle} H ${endX}`;
        } else {
          const railY = Math.max(2, Math.min(anchorTop, partnerTop) - group.sideIndex * 14);
          junctionX = startX + (endX - startX) / 2;
          junctionY = railY;
          partnerPath = `M ${startX} ${anchorMiddle} V ${railY} H ${endX} V ${partnerMiddle}`;
        }

        const descendants = union.querySelector(".family-remarriage-descendants");
        const descendantsRect = descendants?.getBoundingClientRect();
        const descendantsTop = descendantsRect
          ? (descendantsRect.top - layoutRect.top) / scaleY
          : 0;
        const descendantsCenter = descendantsRect
          ? (descendantsRect.left - layoutRect.left + descendantsRect.width / 2) / scaleX
          : 0;
        const childOffset = junctionX - (partnerLeft + partnerRight) / 2;

        nextUnions[group.key] = {
          partnerPath,
          childPath:
            group.children.length && descendantsRect
              ? descendantChildPath({
                  junctionX,
                  junctionY,
                  descendantsCenter,
                  descendantsTop,
                  denseLayout,
                })
              : "",
          childOffset,
          junctionX,
          junctionY,
          annotationX: junctionX,
          annotationY: junctionY - 6,
        };
      });

      setConnectorGeometry({
        width: layout.offsetWidth,
        height: layout.offsetHeight,
        incomingPath,
        unions: nextUnions,
      });
    };

    measure();
    const observer = globalThis.ResizeObserver ? new ResizeObserver(measure) : null;
    observer?.observe(layout);
    window.addEventListener("resize", measure);

    return () => {
      layout.closest(".family-child-branch-item")?.style.removeProperty("--branch-anchor-offset");
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [branchAnchor.id, denseLayout, descendantLaneOffsets, positionedGroups]);

  return (
    <div
      className={`family-remarriage-layout ${denseLayout ? "dense" : ""}`}
      data-branch-anchor-id={branchAnchor.id}
      ref={layoutRef}
      style={{ "--remarriage-rail-space": `${Math.max(0, railLevels) * 14}px` }}
    >
      <svg
        className="family-remarriage-connectors"
        aria-hidden="true"
        preserveAspectRatio="none"
        viewBox={`0 0 ${connectorGeometry.width || 1} ${connectorGeometry.height || 1}`}
      >
        {connectorGeometry.incomingPath && (
          <path className="family-remarriage-incoming-link" d={connectorGeometry.incomingPath} />
        )}
        {positionedGroups.map((group) => {
          const geometry = connectorGeometry.unions[group.key] || {};

          return (
            <g
              className="family-remarriage-relationship"
              data-remarriage-relationship-key={group.key}
              key={group.key}
            >
              <SvgPartnerRelationshipPath
                className="family-remarriage-link"
                d={geometry.partnerPath || ""}
                relationship={group.relationship}
              />
              {partnerRelationshipAnnotation(group.relationship) && (
                <text
                  className="family-union-annotation svg-annotation"
                  x={geometry.annotationX || 0}
                  y={geometry.annotationY || 0}
                >
                  {partnerRelationshipAnnotation(group.relationship)}
                </text>
              )}
              {group.children.length > 0 && (
                <path className="family-remarriage-child-link" d={geometry.childPath || ""} />
              )}
              <circle
                className="family-remarriage-junction"
                cx={geometry.junctionX || 0}
                cy={geometry.junctionY || 0}
                r="4"
              />
            </g>
          );
        })}
      </svg>
      {positionedGroups.map((group, index) => {
        const order = index < leftCount ? index : index + 1;
        const childOffset = connectorGeometry.unions[group.key]?.childOffset || 0;

        return (
          <div
            className={`family-union-block family-remarriage-union ${group.side}`}
            data-remarriage-key={group.key}
            key={group.key}
            style={{ order }}
          >
            <div className="family-parent-row single-parent">
              <span className="family-parent-node">{renderCard(group.partner)}</span>
            </div>
            {group.children.length > 0 && (
              <div
                className="family-remarriage-descendants"
                data-remarriage-descendants-key={group.key}
                data-dense-lane-offset={denseLayout ? descendantLaneOffsets[group.key] || 0 : null}
                style={
                  denseLayout
                    ? { marginTop: `${descendantLaneOffsets[group.key] || 0}px` }
                    : { transform: `translateX(${childOffset}px)` }
                }
              >
                {group.childrenContent}
              </div>
            )}
          </div>
        );
      })}
      <span className="family-multi-anchor-node" style={{ order: leftCount }}>
        {renderCard(anchor)}
      </span>
    </div>
  );
}
