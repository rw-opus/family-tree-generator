// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PropertyOwnershipSummary } from "../../src/components/PropertyOwnershipSummary.jsx";

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

  it("shows current ownership and immutable transaction history", () => {
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
    expect(container.textContent).toContain("Recorded transfer history");
    expect(container.textContent).toContain("25/05/2025");
    expect(container.textContent).toContain("Donation · 1/4 of the property (25%)");

    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector('button[aria-label="Remove transfer"]')).toBeNull();
    expect(container.textContent).not.toContain("Record a sale or transfer");
    expect(container.textContent).not.toContain("Add an outside buyer or company");
  });

  it("opens family-tree owners from both the title and history", () => {
    const onSelectPerson = renderSummary();
    const sellerButtons = [...container.querySelectorAll(".ownership-person-link")].filter(
      (button) => button.textContent === "Joseph Borg",
    );

    expect(sellerButtons.length).toBeGreaterThanOrEqual(2);
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

  it("keeps a sold-out outside owner accessible from its transfer-history seller link", () => {
    renderCompanySummary({
      transfers: [
        {
          id: "sold-out",
          kind: "sale",
          sellerId: "company",
          buyerId: "buyer",
          numerator: 1,
          denominator: 1,
          amountType: "whole-property",
          date: "2025-05-25",
        },
      ],
    });

    const historyLink = container.querySelector(
      'button[aria-label="Open Harbour Holdings Limited owner card"]',
    );
    expect(historyLink).not.toBeNull();
    act(() => historyLink.click());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Add another sale or donation");
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

  it("drops the kicker above the current-ownership heading", () => {
    renderSummary();

    // The heading is still named for the section it labels.
    expect(container.querySelector("#current-title").textContent).toBe("Current ownership");
    expect(container.querySelector(".section-heading .eyebrow")).toBeNull();
  });

  it("opens an outside party from either side of a transfer-history row", () => {
    // The two sides of a history row were not rendered alike: the seller was
    // offered its owner card and the buyer was left as bare text, so the same
    // outside party was a link in one column and dead text in the next.
    const donor = { id: "company-a", name: "Alpha Holdings Limited", type: "company" };
    const donee = { id: "company-b", name: "Beta Holdings Limited", type: "company" };
    const gift = {
      id: "outside-gift",
      kind: "donation",
      sellerId: donor.id,
      buyerId: donee.id,
      numerator: 1,
      denominator: 2,
      amountType: "whole-property",
      date: "2025-01-01",
    };
    act(() =>
      root.render(
        <PropertyOwnershipSummary
          people={[]}
          outsideParties={[donor, donee]}
          property={{
            id: "outside-chain",
            owners: [
              { id: "alpha-title", personId: donor.id, shareNumerator: 1, shareDenominator: 1 },
            ],
            transfers: [gift],
            declarations: [],
            saleLots: [],
          }}
          startingOwnership={{ [donor.id]: 1 }}
          transfers={[gift]}
          onOutsideOwnerTransactionsChange={vi.fn()}
        />,
      ),
    );

    const historyRow = container.querySelector(".read-only-transfer-history .history-row");
    const partyLinks = [...historyRow.querySelectorAll("button.ownership-person-link")].map(
      (button) => button.textContent,
    );
    expect(partyLinks).toEqual(["Alpha Holdings Limited", "Beta Holdings Limited"]);

    // The buyer link opens the buyer's card, not the seller's.
    act(() => historyRow.querySelectorAll("button.ownership-person-link")[1].click());
    expect(container.querySelector("#outside-owner-title").textContent).toBe(
      "Beta Holdings Limited",
    );
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
