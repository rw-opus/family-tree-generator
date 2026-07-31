// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FamilyTreeCanvas } from "../../src/components/FamilyTreeCanvas.jsx";
import { CARD_WIDTH } from "../../src/components/familyTree/treeLayout.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const person = (id, name, extra = {}) => ({
  id,
  fullName: name,
  designations: [],
  fatherId: "",
  motherId: "",
  spouseIds: [],
  siblingIds: [],
  ...extra,
});

/** Married grandparents, two children, two grandchildren. */
const family = () => [
  person("gf", "Karmnu Borg", { spouseIds: ["gm"] }),
  person("gm", "Rita Borg", { spouseIds: ["gf"] }),
  person("fa", "Pawlu Borg", { fatherId: "gf", motherId: "gm", spouseIds: ["mo"] }),
  person("mo", "Doris Borg", { spouseIds: ["fa"] }),
  person("au", "Marija Borg", { fatherId: "gf", motherId: "gm" }),
  person("c1", "Joseph Borg", { fatherId: "fa", motherId: "mo" }),
  person("c2", "Anna Borg", { fatherId: "fa", motherId: "mo" }),
];

const renderCanvas = (props) => act(() => root.render(<FamilyTreeCanvas {...props} />));

const positionedCards = () =>
  [...container.querySelectorAll(".tree-node")].map((node) => ({
    generation: Number(node.dataset.familyGeneration),
    x: parseFloat(node.style.left),
    y: parseFloat(node.style.top),
    outsideMarriage: node.classList.contains("born-outside-marriage"),
  }));

describe("FamilyTreeCanvas", () => {
  it("falls back to the designation tree when nobody is linked", () => {
    renderCanvas({
      people: [person("a", "Solitary Person", { designations: ["Deceased"] })],
    });

    expect(container.querySelector(".layered-family-tree")).toBeNull();
    expect(container.textContent).toContain("Visual family record");
  });

  it("uses the layered layout as soon as anyone is linked", () => {
    renderCanvas({ people: family() });

    expect(container.querySelector(".layered-family-tree")).not.toBeNull();
    expect(container.textContent).toContain("Relational family record");
  });

  it("renders a card for every linked person", () => {
    renderCanvas({ people: family() });

    expect(container.querySelectorAll("[data-person-id]")).toHaveLength(7);
  });

  it("puts each generation on exactly one row", () => {
    renderCanvas({ people: family() });

    const rowByGeneration = new Map();
    positionedCards().forEach((card) => {
      if (!rowByGeneration.has(card.generation)) rowByGeneration.set(card.generation, card.y);
      expect(card.y).toBe(rowByGeneration.get(card.generation));
    });

    expect(rowByGeneration.size).toBe(3);
  });

  it("never overlaps two cards on a row", () => {
    renderCanvas({ people: family() });

    const rows = new Map();
    positionedCards().forEach((card) => {
      rows.set(card.generation, [...(rows.get(card.generation) || []), card]);
    });

    rows.forEach((cards) => {
      const sorted = [...cards].sort((first, second) => first.x - second.x);
      sorted.slice(1).forEach((card, index) => {
        expect(card.x).toBeGreaterThanOrEqual(sorted[index].x + CARD_WIDTH);
      });
    });
  });

  it("marks a child born outside marriage and leaves marital children unmarked", () => {
    renderCanvas({
      people: [
        person("man", "Ganni Sciberras"),
        person("woman", "Marija Borg"),
        person("natural", "Carmel Sciberras", { fatherId: "man", motherId: "woman" }),
      ],
    });

    expect(container.querySelector(".born-outside-marriage")).not.toBeNull();
    expect(container.querySelector(".outside-marriage-badge")).not.toBeNull();

    renderCanvas({ people: family() });
    expect(container.querySelector(".born-outside-marriage")).toBeNull();
  });

  it("draws a marital union bar for a recorded spouse pair", () => {
    renderCanvas({ people: family() });

    expect(container.querySelector(".tree-edge-partner.marital")).not.toBeNull();
  });

  it("draws a non-marital union for a couple known only from a shared child", () => {
    renderCanvas({
      people: [
        person("man", "Ganni Sciberras"),
        person("woman", "Marija Borg"),
        person("child", "Carmel Sciberras", { fatherId: "man", motherId: "woman" }),
      ],
    });

    expect(container.querySelector(".tree-edge-partner.marital")).toBeNull();
    expect(container.querySelector(".tree-edge.flagged")).not.toBeNull();
  });

  it("does not mark anyone when a parent is simply not recorded", () => {
    renderCanvas({
      people: [
        person("mother", "Marija Borg"),
        person("child", "Carmel Borg", { motherId: "mother" }),
      ],
    });

    expect(container.querySelector(".born-outside-marriage")).toBeNull();
    expect(container.querySelector(".outside-marriage-badge")).toBeNull();
    expect(container.querySelector(".tree-edge.flagged")).toBeNull();
  });

  it("lays a very dense imported tree out on one row per generation", () => {
    const people = Array.from({ length: 120 }, (_, index) =>
      person(`person-${index}`, `Person ${index}`, {
        fatherId: index > 0 ? `person-${index - 1}` : "",
      }),
    );

    renderCanvas({ people });

    const layout = container.querySelector(".layered-family-tree");
    expect(layout).not.toBeNull();
    // An unbroken parent chain is one person per generation, and nobody is dropped.
    expect(layout.dataset.generationCount).toBe("120");
    expect(container.querySelectorAll("[data-person-id]")).toHaveLength(people.length);
  });

  it("titles the tree after the deceased when no title is supplied", () => {
    renderCanvas({
      people: family().map((entry) => (entry.id === "gf" ? { ...entry, isDeceased: true } : entry)),
    });

    expect(container.textContent).toContain("Family Tree of");
  });

  it("uses the supplied tree title when there is one", () => {
    renderCanvas({ people: family(), treeTitle: "Borg succession" });

    expect(container.textContent).toContain("Borg succession");
  });
});
