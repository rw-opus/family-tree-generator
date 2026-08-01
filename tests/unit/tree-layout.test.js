import { describe, expect, it } from "vitest";
import {
  CARD_GAP,
  CARD_HEIGHT,
  CARD_WIDTH,
  PARTNER_GAP,
  ROW_GAP,
  assignUnionBarLanes,
  assignGenerations,
  buildFamilyTreeLayout,
  buildUnions,
  splitSiblingBar,
} from "../../src/components/familyTree/treeLayout.js";

const person = (id, extra = {}) => ({
  id,
  fullName: id,
  fatherId: "",
  motherId: "",
  spouseIds: [],
  siblingIds: [],
  ...extra,
});

/** Grandparents -> two married children -> four grandchildren. */
const threeGenerationFamily = () => [
  person("grandfather", { spouseIds: ["grandmother"] }),
  person("grandmother", { spouseIds: ["grandfather"] }),
  person("father", { fatherId: "grandfather", motherId: "grandmother", spouseIds: ["mother"] }),
  person("mother", { spouseIds: ["father"] }),
  person("aunt", { fatherId: "grandfather", motherId: "grandmother", spouseIds: ["uncle"] }),
  person("uncle", { spouseIds: ["aunt"] }),
  person("child-a", { fatherId: "father", motherId: "mother" }),
  person("child-b", { fatherId: "father", motherId: "mother" }),
  person("cousin-a", { fatherId: "uncle", motherId: "aunt" }),
  person("cousin-b", { fatherId: "uncle", motherId: "aunt" }),
];

const threeNeighbouringHouseholds = () => [
  person("ancestor", { spouseIds: ["ancestor-spouse"] }),
  person("ancestor-spouse", { spouseIds: ["ancestor"] }),
  person("margherita", {
    fatherId: "ancestor",
    motherId: "ancestor-spouse",
    spouseIds: ["joseph"],
  }),
  person("joseph", { spouseIds: ["margherita"] }),
  ...["francesco-z", "paolo", "michele", "concetta"].map((id) =>
    person(id, { fatherId: "joseph", motherId: "margherita" }),
  ),
  person("alfonso", { fatherId: "ancestor", motherId: "ancestor-spouse" }),
  ...["francesco-a", "violette", "michelina", "amadeo"].map((id) =>
    person(id, { fatherId: "alfonso" }),
  ),
  person("emanuele", {
    fatherId: "ancestor",
    motherId: "ancestor-spouse",
    spouseIds: ["marianna"],
  }),
  person("marianna", { spouseIds: ["emanuele"] }),
  ...["francesco-e", "michelangelo", "salvatore", "giovanni", "paolino"].map((id) =>
    person(id, { fatherId: "emanuele" }),
  ),
];

const nodesById = (layout) => new Map(layout.nodes.map((node) => [node.id, node]));

describe("assignUnionBarLanes", () => {
  it("separates complete family spans that would otherwise merge into one rail", () => {
    const unions = assignUnionBarLanes([
      {
        id: "first-family",
        generation: 2,
        marriageIndex: 0,
        childIds: ["first-child"],
        barLeft: 100,
        barRight: 260,
      },
      {
        id: "second-family",
        generation: 2,
        marriageIndex: 0,
        childIds: ["second-child"],
        barLeft: 220,
        barRight: 380,
      },
      {
        id: "distant-family",
        generation: 2,
        marriageIndex: 0,
        childIds: ["distant-child"],
        barLeft: 500,
        barRight: 600,
      },
    ]);

    expect(unions.find((union) => union.id === "first-family").barLane).toBe(0);
    expect(unions.find((union) => union.id === "second-family").barLane).toBe(1);
    expect(unions.find((union) => union.id === "distant-family").barLane).toBe(0);
  });
});

describe("assignGenerations", () => {
  it("puts spouses on the same generation", () => {
    const generations = assignGenerations(threeGenerationFamily());
    expect(generations.get("father")).toBe(generations.get("mother"));
    expect(generations.get("aunt")).toBe(generations.get("uncle"));
  });

  it("places each child exactly one generation below its parents", () => {
    const generations = assignGenerations(threeGenerationFamily());
    expect(generations.get("father")).toBe(generations.get("grandfather") + 1);
    expect(generations.get("child-a")).toBe(generations.get("father") + 1);
    expect(generations.get("cousin-a")).toBe(generations.get("aunt") + 1);
  });

  it("keeps cousins on the same generation", () => {
    const generations = assignGenerations(threeGenerationFamily());
    expect(generations.get("cousin-a")).toBe(generations.get("child-a"));
  });

  it("does not hang on a cycle in the parent data", () => {
    const people = [
      person("a", { fatherId: "b" }),
      person("b", { fatherId: "a" }),
      person("c", { fatherId: "a" }),
    ];
    expect(() => assignGenerations(people)).not.toThrow();
    expect(assignGenerations(people).size).toBe(3);
  });
});

