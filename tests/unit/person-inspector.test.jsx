// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonInspector } from "../../src/components/PersonInspector.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("PersonInspector", () => {
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

  it("adds a father around the selected person without moving the selection", () => {
    const onChange = vi.fn();
    const onSelectPerson = vi.fn();
    const child = {
      id: "child",
      fullName: "Maria Example",
      sex: "Female",
      surnameAtBirth: "Example",
      designations: [],
      spouseIds: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[child]}
          selectedPersonId="child"
          onChange={onChange}
          onSelectPerson={onSelectPerson}
        />,
      ),
    );

    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Father"))
        .click(),
    );

    const updatedPeople = onChange.mock.calls[0][0];
    expect(updatedPeople).toHaveLength(2);
    expect(updatedPeople[1]).toMatchObject({
      sex: "Male",
      designations: ["Parent"],
    });
    expect(updatedPeople[0].fatherId).toBe(updatedPeople[1].id);
    expect(onSelectPerson).not.toHaveBeenCalled();
  });

  it("adds several children while keeping the relationship controls on the same person", () => {
    let currentPeople = [{
      id: "parent",
      fullName: "Maria Example",
      sex: "Female",
      surnameAtBirth: "Example",
      designations: [],
      spouseIds: [],
      siblingIds: [],
    }];
    const onChange = vi.fn((nextPeople) => {
      currentPeople = nextPeople;
      act(() =>
        root.render(
          <PersonInspector
            people={currentPeople}
            selectedPersonId="parent"
            onChange={onChange}
            onSelectPerson={vi.fn()}
          />,
        ),
      );
    });

    act(() =>
      root.render(
        <PersonInspector
          people={currentPeople}
          selectedPersonId="parent"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const clickChild = () => {
      const childButton = [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Child"));
      act(() => childButton.click());
    };
    clickChild();
    clickChild();
    clickChild();

    expect(currentPeople).toHaveLength(4);
    expect(currentPeople.slice(1).every((person) => person.motherId === "parent")).toBe(true);
    const childButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent.includes("Child"));
    expect(childButton.querySelector(".relationship-count").textContent).toBe("3");
  });

  it("locks a parent to one father and blocks deleting someone with a child", () => {
    const people = [
      {
        id: "parent",
        fullName: "Joseph Example",
        sex: "Male",
        designations: [],
        spouseIds: [],
      },
      {
        id: "child",
        fullName: "Anna Example",
        designations: [],
        fatherId: "parent",
        spouseIds: [],
      },
      {
        id: "father",
        fullName: "Paul Example",
        designations: [],
        spouseIds: [],
      },
    ];
    people[0].fatherId = "father";

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="parent"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const fatherButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent.includes("Father"));
    const deleteButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent.includes("Delete person"));
    expect(fatherButton.disabled).toBe(true);
    expect(fatherButton.querySelector(".relationship-count").textContent).toBe("1");
    expect(deleteButton.disabled).toBe(true);
    expect(container.textContent).toContain("Remove 1 child first.");
  });

  it("can link an existing person as a spouse in both directions", () => {
    const onChange = vi.fn();
    const people = [
      {
        id: "person-a",
        fullName: "Maria Borg",
        sex: "Female",
        surnameAtBirth: "Borg",
        designations: [],
        spouseIds: [],
      },
      {
        id: "person-b",
        fullName: "Joseph Vella",
        designations: [],
        spouseIds: [],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="person-a"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const spouseButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent.includes("Spouse"));
    act(() => spouseButton.click());

    const spouseSelect = container.querySelector('select[aria-label="Existing spouse"]');
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      ).set.call(spouseSelect, "person-b");
      spouseSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const linkButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent.includes("Link spouse"));
    act(() => linkButton.click());

    const updatedPeople = onChange.mock.calls.at(-1)[0];
    expect(updatedPeople[0].spouseIds).toEqual(["person-b"]);
    expect(updatedPeople[1].spouseIds).toEqual(["person-a"]);
  });

  it("requires an explicit deceased checkbox and omits date of birth", () => {
    const onChange = vi.fn();
    const person = {
      id: "person",
      fullName: "Maria Example",
      designations: [],
      spouseIds: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[person]}
          selectedPersonId="person"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).not.toContain("Date of birth");
    expect(container.textContent).toContain("Succession record");
    expect(container.textContent).toContain(
      "Not opened because this person is living",
    );
    const deceasedCheckbox = [...container.querySelectorAll('input[type="checkbox"]')]
      .find((input) => input.parentElement.textContent.includes("This person is deceased."));
    expect(deceasedCheckbox.checked).toBe(false);

    act(() => deceasedCheckbox.click());
    expect(onChange.mock.calls[0][0][0]).toMatchObject({
      isDeceased: true,
      designations: ["Deceased"],
    });
  });

  it("prefills a man's surname at birth from his full name", () => {
    const person = {
      id: "person",
      fullName: "Joseph Borg",
      surnameAtBirth: "",
      sex: "Male",
      designations: [],
      spouseIds: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[person]}
          selectedPersonId="person"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const surnameLabel = [...container.querySelectorAll("label")]
      .find((label) => label.textContent.includes("Surname at birth"));
    expect(surnameLabel.querySelector("input").value).toBe("Borg");
  });

  it("edits names and surname separately while keeping the full display name synchronized", () => {
    const onChange = vi.fn();
    const person = {
      id: "person",
      fullName: "Maria Borg",
      designations: [],
      spouseIds: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[person]}
          selectedPersonId="person"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const namesInput = [...container.querySelectorAll("label")]
      .find((label) => label.querySelector(":scope > span")?.textContent === "Names")
      .querySelector("input");
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(namesInput, "Maria Anna");
      namesInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange.mock.calls.at(-1)[0][0]).toMatchObject({
      givenNames: "Maria Anna",
      fullName: "Maria Anna Borg",
    });
  });

  it("blocks adding relatives until the selected person is identified", () => {
    const onChange = vi.fn();
    const person = {
      id: "person",
      givenNames: "",
      surname: "",
      fullName: "",
      surnameAtBirth: "",
      sex: "Female",
      designations: [],
      spouseIds: [],
      siblingIds: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[person]}
          selectedPersonId="person"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const relationshipButtons = [...container.querySelectorAll(
      ".relationship-actions button",
    )];
    expect(relationshipButtons.every((button) => button.disabled)).toBe(true);
    expect(container.textContent).toContain(
      "Identify this person first: Names, Surname, Surname at birth.",
    );
    act(() => relationshipButtons[0].click());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows testate notes and post-1992 causa mortis fields", () => {
    const deceased = {
      id: "deceased",
      fullName: "Joseph Borg",
      sex: "Male",
      isDeceased: true,
      dateOfDeath: "2020-01-01",
      inheritanceBasis: "will",
      willHeirs: [
        {
          id: "heir-record",
          personId: "child",
          sharePercent: 100,
        },
      ],
      causaMortisDeclarations: [
        {
          id: "cm-1",
          date: "",
          notaryName: "",
          immovablePropertyValue: "",
          declarantPersonIds: ["child"],
        },
      ],
      designations: ["Deceased"],
      spouseIds: [],
      siblingIds: [],
    };
    const child = {
      id: "child",
      fullName: "Maria Borg",
      sex: "Female",
      surnameAtBirth: "Borg",
      fatherId: "deceased",
      designations: [],
      spouseIds: [],
      siblingIds: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[deceased, child]}
          properties={[
            { id: "property-1", address: "1 Republic Street" },
          ]}
          causaMortisCoverage={[
            {
              personId: "deceased",
              propertyId: "property-1",
              propertyAddress: "1 Republic Street",
              requiredShare: 0.5,
              declaredShare: 0,
              difference: -0.5,
              status: "under",
            },
          ]}
          selectedPersonId="deceased"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).toContain("Testate (will)");
    expect(container.textContent).toContain("Will notes");
    expect(container.textContent).toContain("Causa mortis declarations");
    expect(container.textContent).toContain("Required 1/2");
    expect(container.textContent).toContain("Missing 1/2");
    expect(container.textContent).toContain("Declaration CM 1");
    expect(
      container.querySelector(
        'select[aria-label="Property declared causa mortis 1"]',
      ).value,
    ).toBe("property-1");
    const valueInput = container.querySelector(
      'input[aria-label="Immovable property value declared causa mortis 1"]',
    );
    expect(valueInput.required).toBe(true);
    const declarant = [...container.querySelectorAll(
      ".causa-mortis-declarants label",
    )].find((label) => label.textContent.includes("Maria Borg"));
    expect(declarant.querySelector("input").checked).toBe(true);
  });

  it("selects every descendant when adding a causa mortis declaration", () => {
    const onChange = vi.fn();
    const deceased = {
      id: "deceased",
      fullName: "Joseph Borg",
      sex: "Male",
      isDeceased: true,
      dateOfDeath: "2020-01-01",
      inheritanceBasis: "intestacy",
      designations: ["Deceased"],
      spouseIds: [],
      siblingIds: [],
    };
    const child = {
      id: "child",
      fullName: "Maria Borg",
      fatherId: "deceased",
      designations: [],
      spouseIds: [],
      siblingIds: [],
    };
    const grandchild = {
      id: "grandchild",
      fullName: "Paul Borg",
      motherId: "child",
      designations: [],
      spouseIds: [],
      siblingIds: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[deceased, child, grandchild]}
          selectedPersonId="deceased"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const addButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.includes("Add declaration"),
    );
    act(() => addButton.click());
    expect(
      onChange.mock.calls.at(-1)[0][0].causaMortisDeclarations[0]
        .declarantPersonIds,
    ).toEqual(["child", "grandchild"]);
  });

  it("makes the declared value optional when every identified heir is deceased", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        sex: "Male",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "intestacy",
        causaMortisDeclarations: [
          {
            id: "cm-1",
            declarantPersonIds: ["child"],
          },
        ],
        designations: ["Deceased"],
        spouseIds: [],
        siblingIds: [],
      },
      {
        id: "child",
        fullName: "Maria Borg",
        fatherId: "deceased",
        isDeceased: true,
        dateOfDeath: "2022-01-01",
        designations: ["Deceased"],
        spouseIds: [],
        siblingIds: [],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="deceased"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const valueInput = container.querySelector(
      'input[aria-label="Immovable property value declared causa mortis 1"]',
    );
    expect(valueInput.required).toBe(false);
    expect(container.textContent).toContain(
      "optional because every identified heir is now deceased",
    );
  });
});
