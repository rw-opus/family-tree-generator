// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SuccessionTraceControl } from "../../src/components/SuccessionTraceControl.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const property = {
  id: "property",
  address: "1 Republic Street",
  saleValue: "300000",
  owners: [{ id: "initial", personId: "deceased", shareNumerator: 1, shareDenominator: 1 }],
};
const people = [
  { id: "deceased", fullName: "Joseph Borg", dateOfDeath: "2020-01-02" },
  { id: "owner", fullName: "Maria Borg" },
];
const propertyReport = {
  ownership: {
    transmissions: [
      {
        deceasedId: "deceased",
        amount: 1,
        basis: "intestacy",
        allocations: { owner: 1 },
      },
    ],
  },
  ledger: {
    owners: [{ id: "owner", personId: "owner", name: "Maria Borg", share: 1 }],
    entries: [],
  },
};

describe("SuccessionTraceControl", () => {
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

  function renderControl(overrides = {}) {
    const props = {
      property,
      people,
      outsideParties: [],
      propertyReport,
      onSelectPerson: vi.fn(),
      ...overrides,
    };
    act(() => root.render(<SuccessionTraceControl {...props} />));
    return props;
  }

  it("steps through calculated succession events and links family members", () => {
    const props = renderControl();

    expect(container.textContent).toContain("Trace succession");
    expect(container.textContent).toContain("View full history");

    const start = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Start"),
    );
    act(() => start.click());
    expect(container.textContent).toContain("Initial ownership");

    const personLink = container.querySelector(".trace-person-link");
    act(() => personLink.click());
    expect(props.onSelectPerson).toHaveBeenLastCalledWith("deceased");

    act(() => container.querySelector('button[aria-label="Next succession event"]').click());
    expect(container.textContent).toContain("Succession of Joseph Borg");
  });

  it("opens the printable full history", () => {
    renderControl();
    const openHistory = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("View full history"),
    );
    act(() => openHistory.click());

    expect(document.querySelector(".succession-history-dialog")).not.toBeNull();
    expect(document.body.classList.contains("succession-history-open")).toBe(true);
  });

  it("opens both sides of a sold-out outside-to-family transfer from full history", () => {
    const onSelectPerson = vi.fn();
    const onSelectOutsideOwner = vi.fn();
    const outsideSeller = {
      id: "company",
      name: "Harbour Holdings Limited",
      type: "company",
    };
    renderControl({
      property: {
        id: "sold-out-property",
        address: "1 Harbour Road",
        owners: [
          { id: "company-title", personId: "company", shareNumerator: 1, shareDenominator: 1 },
        ],
      },
      people: [{ id: "buyer", fullName: "Maria Vella" }],
      outsideParties: [outsideSeller],
      propertyReport: {
        ownership: { transmissions: [] },
        ledger: {
          owners: [{ id: "buyer", name: "Maria Vella", share: 1 }],
          entries: [
            {
              id: "company-sale",
              kind: "sale",
              sellerId: "company",
              buyerId: "buyer",
              amount: 1,
              amountFraction: { numerator: 1, denominator: 1 },
              date: "2025-05-25",
            },
          ],
        },
      },
      onSelectPerson,
      onSelectOutsideOwner,
    });

    const openHistory = () =>
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent.includes("View full history"),
      );
    act(() => openHistory().click());
    const sellerLink = document.querySelector(
      'button[aria-label="Open seller Harbour Holdings Limited"]',
    );
    expect(sellerLink).not.toBeNull();
    act(() => sellerLink.click());
    expect(onSelectOutsideOwner).toHaveBeenCalledWith("company");
    expect(document.querySelector(".succession-history-dialog")).toBeNull();

    act(() => openHistory().click());
    const buyerLink = document.querySelector('button[aria-label="Open buyer Maria Vella"]');
    expect(buyerLink).not.toBeNull();
    act(() => buyerLink.click());
    expect(onSelectPerson).toHaveBeenCalledWith("buyer");
    expect(document.querySelector(".succession-history-dialog")).toBeNull();
  });

  it("steps through a recorded transfer that needs attention without hiding it", () => {
    renderControl({
      property: {
        id: "invalid-property",
        owners: [{ id: "initial", personId: "deceased", shareNumerator: 1, shareDenominator: 1 }],
      },
      propertyReport: {
        ownership: { transmissions: [] },
        ledger: {
          owners: [{ id: "deceased", name: "Joseph Borg", share: 1 }],
          entries: [
            {
              id: "invalid-sale",
              kind: "sale",
              sellerId: "deceased",
              buyerId: "",
              amount: 0,
              error: "Select a seller and buyer.",
              date: "2025-05-25",
            },
          ],
        },
      },
    });

    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Start"))
        .click(),
    );
    act(() => container.querySelector('button[aria-label="Next succession event"]').click());

    expect(container.querySelector(".succession-trace-event.invalid")).not.toBeNull();
    expect(container.textContent).toContain(
      "Recorded sale needs attention: Select a seller and buyer.",
    );
  });
});
