// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TreeToolsPanel } from "../../src/components/TreeToolsPanel.jsx";

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
  startingOwnership: { isComplete: true, totalPercent: 100 },
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

describe("TreeToolsPanel", () => {
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

  function renderPanel(overrides = {}) {
    const props = {
      property,
      people,
      outsideParties: [],
      propertyReport,
      cardFields: { ownershipFraction: true, ownershipValue: false },
      onCardFieldsChange: vi.fn(),
      onFocusEvent: vi.fn(),
      onSelectPerson: vi.fn(),
      ...overrides,
    };
    act(() => root.render(<TreeToolsPanel {...props} />));
    return props;
  }

  it("contains only display and succession tools", () => {
    renderPanel();
    act(() => container.querySelector(".tree-tools-panel-toggle").click());

    expect(container.textContent).toContain("Person card details");
    expect(container.textContent).toContain("Trace succession");
    expect(container.textContent).toContain("View full history");
    expect(container.textContent).not.toContain("Property address");
    expect(container.textContent).not.toContain("Selling price");
    expect(container.textContent).not.toContain("Initial ownership");
    expect(container.textContent).not.toContain("Current owners");
    expect(container.textContent).not.toContain("Tax Calculation");
  });

  it("updates card fields and steps through the calculated history", () => {
    const props = renderPanel();
    act(() => container.querySelector(".tree-tools-panel-toggle").click());

    const cardView = [...container.querySelectorAll("summary")].find((summary) =>
      summary.textContent.includes("Person card details"),
    );
    act(() => cardView.click());
    const valueToggle = [...container.querySelectorAll("label")]
      .find((label) => label.textContent.includes("Current holding value"))
      .querySelector("input");
    act(() => valueToggle.click());
    expect(props.onCardFieldsChange).toHaveBeenCalledWith(
      expect.objectContaining({ ownershipValue: true }),
    );

    const start = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Start"),
    );
    act(() => start.click());
    expect(props.onFocusEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "initial", personId: "deceased" }),
    );

    act(() => container.querySelector('button[aria-label="Next succession event"]').click());
    expect(container.textContent).toContain("Succession of Joseph Borg");
    expect(props.onFocusEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "succession", personId: "deceased" }),
    );
  });

  it("opens the printable full history", () => {
    renderPanel({ expanded: true });
    const openHistory = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("View full history"),
    );
    act(() => openHistory.click());

    expect(document.querySelector(".succession-history-dialog")).not.toBeNull();
    expect(document.body.classList.contains("succession-history-open")).toBe(true);
  });
});
