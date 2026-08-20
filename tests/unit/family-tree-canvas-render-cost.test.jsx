// @vitest-environment jsdom
//
// The tree canvas is re-rendered by anything that re-renders the workspace: a
// keystroke in the person inspector, opening the causa mortis or will dialogs,
// a save-state change. Rebuilding the tree geometry or re-running every person
// card on those renders made the whole workspace feel laggy, so these are
// guards on the render cost, not on what is drawn.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each card derives its legal state from the whole people list, so counting
// card bodies is the cheapest proxy for "did every card re-render". The cards
// reach this module through cardName().
const cardBodyRuns = { count: 0 };
vi.mock("../../src/components/familyTree/treePresentation.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    personCardName: (...args) => {
      cardBodyRuns.count += 1;
      return actual.personCardName(...args);
    },
  };
});

// familyPersonCardState() calls personWills() exactly once, so this counts how
// many times that state is derived across the whole canvas.
const cardStateDerivations = { count: 0 };
vi.mock("../../src/domain/wills.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    personWills: (...args) => {
      cardStateDerivations.count += 1;
      return actual.personWills(...args);
    },
  };
});

const treeLayout = await import("../../src/components/familyTree/treeLayout.js");
const { FamilyTreeCanvas } = await import("../../src/components/FamilyTreeCanvas.jsx");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  cardBodyRuns.count = 0;
  cardStateDerivations.count = 0;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
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

/** Grandparents, six married children, four grandchildren each. */
const family = () => {
  const people = [
    person("gf", "Karmnu Borg", { spouseIds: ["gm"] }),
    person("gm", "Rita Borg", { spouseIds: ["gf"] }),
  ];
  for (let index = 0; index < 6; index += 1) {
    const childId = `c${index}`;
    const spouseId = `cs${index}`;
    people.push(
      person(childId, `Child ${index} Borg`, {
        fatherId: "gf",
        motherId: "gm",
        spouseIds: [spouseId],
      }),
      person(spouseId, `Spouse ${index} Borg`, { spouseIds: [childId] }),
    );
    for (let child = 0; child < 4; child += 1) {
      people.push(
        person(`g${index}_${child}`, `Grandchild ${index}-${child} Borg`, {
          fatherId: childId,
          motherId: spouseId,
        }),
      );
    }
  }
  return people;
};

// Held steady the way the workspace holds it: these come off the normalised
// tree settings, which only change when the tree itself does.
const CARD_FIELDS = Object.freeze({});

const canvasProps = (people) => ({
  treeTitle: "Borg",
  people,
  selectedPersonId: "c1",
  personCardFields: CARD_FIELDS,
  // Deliberately a fresh closure each time, exactly as the workspace supplies
  // them: the canvas is expected to insulate the cards from that churn.
  onSelectPerson: () => {},
  onFocusPerson: () => {},
});

describe("family tree canvas render cost", () => {
  it("does not rebuild the tree geometry when re-rendered with unchanged people", () => {
    const buildLayout = vi.spyOn(treeLayout, "buildFamilyTreeLayout");
    const people = family();
    const props = canvasProps(people);

    act(() => root.render(<FamilyTreeCanvas {...props} />));
    const afterFirstRender = buildLayout.mock.calls.length;
    expect(afterFirstRender).toBeGreaterThan(0);

    for (let index = 0; index < 10; index += 1) {
      act(() => root.render(<FamilyTreeCanvas {...canvasProps(people)} />));
    }

    expect(buildLayout.mock.calls.length).toBe(afterFirstRender);
  });

  it("does not re-run any person card when re-rendered with unchanged people", () => {
    const people = family();

    act(() => root.render(<FamilyTreeCanvas {...canvasProps(people)} />));
    expect(cardBodyRuns.count).toBe(people.length);

    cardBodyRuns.count = 0;
    for (let index = 0; index < 10; index += 1) {
      act(() => root.render(<FamilyTreeCanvas {...canvasProps(people)} />));
    }

    expect(cardBodyRuns.count).toBe(0);
  });

  it("does not recompute card labels when only selection changes", () => {
    const people = family();
    act(() => root.render(<FamilyTreeCanvas {...canvasProps(people)} selectedPersonId="c1" />));

    cardBodyRuns.count = 0;
    act(() => root.render(<FamilyTreeCanvas {...canvasProps(people)} selectedPersonId="c2" />));

    // The selected state still reaches the two affected cards, but their
    // person-derived labels are cached and therefore do not redo whole-family
    // display-name work.
    expect(cardBodyRuns.count).toBe(0);
  });

  it("keeps unaffected cards and layout geometry when one person's label changes", () => {
    const buildLayout = vi.spyOn(treeLayout, "buildFamilyTreeLayout");
    const people = family();
    act(() => root.render(<FamilyTreeCanvas {...canvasProps(people)} />));
    const layoutsAfterFirstRender = buildLayout.mock.calls.length;

    cardBodyRuns.count = 0;
    const changedPeople = people.map((candidate) =>
      candidate.id === "c1" ? { ...candidate, fullName: "Changed Child Borg" } : candidate,
    );
    act(() => root.render(<FamilyTreeCanvas {...canvasProps(changedPeople)} />));

    expect(buildLayout.mock.calls.length).toBe(layoutsAfterFirstRender);
    expect(cardBodyRuns.count).toBe(1);
  });

  it("derives each person's card state once per family, not once per card", () => {
    const people = family();
    act(() => root.render(<FamilyTreeCanvas {...canvasProps(people)} />));

    // Deriving this reads the whole people list. It used to be done twice per
    // person -- once for the action-required legend and again inside the card.
    expect(cardStateDerivations.count).toBe(people.length);
  });

  it("still marks the selected card, and still selects on click", () => {
    const people = family();
    const selected = [];
    const props = { ...canvasProps(people), onSelectPerson: (id) => selected.push(id) };
    act(() => root.render(<FamilyTreeCanvas {...props} selectedPersonId="c1" />));

    const selectedCard = container.querySelector(".family-node.selected");
    expect(selectedCard?.dataset.personId).toBe("c1");

    const other = [...container.querySelectorAll("[data-person-id]")].find(
      (node) => node.dataset.personId === "c2",
    );
    act(() => other.click());
    expect(selected).toEqual(["c2"]);
  });
});
