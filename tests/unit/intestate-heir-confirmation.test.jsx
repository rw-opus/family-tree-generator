// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntestateHeirConfirmation } from "../../src/components/IntestateHeirConfirmation.jsx";

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