describe("buildUnions", () => {
  it("marks a recorded spouse pair as a marriage", () => {
    const union = buildUnions(threeGenerationFamily()).find(
      (candidate) => candidate.id === "union:father+mother",
    );
    expect(union.type).toBe("marriage");
    expect(union.marital).toBe(true);
    expect(union.childIds).toEqual(expect.arrayContaining(["child-a", "child-b"]));
  });

  it("assumes a couple known only from a shared child are married", () => {
    const people = [
      person("man"),
      person("woman"),
      person("child", { fatherId: "man", motherId: "woman" }),
    ];
    const union = buildUnions(people).find((candidate) => candidate.childIds.includes("child"));
    // Nothing on the record says they were not married, so nothing on the chart
    // should suggest it.
    expect(union.type).toBe("marriage");
    expect(union.marital).toBe(true);
  });

  it("takes a partnership only from the relationships record", () => {
    const people = [
      person("man", { partnerRelationships: [{ personId: "woman", type: "partnership" }] }),
      person("woman"),
      person("child", { fatherId: "man", motherId: "woman" }),
    ];
    const union = buildUnions(people).find((candidate) => candidate.childIds.includes("child"));
    expect(union.type).toBe("partnership");
    expect(union.marital).toBe(false);
  });

  it("honours an explicit partnership over an implied marriage", () => {
    const people = [
      person("man", {
        spouseIds: ["woman"],
        partnerRelationships: [{ personId: "woman", type: "partnership" }],
      }),
      person("woman", { spouseIds: ["man"] }),
      person("child", { fatherId: "man", motherId: "woman" }),
    ];
    const union = buildUnions(people).find((candidate) => candidate.childIds.includes("child"));
    expect(union.type).toBe("partnership");
  });

  it("creates a single-parent union when only one parent is known", () => {
    const people = [person("mother"), person("child", { motherId: "mother" })];
    const union = buildUnions(people).find((candidate) => candidate.childIds.includes("child"));
    expect(union.type).toBe("single");
    expect(union.parentIds).toEqual(["mother"]);
  });

  it("draws a one-parent child from that parent's sole recorded marriage", () => {
    const people = [
      person("mother", { spouseIds: ["father"] }),
      person("father", { spouseIds: ["mother"] }),
      person("child", { motherId: "mother" }),
    ];
    const union = buildUnions(people).find((candidate) => candidate.childIds.includes("child"));

    expect(union.parentIds).toEqual(expect.arrayContaining(["mother", "father"]));
    expect(union.marital).toBe(true);
  });

  it("does not guess a missing parent when the recorded parent has several spouses", () => {
    const people = [
      person("mother", { spouseIds: ["first", "second"] }),
      person("first", { spouseIds: ["mother"] }),
      person("second", { spouseIds: ["mother"] }),
      person("child", { motherId: "mother" }),
    ];
    const union = buildUnions(people).find((candidate) => candidate.childIds.includes("child"));

    expect(union.parentIds).toEqual(["mother"]);
    expect(union.type).toBe("single");
  });

  it("keeps a childless marriage so the union is still drawn", () => {
    const people = [person("a", { spouseIds: ["b"] }), person("b", { spouseIds: ["a"] })];
    expect(buildUnions(people)).toHaveLength(1);
  });
});

