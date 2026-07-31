import { describe, expect, it } from "vitest";
import {
  CARD_WIDTH,
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

  it("treats a couple known only from a shared child as a partnership", () => {
    const people = [
      person("man"),
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
      person("man"),
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
    expect(naturalEdge.marital).toBe(false);
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
