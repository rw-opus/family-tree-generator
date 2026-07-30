// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Properties } from "../../src/components/Properties.jsx";

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

  it("keeps company vendors on a compact manual-tax form", () => {
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
                  taxTreatment: "inheritance",
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
    expect(treatment.disabled).toBe(true);
    expect(container.textContent).toContain("Manually assessed tax");
    expect(container.textContent).not.toContain("Inheritance date");
    expect(container.textContent).not.toContain("Accumulated causa mortis value");
  });
});
