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
});