describe("buildFamilyTreeLayout", () => {
  it("returns empty geometry for no people", () => {
    expect(buildFamilyTreeLayout([])).toMatchObject({ nodes: [], edges: [], width: 0 });
  });

  it("gives every person in a generation an identical row position", () => {
    const layout = buildFamilyTreeLayout(threeGenerationFamily());
    const yByGeneration = new Map();

    layout.nodes.forEach((node) => {
      if (!yByGeneration.has(node.generation)) yByGeneration.set(node.generation, node.y);
      expect(node.y).toBe(yByGeneration.get(node.generation));
    });

    expect(yByGeneration.size).toBe(3);
  });

  it("uses a constant vertical pitch between generations", () => {
    const layout = buildFamilyTreeLayout(threeGenerationFamily());
    const rowTops = [...new Set(layout.nodes.map((node) => node.y))].sort((a, b) => a - b);
    const gaps = rowTops.slice(1).map((top, index) => top - rowTops[index]);
    expect(new Set(gaps).size).toBe(1);
  });

  it("sets each row pitch from the tallest measured card in the generation", () => {
    const layout = buildFamilyTreeLayout(threeGenerationFamily(), {
      nodeHeights: { grandfather: 184, grandmother: 132 },
    });
    const cards = nodesById(layout);

    expect(cards.get("grandfather").height).toBe(184);
    expect(cards.get("grandmother").height).toBe(132);
    expect(cards.get("father").y).toBe(cards.get("grandfather").y + 184 + ROW_GAP);
    expect(cards.get("father").y).toBeGreaterThan(
      cards.get("grandmother").y + CARD_HEIGHT + ROW_GAP,
    );
  });

  it("starts a single-parent branch at the centre below the full parent card", () => {
    const layout = buildFamilyTreeLayout(
      [person("parent"), person("child", { fatherId: "parent" })],
      { nodeHeights: { parent: 190 } },
    );
    const cards = nodesById(layout);
    const union = layout.unions.find((candidate) => candidate.childIds.includes("child"));
    const stem = layout.edges.find((edge) => edge.id === `${union.id}:stem`);
    const parent = cards.get("parent");

    expect(stem.from.x).toBe(parent.x + parent.width / 2);
    expect(stem.from.y).toBe(parent.y + parent.height);
    expect(stem.to.y).toBeGreaterThan(stem.from.y);
    expect(union.y).toBeLessThan(cards.get("child").y);
  });

  it("keeps every child rail below the tallest parent card in its row", () => {
    const layout = buildFamilyTreeLayout(threeGenerationFamily(), {
      nodeHeights: { father: 184, mother: 142 },
    });
    const cards = nodesById(layout);
    const union = layout.unions.find((candidate) => candidate.id === "union:father+mother");
    const tallestParentBottom = Math.max(
      cards.get("father").y + cards.get("father").height,
      cards.get("mother").y + cards.get("mother").height,
    );

    expect(union.parentBottom).toBe(tallestParentBottom);
    expect(union.y).toBeGreaterThan(tallestParentBottom);
  });

  it("keeps neighbouring households on three independent child bars", () => {
    const layout = buildFamilyTreeLayout(threeNeighbouringHouseholds());
    const cards = nodesById(layout);
    const expectedFamilies = [
      ["margherita", ["francesco-z", "paolo", "michele", "concetta"]],
      ["alfonso", ["francesco-a", "violette", "michelina", "amadeo"]],
      ["emanuele", ["francesco-e", "michelangelo", "salvatore", "giovanni", "paolino"]],
    ];
    const familyBars = expectedFamilies.map(([parentId, childIds]) => {
      const union = layout.unions.find(
        (candidate) =>
          candidate.parentIds.includes(parentId) &&
          childIds.every((childId) => candidate.childIds.includes(childId)),
      );
      const bar = layout.edges.find((edge) => edge.id === `${union.id}:bar`);
      const childCentres = childIds.map((childId) => cards.get(childId).x + CARD_WIDTH / 2);

      expect(union.childIds).toHaveLength(childIds.length);
      expect(bar.from.x).toBe(Math.min(...childCentres));
      expect(bar.to.x).toBe(Math.max(...childCentres));
      return bar;
    });

    const sorted = [...familyBars].sort((first, second) => first.from.x - second.from.x);
    expect(sorted[0].to.x).toBeLessThan(sorted[1].from.x);
    expect(sorted[1].to.x).toBeLessThan(sorted[2].from.x);
  });

  it("never overlaps two cards on the same row", () => {
    const layout = buildFamilyTreeLayout(threeGenerationFamily());
    const rows = new Map();

    layout.nodes.forEach((node) => {
      rows.set(node.generation, [...(rows.get(node.generation) || []), node]);
    });

    rows.forEach((nodes) => {
      const sorted = [...nodes].sort((first, second) => first.x - second.x);
      sorted.slice(1).forEach((node, index) => {
        expect(node.x).toBeGreaterThanOrEqual(sorted[index].x + CARD_WIDTH);
      });
    });
  });

  it("sits a union between its parents", () => {
    const layout = buildFamilyTreeLayout(threeGenerationFamily());
    const cards = nodesById(layout);
    const union = layout.unions.find((candidate) => candidate.id === "union:father+mother");
    const left = Math.min(cards.get("father").x, cards.get("mother").x);
    const right = Math.max(cards.get("father").x, cards.get("mother").x) + CARD_WIDTH;

    expect(union.x).toBeGreaterThan(left);
    expect(union.x).toBeLessThan(right);
  });

  it("centres a union over the span of its children", () => {
    const layout = buildFamilyTreeLayout(threeGenerationFamily());
    const cards = nodesById(layout);
    const union = layout.unions.find((candidate) => candidate.id === "union:father+mother");
    const childCentres = union.childIds.map((id) => cards.get(id).x + CARD_WIDTH / 2);

    expect(union.x).toBeGreaterThanOrEqual(Math.min(...childCentres));
    expect(union.x).toBeLessThanOrEqual(Math.max(...childCentres));
  });

  it("drops descent edges from the union bar to each child row", () => {
    const layout = buildFamilyTreeLayout(threeGenerationFamily());
    const cards = nodesById(layout);
    const descents = layout.edges.filter((edge) => edge.kind === "descent");

    // Three unions in this family produce children: the grandparents, and each
    // of their two married children.
    expect(descents).toHaveLength(6);
    descents.forEach((edge) => {
      expect(edge.to.y).toBe(cards.get(edge.childId).y);
      expect(edge.from.x).toBe(edge.to.x);
    });
  });

  it("flags children born outside a marriage and marks their descent edge", () => {
    const people = [
      person("man", { partnerRelationships: [{ personId: "woman", type: "partnership" }] }),
      person("woman"),
      person("natural-child", { fatherId: "man", motherId: "woman" }),
      person("married-man", { spouseIds: ["wife"] }),
      person("wife", { spouseIds: ["married-man"] }),
      person("legitimate-child", { fatherId: "married-man", motherId: "wife" }),
    ];
    const layout = buildFamilyTreeLayout(people);
    const cards = nodesById(layout);

    expect(cards.get("natural-child").bornOutsideMarriage).toBe(true);
    expect(cards.get("legitimate-child").bornOutsideMarriage).toBe(false);

    const naturalEdge = layout.edges.find(
      (edge) => edge.kind === "descent" && edge.childId === "natural-child",
    );
    expect(naturalEdge.flagged).toBe(true);
  });

  it("never flags a person just because one parent is not recorded", () => {
    const people = [
      person("mother"),
      person("child", { motherId: "mother" }),
      person("grandchild", { motherId: "child" }),
    ];
    const layout = buildFamilyTreeLayout(people);

    layout.nodes.forEach((node) => expect(node.bornOutsideMarriage).toBe(false));
    layout.edges.forEach((edge) => expect(Boolean(edge.flagged)).toBe(false));
  });

  it("keeps every person on the canvas", () => {
    const layout = buildFamilyTreeLayout(threeGenerationFamily());
    expect(layout.nodes).toHaveLength(10);
    layout.nodes.forEach((node) => {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x + node.width).toBeLessThanOrEqual(layout.width);
      expect(node.y + node.height).toBeLessThanOrEqual(layout.height);
    });
  });

  it("is deterministic across runs", () => {
    const first = buildFamilyTreeLayout(threeGenerationFamily());
    const second = buildFamilyTreeLayout(threeGenerationFamily());
    expect(second.nodes.map((node) => [node.id, node.x, node.y])).toEqual(
      first.nodes.map((node) => [node.id, node.x, node.y]),
    );
  });
});

