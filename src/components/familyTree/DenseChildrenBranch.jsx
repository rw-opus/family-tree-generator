import { useLayoutEffect, useRef, useState } from "react";
import { a3PrintableWidthForColumns } from "../../domain/a3PrintPreview.js";
import "./DenseChildrenBranch.css";

export const DENSE_TREE_PERSON_THRESHOLD = 80;
export const DENSE_TREE_TWO_PAGE_THRESHOLD = 160;
export const DENSE_CHILDREN_WORKING_WIDTH = Math.floor(a3PrintableWidthForColumns(1));
export const DENSE_CHILDREN_TWO_PAGE_WORKING_WIDTH = Math.floor(a3PrintableWidthForColumns(2));
export const DENSE_CHILDREN_SIDE_GUTTER = 28;
export const DENSE_CHILDREN_ROW_GUTTER = 32;
export const DENSE_CHILDREN_NESTED_STEP = 32;
export const DENSE_CHILDREN_MIN_WIDTH = 720;
export const DENSE_PARTNER_COLUMN_MAX_WIDTH = 1200;
export const DENSE_PARTNER_COLUMN_MIN_WIDTH = 360;

const ROW_TOLERANCE = 3;

function rounded(value) {
  return Math.round(value * 100) / 100;
}

export function denseTreeWorkingWidth(personCount) {
  return personCount >= DENSE_TREE_TWO_PAGE_THRESHOLD
    ? DENSE_CHILDREN_TWO_PAGE_WORKING_WIDTH
    : DENSE_CHILDREN_WORKING_WIDTH;
}

export function shouldUseDenseChildrenLayout(personCount) {
  return personCount >= DENSE_TREE_PERSON_THRESHOLD;
}

export function densePartnerColumnWidth(workingWidth, relationshipCount) {
  const count = Math.max(1, Number(relationshipCount) || 1);
  const anchorReserve = 160;
  const relationshipGaps = count * 64;
  const availablePerRelationship = Math.floor(
    (workingWidth - anchorReserve - relationshipGaps) / count,
  );

  return Math.max(
    DENSE_PARTNER_COLUMN_MIN_WIDTH,
    Math.min(DENSE_PARTNER_COLUMN_MAX_WIDTH, availablePerRelationship),
  );
}

export function denseChildrenMaxWidth(depth = 0, workingWidth = DENSE_CHILDREN_WORKING_WIDTH) {
  return Math.max(
    DENSE_CHILDREN_MIN_WIDTH,
    workingWidth - Math.max(0, Number(depth) || 0) * DENSE_CHILDREN_NESTED_STEP,
  );
}

export function groupDenseChildRows(anchors, tolerance = ROW_TOLERANCE) {
  return [...anchors]
    .sort((first, second) => first.itemTop - second.itemTop || first.centerX - second.centerX)
    .reduce((rows, anchor) => {
      const row = rows.find(
        (candidate) => Math.abs(candidate.itemTop - anchor.itemTop) <= tolerance,
      );

      if (row) {
        row.anchors.push(anchor);
        row.anchors.sort((first, second) => first.centerX - second.centerX);
      } else {
        rows.push({ itemTop: anchor.itemTop, anchors: [anchor] });
      }
      return rows;
    }, [])
    .sort((first, second) => first.itemTop - second.itemTop);
}

export function denseChildrenConnectorGeometry({
  width,
  anchors,
  sideGutter = DENSE_CHILDREN_SIDE_GUTTER,
  rowGutter = DENSE_CHILDREN_ROW_GUTTER,
}) {
  const rows = groupDenseChildRows(anchors);
  if (!rows.length || !width) {
    return { parentPath: "", rows: [] };
  }

  const parentX = rounded(width / 2);
  if (anchors.length === 1) {
    const anchor = anchors[0];
    const anchorX = rounded(anchor.centerX);
    const entryTop = rounded(anchor.entryTop);
    const railY = rounded(anchor.itemTop + rowGutter / 2);
    const elbow = parentX === anchorX ? "" : ` V ${railY} H ${anchorX}`;

    return {
      parentPath: `M ${parentX} 0${elbow} V ${entryTop}`,
      rows: [],
    };
  }

  const trunkX = rounded(sideGutter / 2);
  const rowGeometry = rows.map((row) => {
    const railY = rounded(row.itemTop + rowGutter / 2);
    const furthestAnchorX = rounded(
      Math.max(trunkX, ...row.anchors.map((anchor) => anchor.centerX)),
    );

    return {
      railPath: `M ${trunkX} ${railY} H ${furthestAnchorX}`,
      railY,
      stems: row.anchors.map((anchor) => ({
        key: anchor.key,
        path: `M ${rounded(anchor.centerX)} ${rounded(railY + 1.5)} V ${rounded(anchor.entryTop)}`,
      })),
    };
  });
  const firstRailY = rowGeometry[0].railY;
  const lastRailY = rowGeometry.at(-1).railY;
  return {
    parentPath: `M ${parentX} 0 V ${firstRailY} H ${trunkX}${
      lastRailY === firstRailY ? "" : ` V ${lastRailY}`
    }`,
    rows: rowGeometry,
  };
}

function relativeRect(node, layoutRect, scaleX, scaleY) {
  const rect = node.getBoundingClientRect();
  const left = (rect.left - layoutRect.left) / scaleX;
  const top = (rect.top - layoutRect.top) / scaleY;

  return {
    left,
    right: left + rect.width / scaleX,
    top,
    bottom: top + rect.height / scaleY,
    width: rect.width / scaleX,
    height: rect.height / scaleY,
  };
}

