// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinalWithholdingTaxSection } from "../../src/components/personInspector/FinalWithholdingTaxSection.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("FinalWithholdingTaxSection", () => {
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

  const changeInput = (input, value) => {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("shows a calculated tax amount", () => {
    act(() =>
      root.render(
        <FinalWithholdingTaxSection
          vendorTax={{ tax: 2400, rows: [{ selectedMethod: "flat", tax: 2400 }] }}
        />,
      ),
    );

    expect(container.textContent).toContain("Final Withholding Tax");
    expect(container.querySelector(".fwt-status-row strong").textContent).toBe("€2,400.00");
    expect(container.textContent).toContain("Calculated from the recorded source fractions");
  });

  it("routes an inherited pending fraction to CM details without asking for an acquisition date", () => {
    const onOpenSourcePerson = vi.fn();
    const warning = "Enter the causa mortis acquisition value for this fraction.";
    const vendorTax = {
      tax: null,
      rows: [
        {
          id: "inheritance-source",
          provenance: "Inherited from Edgar Wadge",
          provenancePersonId: "edgar",
          sourceKind: "inheritance",
          inheritanceDate: "2008-05-20",
          selectedMethod: null,
          tax: null,
          warning,
        },
      ],
    };

    act(() =>
      root.render(
        <FinalWithholdingTaxSection
          vendorTax={vendorTax}
          onOpenSourcePerson={onOpenSourcePerson}
        />,
      ),
    );

    expect(container.textContent).toContain(warning);
    expect(container.querySelector('input[aria-label="Original acquisition date"]')).toBeNull();
    const button = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent.includes("Open Edgar Wadge CM details"),
    );
    act(() => button.click());
    expect(onOpenSourcePerson).toHaveBeenCalledWith("edgar");
  });

  it("allows a living original owner to confirm an acquisition date in DD/MM/YYYY", () => {
    const onConfirmInitialAcquisition = vi.fn();
    const row = {
      id: "owner-unresolved",
      provenance: "Initial ownership — acquisition details incomplete",
      sourceKind: "initial",
      requiresOriginalAcquisitionDate: true,
      selectedMethod: null,
      tax: null,
      warning: "The acquisition date is needed before tax can be calculated.",
    };

    act(() =>
      root.render(
        <FinalWithholdingTaxSection
          vendorTax={{ tax: null, rows: [row] }}
          onConfirmInitialAcquisition={onConfirmInitialAcquisition}
        />,
      ),
    );

    const input = container.querySelector('input[aria-label="Original acquisition date"]');
    expect(input).not.toBeNull();
    expect(input.placeholder).toBe("dd/mm/yyyy");

    changeInput(input, "25052020");
    const button = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent.trim() === "Confirm date",
    );
    act(() => button.click());

    expect(onConfirmInitialAcquisition).toHaveBeenCalledWith({
      row,
      acquisitionDate: "2020-05-25",
    });
  });

  it("does not show an acquisition date for a deceased original owner or another unresolved type", () => {
    const vendorTax = {
      tax: null,
      rows: [
        {
          id: "transfer-unresolved",
          provenance: "Transferred share — acquisition details incomplete",
          sourceKind: "transfer",
          selectedMethod: null,
          tax: null,
          warning: "The transfer source needs review.",
        },
      ],
    };

    act(() => root.render(<FinalWithholdingTaxSection vendorTax={vendorTax} isPersonDeceased />));

    expect(container.textContent).toContain("The transfer source needs review.");
    expect(container.querySelector('input[aria-label="Original acquisition date"]')).toBeNull();
  });

  it("routes a donation source to the donor's original acquisition details, not CM details", () => {
    const onOpenSourcePerson = vi.fn();
    const vendorTax = {
      tax: null,
      rows: [
        {
          id: "donation-unresolved",
          provenance: "Donated by Joseph Borg",
          provenancePersonId: "joseph",
          sourceKind: "donation",
          inheritanceDate: "2020-05-25",
          selectedMethod: null,
          tax: null,
          warning: "The donor acquisition details need review.",
        },
      ],
    };

    act(() =>
      root.render(
        <FinalWithholdingTaxSection
          vendorTax={vendorTax}
          onOpenSourcePerson={onOpenSourcePerson}
        />,
      ),
    );

    expect(container.textContent).toContain("The donor acquisition details need review.");
    const button = container.querySelector(".fwt-source-link");
    expect(button.textContent).toContain("Open Joseph Borg original acquisition details");
    expect(button.textContent).not.toContain("CM details");
    expect(container.querySelector('input[aria-label="Original acquisition date"]')).toBeNull();
    act(() => button.click());
    expect(onOpenSourcePerson).toHaveBeenCalledWith("joseph");
  });

  it("does not request an original acquisition date when the donor is deceased", () => {
    act(() =>
      root.render(
        <FinalWithholdingTaxSection
          vendorTax={{
            tax: null,
            rows: [
              {
                id: "deceased-donor",
                provenance: "Donated by Joseph Borg",
                provenancePersonId: "joseph",
                provenancePersonDeceased: true,
                sourceKind: "donation",
                selectedMethod: null,
                tax: null,
                warning: "The earlier acquisition date requires review.",
              },
            ],
          }}
          onOpenSourcePerson={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector('input[aria-label="Original acquisition date"]')).toBeNull();
    expect(container.querySelector(".fwt-source-link")).toBeNull();
    expect(container.textContent).toContain("requires review");
  });

  it("lets a living original owner complete the donor look-through date after leaving ownership", () => {
    const onConfirmInitialAcquisition = vi.fn();
    const row = {
      id: "former-owner-date",
      sourceKind: "initial",
      provenance: "Original ownership",
      originalOwnerRecordId: "original-title",
      requiresOriginalAcquisitionDate: true,
      warning: "Enter this living original owner's acquisition date for a later donated share.",
    };

    act(() =>
      root.render(
        <FinalWithholdingTaxSection
          additionalResolutionRows={[row]}
          onConfirmInitialAcquisition={onConfirmInitialAcquisition}
        />,
      ),
    );

    expect(container.querySelector(".fwt-status-row strong").textContent).toBe(
      "Not a current vendor",
    );
    changeInput(
      container.querySelector('input[aria-label="Original acquisition date"]'),
      "01012010",
    );
    const button = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent.trim() === "Confirm date",
    );
    act(() => button.click());

    expect(onConfirmInitialAcquisition).toHaveBeenCalledWith({
      row,
      acquisitionDate: "2010-01-01",
    });
  });

  it("records the contract Donation Value without asking for another value basis", () => {
    const onConfirmDonationAcquisitionValue = vi.fn();
    const row = {
      id: "older-donation",
      sourceKind: "donation",
      provenance: "Donated by Joseph Borg",
      provenancePersonId: "joseph",
      sourceTransferId: "gift",
      requiresDonationAcquisitionValue: true,
      warning: "Enter the Donation Value stated in the contract for this donated fraction.",
      selectedMethod: null,
      tax: null,
    };

    act(() =>
      root.render(
        <FinalWithholdingTaxSection
          vendorTax={{ tax: null, rows: [row] }}
          onConfirmDonationAcquisitionValue={onConfirmDonationAcquisitionValue}
        />,
      ),
    );

    expect(container.querySelector('input[aria-label="Original acquisition date"]')).toBeNull();
    const valueInput = container.querySelector('input[aria-label="Donation Value"]');
    expect(container.querySelector(".fwt-status-row strong").textContent).toBe("Not calculated");
    // Nothing listed here is optional: without it there is no tax figure at all.
    expect(valueInput.closest("label").textContent).toContain("Donation Value");
    expect(container.textContent).not.toContain("optional");
    expect(container.textContent).toContain(
      "1 source fraction still needs a detail below before the tax can be calculated",
    );
    expect(container.textContent).not.toContain("Value basis");
    expect(
      container.querySelector('select[aria-label="Donation acquisition value basis"]'),
    ).toBeNull();
    const submit = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Confirm value",
    );
    expect(submit.disabled).toBe(true);

    changeInput(valueInput, "120000");
    act(() => submit.click());

    expect(onConfirmDonationAcquisitionValue).toHaveBeenCalledWith({
      row,
      acquisitionValue: "120000",
      acquisitionValueBasis: "deed-value",
    });
  });
});