describe("a person married more than once", () => {
  /** Nicola marries three times and has a child by each wife. */
  const thriceMarried = () => [
    person("nicola", { spouseIds: ["carmela", "margherita", "francesca"] }),
    person("carmela", { spouseIds: ["nicola"] }),
    person("margherita", { spouseIds: ["nicola"] }),
    person("francesca", { spouseIds: ["nicola"] }),
    person("child-1", { fatherId: "nicola", motherId: "carmela" }),
    person("child-2", { fatherId: "nicola", motherId: "margherita" }),
    person("child-3", { fatherId: "nicola", motherId: "francesca" }),
  ];

  const unionWith = (layout, motherId) =>
    layout.unions.find((union) => union.parentIds.includes(motherId));

  it("builds one union per marriage", () => {
    const layout = buildFamilyTreeLayout(thriceMarried());
    const withChildren = layout.unions.filter((union) => union.childIds.length);

    expect(withChildren).toHaveLength(3);
  });

  it("numbers each marriage so its children can be read back", () => {
    const layout = buildFamilyTreeLayout(thriceMarried());
    const indices = ["carmela", "margherita", "francesca"]
      .map((id) => unionWith(layout, id).marriageIndex)
      .sort();

    expect(indices).toEqual([0, 1, 2]);
    layout.unions.forEach((union) => expect(union.numbered).toBe(true));
  });

  it("gives every marriage its own sibling bar depth", () => {
    const layout = buildFamilyTreeLayout(thriceMarried());
    const barDepths = layout.unions
      .filter((union) => union.childIds.length)
      .map((union) => union.y);

    // Sharing one bar is what made the three sets of children indistinguishable.
    expect(new Set(barDepths).size).toBe(3);
  });

  it("keeps every sibling bar clear of the children's row", () => {
    const layout = buildFamilyTreeLayout(thriceMarried());

    layout.unions
      .filter((union) => union.childIds.length)
      .forEach((union) => {
        expect(union.y).toBeGreaterThan(union.parentBottom);
        expect(union.y).toBeLessThan(union.childTop);
      });
  });

  it("carries the marriage number onto each child's descent edge", () => {
    const layout = buildFamilyTreeLayout(thriceMarried());
    const edgeFor = (childId) =>
      layout.edges.find((edge) => edge.kind === "descent" && edge.childId === childId);

    expect(edgeFor("child-1").marriageIndex).toBe(unionWith(layout, "carmela").marriageIndex);
    expect(edgeFor("child-2").marriageIndex).toBe(unionWith(layout, "margherita").marriageIndex);
    expect(edgeFor("child-3").marriageIndex).toBe(unionWith(layout, "francesca").marriageIndex);
  });

  it("routes an outer marriage above an intervening spouse", () => {
    const layout = buildFamilyTreeLayout(thriceMarried());
    const cards = new Map(layout.nodes.map((node) => [node.id, node]));

    layout.edges
      .filter((edge) => edge.kind === "partner")
      .forEach((edge) => {
        const spanned = layout.nodes.filter(
          (node) =>
            node.generation === cards.get("nicola").generation &&
            node.x + node.width / 2 > Math.min(edge.from.x, edge.to.x) + 1 &&
            node.x + node.width / 2 < Math.max(edge.from.x, edge.to.x) - 1,
        );
        if (spanned.length) {
          expect(edge.route).toBe("over");
          expect(edge.routeY).toBeLessThan(cards.get("nicola").y);
        } else {
          expect(edge.route).toBe("straight");
        }
      });
  });

  it("gives every marriage one child stem from its own union marker", () => {
    const layout = buildFamilyTreeLayout(thriceMarried());

    layout.unions
      .filter((union) => union.childIds.length)
      .forEach((union) => {
        const stems = layout.edges.filter(
          (edge) => edge.kind === "stem" && edge.id.startsWith(`${union.id}:stem`),
        );
        expect(stems).toHaveLength(1);
        expect(stems[0].from).toEqual({ x: union.markerX, y: union.markerY });
      });
  });

  it("drops a remarriage stem straight onto the bar even over a middle child", () => {
    const people = [
      person("federico", { spouseIds: ["antonia"] }),
      person("antonia", { spouseIds: ["federico", "joseph"] }),
      person("joseph", { spouseIds: ["antonia"] }),
      person("emanuel", { fatherId: "federico", motherId: "antonia" }),
      person("alfio", { fatherId: "federico", motherId: "antonia" }),
      person("francesco", { fatherId: "federico", motherId: "antonia" }),
      person("giuseppina", { fatherId: "joseph", motherId: "antonia" }),
      person("benedetta", { fatherId: "joseph", motherId: "antonia" }),
      person("vincenza", { fatherId: "joseph", motherId: "antonia" }),
    ];
    const layout = buildFamilyTreeLayout(people, {
      nodeHeights: { federico: 154, antonia: 126 },
    });
    const cards = nodesById(layout);
    const union = layout.unions.find(
      (candidate) =>
        candidate.parentIds.includes("federico") && candidate.parentIds.includes("antonia"),
    );
    const stem = layout.edges.find((edge) => edge.id === `${union.id}:stem`);
    const childLines = union.childIds.map((childId) =>
      layout.edges.find((edge) => edge.kind === "descent" && edge.childId === childId),
    );
    const tallestParentBottom = Math.max(
      cards.get("federico").y + cards.get("federico").height,
      cards.get("antonia").y + cards.get("antonia").height,
    );

    // The stem runs straight down from the middle of the marriage onto the bar.
    // Over an odd number of children that point is the middle child's own
    // centre line, and parent to bar to child reading as one line is correct —
    // stepping aside to a gap put a visible jog on every such family.
    expect(stem.from.x).toBe(union.markerX);
    expect(stem.to.x).toBe(stem.from.x);
    expect(stem.to.y).toBe(union.y);
    expect(union.y).toBeGreaterThan(tallestParentBottom);
    expect(childLines.some((childLine) => childLine.from.x === stem.to.x)).toBe(true);
  });

  it("opens a sibling rail where the descendant stem of another marriage passes through it", () => {
    expect(splitSiblingBar(100, 300, [250])).toEqual([
      { left: 100, right: 245 },
      { left: 255, right: 300 },
    ]);
  });

  it("places each marriage's child close to that union instead of across the chart", () => {
    const layout = buildFamilyTreeLayout(thriceMarried());
    const cards = nodesById(layout);

    layout.unions
      .filter((union) => union.childIds.length)
      .forEach((union) => {
        const childCentre = cards.get(union.childIds[0]).x + CARD_WIDTH / 2;
        expect(Math.abs(childCentre - union.markerX)).toBeLessThanOrEqual(CARD_WIDTH + CARD_GAP);
      });
  });
});

