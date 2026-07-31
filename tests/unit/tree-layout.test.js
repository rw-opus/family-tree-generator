import { describe, expect, it } from "vitest";
import {
  CARD_GAP,
  CARD_HEIGHT,
  CARD_WIDTH,
  ROW_GAP,
  assignGenerations,
  buildFamilyTreeLayout,
  buildUnions,
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

const nodesById = (layout) => new Map(layout.nodes.map((node) => [node.id, node]));

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
    // adjacent rather than being spread to centre over two grandchildren.
    const gaps = row.slice(1).map((node, index) => node.x - (row[index].x + row[index].width));

    expect(Math.max(...gaps)).toBeLessThanOrEqual(CARD_GAP);
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
