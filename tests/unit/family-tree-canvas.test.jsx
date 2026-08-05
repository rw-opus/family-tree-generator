// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(container.textContent).toContain("Print preview");
    expect(container.querySelector('[data-person-id="a"] .family-node-name').textContent).toBe(
      "Solitary",
    );
    expect(container.querySelector('[data-person-id="a"] .family-node-surname').textContent).toBe(
      "Person",
    );
  });

  it("uses the layered layout as soon as anyone is linked", () => {
    renderCanvas({ people: family() });

    expect(container.querySelector(".layered-family-tree")).not.toBeNull();
    expect(container.textContent).toContain("Select a person in the index");
  });

  it("explains red fields and directs the user to the person card", () => {
    renderCanvas({
      people: [person("a", "Joseph Borg")],
      causaMortisCoverageByPerson: { a: [{ status: "missing" }] },
    });

    expect(container.querySelector(".tree-required-data-key").textContent).toContain(
      "Red means action required",
    );
    expect(container.querySelector(".tree-required-data-key").textContent).toContain(
      "open that person's card",
    );
    const card = container.querySelector('[data-person-id="a"]');
    expect(card.classList.contains("cm-share-incomplete")).toBe(true);
    expect(card.getAttribute("aria-label")).toContain(
      "open this person's card and update the missing detail",
    );
  });

  it("highlights a GEDCOM birth surname that needs confirmation", () => {
    renderCanvas({
      people: [
        person("a", "Anna Borg", {
          surnameAtBirth: "",
          surnameAtBirthReviewRequired: true,
        }),
      ],
    });

    const card = container.querySelector('[data-person-id="a"]');
    expect(card.classList.contains("surname-at-birth-review-required")).toBe(true);
    expect(card.textContent).toContain("Confirm surname at birth");
    expect(card.getAttribute("aria-label")).toContain(
      "open this person's card and update the missing detail",
    );
  });

  it("gives a zoomed relational tree an explicit full scroll footprint", () => {
    renderCanvas({ people: family(), zoom: 175 });

    const footprint = container.querySelector(".layered-family-tree-viewport");
    const tree = container.querySelector(".layered-family-tree");
    const unscaledWidth = parseFloat(tree.style.width);
    const unscaledHeight = parseFloat(tree.style.height);

    expect(tree.style.transform).toBe("scale(1.75)");
    expect(parseFloat(footprint.style.width)).toBe(Math.ceil(unscaledWidth * 1.75));
    expect(parseFloat(footprint.style.height)).toBe(Math.ceil(unscaledHeight * 1.75));
  });

  it("keeps controls outside the pannable tree and centres cards by scrolling only the chart", () => {
    const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollIntoView",
    );
    const scrollTo = vi.fn();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      renderCanvas({
        people: family(),
        selectedPersonId: "c1",
        toolbar: <button type="button">Home</button>,
      });

      const panel = container.querySelector(".tree-panel");
      const controls = container.querySelector(".tree-panel-fixed-controls");
      const scrollRegion = container.querySelector(".tree-canvas-scroll-region");
      expect(controls.parentElement).toBe(panel);
      expect(scrollRegion.parentElement).toBe(panel);
      expect(scrollRegion.contains(controls)).toBe(false);
      expect(scrollTo).toHaveBeenCalledOnce();
      expect(scrollTo.mock.instances[0]).toBe(scrollRegion);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      if (originalScrollTo) {
        Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
      } else {
        delete HTMLElement.prototype.scrollTo;
      }
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
      } else {
        delete HTMLElement.prototype.scrollIntoView;
      }
    }
  });

  it("renders a card for every linked person", () => {
    renderCanvas({ people: family() });

    expect(container.querySelectorAll("[data-person-id]")).toHaveLength(7);
  });

  it("provides tree navigation controls with one keyboard tab stop", () => {
    const onZoomChange = vi.fn();
    renderCanvas({
      people: family(),
      selectedPersonId: "fa",
      onZoomChange,
    });

    expect(container.textContent).toContain("Fit tree");
    expect(container.textContent).not.toContain("Top");
    expect(container.textContent).not.toContain("Fit branch");
    expect(container.textContent).not.toContain("Centre");
    const cards = [...container.querySelectorAll("[data-person-id]")];
    expect(cards.filter((card) => card.tabIndex === 0)).toHaveLength(1);
    expect(container.querySelector('[data-person-id="fa"]').tabIndex).toBe(0);
    expect(cards.filter((card) => card.tabIndex === -1)).toHaveLength(cards.length - 1);

    const fitTree = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Fit tree",
    );
    act(() => fitTree.click());
    expect(onZoomChange).toHaveBeenCalledOnce();
  });

  it("pans from a person card with one finger without opening the card", () => {
    const onSelectPerson = vi.fn();
    renderCanvas({ people: family(), onSelectPerson });
    const scrollRegion = container.querySelector(".tree-canvas-scroll-region");
    const card = container.querySelector('[data-person-id="fa"]');
    scrollRegion.scrollLeft = 80;
    scrollRegion.scrollTop = 120;

    const touchEvent = (type, touches, changedTouches = touches) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", { configurable: true, value: touches });
      Object.defineProperty(event, "changedTouches", {
        configurable: true,
        value: changedTouches,
      });
      return event;
    };

    const start = { identifier: 1, clientX: 100, clientY: 100 };
    const moved = { identifier: 1, clientX: 80, clientY: 35 };
    const moveEvent = touchEvent("touchmove", [moved]);

    act(() => {
      card.dispatchEvent(touchEvent("touchstart", [start]));
      scrollRegion.dispatchEvent(moveEvent);
      scrollRegion.dispatchEvent(touchEvent("touchend", [], [moved]));
      card.click();
    });

    expect(moveEvent.defaultPrevented).toBe(true);
    expect(scrollRegion.scrollLeft).toBe(100);
    expect(scrollRegion.scrollTop).toBe(185);
    expect(onSelectPerson).not.toHaveBeenCalled();
  });

  it("shows a person's surname even when it matches the father's", () => {
    renderCanvas({ people: family() });

    expect(container.querySelector('[data-person-id="c1"] .family-node-name').textContent).toBe(
      "Joseph",
    );
    expect(container.querySelector('[data-person-id="c1"] .family-node-surname').textContent).toBe(
      "Borg",
    );
  });

  it("formats a will and notary on separate card lines and supports a UK-will fallback", () => {
    const people = [
      person("testator", "Joseph Borg", {
        isDeceased: true,
        inheritanceBasis: "will",
        spouseIds: ["spouse"],
        wills: [
          {
            id: "will-1",
            date: "2012-07-18",
            notaryName: "Ivan Barbara",
            description: "",
          },
        ],
      }),
      person("spouse", "Maria Borg", { spouseIds: ["testator"] }),
    ];

    renderCanvas({ people, personCardFields: { willDetails: true } });
    let details = [
      ...container.querySelectorAll('[data-person-id="testator"] .family-node-detail'),
    ].map((element) => element.textContent.trim());
    expect(details).toContain("Will 18/07/2012");
    expect(details).toContain("Not. Ivan Barbara");
    expect(container.textContent).not.toContain("Publishing Notary");

    renderCanvas({
      people: [
        { ...people[0], wills: [{ id: "uk", date: "1981-10-15", description: "UK will" }] },
        people[1],
      ],
      personCardFields: { willDetails: true },
    });
    details = [
      ...container.querySelectorAll('[data-person-id="testator"] .family-node-detail'),
    ].map((element) => element.textContent.trim());
    expect(details).toContain("Will 15/10/1981");
    expect(details).toContain("UK will");
  });

  it("shows a deceased share and prints exactly the selected card details", () => {
    const onPrint = vi.fn();
    const people = [
      person("testator", "Joseph Borg", {
        isDeceased: true,
        dateOfDeath: "2020-07-18",
        inheritanceBasis: "will",
        spouseIds: ["spouse"],
        wills: [{ id: "will", date: "2012-07-18", notaryName: "Ivan Barbara" }],
        causaMortisDeclarations: [
          {
            id: "cm",
            status: "complete",
            date: "2020-08-20",
            notaryName: "Maria Vella",
          },
        ],
      }),
      person("spouse", "Maria Borg", { spouseIds: ["testator"] }),
    ];

    renderCanvas({
      people,
      ownershipByPerson: { testator: 0.5 },
      personCardFields: {
        ownershipFraction: true,
        ownershipPercentage: false,
        dateOfDeath: true,
        willDetails: true,
        causaMortisDetails: true,
      },
      onPrint,
    });

    const card = container.querySelector('[data-person-id="testator"]');
    expect(card.textContent).toContain("1/2");
    expect(card.textContent).not.toContain("50%");
    expect(card.textContent).toContain("d. 18/07/2020");
    expect(card.textContent).toContain("Will 18/07/2012");
    expect(card.textContent).toContain("Not. Ivan Barbara");
    expect(card.textContent).toContain("CM 20/08/2020");
    expect(card.textContent).toContain("Not. Maria Vella");

    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Print preview"))
        .click(),
    );
    const printedTree = onPrint.mock.calls[0][0];
    expect(printedTree.querySelector('[data-person-id="testator"]').textContent).toBe(
      card.textContent,
    );
  });

  it("shows the current holding value only for a person who still owns the share", () => {
    const people = [
      person("deceased", "Joseph Borg", {
        isDeceased: true,
        dateOfDeath: "2020-07-18",
        fatherId: "ancestor",
      }),
      person("owner", "Maria Borg", { fatherId: "deceased" }),
      person("ancestor", "Karmnu Borg"),
    ];

    renderCanvas({
      people,
      ownershipByPerson: { deceased: 0.5, owner: 0.5 },
      currentOwnershipByPerson: { owner: 0.5 },
      propertyValue: 300000,
      personCardFields: {
        ownershipFraction: true,
        ownershipValue: true,
      },
    });

    expect(container.querySelector('[data-person-id="owner"]').textContent).toContain(
      "Current value €150,000.00",
    );
    expect(container.querySelector('[data-person-id="deceased"]').textContent).not.toContain(
      "Current value",
    );
  });

  it("labels a traced person's percentage and value as belonging to that history step", () => {
    const people = [
      person("ancestor", "Karmnu Borg"),
      person("owner", "Maria Borg", { fatherId: "ancestor" }),
    ];

    renderCanvas({
      people,
      ownershipByPerson: { owner: 0.25 },
      currentOwnershipByPerson: { owner: 0.25 },
      ownershipSnapshotActive: true,
      propertyValue: 400000,
      personCardFields: {
        ownershipFraction: true,
        ownershipPercentage: true,
        ownershipValue: true,
      },
    });

    const card = container.querySelector('[data-person-id="owner"]');
    expect(card.classList.contains("trace-ownership-snapshot")).toBe(true);
    expect(card.textContent).toContain("1/4");
    expect(card.textContent).toContain("25%");
    expect(card.textContent).toContain("Value at this step €100,000.00");
    expect(card.textContent).not.toContain("Current value");
  });

  it("does not force hidden legal details onto cards in a dense tree", () => {
    const people = Array.from({ length: 80 }, (_, index) =>
      person(`person-${index}`, `Person ${index}`, {
        fatherId: index > 0 ? `person-${index - 1}` : "",
        ...(index === 0
          ? {
              isDeceased: true,
              dateOfDeath: "2020-07-18",
              inheritanceBasis: "will",
              wills: [{ id: "will", date: "2012-07-18", notaryName: "Ivan Barbara" }],
              causaMortisDeclarations: [
                {
                  id: "cm",
                  status: "complete",
                  date: "2020-08-20",
                  notaryName: "Maria Vella",
                },
              ],
            }
          : {}),
      }),
    );

    renderCanvas({
      people,
      personCardFields: {
        ownershipFraction: false,
        ownershipPercentage: false,
        dateOfDeath: false,
        willDetails: false,
        causaMortisDetails: false,
      },
    });

    const card = container.querySelector('[data-person-id="person-0"]');
    expect(card.textContent).not.toContain("d. 18/07/2020");
    expect(card.textContent).not.toContain("Will");
    expect(card.textContent).not.toContain("CM");
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

  it("measures a tall card and relays out the generation below it", () => {
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return this.dataset?.personId === "gf" ? 184 : 108;
      },
    });

    try {
      renderCanvas({ people: family() });
      const grandfather = container.querySelector('[data-tree-person-id="gf"]');
      const father = container.querySelector('[data-tree-person-id="fa"]');

      expect(parseFloat(father.style.top)).toBeGreaterThan(parseFloat(grandfather.style.top) + 108);
      expect(parseFloat(grandfather.style.minHeight)).toBe(184);
    } finally {
      if (originalOffsetHeight) {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
      } else {
        delete HTMLElement.prototype.offsetHeight;
      }
    }
  });

  it("measures expanded card widths and relays out siblings without overlap", () => {
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight",
    );
    const originalOffsetWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetWidth",
    );
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get: () => 108,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        if (this.dataset?.personId === "c1") return 184;
        if (this.dataset?.personId === "c2") return 156;
        return 112;
      },
    });

    try {
      renderCanvas({ people: family() });
      const first = container.querySelector('[data-tree-person-id="c1"]');
      const second = container.querySelector('[data-tree-person-id="c2"]');
      const ordered = [first, second].sort(
        (left, right) => parseFloat(left.style.left) - parseFloat(right.style.left),
      );

      expect(parseFloat(first.style.width)).toBe(184);
      expect(parseFloat(second.style.width)).toBe(156);
      expect(parseFloat(ordered[1].style.left)).toBeGreaterThanOrEqual(
        parseFloat(ordered[0].style.left) + parseFloat(ordered[0].style.width),
      );
    } finally {
      if (originalOffsetHeight) {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
      } else {
        delete HTMLElement.prototype.offsetHeight;
      }
      if (originalOffsetWidth) {
        Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetWidth);
      } else {
        delete HTMLElement.prototype.offsetWidth;
      }
    }
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
        person("man", "Ganni Sciberras", {
          partnerRelationships: [{ personId: "woman", type: "partnership" }],
        }),
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

  it("draws a non-marital union only when the record says they were not married", () => {
    renderCanvas({
      people: [
        person("man", "Ganni Sciberras", {
          partnerRelationships: [{ personId: "woman", type: "partnership" }],
        }),
        person("woman", "Marija Borg"),
        person("child", "Carmel Sciberras", { fatherId: "man", motherId: "woman" }),
      ],
    });

    expect(container.querySelector(".tree-edge-partner.marital")).toBeNull();
    expect(container.querySelector(".tree-edge-partner.partnership")).not.toBeNull();
    expect(container.querySelector(".tree-edge-stem.flagged")).toBeNull();
    expect(container.querySelector(".tree-edge-descent.flagged")).toBeNull();
  });

  it("assumes a couple are married when the record does not say otherwise", () => {
    renderCanvas({
      people: [
        person("man", "Ganni Sciberras"),
        person("woman", "Marija Borg"),
        person("child", "Carmel Sciberras", { fatherId: "man", motherId: "woman" }),
      ],
    });

    expect(container.querySelector(".tree-edge-partner.marital")).not.toBeNull();
    expect(container.querySelector(".born-outside-marriage")).toBeNull();
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

  it("does not repeat a generated title inside the tree canvas", () => {
    renderCanvas({
      people: family().map((entry) => (entry.id === "gf" ? { ...entry, isDeceased: true } : entry)),
    });

    expect(container.querySelector(".family-chart-title")).toBeNull();
  });

  it("does not repeat a supplied title inside the tree canvas", () => {
    renderCanvas({ people: family(), treeTitle: "Borg succession" });

    expect(container.querySelector(".family-chart-title")).toBeNull();
  });
});