describe("separate families on one chart", () => {
  it("packs unrelated families together instead of leaving a void", () => {
    const people = [
      person("a1", { spouseIds: ["a2"] }),
      person("a2", { spouseIds: ["a1"] }),
      ...Array.from({ length: 8 }, (_, index) =>
        person(`a-child-${index}`, { fatherId: "a1", motherId: "a2" }),
      ),
      person("b1", { spouseIds: ["b2"] }),
      person("b2", { spouseIds: ["b1"] }),
      person("b-child", { fatherId: "b1", motherId: "b2" }),
    ];
    const layout = buildFamilyTreeLayout(people);
    const ids = new Set(["b1", "b2", "b-child"]);
    const second = layout.nodes.filter((node) => ids.has(node.id));
    const first = layout.nodes.filter((node) => !ids.has(node.id));

    const firstRight = Math.max(...first.map((node) => node.x + node.width));
    const secondLeft = Math.min(...second.map((node) => node.x));

    // The families must not interleave, and must not sit oceans apart.
    expect(secondLeft).toBeGreaterThanOrEqual(firstRight);
    expect(secondLeft - firstRight).toBeLessThanOrEqual(CARD_WIDTH * 1.5);
  });
});

describe("which generation sets the width", () => {
  /** Eight uncles and aunts above, one couple with two children below. */
  const wideOlderGeneration = () => [
    person("gf", { spouseIds: ["gm"] }),
    person("gm", { spouseIds: ["gf"] }),
    ...Array.from({ length: 8 }, (_, index) =>
      person(`uncle-${index}`, { fatherId: "gf", motherId: "gm" }),
    ),
    person("spouse", { spouseIds: ["uncle-0"] }),
    person("child-a", { fatherId: "uncle-0", motherId: "spouse" }),
    person("child-b", { fatherId: "uncle-0", motherId: "spouse" }),
  ];

  const rowsOf = (layout) => {
    const rows = new Map();
    layout.nodes.forEach((node) => {
      rows.set(node.generation, [...(rows.get(node.generation) || []), node]);
    });
    rows.forEach((nodes, generation) =>
      rows.set(
        generation,
        [...nodes].sort((first, second) => first.x - second.x),
      ),
    );
    return rows;
  };

  it("packs the denser generation adjacently when the uncles outnumber the descendants", () => {
    const rows = rowsOf(buildFamilyTreeLayout(wideOlderGeneration()));
    const row = rows.get(1);

    // The uncles are the crowded row here, so it is their boxes that end up
    // adjacent rather than being spread to centre over two grandchildren. A
    // couple whose children are slightly wider than the pair may widen its own
    // slot by those few pixels — that is the subtree rule, not spreading.
    const gaps = row.slice(1).map((node, index) => node.x - (row[index].x + row[index].width));

    expect(Math.max(...gaps)).toBeLessThanOrEqual(CARD_GAP * 2);
  });

  it("takes the chart width from the widest generation, not a sparse one", () => {
    const layout = buildFamilyTreeLayout(wideOlderGeneration());
    const rows = rowsOf(layout);
    const widest = [...rows.values()].reduce(
      (best, nodes) => (nodes.length > best.length ? nodes : best),
      [],
    );
    const widestSpan = widest.at(-1).x + CARD_WIDTH - widest[0].x;

    // Everything else has to fit inside the room the biggest generation needs.
    expect(layout.width).toBeLessThan(widestSpan + CARD_WIDTH * 2);
  });
});

