// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DENSE_CHILDREN_TWO_PAGE_WORKING_WIDTH,
  DENSE_CHILDREN_WORKING_WIDTH,
  denseChildrenConnectorGeometry,
  denseChildrenMaxWidth,
  densePartnerColumnWidth,
  denseTreeWorkingWidth,
  groupDenseChildRows,
  shouldUseDenseChildrenLayout,
} from "../../src/components/familyTree/DenseChildrenBranch.jsx";
import { calculateA3Tiles } from "../../src/domain/a3PrintPreview.js";
import {
  denseDescendantLaneOffsets,
  descendantChildPath,
} from "../../src/components/familyTree/MultiplePartnerHousehold.jsx";
import { RelationalFamilyTree } from "../../src/components/familyTree/RelationalFamilyTree.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function peopleWithChildren(total) {
  return [
    { id: "parent", fullName: "Parent" },
    ...Array.from({ length: total - 1 }, (_, index) => ({
      id: `child-${String(index).padStart(3, "0")}`,
      fullName: `Child ${String(index).padStart(3, "0")}`,
      fatherId: "parent",
    })),
  ];
}

function renderRelationalTree(root, people) {
  act(() =>
    root.render(
      <RelationalFamilyTree
        people={people}
        displayName={(person) => person.fullName}
        cardName={(person) => person.fullName}
        renderCard={(person) => (
          <button data-person-id={person.id} key={person.id} type="button">
            {person.fullName}
          </button>
        )}
      />,
    ),
  );
}

describe("dense descendant layout geometry", () => {
  it("switches at 80 people and exposes the one- and two-A3 working widths", () => {
    expect(shouldUseDenseChildrenLayout(79)).toBe(false);
    expect(shouldUseDenseChildrenLayout(80)).toBe(true);
    expect(shouldUseDenseChildrenLayout(81)).toBe(true);
    expect(denseTreeWorkingWidth(159)).toBe(DENSE_CHILDREN_WORKING_WIDTH);
    expect(denseTreeWorkingWidth(160)).toBe(DENSE_CHILDREN_TWO_PAGE_WORKING_WIDTH);
    expect(denseChildrenMaxWidth(2, DENSE_CHILDREN_WORKING_WIDTH)).toBe(1410);
    expect(densePartnerColumnWidth(DENSE_CHILDREN_WORKING_WIDTH, 3)).toBe(374);
    expect(densePartnerColumnWidth(DENSE_CHILDREN_TWO_PAGE_WORKING_WIDTH, 2)).toBe(1200);
    expect(densePartnerColumnWidth(DENSE_CHILDREN_TWO_PAGE_WORKING_WIDTH, 3)).toBe(840);
    expect(densePartnerColumnWidth(DENSE_CHILDREN_TWO_PAGE_WORKING_WIDTH, 4)).toBe(614);

    expect(
      calculateA3Tiles({
        contentWidth: DENSE_CHILDREN_TWO_PAGE_WORKING_WIDTH,
        contentHeight: 600,
      }).columns,
    ).toBe(2);
  });

  it("uses one direct connector instead of a full row rail for a sole child", () => {
    expect(
      denseChildrenConnectorGeometry({
        width: 1000,
        anchors: [{ key: "only", itemTop: 0, centerX: 100, entryTop: 32 }],
      }),
    ).toEqual({
      parentPath: "M 500 0 V 16 H 100 V 32",
      rows: [],
    });

    expect(
      denseChildrenConnectorGeometry({
        width: 1000,
        anchors: [{ key: "centred", itemTop: 0, centerX: 500, entryTop: 32 }],
      }).parentPath,
    ).toBe("M 500 0 V 32");
  });

  it("routes dense remarriage descendants through a reserved elbow", () => {
    expect(
      descendantChildPath({
        junctionX: 400,
        junctionY: 80,
        descendantsCenter: 620,
        descendantsTop: 160,
        denseLayout: true,
      }),
    ).toBe("M 400 80 V 148 H 620 V 160");
    expect(
      descendantChildPath({
        junctionX: 400,
        junctionY: 80,
        descendantsCenter: 620,
        descendantsTop: 160,
        denseLayout: false,
      }),
    ).toBe("M 400 80 V 160");
  });

  it("moves only colliding descendant columns into reserved vertical lanes", () => {
    expect(
      denseDescendantLaneOffsets([
        {
          key: "left",
          left: 0,
          cards: [{ left: 0, right: 100, top: 0, bottom: 50 }],
        },
        {
          key: "middle",
          left: 80,
          cards: [{ left: 80, right: 180, top: 30, bottom: 80 }],
        },
        {
          key: "right",
          left: 150,
          cards: [{ left: 150, right: 250, top: 40, bottom: 90 }],
        },
        {
          key: "separate",
          left: 300,
          cards: [{ left: 300, right: 350, top: 0, bottom: 50 }],
        },
      ]),
    ).toEqual({ left: 0, middle: 26, right: 72, separate: 0 });
  });

  it("groups sub-pixel aligned anchors into stable visual rows", () => {
    const rows = groupDenseChildRows([
      { key: "right", itemTop: 10.4, centerX: 300 },
      { key: "next", itemTop: 14, centerX: 120 },
      { key: "left", itemTop: 10, centerX: 100 },
    ]);

    expect(rows.map((row) => row.anchors.map((anchor) => anchor.key))).toEqual([
      ["left", "right"],
      ["next"],
    ]);
  });

  it("routes the incoming trunk through row gutters and splits child stems below each rail", () => {
    const geometry = denseChildrenConnectorGeometry({
      width: 1000,
      anchors: [
        { key: "a", itemTop: 0, centerX: 100, entryTop: 32 },
        { key: "b", itemTop: 0.5, centerX: 300, entryTop: 32 },
        { key: "c", itemTop: 100, centerX: 200, entryTop: 132 },
      ],
    });

    expect(geometry.parentPath).toBe("M 500 0 V 116");
    expect(geometry.rows.map((row) => row.railPath)).toEqual([
      "M 100 16 H 500",
      "M 200 116 H 500",
    ]);
    expect(geometry.rows.flatMap((row) => row.stems.map((stem) => stem.path))).toEqual([
      "M 100 17.5 V 32",
      "M 300 17.5 V 32",
      "M 200 117.5 V 132",
    ]);
  });
});

