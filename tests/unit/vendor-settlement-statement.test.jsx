// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VendorSettlementStatement } from "../../src/components/VendorSettlementStatement.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const property = {
  address: "24 St Mary Street, Sliema",
  saleValue: "1000000",
};

const people = [
  { id: "alice", fullName: "Alice Borg" },
  { id: "bob", fullName: "Bob Vella" },
];

const report = {
  totalSaleValue: 1000000,
  totalTax: null,
  totalNet: null,
  totalsComplete: false,
  vendors: [
    {
      id: "alice",
      name: "Alice Borg",
      share: 0.5,
      shareFraction: { numerator: 1, denominator: 2 },
      attributedSaleValue: 500000,
      tax: 53000,
      net: 447000,
      incompleteRowCount: 0,
      rows: [
        {
          id: "alice-inherited",
          share: 0.25,
          shareFraction: { numerator: 1, denominator: 4 },
          selectedMethod: {
            key: "gain",
            label: "12% of transfer value less acquisition value",
            rate: 0.12,
          },
          attributedSaleValue: 250000,
          tax: 48000,
          net: 202000,
        },
        {
          id: "alice-manual",
          share: 0.25,
          shareFraction: { numerator: 1, denominator: 4 },
          selectedMethod: {
            key: "manual",
            label: "Manually assessed tax",
            rate: null,
          },
          attributedSaleValue: 250000,
          tax: 5000,
          net: 245000,
        },
      ],
    },
    {
      id: "bob",
      name: "Bob Vella",
      share: 0.5,
      shareFraction: { numerator: 1, denominator: 2 },
      attributedSaleValue: 500000,
      tax: null,
      net: null,
      incompleteRowCount: 1,
      rows: [
        {
          id: "bob-exempt",
          share: 0.25,
          shareFraction: { numerator: 1, denominator: 4 },
          selectedMethod: {
            key: "exempt",
            label: "Exempt transfer",
            rate: null,
          },
          attributedSaleValue: 250000,
          tax: 0,
          net: 250000,
        },
        {
          id: "bob-pending",
          share: 0.25,
          shareFraction: { numerator: 1, denominator: 4 },
          selectedMethod: null,
          attributedSaleValue: 250000,
          tax: null,
          net: null,
        },
      ],
    },
  ],
};

describe("VendorSettlementStatement", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.querySelector(".vendor-settlement-dialog")?.remove();
    document.body.classList.remove("vendor-settlement-open");
    container.remove();
    vi.restoreAllMocks();
  });

  const renderAndOpen = (props = {}) => {
    act(() =>
      root.render(
        <VendorSettlementStatement
          report={report}
          property={property}
          people={people}
          {...props}
        />,
      ),
    );
    act(() => container.querySelector(".vendor-settlement-open-button").click());
    return document.querySelector(".vendor-settlement-dialog");
  };

  it("opens an accessible statement with every vendor exactly once", () => {
    const dialog = renderAndOpen();

    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const title = document.getElementById(dialog.getAttribute("aria-labelledby"));
    expect(title.textContent).toBe("Vendor Settlement Statement");
    expect(dialog.querySelectorAll(".vendor-settlement-vendor-row")).toHaveLength(2);
    expect(dialog.textContent.match(/Alice Borg/g)).toHaveLength(1);
    expect(dialog.textContent.match(/Bob Vella/g)).toHaveLength(1);
    expect(dialog.textContent).toContain("24 St Mary Street, Sliema");
  });

  it("lists exact ownership, gross price, and every applied tax method by source", () => {
    const dialog = renderAndOpen();
    const rows = dialog.querySelectorAll(".vendor-settlement-vendor-row");

    expect(rows[0].textContent).toContain("1/2");
    expect(rows[0].textContent).toContain("€500,000.00");
    expect(rows[0].textContent).toContain("12% of transfer value less acquisition value");
    expect(rows[0].textContent).toContain("Manually assessed tax");
    expect(rows[0].textContent).toContain("€48,000.00");
    expect(rows[0].textContent).toContain("€5,000.00");
    expect(rows[0].textContent).toContain("€53,000.00");
    expect(rows[0].textContent).toContain("€447,000.00");
    expect(rows[1].textContent).toContain("Exempt transfer");
    expect(rows[1].textContent).toContain("Not calculated");
    expect(rows[1].textContent).toContain("1 source pending");
  });

  it("keeps overall tax and net honest while one vendor is incomplete", () => {
    const dialog = renderAndOpen();
    const totals = dialog.querySelector("tfoot").textContent;

    expect(totals).toContain("€1,000,000.00");
    expect(totals.match(/Not calculated/g)).toHaveLength(2);
    expect(totals).toContain("1 vendor(s) pending");
    expect(dialog.textContent).toContain(
      "Overall tax and net totals remain uncalculated until every vendor source",
    );
  });

  it("prints the open statement and closes it with Escape", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const dialog = renderAndOpen();
    const printButton = [...dialog.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Print statement"),
    );

    act(() => printButton.click());
    expect(print).toHaveBeenCalledOnce();

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.querySelector(".vendor-settlement-dialog")).toBeNull();
    expect(document.body.classList.contains("vendor-settlement-open")).toBe(false);
  });

  it("opens a vendor's person card from the statement", () => {
    const onSelectPerson = vi.fn();
    const dialog = renderAndOpen({ onSelectPerson });

    act(() => dialog.querySelector(".vendor-settlement-person-link").click());
    expect(onSelectPerson).toHaveBeenCalledWith("alice");
    expect(document.querySelector(".vendor-settlement-dialog")).toBeNull();
  });

  it("disables the printable statement when there are no vendors", () => {
    act(() =>
      root.render(<VendorSettlementStatement report={{ vendors: [] }} property={property} />),
    );

    expect(container.querySelector(".vendor-settlement-open-button").disabled).toBe(true);
  });
});
