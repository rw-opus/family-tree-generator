// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IntestacyProposal,
  IntestateHeirConfirmation,
} from "../../src/components/IntestateHeirConfirmation.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

const deceased = {
  id: "deceased",
  fullName: "Joseph Borg",
  isDeceased: true,
  dateOfDeath: "2020-01-01",
  designations: ["Deceased"],
  spouseIds: [],
};
const child = { id: "child", fullName: "Paul Borg", designations: [], spouseIds: [] };
const spouse = { id: "spouse", fullName: "Maria Borg", designations: [], spouseIds: [] };
const people = [deceased, child, spouse];
const initialCalculation = {
  shares: new Map([[child.id, 1]]),
  destination: "descendants",
  contextSignature: "children-only",
  warnings: [],
};
const changedCalculation = {
  shares: new Map([
    [spouse.id, 0.5],
    [child.id, 0.5],
  ]),
  destination: "spouse-and-descendants",
  contextSignature: "spouse-and-children",
  warnings: [],
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function inspector(calculated, onUpdatePerson = vi.fn()) {
  return (
    <IntestateHeirConfirmation
      deceased={deceased}
      people={people}
      calculated={calculated}
      shareDisplay="percentage"
      displayName={(person) => person?.fullName || "Unknown person"}
      onUpdatePerson={onUpdatePerson}
    />
  );
}

function editBeneficiaries() {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent.trim() === "Edit Beneficiaries",
  );
  act(() => button.click());
}

