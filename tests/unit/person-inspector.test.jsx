// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonInspector } from "../../src/components/PersonInspector.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("PersonInspector", () => {
  let container;
  let root;
  const beginEditing = () => {
    const editButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Edit",
    );
    if (editButton) act(() => editButton.click());
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("opens an unnamed person's fields for editing immediately", () => {
    act(() =>
      root.render(
        <PersonInspector
          people={[
            {
              id: "unnamed",
              fullName: "",
              givenNames: "",
              surname: "",
              sex: "",
              spouseIds: [],
            },
          ]}
          selectedPersonId="unnamed"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector(".person-edit-fields").disabled).toBe(false);
    expect(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent.trim() === "Done",
      ),
    ).not.toBeNull();
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
    let currentPeople = [
      {
        id: "parent",
        fullName: "Maria Example",
        sex: "Female",
        surnameAtBirth: "Example",
        designations: [],
        spouseIds: [],
        siblingIds: [],
      },
    ];
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
      const childButton = [...container.querySelectorAll("button")].find((button) =>
        button.textContent.includes("Child"),
      );
      act(() => childButton.click());
    };
    clickChild();
    clickChild();
    clickChild();

    expect(currentPeople).toHaveLength(4);
    expect(currentPeople.slice(1).every((person) => person.motherId === "parent")).toBe(true);
    const childButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Child"),
    );
    expect(childButton.querySelector(".relationship-count").textContent).toBe("3");
  });

  it("adds a partner to existing children as their missing parent", () => {
    const onChange = vi.fn();
    const onSelectPerson = vi.fn();
    const people = [
      {
        id: "parent",
        fullName: "Roland Wadge",
        sex: "Male",
        surnameAtBirth: "Wadge",
        spouseIds: [],
        designations: [],
      },
      {
        id: "child-1",
        fullName: "Child One",
        fatherId: "parent",
        spouseIds: [],
        designations: [],
      },
      {
        id: "child-2",
        fullName: "Child Two",
        fatherId: "parent",
        spouseIds: [],
        designations: [],
      },
      {
        id: "child-3",
        fullName: "Child Three",
        fatherId: "parent",
        spouseIds: [],
        designations: [],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="parent"
          onChange={onChange}
          onSelectPerson={onSelectPerson}
        />,
      ),
    );
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Partner"))
        .click(),
    );
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Create new partner"))
        .click(),
    );

    const updatedPeople = onChange.mock.calls[0][0];
    const partner = updatedPeople.at(-1);
    expect(updatedPeople[0].spouseIds).toEqual([partner.id]);
    expect(
      updatedPeople
        .filter((person) => person.id.startsWith("child-"))
        .every((person) => person.motherId === partner.id),
    ).toBe(true);
    expect(onSelectPerson).not.toHaveBeenCalled();
  });

  it("locks a parent to one father and blocks deleting someone with a descendant", () => {
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

    const fatherButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Father"),
    );
    const deleteButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Delete person"),
    );
    expect(fatherButton.disabled).toBe(true);
    expect(fatherButton.querySelector(".relationship-count").textContent).toBe("1");
    expect(deleteButton.disabled).toBe(true);
    expect(container.textContent).toContain("Remove 1 descendant first.");
  });

  it("blocks deletion while a partner is linked and can remove that link", () => {
    const onChange = vi.fn();
    const people = [
      {
        id: "person",
        fullName: "Maria Borg",
        spouseIds: ["partner"],
      },
      {
        id: "partner",
        fullName: "Joseph Borg",
        spouseIds: ["person"],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="person"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    beginEditing();

    const deleteButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Delete person"),
    );
    const unlinkButton = container.querySelector(
      'button[aria-label="Remove partner link to Joseph Borg"]',
    );
    expect(deleteButton.disabled).toBe(true);
    expect(container.textContent).toContain("Remove 1 partner link first.");

    act(() => unlinkButton.click());

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: "person", spouseIds: [] }),
      expect.objectContaining({ id: "partner", spouseIds: [] }),
    ]);
  });

  it("asks for confirmation before deleting a person without dependencies", () => {
    const onChange = vi.fn();
    const onSelectPerson = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const people = [
      { id: "parent", fullName: "Joseph Borg", spouseIds: [] },
      {
        id: "person",
        fullName: "Maria Borg",
        fatherId: "parent",
        spouseIds: [],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="person"
          onChange={onChange}
          onSelectPerson={onSelectPerson}
        />,
      ),
    );
    beginEditing();
    const deleteButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Delete person"),
    );

    expect(deleteButton.disabled).toBe(false);
    act(() => deleteButton.click());
    expect(confirm).toHaveBeenCalledWith(
      "Are you sure you want to delete Maria Borg from the family tree? This cannot be undone.",
    );
    expect(onChange).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    act(() => deleteButton.click());
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: "parent" })]);
    expect(onSelectPerson).toHaveBeenCalledWith("parent");
  });

  it("can link an existing person as a partner in both directions", () => {
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

    const partnerButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Partner"),
    );
    act(() => partnerButton.click());

    const spouseSelect = container.querySelector('select[aria-label="Existing partner"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        spouseSelect,
        "person-b",
      );
      spouseSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const linkButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Link partner"),
    );
    act(() => linkButton.click());

    const updatedPeople = onChange.mock.calls.at(-1)[0];
    expect(updatedPeople[0].spouseIds).toEqual(["person-b"]);
    expect(updatedPeople[1].spouseIds).toEqual(["person-a"]);
  });

  it("keeps parent creation buttons but omits father and mother detail selectors", () => {
    const person = {
      id: "person",
      fullName: "Joseph Borg",
      givenNames: "Joseph",
      surname: "Borg",
      surnameAtBirth: "Borg",
      sex: "Male",
      designations: [],
      spouseIds: [],
      siblingIds: [],
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

    const relationshipButtons = [...container.querySelectorAll(".relationship-actions button")].map(
      (button) => button.textContent,
    );
    expect(relationshipButtons.some((text) => text.includes("Father"))).toBe(true);
    expect(relationshipButtons.some((text) => text.includes("Mother"))).toBe(true);
    expect(container.textContent).not.toContain("Succession labels");
    const detailLabels = [
      ...container.querySelectorAll(".inspector-fields > label > span:first-child"),
    ].map((span) => span.textContent);
    expect(detailLabels).not.toContain("Father");
    expect(detailLabels).not.toContain("Mother");
  });

  it("requires an explicit deceased checkbox and omits date of birth", () => {
    const onChange = vi.fn();
    const person = {
      id: "person",
      fullName: "Maria Example",
      sex: "Female",
      surnameAtBirth: "Example",
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
    expect(container.querySelector(".person-succession")).toBeNull();
    expect(container.textContent).not.toContain("Succession on death");
    const deceasedCheckbox = [...container.querySelectorAll('input[type="checkbox"]')].find(
      (input) => input.parentElement.textContent.includes("This person is deceased."),
    );
    expect(deceasedCheckbox.disabled).toBe(false);
    expect(deceasedCheckbox.checked).toBe(false);

    act(() => deceasedCheckbox.click());
    expect(onChange.mock.calls[0][0][0]).toMatchObject({
      isDeceased: true,
      designations: ["Deceased"],
    });
  });

  it("shows only the requested personal fields in the requested order", () => {
    const person = {
      id: "person",
      fullName: "Maria Example",
      givenNames: "Maria",
      surname: "Example",
      surnameAtBirth: "Borg",
      sex: "Female",
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

    const labels = [
      ...container.querySelectorAll(".inspector-fields > label > span:first-child"),
    ].map((span) => span.textContent);
    expect(labels).toEqual(["Name", "Surname", "Surname at birth", "Sex"]);
  });

  it("shows succession fields only for a deceased person", () => {
    const person = {
      id: "person",
      fullName: "Maria Example",
      isDeceased: true,
      dateOfDeath: "2024-02-03",
      inheritanceBasis: "intestacy",
      designations: ["Deceased"],
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

    expect(container.querySelector(".person-succession")).not.toBeNull();
    expect(container.querySelector(".succession-detail-row input").value).toBe("2024-02-03");
    expect(container.textContent).toContain("Succession on death");
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

    const surnameLabel = [...container.querySelectorAll("label")].find((label) =>
      label.textContent.includes("Surname at birth"),
    );
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

    beginEditing();
    const namesInput = [...container.querySelectorAll("label")]
      .find((label) => label.querySelector(":scope > span")?.textContent === "Name")
      .querySelector("input");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        namesInput,
        "Maria Anna",
      );
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

    const relationshipButtons = [...container.querySelectorAll(".relationship-actions button")];
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
          properties={[{ id: "property-1", address: "1 Republic Street" }]}
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
      container.querySelector('select[aria-label="Property declared causa mortis 1"]').value,
    ).toBe("property-1");
    const valueInput = container.querySelector(
      'input[aria-label="Immovable property value declared causa mortis 1"]',
    );
    expect(valueInput.required).toBe(true);
    const declarant = [...container.querySelectorAll(".causa-mortis-declarants label")].find(
      (label) => label.textContent.includes("Maria Borg"),
    );
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

    const addButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Add declaration"),
    );
    beginEditing();
    act(() => addButton.click());
    expect(onChange.mock.calls.at(-1)[0][0].causaMortisDeclarations[0].declarantPersonIds).toEqual([
      "child",
      "grandchild",
    ]);
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

  it("unlocks full details and assigned parent dropdowns with Edit", () => {
    const people = [
      {
        id: "person",
        fullName: "Paul Borg",
        givenNames: "Paul",
        surname: "Borg",
        surnameAtBirth: "Borg",
        sex: "Male",
        fatherId: "father",
        motherId: "mother",
        spouseIds: [],
        designations: [],
      },
      {
        id: "father",
        fullName: "Joseph Borg",
        sex: "Male",
        spouseIds: ["mother"],
        designations: [],
      },
      {
        id: "mother",
        fullName: "Maria Borg",
        sex: "Female",
        spouseIds: ["father"],
        designations: [],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="person"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const nameInput = container.querySelector(".inspector-fields input");
    const fatherSelect = container.querySelector('select[aria-label="Father"]');
    const motherSelect = container.querySelector('select[aria-label="Mother"]');
    expect(nameInput.matches(":disabled")).toBe(true);
    expect(fatherSelect.matches(":disabled")).toBe(true);
    expect(motherSelect.matches(":disabled")).toBe(true);
    expect(fatherSelect.value).toBe("father");
    expect(motherSelect.value).toBe("mother");

    beginEditing();
    expect(nameInput.matches(":disabled")).toBe(false);
    expect(fatherSelect.matches(":disabled")).toBe(false);
    expect(motherSelect.matches(":disabled")).toBe(false);
    expect(container.textContent).toContain("Done");
  });
});
