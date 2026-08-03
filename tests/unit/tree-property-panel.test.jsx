// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TreePropertyPanel } from "../../src/components/TreePropertyPanel.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const property = {
  id: "property",
  address: "1 Republic Street",
  saleValue: "300000",
  owners: [
    {
      id: "initial-owner",
      personId: "deceased",
      sharePercent: 100,
      shareNumerator: 1,
      shareDenominator: 1,
    },
  ],
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
    owners: [
      {
        id: "owner",
        personId: "owner",
        name: "Maria Borg",
        share: 1,
      },
    ],
    entries: [],
  },
};

describe("TreePropertyPanel", () => {
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

  it("combines selling price, initial shares, current values, and card controls", () => {
    const onCardFieldsChange = vi.fn();
    act(() =>
      root.render(
        <TreePropertyPanel
          property={property}
          people={people}
          outsideParties={[]}
          propertyReport={propertyReport}
          cardFields={{ ownershipFraction: true, ownershipValue: false }}
          onCardFieldsChange={onCardFieldsChange}
          onPropertyChange={vi.fn()}
          onFocusEvent={vi.fn()}
          onOpenProperty={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).toContain("Property & Tree View");
    expect(container.textContent).toContain("1 Republic Street");
    expect(container.textContent).toContain("€300,000.00");
    expect(container.textContent).toContain("Define initial shares");

    const currentTitle = [...container.querySelectorAll("summary")].find((summary) =>
      summary.textContent.includes("Current title and values"),
    );
    act(() => currentTitle.click());
    expect(container.textContent).toContain("Maria Borg");
    expect(container.textContent).toContain("1/1");

    const cardView = [...container.querySelectorAll("summary")].find((summary) =>
      summary.textContent.includes("View person cards"),
    );
    act(() => cardView.click());
    const valueToggle = [...container.querySelectorAll("label")]
      .find((label) => label.textContent.includes("Current holding value"))
      .querySelector("input");
    act(() => valueToggle.click());
    expect(onCardFieldsChange).toHaveBeenCalledWith(
      expect.objectContaining({ ownershipValue: true }),
    );
  });

  it("steps through succession events and focuses the relevant person", () => {
    const onFocusEvent = vi.fn();
    act(() =>
      root.render(
        <TreePropertyPanel
          property={property}
          people={people}
          outsideParties={[]}
          propertyReport={propertyReport}
          cardFields={{}}
          onCardFieldsChange={vi.fn()}
          onPropertyChange={vi.fn()}
          onFocusEvent={onFocusEvent}
          onOpenProperty={vi.fn()}
        />,
      ),
    );

    const start = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Start"),
    );
    act(() => start.click());
    expect(container.textContent).toContain("Initial ownership");
    expect(onFocusEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "initial",
        personId: "deceased",
        ownershipSnapshot: { deceased: 1 },
      }),
    );

    act(() => container.querySelector('button[aria-label="Next succession event"]').click());
    expect(container.textContent).toContain("Succession of Joseph Borg");
    expect(container.textContent).toContain("Maria Borg receives 1/1 (100%)");
    expect(onFocusEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "succession",
        personId: "deceased",
        ownershipSnapshot: { deceased: 1 },
      }),
    );

    act(() => container.querySelector('button[aria-label="Next succession event"]').click());
    expect(container.textContent).toContain("Proposed property sale");
    expect(container.textContent).toContain("€300,000.00");

    const endTrace = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("End trace"),
    );
    act(() => endTrace.click());
    expect(onFocusEvent).toHaveBeenLastCalledWith(null);
    expect(container.textContent).not.toContain("Proposed property sale");
  });

  it("opens and prints the complete succession history", () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    act(() =>
      root.render(
        <TreePropertyPanel
          property={property}
          people={people}
          outsideParties={[]}
          propertyReport={propertyReport}
          cardFields={{}}
          onCardFieldsChange={vi.fn()}
          onPropertyChange={vi.fn()}
          onFocusEvent={vi.fn()}
          onOpenProperty={vi.fn()}
        />,
      ),
    );

    const openHistory = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("View full history"),
    );
    act(() => openHistory.click());

    const dialog = document.querySelector(".succession-history-dialog");
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("Full Succession History");
    expect(dialog.textContent).toContain("Initial ownership");
    expect(dialog.textContent).toContain("Succession of Joseph Borg");
    expect(dialog.textContent).toContain("Proposed property sale");
    expect(document.body.classList.contains("succession-history-open")).toBe(true);

    const printHistory = [...dialog.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Print history"),
    );
    act(() => printHistory.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(printSpy).toHaveBeenCalledOnce();

    act(() =>
      dialog
        .querySelector('button[aria-label="Close full succession history"]')
        .dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(document.querySelector(".succession-history-dialog")).toBeNull();
    expect(document.body.classList.contains("succession-history-open")).toBe(false);
    printSpy.mockRestore();
  });
});