/**
 * The reference sketch: X married A, B and C. D and E are X and A's children,
 * F is X and B's, and G, H and J are X and C's. W and Z are X's parents and P
 * is X's sibling.
 */
describe("the reference multi-marriage sketch", () => {
  const sketch = () => [
    person("W", { spouseIds: ["Z"] }),
    person("Z", { spouseIds: ["W"] }),
    person("X", { fatherId: "W", motherId: "Z", spouseIds: ["A", "B", "C"] }),
    person("P", { fatherId: "W", motherId: "Z" }),
    person("A", { spouseIds: ["X"] }),
    person("B", { spouseIds: ["X"] }),
    person("C", { spouseIds: ["X"] }),
    person("D", { fatherId: "X", motherId: "A" }),
    person("E", { fatherId: "X", motherId: "A" }),
    person("F", { fatherId: "X", motherId: "B" }),
    person("G", { fatherId: "X", motherId: "C" }),
    person("H", { fatherId: "X", motherId: "C" }),
    person("J", { fatherId: "X", motherId: "C" }),
  ];

  const rowOrder = (layout, generation) =>
    layout.nodes
      .filter((node) => node.generation === generation)
      .sort((first, second) => first.x - second.x)
      .map((node) => node.id);

  const unionOf = (layout, spouseId) =>
    layout.unions.find(
      (union) => union.parentIds.includes("X") && union.parentIds.includes(spouseId),
    );

  it("puts the parents on one row and everyone else on the next two", () => {
    const layout = buildFamilyTreeLayout(sketch());

    expect(rowOrder(layout, 0).sort()).toEqual(["W", "Z"]);
    expect(rowOrder(layout, 1).sort()).toEqual(["A", "B", "C", "P", "X"]);
    expect(rowOrder(layout, 2).sort()).toEqual(["D", "E", "F", "G", "H", "J"]);
  });

  it("keeps the sibling clear of the spouse chain", () => {
    // Spouses may be interjected between siblings, but the much-married person
    // belongs at the outer end so the parents' bar never crosses the corridor
    // the outer marriage routes through.
    expect(rowOrder(buildFamilyTreeLayout(sketch()), 1)).toEqual(["P", "A", "X", "B", "C"]);
  });

  it("gives each marriage its own children", () => {
    const layout = buildFamilyTreeLayout(sketch());

    expect(unionOf(layout, "A").childIds.sort()).toEqual(["D", "E"]);
    expect(unionOf(layout, "B").childIds.sort()).toEqual(["F"]);
    expect(unionOf(layout, "C").childIds.sort()).toEqual(["G", "H", "J"]);
  });

  it("routes only the outer marriage over the spouse in between", () => {
    const layout = buildFamilyTreeLayout(sketch());
    const routeFor = (spouseId) =>
      layout.edges.find(
        (edge) => edge.kind === "partner" && edge.unionId === unionOf(layout, spouseId).id,
      ).route;

    expect(routeFor("A")).toBe("straight");
    expect(routeFor("B")).toBe("straight");
    expect(routeFor("C")).toBe("over");
  });

  it("drops a vertical from the outer marriage to its own children", () => {
    const layout = buildFamilyTreeLayout(sketch());
    const stem = layout.edges.find(
      (edge) => edge.kind === "stem" && edge.unionId === unionOf(layout, "C").id,
    );

    expect(stem.route).toBe("outer-union");
    // It leaves the raised route above the row and runs down past the children's row.
    expect(stem.from.y).toBeLessThan(layout.nodes.find((node) => node.id === "X").y);
    expect(stem.to.y).toBeGreaterThan(stem.from.y);
  });

  it("takes every marriage's children from a different depth", () => {
    const layout = buildFamilyTreeLayout(sketch());
    const depths = ["A", "B", "C"].map((spouseId) => unionOf(layout, spouseId).y);

    expect(new Set(depths).size).toBe(3);
  });

  it("enters an only child's bar straight below the marriage", () => {
    const layout = buildFamilyTreeLayout(sketch());
    const union = unionOf(layout, "B");

    // The stem and the child's descent are meant to read as one straight line,
    // so the bar must not be entered off to one side.
    expect(union.barEntryX).toBe(union.markerX);
  });
});

