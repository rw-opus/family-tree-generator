// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TreeRegisterDialog } from "../../src/components/TreeRegisterDialog.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

const setInput = (input, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("TreeRegisterDialog", () => {
  it("buffers typing, exposes repeatable legal records and shows calculated holdings", () => {
    const onUpdatePerson = vi.fn(() => true);
    const people = [
      { id: "father", givenNames: "Joseph", surname: "Borg", fullName: "Joseph Borg" },
      {
        id: "maria",
        givenNames: "Maria",
        surname: "Abela",
        fullName: "Maria Abela",
        sex: "Female",
        fatherId: "father",
        isDeceased: true,
        dateOfDeath: "2020-05-06",
        inheritanceBasis: "will",
        wills: [{ id: "will", date: "2019-01-02", notaryName: "A. Vella" }],
        causaMortisDeclarations: [
          { id: "cm", propertyId: "property", date: "2020-06-07", notaryName: "B. Borg" },
        ],
      },
    ];

    act(() =>
      root.render(
        <TreeRegisterDialog
          open
          treeTitle="Test family"
          property={{ id: "property", saleValue: 200000 }}
          people={people}
          ownershipByPerson={{ maria: 0.25 }}
          ownershipFractionsByPerson={{ maria: { numerator: 1, denominator: 4 } }}
          currentOwnerPresentationsByPerson={{}}
          onUpdateTreeTitle={vi.fn(() => true)}
          onUpdateProperty={vi.fn(() => true)}
          onUpdatePerson={onUpdatePerson}
          onSetDeceased={vi.fn(() => true)}
          onShareDisplayChange={vi.fn()}
          onOpenPerson={vi.fn()}
          onDownload={vi.fn()}
          onRegisterPendingEditFlush={() => vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).toContain("Daughter of Joseph Borg");
    expect(container.textContent).toContain("Will 1");
    expect(container.textContent).toContain("DCM 1");
    expect(container.textContent).toContain("1/4");
    expect(container.textContent).toContain("25%");
    expect(container.textContent).toContain("€50,000.00");

    const surname = container.querySelector('input[aria-label="Surname for Maria Abela"]');
    act(() => surname.focus());
    act(() => setInput(surname, "Vella"));
    expect(onUpdatePerson).not.toHaveBeenCalled();
    act(() => surname.blur());
    expect(onUpdatePerson).toHaveBeenCalledTimes(1);
    expect(onUpdatePerson.mock.calls[0][0]).toBe("maria");
    expect(onUpdatePerson.mock.calls[0][1](people[1])).toMatchObject({
      surname: "Vella",
      fullName: "Maria Vella",
    });
  });
});
