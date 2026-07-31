import { useMemo } from "react";
import { buildFamilyTreeLayout } from "./treeLayout.js";
import "./LayeredFamilyTree.css";

/** Orthogonal connector: down, across, then down again. */
function elbowPath(from, to) {
  if (from.x === to.x) return `M ${from.x} ${from.y} V ${to.y}`;
  const midY = from.y + (to.y - from.y) / 2;
  return `M ${from.x} ${from.y} V ${midY} H ${to.x} V ${to.y}`;
}

function edgeClassName(edge) {
  return [
    "tree-edge",
    `tree-edge-${edge.kind}`,
    // Only a recorded unmarried couple is marked. A person with one unrecorded
    // parent is drawn exactly like anybody else.
    edge.flagged ? "flagged" : "",
    edge.kind === "partner" ? (edge.marital ? "marital" : "partnership") : "",
    // Colours the descent of each marriage so the children of one mother read
    // as a set even where the bars run close together.
    Number.isFinite(edge.marriageIndex) ? `marriage-${Math.min(edge.marriageIndex, 3)}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

const MARRIAGE_LINE_OFFSET = 2;

/**
 * A marriage is two parallel horizontal lines between the spouses; anyone not
 * married is joined by a single dotted line. Both read the same in black and
 * white, which colour alone did not.
 */
function PartnerLink({ edge }) {
  const left = Math.min(edge.from.x, edge.to.x);
  const right = Math.max(edge.from.x, edge.to.x);

  if (!edge.marital) {
    return (
      <line
        className="tree-edge tree-edge-partner partnership"
        x1={left}
        y1={edge.from.y}
        x2={right}
        y2={edge.from.y}
      />
    );
  }

  return (
    <g className="tree-edge-partner-pair">
      {[-MARRIAGE_LINE_OFFSET, MARRIAGE_LINE_OFFSET].map((offset) => (
        <line
          className="tree-edge tree-edge-partner marital"
          key={offset}
          x1={left}
          y1={edge.from.y + offset}
          x2={right}
          y2={edge.from.y + offset}
        />
      ))}
    </g>
  );
}

/**
 * Draws the whole family graph on absolute generation rows. Geometry comes from
 * treeLayout; this component only paints it and keeps the cards interactive.
 */
export function LayeredFamilyTree({ people = [], renderCard, emptyState = null }) {
  const layout = useMemo(() => buildFamilyTreeLayout(people), [people]);

  if (!layout.nodes.length) return emptyState;

  return (
    <div
      className="layered-family-tree"
      style={{ width: `${layout.width}px`, height: `${layout.height}px` }}
      data-generation-count={layout.generationCount}
    >
      <svg
        className="tree-edge-layer"
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        aria-hidden="true"
      >
        {layout.edges
          .filter((edge) => edge.kind === "partner")
          .map((edge) => (
            <PartnerLink edge={edge} key={edge.id} />
          ))}

        {layout.edges
          .filter((edge) => edge.kind === "stem")
          .map((edge) => (
            <path className={edgeClassName(edge)} key={edge.id} d={elbowPath(edge.from, edge.to)} />
          ))}

        {layout.edges
          .filter((edge) => edge.kind === "sibling-bar")
          .map((edge) => (
            <line
              className={edgeClassName(edge)}
              key={edge.id}
              x1={edge.from.x}
              y1={edge.from.y}
              x2={edge.to.x}
              y2={edge.to.y}
            />
          ))}

        {layout.edges
          .filter((edge) => edge.kind === "descent")
          .map((edge) => (
            <line
              className={edgeClassName(edge)}
              key={edge.id}
              x1={edge.from.x}
              y1={edge.from.y}
              x2={edge.to.x}
              y2={edge.to.y}
            />
          ))}
      </svg>

      {layout.nodes.map((node) => (
        <div
          className={`tree-node ${node.bornOutsideMarriage ? "born-outside-marriage" : ""}`}
          key={node.id}
          data-family-generation={node.generation}
          style={{
            left: `${node.x}px`,
            top: `${node.y}px`,
            width: `${node.width}px`,
            minHeight: `${node.height}px`,
          }}
        >
          {node.bornOutsideMarriage && (
            <span className="outside-marriage-badge" title="Born outside marriage">
              nm
            </span>
          )}
          {renderCard(node.person)}
        </div>
      ))}
    </div>
  );
}