function setOverflowReservation(item, content, scaleX) {
  const contentRect = content.getBoundingClientRect();
  const cardRects = [...content.querySelectorAll("[data-person-id]")].map((node) =>
    node.getBoundingClientRect(),
  );
  if (!contentRect.width || !cardRects.length) return false;

  const visualLeft = Math.min(...cardRects.map((rect) => rect.left));
  const visualRight = Math.max(...cardRects.map((rect) => rect.right));
  const before = Math.max(0, Math.ceil((contentRect.left - visualLeft) / scaleX));
  const after = Math.max(0, Math.ceil((visualRight - contentRect.right) / scaleX));
  const previousBefore = Number.parseFloat(
    item.style.getPropertyValue("--dense-visual-overflow-before"),
  );
  const previousAfter = Number.parseFloat(
    item.style.getPropertyValue("--dense-visual-overflow-after"),
  );
  const changed =
    (Number.isFinite(previousBefore) ? previousBefore : 0) !== before ||
    (Number.isFinite(previousAfter) ? previousAfter : 0) !== after;

  if (changed) {
    item.style.setProperty("--dense-visual-overflow-before", `${before}px`);
    item.style.setProperty("--dense-visual-overflow-after", `${after}px`);
  }
  return changed;
}

function anchorNodeFor(item, personId) {
  return [...item.querySelectorAll("[data-person-id]")].find(
    (node) => node.dataset.personId === personId,
  );
}

export function DenseChildrenBranch({
  branches,
  depth = 0,
  workingWidth = DENSE_CHILDREN_WORKING_WIDTH,
  widthLimit,
}) {
  const layoutRef = useRef(null);
  const [connectorGeometry, setConnectorGeometry] = useState({
    width: 0,
    height: 0,
    parentPath: "",
    rows: [],
  });
  const maxWidth = widthLimit || denseChildrenMaxWidth(depth, workingWidth);
  const usesTwoPages = maxWidth > DENSE_CHILDREN_WORKING_WIDTH;

  useLayoutEffect(() => {
    const layout = layoutRef.current;
    if (!layout) return undefined;

    const measure = () => {
      if (!layout.offsetWidth || !layout.offsetHeight) return;

      const layoutRect = layout.getBoundingClientRect();
      const scaleX = layoutRect.width / layout.offsetWidth || 1;
      const scaleY = layoutRect.height / layout.offsetHeight || 1;
      const items = [...layout.querySelectorAll(":scope > .family-dense-child-item")];
      let reservationChanged = false;

      items.forEach((item) => {
        const content = item.querySelector(":scope > .family-dense-child-content");
        if (content) {
          reservationChanged = setOverflowReservation(item, content, scaleX) || reservationChanged;
        }
      });

      if (reservationChanged) return;

      const nextAnchors = items
        .map((item) => {
          const anchor = anchorNodeFor(item, item.dataset.denseAnchorId);
          if (!anchor) return null;

          const itemRect = relativeRect(item, layoutRect, scaleX, scaleY);
          const anchorRect = relativeRect(anchor, layoutRect, scaleX, scaleY);
          const content = item.querySelector(":scope > .family-dense-child-content");
          const contentRect = content
            ? relativeRect(content, layoutRect, scaleX, scaleY)
            : anchorRect;
          return {
            key: item.dataset.denseChildKey,
            itemTop: itemRect.top,
            centerX: anchorRect.left + anchorRect.width / 2,
            entryTop: contentRect.top,
          };
        })
        .filter(Boolean);
      const nextGeometry = denseChildrenConnectorGeometry({
        width: layout.offsetWidth,
        anchors: nextAnchors,
      });

      setConnectorGeometry({
        ...nextGeometry,
        width: layout.offsetWidth,
        height: layout.offsetHeight,
      });
    };

    measure();
    const observer = globalThis.ResizeObserver ? new ResizeObserver(measure) : null;
    const mutationObserver = globalThis.MutationObserver ? new MutationObserver(measure) : null;
    observer?.observe(layout);
    layout
      .querySelectorAll(":scope > .family-dense-child-item")
      .forEach((item) => observer?.observe(item));
    mutationObserver?.observe(layout, {
      attributes: true,
      attributeFilter: ["class", "style"],
      subtree: true,
    });
    window.addEventListener("resize", measure);

    return () => {
      observer?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [branches, maxWidth]);

  return (
    <div
      className={[
        "family-dense-children-branch",
        branches.length === 1 && "single",
        usesTwoPages && "two-page",
      ]
        .filter(Boolean)
        .join(" ")}
      data-dense-child-count={branches.length}
      data-dense-depth={depth}
      ref={layoutRef}
      style={{ "--dense-children-max-width": `${maxWidth}px` }}
    >
      <svg
        aria-hidden="true"
        className="family-dense-children-connectors"
        preserveAspectRatio="none"
        viewBox={`0 0 ${connectorGeometry.width || 1} ${connectorGeometry.height || 1}`}
      >
        <path className="family-dense-parent-trunk" d={connectorGeometry.parentPath} />
        {connectorGeometry.rows.map((row, rowIndex) => (
          <g className="family-dense-child-row-connectors" key={`row-${rowIndex}`}>
            <path className="family-dense-child-rail" d={row.railPath} />
            {row.stems.map((stem) => (
              <path className="family-dense-child-stem" d={stem.path} key={stem.key} />
            ))}
          </g>
        ))}
      </svg>
      {branches.map((branch) => (
        <div
          className="family-dense-child-item family-child-branch-item"
          data-dense-anchor-id={branch.personId}
          data-branch-anchor-id={branch.personId}
          data-dense-child-key={branch.key}
          key={branch.key}
        >
          <div className="family-dense-child-content">{branch.content}</div>
        </div>
      ))}
    </div>
  );
}
