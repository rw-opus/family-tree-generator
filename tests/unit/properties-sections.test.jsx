// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Properties } from "../../src/components/Properties.jsx";
import {
  intestacyAllocationSignature,
  intestateAllocations,
} from "../../src/domain/familyOwnership.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const people = [{ id: "owner", fullName: "Joseph Borg" }];
const properties = [
  {
    id: "property",
    address: "1 Republic Street",
    owners: [
      {
        id: "initial-owner",
        personId: "owner",
        sharePercent: 100,
        shareNumerator: 1,
        shareDenominator: 1,
      },
    ],
    declarations: [],
    transfers: [],
    saleLots: [],
    saleValue: "250000",
  },
];

describe("Properties section views", () => {
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

  const renderSection = (section) => {
    act(() =>
      root.render(
        <Properties
          properties={properties}
          people={people}
          outsideParties={[]}
          singleProperty
          section={section}
          onChange={vi.fn()}
        />,
      ),
    );
  };

  it("preserves the complete view by default", () => {
    act(() =>
      root.render(
        <Properties
          properties={properties}
          people={people}
          outsideParties={[]}
          singleProperty
          onChange={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).toContain("Initial owner/s of the property");
    expect(container.textContent).toContain("Value of the property being sold today");
    expect(container.textContent).toContain("Calculated title after inheritance");
    expect(container.textContent).toContain("Ownership transfers");
    expect(container.textContent).toContain("Tax Calculation");
  });

  it("keeps exact ownership available when every monetary value is omitted", () => {
    act(() =>
      root.render(
        <Properties
          properties={[{ ...properties[0], saleValue: "" }]}
          people={people}
          outsideParties={[]}
          singleProperty
          onChange={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).toContain(
      "Value of the property being sold today (€) (optional)",
    );
    expect(container.textContent).toContain("Consideration (€) (optional)");
    expect(container.textContent).toContain("1/1");
    expect(container.textContent).toContain("Total sale value Not entered");
    expect(container.textContent).toContain("Not calculated");
    expect(container.textContent).not.toContain("€0.00");
  });

  it.each([
    [
      "property",
      ["Value of the property being sold today", "Initial owner/s of the property"],
      ["Calculated title after inheritance", "Ownership transfers", "Tax Calculation"],
    ],
    [
      "ownership",
      ["Calculated title after inheritance", "Ownership transfers"],
      [
        "Value of the property being sold today",
        "Initial owner/s of the property",
        "Tax Calculation",
      ],
    ],
    [
      "tax",
      ["Tax Calculation"],
      [
        "Value of the property being sold today",
        "Initial owner/s of the property",
        "Ownership transfers",
      ],
    ],
  ])("renders only the %s section", (section, visibleText, hiddenText) => {
    renderSection(section);

    visibleText.forEach((text) => expect(container.textContent).toContain(text));
    hiddenText.forEach((text) => expect(container.textContent).not.toContain(text));
  });

  it("updates today's property value without exposing property-level declarations", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        <Properties
          properties={properties}
          people={people}
          outsideParties={[]}
          singleProperty
          section="property"
          onChange={onChange}
        />,
      ),
    );

    expect(container.textContent).not.toContain("Declarations of succession");
    expect(container.textContent).not.toContain("Declaration Causa Mortis");

    const saleValue = container.querySelector(
      'input[aria-label="Value of the property being sold today"]',
    );
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    act(() => {
      setValue.call(saleValue, "325000");
      saleValue.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith({
      properties: [{ ...properties[0], saleValue: "325000" }],
    });
  });

  it("opens a linked person's details from ownership and tax labels", () => {
    const onSelectPerson = vi.fn();
    act(() =>
      root.render(
        <Properties
          properties={properties}
          people={people}
          outsideParties={[]}
          singleProperty
          section="ownership"
          onSelectPerson={onSelectPerson}
          onChange={vi.fn()}
        />,
      ),
    );

    act(() => container.querySelector(".ownership-person-link").click());
    expect(onSelectPerson).toHaveBeenLastCalledWith("owner");

    act(() =>
      root.render(
        <Properties
          properties={properties}
          people={people}
          outsideParties={[]}
          singleProperty
          section="tax"
          onSelectPerson={onSelectPerson}
          onChange={vi.fn()}
        />,
      ),
    );

    act(() => container.querySelector(".tax-person-link").click());
    expect(onSelectPerson).toHaveBeenLastCalledWith("owner");
  });

  it("shows safe tax subtotals and opens a printable list for every vendor", () => {
    const mixedPeople = [
      { id: "first-owner", fullName: "Maria Borg", spouseIds: [] },
      { id: "second-owner", fullName: "Joseph Vella", spouseIds: [] },
    ];
    const mixedProperty = {
      ...properties[0],
      saleDate: "2026-08-13",
      owners: [
        {
          id: "first-title",
          personId: "first-owner",
          shareNumerator: 1,
          shareDenominator: 2,
          acquisitionDate: "2020-01-01",
        },
        {
          id: "second-title",
          personId: "second-owner",
          shareNumerator: 1,
          shareDenominator: 2,
        },
      ],
    };

    act(() =>
      root.render(
        <Properties
          properties={[mixedProperty]}
          people={mixedPeople}
          outsideParties={[]}
          singleProperty
          section="tax"
          onChange={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).toContain("Calculated tax subtotal");
    expect(container.textContent).toContain("€10,000.00");
    expect(container.textContent).toContain("Calculated net subtotal");
    expect(container.textContent).toContain("€115,000.00");
    expect(container.textContent).toContain("1 source fraction is not yet calculated");
    expect(container.textContent).toContain("€125,000.00 of the selling price remains unassessed");

    const openList = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Open printable vendor list"),
    );
    act(() => openList.click());

    const statement = document.querySelector(".vendor-settlement-dialog");
    expect(statement).not.toBeNull();
    expect(statement.querySelectorAll(".vendor-settlement-vendor-row")).toHaveLength(2);
    expect(statement.textContent).toContain("Maria Borg");
    expect(statement.textContent).toContain("Joseph Vella");
  });

  it("shows each recorded transfer once in the current-owner ledger", () => {
    const transferredPeople = [
      { id: "owner", fullName: "Joseph Borg" },
      { id: "buyer", fullName: "Maria Vella" },
    ];
    const transferredProperty = {
      ...properties[0],
      transfers: [
        {
          id: "sale",
          kind: "sale",
          sellerId: "owner",
          buyerId: "buyer",
          numerator: 1,
          denominator: 4,
          amountType: "whole-property",
          date: "2020-01-01",
          provenance: [{ trancheId: "initial-initial-owner", numerator: 1, denominator: 4 }],
        },
      ],
    };

    act(() =>
      root.render(
        <Properties
          properties={[transferredProperty]}
          people={transferredPeople}
          outsideParties={[]}
          singleProperty
          section="ownership"
          onChange={vi.fn()}
        />,
      ),
    );

    const ownerRows = [...container.querySelectorAll(".owner-list .owner-row")].map((row) =>
      row.textContent.replace(/\s+/g, " ").trim(),
    );
    expect(ownerRows).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Joseph Borg.*3\/4/),
        expect.stringMatching(/Maria Vella.*1\/4/),
      ]),
    );
  });

  it("shows a manually assessed company vendor as read-only information", () => {
    act(() =>
      root.render(
        <Properties
          properties={[
            {
              ...properties[0],
              transfers: [
                {
                  id: "sale",
                  sellerId: "owner",
                  buyerId: "company",
                  numerator: 1,
                  denominator: 1,
                  amountType: "whole-property",
                  date: "2021-01-01",
                },
              ],
              saleLots: [
                {
                  id: "company-lot",
                  ownerId: "company",
                  taxTreatment: "manual",
                  transferValue: 100,
                  manualTaxAmount: 5,
                  useDeclaredValues: false,
                },
              ],
            },
          ]}
          people={people}
          outsideParties={[{ id: "company", name: "Buyer Limited", type: "company" }]}
          singleProperty
          section="tax"
          onChange={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector("select")).toBeNull();
    expect(container.textContent).toContain("Manually assessed tax: €5.00");
    expect(container.textContent).toContain("Buyer Limited");
    expect(container.textContent).not.toContain("Inheritance date");
    expect(container.textContent).not.toContain("Accumulated causa mortis value");
  });

  it("shows automatic 7% treatment without causa mortis value fields for a pre-cutoff death", () => {
    const inheritedPeople = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "1992-11-24",
        inheritanceBasis: "intestacy",
        spouseIds: [],
      },
      { id: "child", fullName: "Maria Borg", fatherId: "deceased", spouseIds: [] },
    ];
    const calculated = intestateAllocations(inheritedPeople, "deceased");
    const deceasedWithRows = {
      ...inheritedPeople[0],
      intestateHeirs: [{ id: "child-share", personId: "child", sharePercent: 100 }],
    };
    inheritedPeople[0] = {
      ...deceasedWithRows,
      intestateHeirsConfirmed: true,
      intestateConfirmationBasis: intestacyAllocationSignature(deceasedWithRows, calculated),
    };
    const inheritedProperty = {
      id: "property",
      address: "1 Republic Street",
      owners: [{ id: "initial-owner", personId: "deceased", sharePercent: 100 }],
      declarations: [],
      transfers: [],
      saleLots: [
        {
          id: "child-sale",
          ownerId: "child",
          acquisitionType: "inheritance",
          inheritanceDate: "",
          transferDate: "2026-07-31",
          shareNumerator: 1,
          shareDenominator: 1,
          acquisitionValue: "",
          transferValue: 200,
          consideration: 200,
          useDeclaredValues: true,
        },
      ],
    };

    act(() =>
      root.render(
        <Properties
          properties={[inheritedProperty]}
          people={inheritedPeople}
          outsideParties={[]}
          singleProperty
          section="tax"
          onChange={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).toContain("7% of transfer value");
    expect(container.textContent).not.toContain("Causa mortis value for this fraction");
    expect(container.textContent).not.toContain("Legal basis of acquisition value");
    expect(container.textContent).not.toContain("Use the accumulated value");
    expect(container.textContent).toContain("d. 24/11/1992");
    expect(container.querySelector("select")).toBeNull();
  });

  it("blocks calculated ownership until a starting owner is entered", () => {
    act(() =>
      root.render(
        <Properties
          properties={[{ ...properties[0], owners: [] }]}
          people={people}
          outsideParties={[]}
          singleProperty
          section="ownership"
          onChange={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).toContain("No starting ownership has been set.");
    expect(container.textContent).toContain("Enter who owned this property before any transfers.");
    expect(container.textContent).not.toContain("Calculated title after inheritance");
    expect(container.textContent).not.toContain("Ownership transfers");
  });

  it("shows the actual under-allocation and withholds tax figures", () => {
    act(() =>
      root.render(
        <Properties
          properties={[
            {
              ...properties[0],
              owners: [
                {
                  ...properties[0].owners[0],
                  sharePercent: 60,
                  shareNumerator: 3,
                  shareDenominator: 5,
                },
              ],
            },
          ]}
          people={people}
          outsideParties={[]}
          singleProperty
          section="tax"
          onChange={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).toContain("Starting ownership totals 60%.");
    expect(container.textContent).toContain("must equal 100%");
    expect(container.textContent).not.toContain("Tax Calculation");
  });

  describe("multi-property workspace", () => {
    it("lists every property with its own address and lets a second property be added", () => {
      const onChange = vi.fn();
      const secondProperty = {
        id: "property-2",
        address: "2 Merchants Street",
        owners: [],
        declarations: [],
        transfers: [],
        saleLots: [],
      };
      act(() =>
        root.render(
          <Properties
            properties={[properties[0], secondProperty]}
            people={people}
            outsideParties={[]}
            section="property"
            onChange={onChange}
          />,
        ),
      );

      expect(container.textContent).toContain("1 Republic Street");
      expect(container.textContent).toContain("2 Merchants Street");
      expect(container.querySelectorAll(".editor-panel")).toHaveLength(2);

      const addButton = [...container.querySelectorAll("button")].find((button) =>
        button.textContent.includes("Add property"),
      );
      expect(addButton).not.toBeUndefined();
      act(() => addButton.click());

      expect(onChange).toHaveBeenCalledWith({
        properties: [
          properties[0],
          secondProperty,
          expect.objectContaining({ address: "", owners: [] }),
        ],
      });
    });

    it("shows the empty state and no add-property gate when there are no properties", () => {
      act(() =>
        root.render(
          <Properties
            properties={[]}
            people={people}
            outsideParties={[]}
            section="property"
            onChange={vi.fn()}
          />,
        ),
      );

      expect(container.textContent).toContain("No properties yet");
      expect(
        [...container.querySelectorAll("button")].some((button) =>
          button.textContent.includes("Add property"),
        ),
      ).toBe(true);
    });
  });
});
