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

function UnionMarker({ union }) {
  if (union.parentIds.length !== 2) return null;

  const y = union.markerY ?? union.y;

  // Where somebody married more than once the marker is numbered, and the same
  // number is repeated on the bar their children hang from, so each child can
  // be read back to the right marriage.
  if (union.numbered) {
    return (
      <g className={`tree-union-marker numbered ${union.marital ? "marital" : "partnership"}`}>
        <circle cx={union.x} cy={y} r={8} />
        <text x={union.x} y={y} dy="0.34em" textAnchor="middle">
          {union.marriageIndex + 1}
        </text>
      </g>
    );
  }

  return (
    <g className={`tree-union-marker ${union.marital ? "marital" : "partnership"}`}>
      <circle cx={union.x} cy={y} r={union.marital ? 5 : 4} />
      {union.marital && <circle className="union-marker-inner" cx={union.x} cy={y} r={2} />}
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

  const partnerBarY = (union) => union.parentBottom - layout.nodes[0].height / 2;

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

        {layout.unions.map((union) => (
          <UnionMarker key={union.id} union={union} partnerBarY={partnerBarY(union)} />
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
