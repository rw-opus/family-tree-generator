import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { buildFamilyTreeLayout } from "./treeLayout.js";
import "./LayeredFamilyTree.css";

function stemPath(edge) {
  if (Number.isFinite(edge.turnY) && edge.from.x !== edge.to.x) {
    return `M ${edge.from.x} ${edge.from.y} V ${edge.turnY} H ${edge.to.x} V ${edge.to.y}`;
  }
  return `M ${edge.from.x} ${edge.from.y} V ${edge.to.y}`;
}

function edgeClassName(edge) {
  return [
    "tree-edge",
    `tree-edge-${edge.kind}`,
    edge.kind === "partner" ? (edge.marital ? "marital" : "partnership") : "",
  ]
    .filter(Boolean)
    .join(" ");
}

const MARRIAGE_LINE_OFFSET = 2;
const PARTNER_ROUTE_CLEARANCE = 7;

function layoutSignature(person) {
  return [
    person.id,
    person.fatherId || "",
    person.motherId || "",
    ...(person.spouseIds || []),
    "|",
    ...(person.siblingIds || []),
    "|",
    ...(person.partnerRelationships || []).map((relationship) =>
      [
        relationship.personId || "",
        relationship.type || "",
        relationship.startDate || "",
        relationship.endDate || "",
        relationship.endReason || "",
      ].join(":"),
    ),
  ].join("\u0001");
}

/**
 * A marriage is two parallel horizontal lines between the spouses; anyone not
 * married is joined by a single dotted line. Both read the same in black and
 * white, which colour alone did not.
 */
function PartnerLink({ edge }) {
  const left = Math.min(edge.from.x, edge.to.x);
  const right = Math.max(edge.from.x, edge.to.x);

  if (edge.route === "over") {
    // Come down in the gap beside the far spouse and turn into the side of the
    // box, rather than descending onto its centre from above.
    const turn = right - PARTNER_ROUTE_CLEARANCE;

    if (!edge.marital) {
      return (
        <path
          className="tree-edge tree-edge-partner partnership"
          d={`M ${left} ${edge.from.y} V ${edge.routeY} H ${turn} V ${edge.to.y} H ${right}`}
        />
      );
    }

    return (
      <g className="tree-edge-partner-pair">
        {[-MARRIAGE_LINE_OFFSET, MARRIAGE_LINE_OFFSET].map((offset) => (
          <path
            className="tree-edge tree-edge-partner marital"
            key={offset}
            d={`M ${left} ${edge.from.y + offset} V ${edge.routeY + offset} H ${
              turn + offset
            } V ${edge.to.y + offset} H ${right}`}
          />
        ))}
      </g>
    );
  }

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
export function LayeredFamilyTree({ people = [], renderCard, emptyState = null, zoom = 100 }) {
  const treeRef = useRef(null);
  const [nodeSizes, setNodeSizes] = useState({});
  const layoutPeopleCacheRef = useRef({ people: [], entries: new Map() });
  const layoutPeople = useMemo(() => {
    const previous = layoutPeopleCacheRef.current;
    const entries = new Map();
    const nextPeople = people.map((person) => {
      const signature = layoutSignature(person);
      const cached = previous.entries.get(person.id);
      const layoutPerson = cached?.signature === signature ? cached.person : person;
      entries.set(person.id, { signature, person: layoutPerson });
      return layoutPerson;
    });
    const unchanged =
      nextPeople.length === previous.people.length &&
      nextPeople.every((person, index) => person === previous.people[index]);
    const resolved = unchanged ? previous.people : nextPeople;
    layoutPeopleCacheRef.current = { people: resolved, entries };
    return resolved;
  }, [people]);
  const layout = useMemo(
    () =>
      buildFamilyTreeLayout(layoutPeople, {
        nodeHeights: Object.fromEntries(
          Object.entries(nodeSizes).map(([personId, size]) => [personId, size.height]),
        ),
        nodeWidths: Object.fromEntries(
          Object.entries(nodeSizes).map(([personId, size]) => [personId, size.width]),
        ),
      }),
    [layoutPeople, nodeSizes],
  );

  useLayoutEffect(() => {
    const tree = treeRef.current;
    if (!tree) return undefined;

    const measure = () => {
      const measured = {};
      tree.querySelectorAll("[data-tree-person-id]").forEach((node) => {
        const card = node.querySelector(".family-node");
        if (!card) return;
        const height = Math.max(card.scrollHeight, card.offsetHeight);
        const width = card.offsetWidth;
        if (height > 0) {
          measured[node.dataset.treePersonId] = {
            height: Math.ceil(height),
            width: width > 0 ? Math.ceil(width) : 0,
          };
        }
      });

      setNodeSizes((current) => {
        const currentKeys = Object.keys(current);
        const measuredKeys = Object.keys(measured);
        const unchanged =
          currentKeys.length === measuredKeys.length &&
          measuredKeys.every(
            (personId) =>
              current[personId]?.height === measured[personId].height &&
              current[personId]?.width === measured[personId].width,
          );
        return unchanged ? current : measured;
      });
    };

    measure();
    if (typeof ResizeObserver !== "function") return undefined;

    const observer = new ResizeObserver(measure);
    tree.querySelectorAll(".family-node").forEach((card) => observer.observe(card));
    return () => observer.disconnect();
    // Only the set of cards matters here: measuring reads the DOM directly, and
    // a card that changes size without the roster changing is caught by the
    // ResizeObserver above. Keying this on renderCard as well meant every
    // selection change tore down the observer and forced a full measuring pass
    // -- reading scrollHeight/offsetWidth per card, each a synchronous reflow.
  }, [people]);

  if (!layout.nodes.length) return emptyState;

  const scale = Math.min(2, Math.max(0.1, Number(zoom) / 100 || 1));

  return (
    <div
      className="layered-family-tree-viewport"
      style={{
        width: `${Math.ceil(layout.width * scale)}px`,
        height: `${Math.ceil(layout.height * scale)}px`,
      }}
    >
      <div
        className="layered-family-tree"
        ref={treeRef}
        style={{
          width: `${layout.width}px`,
          height: `${layout.height}px`,
          transform: `scale(${scale})`,
        }}
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
              <path className={edgeClassName(edge)} key={edge.id} d={stemPath(edge)} />
            ))}

          {layout.edges
            .filter((edge) => edge.kind === "sibling-bar")
            .map((edge) => {
              if (edge.segments?.length > 1) {
                const path = edge.segments
                  .map((segment) => `M ${segment.from.x} ${segment.from.y} H ${segment.to.x}`)
                  .join(" ");
                return <path className={edgeClassName(edge)} key={edge.id} d={path} />;
              }
              return (
                <line
                  className={edgeClassName(edge)}
                  key={edge.id}
                  x1={edge.from.x}
                  y1={edge.from.y}
                  x2={edge.to.x}
                  y2={edge.to.y}
                />
              );
            })}

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
            data-tree-person-id={node.id}
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
    </div>
  );
}