describe("IntestateHeirConfirmation draft context", () => {
  it("shows equal shares for every checked suggested heir", () => {
    const heirs = ["first", "second", "third"].map((id) => ({
      id,
      fullName: `${id} heir`,
      designations: [],
      spouseIds: [],
    }));
    const onSelectedPersonIdsChange = vi.fn();

    act(() =>
      root.render(
        <IntestacyProposal
          calculated={{ shares: new Map(heirs.map((heir) => [heir.id, 1 / 3])) }}
          people={heirs}
          displayName={(person) => person.fullName}
          shareDisplay="both"
          selectedPersonIds={heirs.map((heir) => heir.id)}
          onSelectedPersonIdsChange={onSelectedPersonIdsChange}
        />,
      ),
    );

    expect(container.textContent).toContain("1/3 · 33.33%");
    expect(container.querySelectorAll('input[aria-label^="Select "]:checked')).toHaveLength(4);

    act(() =>
      container.querySelector('input[aria-label="Select second heir as a suggested heir"]').click(),
    );
    expect(onSelectedPersonIdsChange).toHaveBeenCalledWith(["first", "third"]);
  });

  it("reconciles three exact thirds across the proposal and editable percentage boxes", () => {
    const heirs = ["first", "second", "third"].map((id) => ({
      id,
      fullName: `${id} heir`,
      designations: [],
      spouseIds: [],
    }));
    const threeWayDeceased = { ...deceased, spouseIds: [] };
    const threeWayPeople = [threeWayDeceased, ...heirs];
    const calculated = {
      shares: new Map(heirs.map((heir) => [heir.id, 1 / 3])),
      exactShares: new Map(heirs.map((heir) => [heir.id, { numerator: 1, denominator: 3 }])),
      destination: "descendants",
      warnings: [],
    };
    const onUpdatePerson = vi.fn();

    act(() =>
      root.render(
        <IntestateHeirConfirmation
          deceased={threeWayDeceased}
          people={threeWayPeople}
          calculated={calculated}
          shareDisplay="percentage"
          displayName={(person) => person?.fullName || "Unknown person"}
          onUpdatePerson={onUpdatePerson}
        />,
      ),
    );

    expect(
      [...container.querySelectorAll(".calculated-intestacy-row b")].map(
        (label) => label.textContent,
      ),
    ).toEqual(["33.34%", "33.33%", "33.33%"]);

    editBeneficiaries();
    const percentages = [...container.querySelectorAll(".confirmed-heir-percent input")];
    expect(percentages.map((input) => input.value)).toEqual(["33.34", "33.33", "33.33"]);
    expect(percentages.reduce((total, input) => total + Number(input.value), 0)).toBe(100);
    percentages.forEach((input) => {
      expect(input.step).toBe("0.01");
      expect(input.inputMode).toBe("decimal");
    });

    const apply = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent.includes("Apply edited beneficiaries"),
    );
    expect(apply.disabled).toBe(false);
    act(() => apply.click());
    expect(onUpdatePerson).toHaveBeenCalledWith(
      threeWayDeceased.id,
      expect.objectContaining({
        intestateHeirs: expect.arrayContaining([
          expect.objectContaining({ shareNumerator: 1, shareDenominator: 3 }),
          expect.objectContaining({ shareNumerator: 1, shareDenominator: 3 }),
          expect.objectContaining({ shareNumerator: 1, shareDenominator: 3 }),
        ]),
      }),
    );
  });

  it("ignores a persisted over-precision draft string and preserves its exact thirds on blur", () => {
    const heirs = ["first", "second", "third"].map((id) => ({
      id,
      fullName: `${id} heir`,
      designations: [],
      spouseIds: [],
    }));
    const savedRows = heirs.map((heir, index) => ({
      id: `saved-${index}`,
      personId: heir.id,
      shareNumerator: 1,
      shareDenominator: 3,
      sharePercent: 100 / 3,
      sharePercentInput: "33.3333333333333",
    }));
    const savedDeceased = {
      ...deceased,
      intestateHeirs: savedRows,
      intestateHeirsConfirmed: true,
    };
    const savedPeople = [savedDeceased, ...heirs];
    const calculated = {
      shares: new Map(heirs.map((heir) => [heir.id, 1 / 3])),
      exactShares: new Map(heirs.map((heir) => [heir.id, { numerator: 1, denominator: 3 }])),
      destination: "descendants",
      warnings: [],
    };
    const onUpdatePerson = vi.fn();

    act(() =>
      root.render(
        <IntestateHeirConfirmation
          deceased={savedDeceased}
          people={savedPeople}
          calculated={calculated}
          shareDisplay="percentage"
          displayName={(person) => person?.fullName || "Unknown person"}
          onUpdatePerson={onUpdatePerson}
        />,
      ),
    );
    editBeneficiaries();

    const percentages = [...container.querySelectorAll(".confirmed-heir-percent input")];
    expect(percentages.map((input) => input.value)).toEqual(["33.34", "33.33", "33.33"]);
    act(() => {
      percentages[0].focus();
      percentages[0].blur();
    });
    const apply = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent.includes("Apply edited beneficiaries"),
    );
    expect(apply.disabled).toBe(false);
    act(() => apply.click());

    const saved = onUpdatePerson.mock.calls.at(-1)[1].intestateHeirs;
    expect(saved.map((row) => [row.shareNumerator, row.shareDenominator])).toEqual([
      [1, 3],
      [1, 3],
      [1, 3],
    ]);
    expect(saved[0].sharePercentInput).toBeUndefined();
  });

  it("uses the reconciled near-whole total beside edited heir boxes", () => {
    const heirs = ["first", "second", "third"].map((id) => ({
      id,
      fullName: `${id} heir`,
      designations: [],
      spouseIds: [],
    }));
    const savedDeceased = {
      ...deceased,
      intestateHeirsConfirmed: true,
      intestateHeirs: [
        {
          id: "saved-first",
          personId: "first",
          shareNumerator: 3333,
          shareDenominator: 10000,
        },
        ...heirs.slice(1).map((heir, index) => ({
          id: `saved-${index + 2}`,
          personId: heir.id,
          shareNumerator: 1,
          shareDenominator: 3,
        })),
      ],
    };
    const calculated = {
      shares: new Map(heirs.map((heir) => [heir.id, 1 / 3])),
      exactShares: new Map(heirs.map((heir) => [heir.id, { numerator: 1, denominator: 3 }])),
      destination: "descendants",
      warnings: [],
    };

    act(() =>
      root.render(
        <IntestateHeirConfirmation
          deceased={savedDeceased}
          people={[savedDeceased, ...heirs]}
          calculated={calculated}
          shareDisplay="percentage"
          displayName={(person) => person?.fullName || "Unknown person"}
          onUpdatePerson={vi.fn()}
        />,
      ),
    );
    editBeneficiaries();

    expect(
      [...container.querySelectorAll(".confirmed-heir-percent input")].map((input) => input.value),
    ).toEqual(["33.33", "33.33", "33.33"]);
    expect(
      container.querySelector(".intestate-confirmation-footer .succession-total").textContent,
    ).toContain("Total: 99.99% - must equal 100%");
  });

  it("normalises an explicitly typed heir percentage only on blur", () => {
    act(() => root.render(inspector(initialCalculation)));
    editBeneficiaries();

    let percentage = container.querySelector('input[aria-label="Share percentage for Paul Borg"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        percentage,
        "33.335",
      );
      percentage.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      container.querySelector('input[aria-label="Share percentage for Paul Borg"]').value,
    ).toBe("33.335");

    percentage = container.querySelector('input[aria-label="Share percentage for Paul Borg"]');
    act(() => {
      percentage.focus();
      percentage.blur();
    });

    expect(
      container.querySelector('input[aria-label="Share percentage for Paul Borg"]').value,
    ).toBe("33.34");
  });

  it("rebases an untouched automatic draft when the legal context changes", () => {
    const onUpdatePerson = vi.fn();
    act(() => root.render(inspector(initialCalculation, onUpdatePerson)));
    editBeneficiaries();
    expect(container.querySelectorAll(".confirmed-heir-row")).toHaveLength(1);

    act(() => root.render(inspector(changedCalculation, onUpdatePerson)));

    expect(container.querySelectorAll(".confirmed-heir-row")).toHaveLength(2);
    expect(container.textContent).toContain("Maria Borg");
    const apply = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent.includes("Apply edited beneficiaries"),
    );
    expect(apply.disabled).toBe(false);
    act(() => apply.click());

    expect(onUpdatePerson).toHaveBeenCalledWith(
      deceased.id,
      expect.objectContaining({
        intestateHeirsConfirmed: true,
        intestateHeirs: expect.arrayContaining([
          expect.objectContaining({ personId: spouse.id, sharePercent: 50 }),
          expect.objectContaining({ personId: child.id, sharePercent: 50 }),
        ]),
      }),
    );
  });

  it("blocks a modified draft after the legal context changes", () => {
    const onUpdatePerson = vi.fn();
    act(() => root.render(inspector(initialCalculation, onUpdatePerson)));
    editBeneficiaries();

    const percentage = container.querySelector(
      'input[aria-label="Share percentage for Paul Borg"]',
    );
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        percentage,
        "99",
      );
      percentage.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        percentage,
        "100",
      );
      percentage.dispatchEvent(new Event("input", { bubbles: true }));
    });

    act(() => root.render(inspector(changedCalculation, onUpdatePerson)));

    expect(container.querySelectorAll(".confirmed-heir-row")).toHaveLength(1);
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      "facts changed while these edits were open",
    );
    const apply = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent.includes("Apply edited beneficiaries"),
    );
    expect(apply.disabled).toBe(true);
    act(() => apply.click());
    expect(onUpdatePerson).not.toHaveBeenCalled();
  });
});
