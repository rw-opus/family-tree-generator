// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InitialOwnershipEditor } from "../../src/components/InitialOwnershipEditor.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("InitialOwnershipEditor percentage display", () => {
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

  it("shows exact thirds in two-decimal boxes that add to 100 without changing the fractions", () => {
    const people = ["first", "second", "third"].map((id) => ({ id, fullName: id }));
    let latestOwners;

    function Harness() {
      const [owners, setOwners] = useState(
        people.map((person) => ({
          id: `${person.id}-title`,
          personId: person.id,
          shareNumerator: 1,
          shareDenominator: 3,
          sharePercent: 100 / 3,
          sharePercentInput: "33.3333333333333",
        })),
      );
      latestOwners = owners;
      return <InitialOwnershipEditor property={{ owners }} people={people} onChange={setOwners} />;
    }

    act(() => root.render(<Harness />));

    const percentages = [
      ...container.querySelectorAll('input[aria-label="Initial ownership percentage"]'),
    ];
    expect(percentages.map((input) => input.value)).toEqual(["33.34", "33.33", "33.33"]);
    expect(percentages.reduce((total, input) => total + Number(input.value), 0)).toBe(100);
    percentages.forEach((input) => {
      expect(input.step).toBe("0.01");
      expect(input.inputMode).toBe("decimal");
    });

    act(() => {
      percentages[0].focus();
      percentages[0].blur();
    });
    expect(latestOwners.map((owner) => [owner.shareNumerator, owner.shareDenominator])).toEqual([
      [1, 3],
      [1, 3],
      [1, 3],
    ]);
    expect(latestOwners[0].sharePercentInput).toBeUndefined();
  });

  it("normalises an explicitly typed percentage only when the field loses focus", () => {
    const people = [{ id: "owner", fullName: "Owner" }];

    function Harness() {
      const [owners, setOwners] = useState([
        {
          id: "title",
          personId: "owner",
          shareNumerator: 1,
          shareDenominator: 1,
          sharePercent: 100,
        },
      ]);
      return <InitialOwnershipEditor property={{ owners }} people={people} onChange={setOwners} />;
    }

    act(() => root.render(<Harness />));
    let percentage = container.querySelector('input[aria-label="Initial ownership percentage"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        percentage,
        "33.335",
      );
      percentage.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector('input[aria-label="Initial ownership percentage"]').value).toBe(
      "33.335",
    );

    percentage = container.querySelector('input[aria-label="Initial ownership percentage"]');
    act(() => {
      percentage.focus();
      percentage.blur();
    });

    expect(container.querySelector('input[aria-label="Initial ownership percentage"]').value).toBe(
      "33.34",
    );
  });

  it("does not label a near-complete exact allocation as 100%", () => {
    const people = ["first", "second", "third"].map((id) => ({ id, fullName: id }));
    const owners = [
      {
        id: "first-title",
        personId: "first",
        shareNumerator: 3333,
        shareDenominator: 10000,
      },
      ...people.slice(1).map((person) => ({
        id: `${person.id}-title`,
        personId: person.id,
        shareNumerator: 1,
        shareDenominator: 3,
      })),
    ];

    act(() =>
      root.render(
        <InitialOwnershipEditor property={{ owners }} people={people} onChange={() => {}} />,
      ),
    );

    expect(
      [...container.querySelectorAll('input[aria-label="Initial ownership percentage"]')].map(
        (input) => input.value,
      ),
    ).toEqual(["33.33", "33.33", "33.33"]);
    expect(container.querySelector(".initial-title-badge").textContent).toBe("99.99%");
    expect(container.querySelector(".share-status").textContent).toContain(
      "Fractions entered: 99.99% — must equal 100%",
    );
  });
});
