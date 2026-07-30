import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { anchoredBranchOffset } from "./MultiplePartnerHousehold.jsx";
import "./PartnerNetworkHousehold.css";

function relativeRect(node, layoutRect, scaleX, scaleY) {
  const rect = node.getBoundingClientRect();
  const left = (rect.left - layoutRect.left) / scaleX;
  const top = (rect.top - layoutRect.top) / scaleY;
  const width = rect.width / scaleX;
  const height = rect.height / scaleY;

  return {
    left,
    right: left + width,
    top,
    bottom: top + height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}

function assignLanes(entries) {
  const laneEnds = [];

  return [...entries]
    .sort((first, second) => first.spanStart - second.spanStart)
    .map((entry) => {
      let lane = laneEnds.findIndex((end) => entry.spanStart > end + 12);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(entry.spanEnd);
      } else {
        laneEnds[lane] = entry.spanEnd;
      }
      return { ...entry, lane };
    });
}

export function PartnerNetworkHousehold({ anchor, people, groups, renderCard }) {
  const layoutRef = useRef(null);
  const [geometry, setGeometry] = useState({
    width: 0,
    height: 0,
    unions: {},
  });
  const pairGroupCount = groups.filter((group) => group.parentIds.length === 2).length;
  const orderedPeople = useMemo(() => [...people], [people]);

  useLayoutEffect(() => {
    const layout = layoutRef.current;
    if (!layout) return undefined;

    const measure = () => {
      if (!layout.offsetWidth || !layout.offsetHeight) return;

      const layoutRect = layout.getBoundingClientRect();
      const scaleX = layoutRect.width / layout.offsetWidth || 1;
      const scaleY = layoutRect.height / layout.offsetHeight || 1;
      const personRow = layout.querySelector(".family-partner-network-people");
      const personNodes = [...(personRow?.querySelectorAll("[data-person-id]") || [])];
      const personRects = new Map(
        personNodes.map((node) => [
          node.dataset.personId,
          relativeRect(node, layoutRect, scaleX, scaleY),
        ]),
      );
      const unionMarkers = [...layout.querySelectorAll("[data-partner-network-union-key]")];
      const anchorNode = personNodes.find((node) => node.dataset.personId === anchor.id);
      const branchItem = layout.closest(".family-child-branch-item");
      if (anchorNode && branchItem) {
        branchItem.style.setProperty(
          "--branch-anchor-offset",
          `${anchoredBranchOffset(
            anchorNode.getBoundingClientRect(),
            branchItem.getBoundingClientRect(),
            scaleX,
          )}px`,
        );
      }

      const measuredPairs = groups
        .filter((group) => group.parentIds.length === 2)
        .map((group) => {
          const first = personRects.get(group.parentIds[0]);
          const second = personRects.get(group.parentIds[1]);
          if (!first || !second) return null;
          return {
            group,
            first,
            second,
            spanStart: Math.min(first.centerX, second.centerX),
            spanEnd: Math.max(first.centerX, second.centerX),
          };
        })
        .filter(Boolean);
      const nextUnions = {};

      assignLanes(measuredPairs).forEach(({ group, first, second, lane }) => {
        const firstIsLeft = first.centerX <= second.centerX;
        const left = firstIsLeft ? first : second;
        const right = firstIsLeft ? second : first;
        const railY = Math.max(2, Math.min(left.top, right.top) - 10 - lane * 14);
        const startX = left.right;
        const endX = right.left;
        const junctionX = startX + (endX - startX) / 2;
        const marker = unionMarkers.find(
          (element) => element.dataset.partnerNetworkUnionKey === group.key,
        );
        const markerRect = marker ? relativeRect(marker, layoutRect, scaleX, scaleY) : null;
        const approachY = markerRect ? Math.max(railY, markerRect.top - 12) : 0;

        nextUnions[group.key] = {
          partnerPath: `M ${startX} ${left.centerY} V ${railY} H ${endX} V ${right.centerY}`,
          childPath:
            markerRect && group.children.length
              ? `M ${junctionX} ${railY} V ${approachY} H ${markerRect.centerX} V ${markerRect.top}`
              : "",
          junctionX,
          junctionY: railY,
        };
      });

      groups
        .filter((group) => group.parentIds.length === 1 && group.children.length)
        .forEach((group) => {
          const parent = personRects.get(group.parentIds[0]);
          const marker = unionMarkers.find(
            (element) => element.dataset.partnerNetworkUnionKey === group.key,
          );
          const markerRect = marker ? relativeRect(marker, layoutRect, scaleX, scaleY) : null;
          if (!parent || !markerRect) return;
          const approachY = Math.max(parent.bottom, markerRect.top - 12);
          nextUnions[group.key] = {
            partnerPath: "",
            childPath: `M ${parent.centerX} ${parent.bottom} V ${approachY} H ${markerRect.centerX} V ${markerRect.top}`,
            junctionX: parent.centerX,
            junctionY: parent.bottom,
          };
        });

      setGeometry({
        width: layout.offsetWidth,
        height: layout.offsetHeight,
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
  }, [anchor.id, groups, orderedPeople]);

  return (
    <div
      className="family-partner-network"
      ref={layoutRef}
      style={{ "--partner-network-rail-space": `${Math.max(0, pairGroupCount - 1) * 14}px` }}
    >
      <svg
        className="family-partner-network-connectors"
        aria-hidden="true"
        preserveAspectRatio="none"
        viewBox={`0 0 ${geometry.width || 1} ${geometry.height || 1}`}
      >
        {groups.map((group) => {
          const paths = geometry.unions[group.key] || {};

          return (
            <g
              className="family-partner-network-relationship"
              data-partner-network-relationship-key={group.key}
              key={group.key}
            >
              {group.parentIds.length === 2 && (
                <path className="family-partner-network-link" d={paths.partnerPath || ""} />
              )}
              {group.children.length > 0 && (
                <path className="family-partner-network-child-link" d={paths.childPath || ""} />
              )}
              <circle
                className="family-partner-network-junction"
                cx={paths.junctionX || 0}
                cy={paths.junctionY || 0}
                r="4"
              />
            </g>
          );
        })}
      </svg>
      <div className="family-partner-network-people">
        {orderedPeople.map((person) => (
          <span
            className={`family-partner-network-person ${person.id === anchor.id ? "anchor" : ""}`}
            key={person.id}
          >
            {renderCard(person)}
          </span>
        ))}
      </div>
      {groups.some((group) => group.children.length) && (
        <div className="family-partner-network-unions">
          {groups
            .filter((group) => group.children.length)
            .map((group) => (
              <div
                className="family-partner-network-union"
                data-partner-network-union-key={group.key}
                key={group.key}
              >
                {group.childrenContent}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
