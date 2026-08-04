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
    const onOpenTax = vi.fn();
    const onSelectPerson = vi.fn();
    const taxReport = {
      vendors: [
        {
          id: "owner",
          name: "Maria Borg",
          share: 1,
          attributedSaleValue: 300000,
          tax: 2400,
          net: 297600,
          rows: [],
        },
      ],
    };
    act(() =>
      root.render(
        <TreePropertyPanel
          property={property}
          people={people}
          outsideParties={[]}
          propertyReport={propertyReport}
          taxReport={taxReport}
          cardFields={{ ownershipFraction: true, ownershipValue: false }}
          onCardFieldsChange={onCardFieldsChange}
          onPropertyChange={vi.fn()}
          onFocusEvent={vi.fn()}
          onOpenProperty={vi.fn()}
          onOpenTax={onOpenTax}
          onSelectPerson={onSelectPerson}
        />,
      ),
    );

    expect(container.textContent).toContain("Ownership and Tax Panel");
    expect(container.textContent).toContain("€300,000.00");
    act(() => container.querySelector(".tree-property-panel-toggle").click());
    expect(container.querySelector('input[aria-label="Property address on tree"]').value).toBe(
      "1 Republic Street",
    );
    expect(container.textContent).toContain("Initial ownership");

    const currentTitle = [...container.querySelectorAll("summary")].find((summary) =>
      summary.textContent.includes("Current owners & values"),
    );
    act(() => currentTitle.click());
    expect(container.textContent).toContain("Maria Borg");
    const ownerLink = container.querySelector(
      'button[aria-label="Open Maria Borg person details"]',
    );
    act(() => ownerLink.click());
    expect(onSelectPerson).toHaveBeenCalledWith("owner");
    expect(container.textContent).toContain("1/1");
    expect(container.textContent).toContain("Tax €2,400.00");
    expect(container.textContent).toContain("Download one-sheet Excel");
    const taxWorkingsButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("View full tax workings"),
    );
    act(() => taxWorkingsButton.click());
    expect(onOpenTax).toHaveBeenCalledOnce();

    const cardView = [...container.querySelectorAll("summary")].find((summary) =>
      summary.textContent.includes("Person card details"),
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

  it("makes legacy additional properties explicitly selectable one at a time", () => {
    const onPropertySelect = vi.fn();
    const secondProperty = { ...property, id: "property-2", address: "2 Merchant Street" };
    act(() =>
      root.render(
        <TreePropertyPanel
          property={property}
          properties={[property, secondProperty]}
          activePropertyId={property.id}
          people={people}
          outsideParties={[]}
          propertyReport={propertyReport}
          cardFields={{}}
          onCardFieldsChange={vi.fn()}
          onPropertyChange={vi.fn()}
          onPropertySelect={onPropertySelect}
          onFocusEvent={vi.fn()}
          onOpenProperty={vi.fn()}
        />,
      ),
    );
    act(() => container.querySelector(".tree-property-panel-toggle").click());
    const selector = container.querySelector(".tree-property-selector select");
    expect(selector).not.toBeNull();
    act(() => {
      selector.value = "property-2";
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onPropertySelect).toHaveBeenCalledWith("property-2");
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

    act(() => container.querySelector(".tree-property-panel-toggle").click());
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

  it("refreshes an active trace snapshot when the calculated owners change", () => {
    const onFocusEvent = vi.fn();
    const renderPanel = (nextPeople, nextReport) => (
      <TreePropertyPanel
        property={property}
        people={nextPeople}
        outsideParties={[]}
        propertyReport={nextReport}
        cardFields={{}}
        onCardFieldsChange={vi.fn()}
        onPropertyChange={vi.fn()}
        onFocusEvent={onFocusEvent}
        onOpenProperty={vi.fn()}
      />
    );

    act(() => root.render(renderPanel(people, propertyReport)));
    act(() => container.querySelector(".tree-property-panel-toggle").click());
    const start = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Start"),
    );
    act(() => start.click());
    act(() => container.querySelector('button[aria-label="Next succession event"]').click());
    act(() => container.querySelector('button[aria-label="Next succession event"]').click());
    expect(onFocusEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ ownershipSnapshot: { owner: 1 } }),
    );

    const mother = { id: "mother", fullName: "Mother of Joseph" };
    const updatedReport = {
      ...propertyReport,
      ownership: {
        transmissions: [
          {
            deceasedId: "deceased",
            amount: 1,
            basis: "intestacy",
            allocations: { mother: 1 },
          },
        ],
      },
      ledger: {
        owners: [
          {
            id: "mother",
            personId: "mother",
            name: "Mother of Joseph",
            share: 1,
          },
        ],
        entries: [],
      },
    };

    act(() => root.render(renderPanel([...people, mother], updatedReport)));

    expect(onFocusEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "sale",
        ownershipSnapshot: { mother: 1 },
      }),
    );
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

    act(() => container.querySelector(".tree-property-panel-toggle").click());
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