/**
 * The cousins sketch: Y and Z's children are A, B, C, D and M. C alone has
 * E and F; D alone has G, H and I; M, married to N, has J and K.
 */
describe("the reference cousins sketch", () => {
  const sketch = () => [
    person("Y", { spouseIds: ["Z"] }),
    person("Z", { spouseIds: ["Y"] }),
    person("A", { fatherId: "Y", motherId: "Z" }),
    person("B", { fatherId: "Y", motherId: "Z" }),
    person("C", { fatherId: "Y", motherId: "Z" }),
    person("D", { fatherId: "Y", motherId: "Z" }),
    person("M", { fatherId: "Y", motherId: "Z", spouseIds: ["N"] }),
    person("N", { spouseIds: ["M"] }),
    person("E", { fatherId: "C" }),
    person("F", { fatherId: "C" }),
    person("G", { fatherId: "D" }),
    person("H", { fatherId: "D" }),
    person("I", { fatherId: "D" }),
    person("J", { fatherId: "M", motherId: "N" }),
    person("K", { fatherId: "M", motherId: "N" }),
  ];

  const centres = (layout) =>
    new Map(layout.nodes.map((node) => [node.id, node.x + CARD_WIDTH / 2]));

  it("centres each parent over its own children", () => {
    const layout = buildFamilyTreeLayout(sketch());
    const at = centres(layout);

    [
      ["C", ["E", "F"]],
      ["D", ["G", "H", "I"]],
    ].forEach(([parentId, childIds]) => {
      const mid =
        (Math.min(...childIds.map((id) => at.get(id))) +
          Math.max(...childIds.map((id) => at.get(id)))) /
        2;
      expect(Math.abs(at.get(parentId) - mid)).toBeLessThanOrEqual(1);
    });

    // M and N sit as a couple right on top of J and K.
    const coupleMid = (at.get("M") + at.get("N")) / 2;
    const childMid = (at.get("J") + at.get("K")) / 2;
    expect(Math.abs(coupleMid - childMid)).toBeLessThanOrEqual(1);
  });

  it("packs all the cousins at the minimum gap", () => {
    const layout = buildFamilyTreeLayout(sketch());
    const row = layout.nodes
      .filter((node) => node.generation === 2)
      .sort((first, second) => first.x - second.x);

    expect(row.map((node) => node.id)).toEqual(["E", "F", "G", "H", "I", "J", "K"]);
    row.slice(1).forEach((node, index) => {
      expect(node.x - (row[index].x + CARD_WIDTH)).toBeLessThanOrEqual(CARD_GAP + 1);
    });
  });

  it("lets childless siblings sit at one card each", () => {
    const layout = buildFamilyTreeLayout(sketch());
    const at = centres(layout);

    // A and B have no descendants pulling on them, so they pack tight
    // against each other and against C's subtree.
    expect(at.get("B") - at.get("A")).toBeLessThanOrEqual(CARD_WIDTH + CARD_GAP + 1);
  });
});

