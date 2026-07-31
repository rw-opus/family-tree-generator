import { useLayoutEffect, useRef, useState } from "react";
import { partnerRelationshipAnnotation } from "./partnerRelationship.js";
import { SvgPartnerRelationshipPath } from "./SvgPartnerRelationshipPath.jsx";
import "./CrossBranchUnionLayer.css";

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

function assignConnectorLanes(entries) {
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

function connectorPaths(first, second, descendant, lane) {
  const firstIsLeft = first.centerX <= second.centerX;
  const left = firstIsLeft ? first : second;
  const right = firstIsLeft ? second : first;
  const railY = Math.max(2, Math.min(left.top, right.top) - 10 - lane * 12);
  const startX = left.right;
  const endX = right.left;
  const junctionX = startX + (endX - startX) / 2;
  const partnerPath = `M ${startX} ${left.centerY} V ${railY} H ${endX} V ${right.centerY}`;
  let childPath = "";

  if (descendant) {
    const approachY = Math.max(railY, descendant.top - 12);
    childPath = `M ${junctionX} ${railY} V ${approachY} H ${descendant.centerX} V ${descendant.top}`;
  }

  return {
    partnerPath,
    childPath,
    junctionX,
    junctionY: railY,
    annotationX: junctionX,
    annotationY: railY - 6,
  };
}

export function CrossBranchUnionLayer({ unions, children }) {
  const layoutRef = useRef(null);
  const [geometry, setGeometry] = useState({
    width: 0,
    height: 0,
    unions: {},
  });

  useLayoutEffect(() => {
    const layout = layoutRef.current;
    if (!layout) return undefined;

    const measure = () => {
      if (!layout.offsetWidth || !layout.offsetHeight) return;

      const layoutRect = layout.getBoundingClientRect();
      const scaleX = layoutRect.width / layout.offsetWidth || 1;
      const scaleY = layoutRect.height / layout.offsetHeight || 1;
      const personNodes = [...layout.querySelectorAll("[data-person-id]")];
      const descendantNodes = [
        ...layout.querySelectorAll(".family-cross-union-descendants[data-cross-union-key]"),
      ];
      const measured = unions
        .map((union) => {
          const firstNode = personNodes.find(
            (element) => element.dataset.personId === union.parentIds[0],
          );
          const secondNode = personNodes.find(
            (element) => element.dataset.personId === union.parentIds[1],
          );
          if (!firstNode || !secondNode) return null;

          const first = relativeRect(firstNode, layoutRect, scaleX, scaleY);
          const second = relativeRect(secondNode, layoutRect, scaleX, scaleY);
          const descendantNode = descendantNodes.find(
            (element) => element.dataset.crossUnionKey === union.key,
          );

          return {
            key: union.key,
            first,
            second,
            descendant: descendantNode
              ? relativeRect(descendantNode, layoutRect, scaleX, scaleY)
              : null,
            spanStart: Math.min(first.centerX, second.centerX),
            spanEnd: Math.max(first.centerX, second.centerX),
          };
        })
        .filter(Boolean);
      const nextUnions = Object.fromEntries(
        assignConnectorLanes(measured).map((entry) => [
          entry.key,
          connectorPaths(entry.first, entry.second, entry.descendant, entry.lane),
        ]),
      );

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
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [unions]);

  return (
    <div className="family-relational-layout" ref={layoutRef}>
      <svg
        className="family-cross-union-connectors"
        aria-hidden="true"
        preserveAspectRatio="none"
        viewBox={`0 0 ${geometry.width || 1} ${geometry.height || 1}`}
      >
        {unions.map((union) => {
          const paths = geometry.unions[union.key] || {};

          return (
            <g
              className="family-cross-union"
              data-cross-union-key={union.key}
              data-first-person-id={union.parentIds[0]}
              data-second-person-id={union.parentIds[1]}
              key={union.key}
            >
              <SvgPartnerRelationshipPath
                className="family-cross-partner-link"
                d={paths.partnerPath || ""}
                relationship={union.relationship}
              />
              {partnerRelationshipAnnotation(union.relationship) && (
                <text
                  className="family-union-annotation svg-annotation"
                  x={paths.annotationX || 0}
                  y={paths.annotationY || 0}
                >
                  {partnerRelationshipAnnotation(union.relationship)}
                </text>
              )}
              {union.children.length > 0 && (
                <path className="family-cross-child-link" d={paths.childPath || ""} />
              )}
              <circle
                className="family-cross-union-junction"
                cx={paths.junctionX || 0}
                cy={paths.junctionY || 0}
                r="4"
              />
            </g>
          );
        })}
      </svg>
      {children}
    </div>
  );
}
