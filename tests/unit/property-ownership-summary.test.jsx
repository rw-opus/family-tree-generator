// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PropertyOwnershipSummary } from "../../src/components/PropertyOwnershipSummary.jsx";
import {
  buildPropertyVendorTaxReport,
  buildTaxCalculationReport,
} from "../../src/domain/propertyVendorTax.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("PropertyOwnershipSummary", () => {
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

  function renderSummary(onSelectPerson = vi.fn()) {
    act(() =>
      root.render(
        <PropertyOwnershipSummary
          people={[
            { id: "seller", fullName: "Joseph Borg" },
            { id: "buyer", fullName: "Maria Vella" },
          ]}
          outsideParties={[]}
          startingOwnership={{ seller: 1 }}
          transfers={[
            {
              id: "donation",
              kind: "donation",
              sellerId: "seller",
              buyerId: "buyer",
              numerator: 1,
              denominator: 4,
              amountType: "whole-property",
              date: "2025-05-25",
            },
          ]}
          onSelectPerson={onSelectPerson}
        />,
      ),
    );
    return onSelectPerson;
  }

  function renderOwnerValues({ saleValue, shares, taxCalculationReport = null }) {
    const people = shares.map((share, index) => ({
      id: `owner-${index + 1}`,
      fullName: `Owner ${index + 1}`,
      share,
    }));
    act(() =>
      root.render(
        <PropertyOwnershipSummary
          people={people}
          outsideParties={[]}
          property={{ id: "property", saleValue }}
          startingOwnership={Object.fromEntries(people.map((person) => [person.id, person.share]))}
          transfers={[]}
          taxCalculationReport={taxCalculationReport}
        />,
      ),
    );
  }

  const setSelect = (select, value) => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const setInput = (input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const company = {
    id: "company",
    name: "Harbour Holdings Limited",
    type: "company",
    registrationNumber: "C 12345",
  };
  const companyProperty = (transfers = []) => ({
    id: "property",
    address: "1 Harbour Road",
    owners: [
      {
        id: "company-owner",
        personId: "company",
        shareNumerator: 1,
        shareDenominator: 1,
      },
    ],
    transfers,
    declarations: [],
    saleLots: [],
  });

  function renderCompanySummary({
    transfers = [],
    onChange = vi.fn(),
    property: suppliedProperty = null,
    startingOwnership = { company: 1 },
  } = {}) {
    const property = suppliedProperty || companyProperty(transfers);
    act(() =>
      root.render(
        <PropertyOwnershipSummary
          people={[
            { id: "buyer", fullName: "Maria Vella" },
            { id: "other", fullName: "Joseph Borg" },
          ]}
          outsideParties={[company]}
          property={property}
          startingOwnership={startingOwnership}
          transfers={transfers}
          onOutsideOwnerTransactionsChange={onChange}
        />,
      ),
    );
    return { onChange, property };
  }

  it("shows current ownership without duplicating the succession trace", () => {
    renderSummary();

    const ownerRows = [...container.querySelectorAll(".read-only-owner-row")].map((row) =>
      row.textContent.replace(/\s+/g, " ").trim(),
    );
    expect(ownerRows).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Joseph Borg.*3\/4.*75%/),
        expect.stringMatching(/Maria Vella.*1\/4.*25%/),
      ]),
    );
    expect(container.textContent).not.toContain("Recorded transfer history");
    expect(container.textContent).not.toContain("25/05/2025");

    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector('button[aria-label="Remove transfer"]')).toBeNull();
    expect(container.textContent).not.toContain("Record a sale or transfer");
    expect(container.textContent).not.toContain("Add an outside buyer or company");
  });

  it("shows each current owner's cent-exact share of the recorded property value", () => {
    renderOwnerValues({ saleValue: "1000000", shares: [0.75, 0.25] });

    expect(
      [...container.querySelectorAll(".owner-value")].map((value) => value.textContent),
    ).toEqual(["Current value €750,000.00", "Current value €250,000.00"]);
  });

  it("announces a deceased owner's calculated share as a notional value", () => {
    act(() =>
      root.render(
        <PropertyOwnershipSummary
          people={[{ id: "deceased", fullName: "Joseph Borg", isDeceased: true }]}
          outsideParties={[]}
          property={{ id: "property", saleValue: "100000" }}
          startingOwnership={{ deceased: 1 }}
          transfers={[]}
        />,
      ),
    );

    expect(container.querySelector(".owner-value").textContent).toBe("Notional value €100,000.00");
    expect(container.querySelector(".owner-status").textContent).toBe("Heirs to be Identified");
  });

  it("reconciles rounded owner values to the recorded total", () => {
    renderOwnerValues({ saleValue: "1", shares: [1 / 3, 1 / 3, 1 / 3] });

    expect(
      [...container.querySelectorAll(".owner-value")].map((value) => value.textContent),
    ).toEqual(["Current value €0.34", "Current value €0.33", "Current value €0.33"]);
    const displayedPercentages = [
      ...container.querySelectorAll(".owner-share > small:first-of-type"),
    ]
      .map((label) => label.textContent)
      .filter((label) => label.endsWith("%"));
    expect(displayedPercentages).toEqual(["33.34%", "33.33%", "33.33%"]);
    expect(displayedPercentages.reduce((total, label) => total + Number.parseFloat(label), 0)).toBe(
      100,
    );
  });

  it("uses the reconciled row total instead of masking a near-whole title as 100%", () => {
    const people = ["first", "second", "third"].map((id) => ({
      id,
      fullName: `Owner ${id}`,
    }));
    const owners = [
      {
        id: "first",
        share: 3333 / 10000,
        shareFraction: { numerator: 3333, denominator: 10000 },
      },
      ...people.slice(1).map((person) => ({
        id: person.id,
        share: 1 / 3,
        shareFraction: { numerator: 1, denominator: 3 },
      })),
    ];

    act(() =>
      root.render(
        <PropertyOwnershipSummary
          people={people}
          outsideParties={[]}
          transfers={[]}
          startingOwnership={{}}
          vendorReport={{
            ledger: {
              owners,
              parties: people.map((person) => ({ id: person.id, name: person.fullName })),
              total: 29999 / 30000,
              totalFraction: { numerator: 29999, denominator: 30000 },
            },
          }}
        />,
      ),
    );

    expect(
      [...container.querySelectorAll(".owner-share > small:first-of-type")].map(
        (label) => label.textContent,
      ),
    ).toEqual(["33.33%", "33.33%", "33.33%"]);
    expect(container.querySelector(".ledger-total strong").textContent).toBe("99.99%");
  });

  it("uses the same owner totals as Tax Calculation for split acquisition sources", () => {
    const people = [
      { id: "owner-a", fullName: "Owner A", wills: [], causaMortisDeclarations: [] },
      { id: "owner-b", fullName: "Owner B", wills: [], causaMortisDeclarations: [] },
    ];
    const property = {
      id: "property",
      saleValue: "1000000",
      owners: [
        {
          id: "initial-a",
          personId: "owner-a",
          shareNumerator: 5,
          shareDenominator: 6,
          acquisitionDate: "2010-01-01",
        },
        {
          id: "initial-b",
          personId: "owner-b",
          shareNumerator: 1,
          shareDenominator: 6,
          acquisitionDate: "2010-01-01",
        },
      ],
      transfers: [],
      declarations: [],
      saleLots: [
        {
          id: "source-a-1",
          ownerId: "owner-a",
          shareNumerator: 1,
          shareDenominator: 6,
          acquisitionType: "purchase",
          acquisitionDate: "2010-01-01",
          acquisitionValue: 100000,
        },
        {
          id: "source-a-2",
          ownerId: "owner-a",
          shareNumerator: 4,
          shareDenominator: 6,
          acquisitionType: "purchase",
          acquisitionDate: "2010-01-01",
          acquisitionValue: 400000,
        },
        {
          id: "source-b-1",
          ownerId: "owner-b",
          shareNumerator: 1,
          shareDenominator: 6,
          acquisitionType: "purchase",
          acquisitionDate: "2010-01-01",
          acquisitionValue: 100000,
        },
      ],
    };
    const vendorReport = buildPropertyVendorTaxReport(property, people, []);
    const taxCalculationReport = buildTaxCalculationReport(property, people, [], vendorReport);

    act(() =>
      root.render(
        <PropertyOwnershipSummary
          people={people}
          outsideParties={[]}
          property={property}
          startingOwnership={vendorReport.ownership.ownershipByPerson}
          transfers={[]}
          vendorReport={vendorReport}
          taxCalculationReport={taxCalculationReport}
        />,
      ),
    );

    expect(
      [...container.querySelectorAll(".owner-value")].map((value) => value.textContent),
    ).toEqual(["Current value €833,333.34", "Current value €166,666.66"]);
    expect(taxCalculationReport.vendors.map((vendor) => vendor.attributedSaleValue)).toEqual([
      833333.34, 166666.66,
    ]);
  });

  it.each(["", "not-a-number", -1])(
    "does not invent an owner value when the property value is %j",
    (saleValue) => {
      renderOwnerValues({ saleValue, shares: [1] });

      expect(container.querySelector(".owner-value").textContent).toBe("Current value —");
      expect(container.textContent).not.toContain("€0.00");
    },
  );

  it("preserves an explicitly recorded zero property value", () => {
    renderOwnerValues({ saleValue: 0, shares: [1] });

    expect(container.querySelector(".owner-value").textContent).toBe("Current value €0.00");
  });

  it("opens family-tree owners from the current title", () => {
    const onSelectPerson = renderSummary();
    const sellerButtons = [...container.querySelectorAll(".ownership-person-link")].filter(
      (button) => button.textContent === "Joseph Borg",
    );

    expect(sellerButtons).toHaveLength(1);
    act(() => sellerButtons[0].click());
    expect(onSelectPerson).toHaveBeenCalledWith("seller");
  });

  it("opens a current outside owner card and records an exact onward transfer", () => {
    const { onChange } = renderCompanySummary();

    act(() =>
      container
        .querySelector('button[aria-label="Open Harbour Holdings Limited owner card"]')
        .click(),
    );
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).toContain("C 12345");

    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.trim() === "Add sale or donation")
        .click(),
    );
    act(() => {
      setSelect(container.querySelector('select[aria-label="Outside owner acquirer"]'), "buyer");
      setInput(
        container.querySelector('input[aria-label="Outside owner transfer date"]'),
        "25/05/2025",
      );
    });
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.trim() === "Record transfer")
        .click(),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({
      outsideParties: [company],
      transfers: [
        {
          kind: "sale",
          sellerId: "company",
          buyerId: "buyer",
          numerator: "1",
          denominator: "1",
          amountType: "whole-property",
          date: "2025-05-25",
          provenance: [
            expect.objectContaining({
              trancheId: "initial-company-owner",
              numerator: 1,
              denominator: 1,
            }),
          ],
        },
      ],
    });
  });

  it("moves focus into the outside-owner card and restores it when Escape closes", () => {
    renderCompanySummary();
    const ownerLink = container.querySelector(
      'button[aria-label="Open Harbour Holdings Limited owner card"]',
    );
    ownerLink.focus();
    act(() => ownerLink.click());

    expect(document.activeElement.textContent).toContain("Back to ownership");
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(ownerLink);
  });

  it("keeps keyboard focus inside the outside-owner modal", () => {
    renderCompanySummary();
    act(() =>
      container
        .querySelector('button[aria-label="Open Harbour Holdings Limited owner card"]')
        .click(),
    );
    const dialog = container.querySelector('[role="dialog"]');
    const back = [...dialog.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Back to ownership"),
    );
    const focusable = [
      ...dialog.querySelectorAll(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]",
      ),
    ];
    const last = focusable[focusable.length - 1];

    last.focus();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" })));
    expect(document.activeElement).toBe(back);

    back.focus();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true })));
    expect(document.activeElement).toBe(last);
  });

  it("edits and deletes only the selected outside owner's own transaction", () => {
    const savedTransfer = {
      id: "company-sale",
      kind: "sale",
      sellerId: "company",
      buyerId: "buyer",
      numerator: "1",
      denominator: "4",
      amountType: "whole-property",
      date: "2025-05-25",
    };
    const onChange = vi.fn();
    renderCompanySummary({ transfers: [savedTransfer], onChange });
    act(() =>
      container
        .querySelector('button[aria-label="Open Harbour Holdings Limited owner card"]')
        .click(),
    );

    act(() => container.querySelector('button[aria-label="Edit sale record"]').click());
    act(() =>
      setSelect(container.querySelector('select[aria-label="Outside owner acquirer"]'), "other"),
    );
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.trim() === "Save transfer")
        .click(),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].transfers).toEqual([
      expect.objectContaining({
        id: "company-sale",
        sellerId: "company",
        buyerId: "other",
        numerator: "1",
        denominator: "4",
      }),
    ]);

    onChange.mockClear();
    act(() => container.querySelector('button[aria-label="Delete sale record"]').click());
    expect(onChange).toHaveBeenCalledWith({ transfers: [], outsideParties: [company] });
  });

  it("blocks an outside owner from transferring more than its dated holding", () => {
    const onChange = vi.fn();
    renderCompanySummary({ onChange });
    act(() =>
      container
        .querySelector('button[aria-label="Open Harbour Holdings Limited owner card"]')
        .click(),
    );
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.trim() === "Add sale or donation")
        .click(),
    );
    act(() => {
      setSelect(container.querySelector('select[aria-label="Outside owner acquirer"]'), "buyer");
      setInput(
        container.querySelector('input[aria-label="Outside owner transfer date"]'),
        "25/05/2025",
      );
      setSelect(
        container.querySelector('select[aria-label="Outside owner transfer measurement"]'),
        "defined-share",
      );
      setInput(
        container.querySelector('input[aria-label="Outside owner transfer numerator"]'),
        "3",
      );
      setInput(
        container.querySelector('input[aria-label="Outside owner transfer denominator"]'),
        "2",
      );
    });
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.trim() === "Record transfer")
        .click(),
    );

    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      "larger share than the calculator shows it owned",
    );
  });

  it("rounds an outside-owner transfer percentage to two decimal places on blur", () => {
    renderCompanySummary();
    act(() =>
      container
        .querySelector('button[aria-label="Open Harbour Holdings Limited owner card"]')
        .click(),
    );
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.trim() === "Add sale or donation")
        .click(),
    );
    act(() => {
      setSelect(
        container.querySelector('select[aria-label="Outside owner transfer measurement"]'),
        "defined-share",
      );
      setSelect(
        container.querySelector('select[aria-label="Outside owner share format"]'),
        "percentage",
      );
    });

    const percentage = container.querySelector(
      'input[aria-label="Outside owner transfer percentage"]',
    );
    expect(percentage.step).toBe("0.01");
    expect(percentage.inputMode).toBe("decimal");

    act(() => {
      percentage.focus();
      setInput(percentage, "33.335");
      percentage.blur();
    });

    expect(
      container.querySelector('input[aria-label="Outside owner transfer percentage"]').value,
    ).toBe("33.34");
  });

  it("preserves the exact whole-property amount when editing a legacy outside-owner transfer", () => {
    const legacyTransfer = {
      id: "legacy-company-sale",
      kind: "sale",
      sellerId: "company",
      buyerId: "buyer",
      numerator: 1,
      denominator: 2,
      amountType: "seller-holding",
      date: "2025-05-25",
    };
    const onChange = vi.fn();
    renderCompanySummary({
      transfers: [legacyTransfer],
      onChange,
      property: {
        ...companyProperty([legacyTransfer]),
        owners: [
          {
            id: "company-owner",
            personId: "company",
            shareNumerator: 1,
            shareDenominator: 2,
          },
          {
            id: "other-owner",
            personId: "other",
            shareNumerator: 1,
            shareDenominator: 2,
          },
        ],
      },
      startingOwnership: { company: 0.5, other: 0.5 },
    });

    act(() =>
      container
        .querySelector('button[aria-label="Open Harbour Holdings Limited owner card"]')
        .click(),
    );
    act(() => container.querySelector('button[aria-label="Edit sale record"]').click());
    expect(
      container.querySelector('input[aria-label="Outside owner transfer numerator"]').value,
    ).toBe("1");
    expect(
      container.querySelector('input[aria-label="Outside owner transfer denominator"]').value,
    ).toBe("4");
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.trim() === "Save transfer")
        .click(),
    );

    expect(onChange.mock.calls[0][0].transfers).toEqual([
      expect.objectContaining({
        id: "legacy-company-sale",
        numerator: "1",
        denominator: "4",
        amountType: "whole-property",
      }),
    ]);
  });

  it("lets an outside original owner supply the acquisition date needed for tax", () => {
    const onChange = vi.fn();
    renderCompanySummary({ onChange });
    act(() =>
      container
        .querySelector('button[aria-label="Open Harbour Holdings Limited owner card"]')
        .click(),
    );

    const acquisitionDate = container.querySelector(
      'input[aria-label="Original acquisition date"]',
    );
    expect(acquisitionDate).not.toBeNull();
    act(() => setInput(acquisitionDate, "01/01/2010"));
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.trim() === "Confirm date")
        .click(),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].property.owners[0]).toMatchObject({
      id: "company-owner",
      personId: "company",
      acquisitionDate: "2010-01-01",
    });
  });

  it("lets an outside donee supply the Donation Value needed for tax", () => {
    const onChange = vi.fn();
    const gift = {
      id: "gift-to-company",
      kind: "donation",
      sellerId: "buyer",
      buyerId: "company",
      numerator: 1,
      denominator: 1,
      amountType: "whole-property",
      date: "2020-01-01",
    };
    const property = {
      id: "gift-property",
      saleDate: "2026-08-13",
      saleValue: 100000,
      owners: [
        {
          id: "original-buyer",
          personId: "buyer",
          shareNumerator: 1,
          shareDenominator: 1,
          acquisitionDate: "2000-01-01",
        },
      ],
      transfers: [gift],
      declarations: [],
      saleLots: [],
    };
    act(() =>
      root.render(
        <PropertyOwnershipSummary
          people={[{ id: "buyer", fullName: "Maria Vella" }]}
          outsideParties={[company]}
          property={property}
          startingOwnership={{ buyer: 1 }}
          transfers={[gift]}
          onOutsideOwnerTransactionsChange={onChange}
        />,
      ),
    );
    act(() =>
      container
        .querySelector('button[aria-label="Open Harbour Holdings Limited owner card"]')
        .click(),
    );

    const donationValue = container.querySelector('input[aria-label="Donation Value"]');
    expect(donationValue).not.toBeNull();
    act(() => setInput(donationValue, "40000"));
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.trim() === "Confirm value")
        .click(),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].property.transfers[0]).toMatchObject({
      id: "gift-to-company",
      acquisitionValue: 40000,
      acquisitionValueBasis: "deed-value",
    });
  });

  // A provenance line under every name cost a row each and said what the row
  // already showed. An outside owner stays identifiable by its owner-card link.
  it("gives an owner row its name and share, and no provenance line", () => {
    renderCompanySummary();
    const ownerRow = container.querySelector(".read-only-owner-row");

    expect(container.textContent).not.toContain("Family tree");
    expect(container.textContent).not.toContain("Outside company");
    expect(container.textContent).not.toContain("Outside individual");
    expect(ownerRow.querySelector(".owner-identity small")).toBeNull();
    expect(
      ownerRow.querySelector('button[aria-label="Open Harbour Holdings Limited owner card"]'),
    ).not.toBeNull();
  });

  // The button carried the underline, and an underline cannot be cancelled by
  // a descendant, so it ran under the appended hint too and the two read as one
  // run-on word. The name owns the underline now.
  it("underlines the outside-owner name without underlining its hint", () => {
    renderCompanySummary();
    const link = container.querySelector(".outside-owner-link");

    expect(link.querySelector(".outside-owner-name").textContent).toBe("Harbour Holdings Limited");
    // The hint is a pseudo-element, so the name is the button's only child.
    expect(link.children).toHaveLength(1);
  });

  it("names the section as current title positions and drops the kicker", () => {
    renderSummary();

    // The heading is still named for the section it labels.
    expect(container.querySelector("#current-title").textContent).toBe("Current title positions");
    expect(container.querySelector(".section-heading .eyebrow")).toBeNull();
  });

  it("switches directly from an outside donee to its outside donor's owner card", () => {
    const donor = { id: "company-a", name: "Alpha Holdings Limited", type: "company" };
    const donee = { id: "company-b", name: "Beta Holdings Limited", type: "company" };
    const gift = {
      id: "outside-gift",
      kind: "donation",
      sellerId: donor.id,
      buyerId: donee.id,
      numerator: 1,
      denominator: 1,
      amountType: "whole-property",
      date: "2025-01-01",
    };
    const property = {
      id: "outside-chain",
      saleDate: "2026-08-13",
      saleValue: 100000,
      owners: [
        {
          id: "alpha-title",
          personId: donor.id,
          shareNumerator: 1,
          shareDenominator: 1,
        },
      ],
      transfers: [gift],
      declarations: [],
      saleLots: [],
    };
    act(() =>
      root.render(
        <PropertyOwnershipSummary
          people={[]}
          outsideParties={[donor, donee]}
          property={property}
          startingOwnership={{ [donor.id]: 1 }}
          transfers={[gift]}
          onOutsideOwnerTransactionsChange={vi.fn()}
        />,
      ),
    );

    act(() =>
      container.querySelector('button[aria-label="Open Beta Holdings Limited owner card"]').click(),
    );
    expect(container.querySelector("#outside-owner-title").textContent).toBe(
      "Beta Holdings Limited",
    );

    const openDonor = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Open Alpha Holdings Limited original acquisition details"),
    );
    expect(openDonor).toBeTruthy();
    act(() => openDonor.click());

    expect(container.querySelector("#outside-owner-title").textContent).toBe(
      "Alpha Holdings Limited",
    );
    expect(container.querySelector('input[aria-label="Original acquisition date"]')).not.toBeNull();
  });
});