describe("a parent married more than once", () => {
  const twoWives = () => [
    person("first-wife", { spouseIds: ["husband"] }),
    person("husband", { spouseIds: ["first-wife", "second-wife"] }),
    person("second-wife", { spouseIds: ["husband"] }),
    person("a1", { fatherId: "husband", motherId: "first-wife" }),
    person("a2", { fatherId: "husband", motherId: "first-wife" }),
    person("b1", { fatherId: "husband", motherId: "second-wife" }),
    person("b2", { fatherId: "husband", motherId: "second-wife" }),
  ];

  const properlyCross = (first, second) => {
    const side = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    const sides = [
      side(first.from, first.to, second.from),
      side(first.from, first.to, second.to),
      side(second.from, second.to, first.from),
      side(second.from, second.to, first.to),
    ];
    if (sides.some((value) => value === 0)) return false;
    return sides[0] !== sides[1] && sides[2] !== sides[3];
  };

  it("keeps each marriage's children in their own group, in marriage order", () => {
    const layout = buildFamilyTreeLayout(twoWives());
    const order = layout.nodes
      .filter((node) => node.generation === 1)
      .sort((first, second) => first.x - second.x)
      .map((node) => node.id);

    expect(order).toEqual(["a1", "a2", "b1", "b2"]);
  });

  it("never crosses one marriage's connectors with another's", () => {
    const layout = buildFamilyTreeLayout(twoWives());
    const segments = layout.edges.filter((edge) =>
      ["descent", "sibling-bar", "stem"].includes(edge.kind),
    );

    segments.forEach((first, index) => {
      segments.slice(index + 1).forEach((second) => {
        if (first.unionId === second.unionId) return;
        expect(properlyCross(first, second)).toBe(false);
      });
    });
  });

  it("puts the first marriage's stem over its own children", () => {
    const layout = buildFamilyTreeLayout(twoWives());
    const union = layout.unions.find((candidate) => candidate.childIds.includes("a1"));
    const centres = union.childIds.map((childId) => {
      const node = layout.nodes.find((candidate) => candidate.id === childId);
      return node.x + CARD_WIDTH / 2;
    });

    expect(union.markerX).toBeGreaterThanOrEqual(Math.min(...centres));
    expect(union.markerX).toBeLessThanOrEqual(Math.max(...centres));
  });
});

describe("a second marriage beside a wide first family", () => {
  const remarriedAfterWideBranch = () => [
    person("first-wife", { spouseIds: ["husband"] }),
    person("husband", { spouseIds: ["first-wife", "second-wife"] }),
    person("second-wife", { spouseIds: ["husband"] }),
    person("daughter", { fatherId: "husband", motherId: "first-wife", spouseIds: ["in-law"] }),
    person("in-law", { spouseIds: ["daughter"] }),
    ...Array.from({ length: 8 }, (_, index) =>
      person(`grandchild-${index}`, { fatherId: "in-law", motherId: "daughter" }),
    ),
    ...["a", "b", "c", "d"].map((suffix) =>
      person(`late-${suffix}`, { fatherId: "husband", motherId: "second-wife" }),
    ),
  ];

  it("keeps the second spouse beside the first rather than across the chart", () => {
    const layout = buildFamilyTreeLayout(remarriedAfterWideBranch());
    const at = (id) => {
      const node = layout.nodes.find((candidate) => candidate.id === id);
      return node.x + CARD_WIDTH / 2;
    };

    // Centring a marriage on its children moves the far spouse twice the
    // distance, so without a ceiling the second wife ends up beyond her own
    // children.
    expect(at("second-wife") - at("husband")).toBeLessThanOrEqual((CARD_WIDTH + PARTNER_GAP) * 2);
    expect(at("second-wife")).toBeGreaterThan(at("husband"));
  });
});
