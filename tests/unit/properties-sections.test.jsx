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
    expect(container.textContent).toContain("Ownership transfers");
    expect(container.textContent).toContain("Seller tax lots");
  });

  it.each([
    ["property", ["Initial owner/s of the property"], ["Ownership transfers", "Seller tax lots"]],
    ["ownership", ["Initial owner/s of the property", "Ownership transfers"], ["Seller tax lots"]],
    ["tax", ["Seller tax lots"], ["Initial owner/s of the property", "Ownership transfers"]],
  ])("renders only the %s section", (section, visibleText, hiddenText) => {
    renderSection(section);

    visibleText.forEach((text) => expect(container.textContent).toContain(text));
    hiddenText.forEach((text) => expect(container.textContent).not.toContain(text));
  });

  it("keeps a manually assessed company vendor on a compact form", () => {
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

    const treatment = container.querySelector('select[aria-label="Tax treatment"]');
    expect(treatment.value).toBe("manual");
    expect(treatment.disabled).toBe(false);
    expect(container.textContent).toContain("Manually assessed tax");
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
    inheritedPeople[0] = {
      ...inheritedPeople[0],
      intestateHeirs: [{ id: "child-share", personId: "child", sharePercent: 100 }],
      intestateHeirsConfirmed: true,
      intestateConfirmationBasis: intestacyAllocationSignature(inheritedPeople[0], calculated),
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

    expect(container.textContent).toContain("7% of its transfer value");
    expect(container.textContent).toContain("7% of transfer value");
    expect(container.textContent).not.toContain("Causa mortis value for this fraction");
    expect(container.textContent).not.toContain("Legal basis of acquisition value");
    expect(container.textContent).not.toContain("Use the accumulated value");
    const inheritanceDate = [...container.querySelectorAll('input[placeholder="dd-mm-yyyy"]')].find(
      (input) => input.value === "24-11-1992",
    );
    expect(inheritanceDate).not.toBeUndefined();
    expect(inheritanceDate.disabled).toBe(true);
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
    expect(container.textContent).not.toContain("Seller tax lots");
    expect(container.textContent).not.toContain("Tax payable by each living vendor");
  });
});
