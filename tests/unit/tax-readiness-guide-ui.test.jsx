// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TaxReadinessGuideBar,
  TaxReadinessGuideLauncher,
  taxReadinessIssueControl,
} from "../../src/components/TaxReadinessGuide.jsx";
import { CausaMortisSection } from "../../src/components/personInspector/CausaMortisSection.jsx";
import { FinalWithholdingTaxSection } from "../../src/components/personInspector/FinalWithholdingTaxSection.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("TaxReadinessGuide", () => {
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

  it("starts or resumes from the property workspace with an honest outstanding summary", () => {
    const onStart = vi.fn();
    act(() =>
      root.render(
        <TaxReadinessGuideLauncher
          summary={{ status: "paused", pendingCount: 3, skippedCount: 1 }}
          onStart={onStart}
        />,
      ),
    );
    expect(container.textContent).toContain("3 people need information; 1 skipped for now");
    const button = container.querySelector("button");
    expect(button.textContent).toContain("Resume guided tax setup");
    act(() => button.click());
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("offers Skip for now while issues remain and Next only after they resolve", () => {
    const onSkip = vi.fn();
    const onNext = vi.fn();
    const onGoToSection = vi.fn();
    const render = (issues) =>
      act(() =>
        root.render(
          <TaxReadinessGuideBar
            personId="person"
            personName="Joseph Borg"
            position={1}
            total={4}
            issues={issues}
            onSkip={onSkip}
            onNext={onNext}
            onGoToSection={onGoToSection}
            onPause={() => {}}
          />,
        ),
      );

    const issue = {
      key: "death",
      code: "death-date",
      prompt: "Enter the date of death.",
      section: "identity",
    };
    render([issue]);
    expect(container.textContent).toContain("Person 1 of 4; 1 detail needs attention");
    expect(container.textContent).toContain("Skip for now");
    expect(container.textContent).not.toContain("Next card");
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Go to section"))
        .click(),
    );
    expect(onGoToSection).toHaveBeenCalledWith(issue);

    render([]);
    expect(container.textContent).toContain("Next card");
    expect(container.textContent).not.toContain("Skip for now");
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Next card"))
        .click(),
    );
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("marks the active property's CM value as needed for tax without blocking Skip for now", () => {
    const onComplete = vi.fn(() => true);
    const declaration = {
      id: "cm",
      propertyId: "property",
      status: "complete",
      declaredShareNumerator: 1,
      declaredShareDenominator: 1,
      date: "2020-02-01",
      notaryName: "Maria Vella",
      immovablePropertyValue: "",
      declarantPersonIds: ["heir"],
    };
    act(() =>
      root.render(
        <CausaMortisSection
          declarations={[declaration]}
          properties={[{ id: "property" }]}
          candidates={[{ id: "heir", fullName: "Heir" }]}
          candidateLabel={(candidate) => candidate.fullName}
          dateOfDeath="2020-01-01"
          taxValuePropertyId="property"
          taxValueRequired
          taxRequiredDeclarationIds={new Set(["cm"])}
          onRemoveDeclaration={() => {}}
          onCompleteDeclaration={onComplete}
        />,
      ),
    );

    const value = container.querySelector(
      'input[aria-label="Immovable property value declared causa mortis 1"]',
    );
    expect(value).not.toBeNull();
    expect(value.dataset.taxReadinessField).toBe("causa-mortis-value");
    expect(value.dataset.taxReadinessTargetId).toBe("cm");
    expect(value.required).toBe(false);
    expect(value.closest("label").textContent).toContain("needed for tax");
    const save = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Save declaration"),
    );
    act(() => save.click());
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cm", immovablePropertyValue: "" }),
    );
  });

  it("reopens the exact collapsed CM value after the required editor is cancelled", () => {
    const declaration = (id, value) => ({
      id,
      propertyId: "property",
      status: "complete",
      declaredShareNumerator: 1,
      declaredShareDenominator: 2,
      date: "2020-02-01",
      notaryName: "Maria Vella",
      immovablePropertyValue: value,
      declarantPersonIds: ["heir"],
    });
    act(() =>
      root.render(
        <CausaMortisSection
          declarations={[declaration("cm-one", 100000), declaration("cm-two", "")]}
          properties={[{ id: "property" }]}
          candidates={[{ id: "heir", fullName: "Heir" }]}
          candidateLabel={(candidate) => candidate.fullName}
          dateOfDeath="2020-01-01"
          taxValuePropertyId="property"
          taxValueRequired
          taxRequiredDeclarationIds={new Set(["cm-two"])}
          onRemoveDeclaration={() => {}}
          onCompleteDeclaration={() => true}
        />,
      ),
    );

    const cancel = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Cancel",
    );
    act(() => cancel.click());

    const issue = {
      code: "causa-mortis-acquisition-value",
      targetField: "causa-mortis-value",
      targetId: "cm-two",
    };
    const collapsedTarget = taxReadinessIssueControl(container, issue);
    expect(collapsedTarget?.getAttribute("aria-label")).toBe("Edit Declaration Causa Mortis 2");

    act(() => collapsedTarget.click());

    const value = taxReadinessIssueControl(container, issue);
    expect(value?.getAttribute("aria-label")).toBe(
      "Immovable property value declared causa mortis 2",
    );
    expect(value?.dataset.taxReadinessTargetId).toBe("cm-two");
  });

  it("labels a new active-property CM draft once, but not a different property's draft", () => {
    const draft = (id, propertyId) => ({
      id,
      propertyId,
      status: "draft",
      declaredShareNumerator: 1,
      declaredShareDenominator: 1,
      date: "2020-02-01",
      notaryName: "Maria Vella",
      immovablePropertyValue: "",
      declarantPersonIds: ["heir"],
    });
    act(() =>
      root.render(
        <CausaMortisSection
          declarations={[draft("active", "property"), draft("other", "other-property")]}
          properties={[{ id: "property" }]}
          candidates={[{ id: "heir", fullName: "Heir" }]}
          candidateLabel={(candidate) => candidate.fullName}
          dateOfDeath="2020-01-01"
          taxValuePropertyId="property"
          taxValueRequired
          onRemoveDeclaration={() => {}}
          onCompleteDeclaration={() => true}
        />,
      ),
    );

    const labels = [...container.querySelectorAll("label")]
      .map((label) => label.textContent)
      .filter((label) => label.includes("Value declared"));
    expect(labels).toEqual([
      expect.stringContaining("needed for tax"),
      expect.stringContaining("optional"),
    ]);
    expect(
      taxReadinessIssueControl(container, {
        code: "causa-mortis-under",
        targetField: "add-causa-mortis",
      })?.textContent,
    ).toContain("Insert CM Declaration");
  });

  it("targets the declarants on the exact unresolved CM declaration", () => {
    const declaration = (id, declarantPersonIds) => ({
      id,
      propertyId: "property",
      status: "complete",
      declaredShareNumerator: 1,
      declaredShareDenominator: 2,
      date: "2020-02-01",
      notaryName: "Maria Vella",
      declarantPersonIds,
    });
    act(() =>
      root.render(
        <CausaMortisSection
          declarations={[declaration("valid-cm", ["heir"]), declaration("wrong-cm", ["outsider"])]}
          properties={[{ id: "property" }]}
          candidates={[
            { id: "heir", fullName: "Heir" },
            { id: "outsider", fullName: "Outsider" },
          ]}
          candidateLabel={(candidate) => candidate.fullName}
          dateOfDeath="2020-01-01"
          onRemoveDeclaration={() => {}}
          onCompleteDeclaration={() => true}
        />,
      ),
    );
    const issue = {
      code: "causa-mortis-allocation-unresolved",
      targetField: "causa-mortis-declarants",
      targetId: "wrong-cm",
    };
    const summary = taxReadinessIssueControl(container, issue);
    expect(summary?.getAttribute("aria-label")).toBe("Edit Declaration Causa Mortis 2");

    act(() => summary.click());

    const declarants = taxReadinessIssueControl(container, issue);
    expect(declarants?.classList.contains("causa-mortis-declarants")).toBe(true);
    expect(declarants?.dataset.taxReadinessTargetId).toBe("wrong-cm");
  });

  it("marks the exact FWT inputs that guided tax prompts must focus", () => {
    act(() =>
      root.render(
        <FinalWithholdingTaxSection
          vendorTax={{
            tax: null,
            rows: [
              {
                id: "initial",
                originalOwnerRecordId: "initial-title",
                sourceKind: "initial",
                provenance: "Initial ownership",
                requiresOriginalAcquisitionDate: true,
                selectedMethod: null,
                tax: null,
              },
              {
                id: "gift-one-row",
                sourceTransferId: "gift-one",
                sourceKind: "donation",
                provenance: "Donated share",
                requiresDonationAcquisitionValue: true,
                selectedMethod: null,
                tax: null,
              },
              {
                id: "gift-two-row",
                sourceTransferId: "gift-two",
                sourceKind: "donation",
                provenance: "Second donated share",
                requiresDonationAcquisitionValue: true,
                selectedMethod: null,
                tax: null,
              },
            ],
          }}
          onConfirmInitialAcquisition={() => {}}
          onConfirmDonationAcquisitionValue={() => {}}
        />,
      ),
    );

    expect(
      container.querySelector('[data-tax-readiness-field="original-acquisition-date"]')?.dataset
        .taxReadinessTargetId,
    ).toBe("initial-title");
    expect(
      [...container.querySelectorAll('[data-tax-readiness-field="donation-value"]')].map(
        (input) => input.dataset.taxReadinessTargetId,
      ),
    ).toEqual(["gift-one", "gift-two"]);
    expect(
      taxReadinessIssueControl(container, {
        code: "donation-acquisition-value",
        targetId: "gift-two",
      })?.id,
    ).toBe("fwt-donation-value-gift-two-row");
  });

  it("uses a legacy source transfer id when an original-owner row has no record id", () => {
    act(() =>
      root.render(
        <FinalWithholdingTaxSection
          additionalResolutionRows={[
            {
              id: "generated-resolution-row",
              sourceTransferId: "legacy-gift",
              sourceKind: "initial",
              provenance: "Original ownership",
              requiresOriginalAcquisitionDate: true,
            },
          ]}
          isPersonDeceased
          onConfirmInitialAcquisition={() => {}}
        />,
      ),
    );

    const issue = {
      code: "donor-original-acquisition-date",
      targetId: "legacy-gift",
    };
    const input = taxReadinessIssueControl(container, issue);
    expect(input?.getAttribute("aria-label")).toBe("Original acquisition date");
    expect(input?.dataset.taxReadinessTargetId).toBe("legacy-gift");
  });
});