describe("dense descendant layout markup", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("preserves the ordinary branch below the threshold", () => {
    const people = peopleWithChildren(79);
    renderRelationalTree(root, people);

    expect(container.querySelector(".family-dense-children-branch")).toBeNull();
    expect(container.querySelector(".family-parent-row").classList).not.toContain(
      "dense-descendants",
    );
    expect(container.querySelectorAll(".family-child-branch-item")).toHaveLength(78);
    expect(container.querySelectorAll("[data-person-id]")).toHaveLength(people.length);
  });

  it("uses measured dense branch anchors at the threshold without duplicating people", () => {
    const people = peopleWithChildren(80);
    renderRelationalTree(root, people);

    const denseBranch = container.querySelector(".family-dense-children-branch");
    expect(denseBranch).not.toBeNull();
    expect(container.querySelector(".family-parent-row").classList).toContain("dense-descendants");
    expect(denseBranch.dataset.denseChildCount).toBe("79");
    expect(denseBranch.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(denseBranch.querySelectorAll(":scope > .family-dense-child-item")).toHaveLength(79);
    expect(
      [...denseBranch.querySelectorAll(":scope > .family-dense-child-item")].every(
        (item) => item.dataset.denseAnchorId === item.dataset.branchAnchorId,
      ),
    ).toBe(true);
    expect(container.querySelectorAll("[data-person-id]")).toHaveLength(people.length);
  });

  it("marks very large trees for a readable two-A3 layout", () => {
    renderRelationalTree(root, peopleWithChildren(160));

    expect(container.querySelector(".relational-forest").classList).toContain(
      "dense-tree-two-page",
    );
    expect(container.querySelector(".family-dense-children-branch").classList).toContain(
      "two-page",
    );
  });
});
