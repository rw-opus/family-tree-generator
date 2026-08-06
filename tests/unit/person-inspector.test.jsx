// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonInspector } from "../../src/components/PersonInspector.jsx";
import { normaliseCase } from "../../src/domain/caseModel.js";
import { findPartnerRelationship } from "../../src/domain/partnerRelationships.js";
import { buildPropertyVendorTaxReport } from "../../src/domain/propertyVendorTax.js";
import {
  beginStatusToggleSession,
  endStatusToggleSession,
  statusToggleSession,
} from "../../src/domain/statusToggleSessions.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("PersonInspector", () => {
  let container;
  let root;
  const beginEditing = () => {
    const editButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Edit identity",
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
    expect(container.textContent).not.toContain("GEDCOM");
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  it("does not duplicate the surrounding drawer's Back to Tree navigation", () => {
    act(() =>
      root.render(
        <PersonInspector
          people={[
            {
              id: "person",
              fullName: "Maria Borg",
              sex: "Female",
              spouseIds: [],
            },
          ]}
          selectedPersonId="person"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).not.toContain("Back to Tree");
  });

  it("creates an editable missing mother only after explicit confirmation", () => {
    let latestPeople = [];
    const initialPeople = [
      {
        id: "michael",
        givenNames: "Michael",
        surname: "Wadge",
        fullName: "Michael Wadge",
        sex: "Male",
        isDeceased: true,
        dateOfDeath: "2020-04-12",
        inheritanceBasis: "intestacy",
        fatherId: "edgar",
        motherId: "",
        spouseIds: [],
        designations: ["Deceased"],
      },
      {
        id: "edgar",
        givenNames: "Edgar",
        surname: "Wadge",
        fullName: "Edgar Wadge",
        sex: "Male",
        isDeceased: true,
        dateOfDeath: "1990-01-01",
        spouseIds: [],
        designations: ["Deceased"],
      },
    ];

    function Harness() {
      const [people, setPeople] = useState(initialPeople);
      latestPeople = people;
      return (
        <PersonInspector
          people={people}
          selectedPersonId="michael"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));

    expect(latestPeople.find((person) => person.id === "michael").motherId).toBe("");
    const addMissingParent = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Add missing parent"),
    );
    expect(addMissingParent).not.toBeNull();
    act(() => addMissingParent.click());

    const michael = latestPeople.find((person) => person.id === "michael");
    const mother = latestPeople.find((person) => person.id === michael.motherId);
    expect(mother).toMatchObject({
      fullName: "Mother of Michael",
      sex: "Female",
      isPotentialIntestateParent: true,
      potentialParentAddedExplicitly: true,
      survivalStatusRequired: true,
      survivalStatusReferencePersonId: "michael",
    });
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

  it("requires confirmation before assigning a sole partner as the other parent", () => {
    const onChange = vi.fn();
    const people = [
      {
        id: "parent-a",
        fullName: "Mark Borg",
        sex: "Male",
        spouseIds: [],
        designations: [],
      },
      {
        id: "parent-b",
        fullName: "Elena Borg",
        sex: "Female",
        spouseIds: ["parent-a"],
        designations: [],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="parent-a"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Child"))
        .click(),
    );

    expect(onChange).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Choose the other parent for this child");
    const partnerSelect = container.querySelector(`select[aria-label="Child's other parent"]`);
    expect(partnerSelect.value).toBe("parent-b");
    act(() =>
      [...container.querySelectorAll(".child-partner-chooser button")]
        .find((button) => button.textContent.includes("Add child"))
        .click(),
    );

    expect(onChange.mock.calls[0][0].at(-1)).toMatchObject({
      fatherId: "parent-a",
      motherId: "parent-b",
      designations: ["Child"],
      surname: "Borg",
      surnameAtBirth: "Borg",
    });
  });

  it("uses the recorded father's surname when a mother creates a child", () => {
    const onChange = vi.fn();
    const people = [
      {
        id: "mother",
        givenNames: "Maria",
        surname: "Vella",
        fullName: "Maria Vella",
        surnameAtBirth: "Borg",
        sex: "Female",
        spouseIds: ["father"],
      },
      {
        id: "father",
        givenNames: "Joseph",
        surname: "Testaferrata de Noto",
        fullName: "Joseph Testaferrata de Noto",
        sex: "Male",
        spouseIds: ["mother"],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="mother"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Child"))
        .click(),
    );
    act(() =>
      [...container.querySelectorAll(".child-partner-chooser button")]
        .find((button) => button.textContent.includes("Add child"))
        .click(),
    );

    expect(onChange.mock.calls[0][0].at(-1)).toMatchObject({
      fatherId: "father",
      motherId: "mother",
      surname: "Testaferrata de Noto",
      surnameAtBirth: "Testaferrata de Noto",
      fullName: "",
    });
  });

  it("uses the common recorded father's surname for a newly created sibling", () => {
    const onChange = vi.fn();
    const people = [
      {
        id: "father",
        givenNames: "Joseph",
        surname: "Borg",
        fullName: "Joseph Borg",
        sex: "Male",
        spouseIds: [],
      },
      {
        id: "person",
        givenNames: "Maria",
        surname: "Borg",
        fullName: "Maria Borg",
        surnameAtBirth: "Borg",
        sex: "Female",
        fatherId: "father",
        spouseIds: [],
        siblingIds: [],
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
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Brother / sister"))
        .click(),
    );

    expect(onChange.mock.calls[0][0].at(-1)).toMatchObject({
      fatherId: "father",
      surname: "Borg",
      surnameAtBirth: "Borg",
      fullName: "",
    });
  });

  it("keeps inherited current and birth surnames independently editable", () => {
    let latestPerson;

    function Harness() {
      const [people, setPeople] = useState([
        {
          id: "child",
          givenNames: "Anna",
          surname: "Borg",
          fullName: "Anna Borg",
          surnameAtBirth: "Borg",
          sex: "Female",
          fatherId: "father",
          spouseIds: [],
        },
        { id: "father", fullName: "Joseph Borg", spouseIds: [] },
      ]);
      latestPerson = people[0];
      return (
        <PersonInspector
          people={people}
          selectedPersonId="child"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));
    beginEditing();

    const fieldInput = (label) =>
      [...container.querySelectorAll(".person-edit-fields label")]
        .find((element) => element.querySelector(":scope > span")?.textContent === label)
        .querySelector("input");
    act(() => {
      const surnameInput = fieldInput("Surname");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        surnameInput,
        "Vella",
      );
      surnameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(latestPerson).toMatchObject({
      surname: "Vella",
      fullName: "Anna Vella",
      surnameAtBirth: "Borg",
    });

    act(() => {
      const birthSurnameInput = fieldInput("Surname at birth");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        birthSurnameInput,
        "Camilleri",
      );
      birthSurnameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(latestPerson.surnameAtBirth).toBe("Camilleri");
  });

  it("clears the GEDCOM surname review warning after the birth surname is confirmed", () => {
    let latestPerson;

    function Harness() {
      const [people, setPeople] = useState([
        {
          id: "child",
          givenNames: "Anna",
          surname: "Borg",
          fullName: "Anna Borg",
          surnameAtBirth: "",
          surnameAtBirthReviewRequired: true,
          gedcomUnmarriedParents: true,
          sex: "Female",
          spouseIds: [],
        },
      ]);
      latestPerson = people[0];
      return (
        <PersonInspector
          people={people}
          selectedPersonId="child"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));
    expect(container.textContent).toContain("The imported parents are recorded as unmarried");
    beginEditing();

    const birthSurnameInput = [...container.querySelectorAll(".person-edit-fields label")]
      .find((element) => element.querySelector(":scope > span")?.textContent === "Surname at birth")
      .querySelector("input");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        birthSurnameInput,
        "Vella",
      );
      birthSurnameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(latestPerson).toMatchObject({
      surnameAtBirth: "Vella",
      surnameAtBirthReviewRequired: false,
      gedcomUnmarriedParents: true,
    });
    expect(container.textContent).not.toContain("The imported parents are recorded as unmarried");
  });

  it("asks which partnership applies when a person has several partners", () => {
    const onChange = vi.fn();
    const people = [
      {
        id: "parent",
        fullName: "Roland Wadge",
        sex: "Male",
        spouseIds: ["partner-a", "partner-b"],
        designations: [],
      },
      {
        id: "partner-a",
        fullName: "Anna Borg",
        sex: "Female",
        spouseIds: ["parent"],
      },
      {
        id: "partner-b",
        fullName: "Maria Vella",
        sex: "Female",
        spouseIds: ["parent"],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="parent"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Child"))
        .click(),
    );
    const partnerSelect = container.querySelector(`select[aria-label="Child's other parent"]`);
    expect(partnerSelect).not.toBeNull();
    expect(partnerSelect.value).toBe("partner-b");
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      partnerSelect.value = "partner-a";
      partnerSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() =>
      [...container.querySelectorAll(".child-partner-chooser button")]
        .find((button) => button.textContent.includes("Add child"))
        .click(),
    );

    expect(onChange.mock.calls[0][0].at(-1)).toMatchObject({
      fatherId: "parent",
      motherId: "partner-a",
    });
  });

  it("defaults to the most recently linked valid partner whenever the child chooser reopens", () => {
    const onChange = vi.fn();
    const people = [
      {
        id: "parent",
        fullName: "Roland Wadge",
        sex: "Male",
        spouseIds: ["partner-a", "missing-a", "partner-b", "missing-b"],
        designations: [],
      },
      {
        id: "partner-a",
        fullName: "Anna Borg",
        sex: "Female",
        spouseIds: ["parent"],
      },
      {
        id: "partner-b",
        fullName: "Maria Vella",
        sex: "Female",
        spouseIds: ["parent"],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="parent"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const childButton = [...container.querySelectorAll(".relationship-actions button")].find(
      (button) => button.textContent.includes("Child"),
    );
    act(() => childButton.click());

    let partnerSelect = container.querySelector(`select[aria-label="Child's other parent"]`);
    expect(partnerSelect.value).toBe("partner-b");
    expect([...partnerSelect.options].some((option) => option.value === "")).toBe(true);

    act(() => {
      partnerSelect.value = "";
      partnerSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(partnerSelect.value).toBe("");

    act(() => childButton.click());
    expect(container.querySelector(`select[aria-label="Child's other parent"]`)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();

    act(() => childButton.click());
    partnerSelect = container.querySelector(`select[aria-label="Child's other parent"]`);
    expect(partnerSelect.value).toBe("partner-b");

    act(() =>
      [...container.querySelectorAll(".child-partner-chooser button")]
        .find((button) => button.textContent.includes("Add child"))
        .click(),
    );
    expect(onChange.mock.calls[0][0].at(-1)).toMatchObject({
      fatherId: "parent",
      motherId: "partner-b",
    });
  });

  it("suggests a new partner as a missing parent and applies only confirmed links", () => {
    const onSelectPerson = vi.fn();
    let latestPeople = [];
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
    ];

    function Harness() {
      const [currentPeople, setCurrentPeople] = useState(people);
      latestPeople = currentPeople;
      return (
        <PersonInspector
          people={currentPeople}
          selectedPersonId="parent"
          onChange={setCurrentPeople}
          onSelectPerson={onSelectPerson}
        />
      );
    }

    act(() => root.render(<Harness />));
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

    const partner = latestPeople.at(-1);
    expect(latestPeople[0].spouseIds).toEqual([partner.id]);
    expect(latestPeople.find((person) => person.id === "child-1").motherId).toBeUndefined();
    expect(latestPeople.find((person) => person.id === "child-2").motherId).toBeUndefined();
    expect(container.querySelectorAll(".parent-suggestion")).toHaveLength(2);
    expect(container.textContent).toContain("Parent links to confirm");

    act(() => container.querySelector(".parent-suggestion .primary-button").click());
    expect(latestPeople.find((person) => person.id === "child-1").motherId).toBe(partner.id);
    expect(latestPeople.find((person) => person.id === "child-2").motherId).toBeUndefined();

    act(() => container.querySelector(".parent-suggestion .secondary-button").click());
    expect(latestPeople.find((person) => person.id === "child-2").motherExplicitlyUnassigned).toBe(
      true,
    );
    expect(container.querySelectorAll(".parent-suggestion")).toHaveLength(0);
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
    // Joseph stands between his own father and his child, so removing him would
    // leave those two with no way back to each other.
    expect(container.textContent).toContain("the only link holding this family together");
  });

  it("shows existing parents as one read-only italic relationship", () => {
    const people = [
      {
        id: "child",
        fullName: "Joseph Wadge",
        sex: "Male",
        fatherId: "father",
        motherId: "mother",
        spouseIds: [],
      },
      { id: "father", fullName: "Roland Wadge", spouseIds: [] },
      {
        id: "mother",
        fullName: "Alison Wadge",
        surnameAtBirth: "Buttigieg",
        spouseIds: [],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="child"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector(".person-parentage").textContent).toBe(
      "son of Roland Wadge & Alison Wadge nee Buttigieg",
    );
    expect(container.querySelector('[data-parent-link="father"]')).toBeNull();
    expect(container.querySelector('select[aria-label="Change father"]')).toBeNull();
    expect(container.querySelector('button[aria-label^="Remove father link"]')).toBeNull();
  });

  it("allows deletion of a partner with no descendants, and can still unlink", () => {
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
    // A partner added by mistake has to be removable without first unpicking
    // the marriage. Only descendants stand in the way of a deletion.
    expect(deleteButton.disabled).toBe(false);
    expect(container.textContent).not.toContain("Remove 1 partner link first.");

    act(() => unlinkButton.click());

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: "person", spouseIds: [] }),
      expect.objectContaining({ id: "partner", spouseIds: [] }),
    ]);
  });

  it("can unlink siblings without making either person undeletable", () => {
    const onChange = vi.fn();
    const people = [
      { id: "person", fullName: "Maria Borg", siblingIds: ["sibling"], spouseIds: [] },
      { id: "sibling", fullName: "Paul Borg", siblingIds: ["person"], spouseIds: [] },
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
      'button[aria-label="Remove sibling link to Paul Borg"]',
    );
    expect(deleteButton.disabled).toBe(false);
    expect(unlinkButton).not.toBeNull();

    act(() => unlinkButton.click());

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: "person", siblingIds: [] }),
      expect.objectContaining({ id: "sibling", siblingIds: [] }),
    ]);
  });

  it("hides redundant sibling unlinking when the people already share a parent", () => {
    const people = [
      { id: "father", fullName: "Joseph Borg", spouseIds: [] },
      {
        id: "person",
        fullName: "Maria Borg",
        fatherId: "father",
        siblingIds: ["sibling"],
        spouseIds: [],
      },
      {
        id: "sibling",
        fullName: "Paul Borg",
        fatherId: "father",
        siblingIds: ["person"],
        spouseIds: [],
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
    beginEditing();

    expect(
      container.querySelector('button[aria-label="Remove sibling link to Paul Borg"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("Sibling links");
  });

  it("keeps a shared-parent partnership linked until the child is reassigned", () => {
    const onChange = vi.fn();
    const people = [
      { id: "person", fullName: "Maria Borg", spouseIds: ["partner"] },
      { id: "partner", fullName: "Joseph Borg", spouseIds: ["person"] },
      {
        id: "child",
        fullName: "Anna Borg",
        fatherId: "partner",
        motherId: "person",
        spouseIds: [],
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

    const unlinkButton = container.querySelector(
      'button[aria-label="Remove partner link to Joseph Borg"]',
    );
    expect(unlinkButton.disabled).toBe(true);
    expect(unlinkButton.title).toContain("Reassign");
    act(() => unlinkButton.click());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not delete the sole person from one family tab because another tab has people", () => {
    act(() =>
      root.render(
        <PersonInspector
          people={[
            { id: "person", fullName: "Maria Borg", spouseIds: [] },
            { id: "other-family", fullName: "Paul Vella", spouseIds: [] },
          ]}
          familyPersonIds={["person"]}
          selectedPersonId="person"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    beginEditing();

    const deleteButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Delete person"),
    );
    expect(deleteButton.disabled).toBe(true);
    expect(container.textContent).toContain("A tree must contain at least one person.");
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

  it("blocks deletion for ownership held in a second property, not just the primary one", () => {
    const people = [
      { id: "parent", fullName: "Joseph Borg", spouseIds: [] },
      { id: "person", fullName: "Maria Borg", fatherId: "parent", spouseIds: [] },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[{ id: "property-1" }, { id: "property-2" }]}
          selectedPersonId="person"
          ownershipByPerson={{}}
          hasAnyPropertyOwnership
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    beginEditing();

    const deleteButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Delete person"),
    );
    expect(deleteButton.disabled).toBe(true);
    expect(container.textContent).toContain("Remove the person's property ownership first.");
  });

  it("removes a shared canonical person from only the current family", () => {
    const onChange = vi.fn();
    const onDeletePerson = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    act(() =>
      root.render(
        <PersonInspector
          people={[
            { id: "person", fullName: "Maria Borg", spouseIds: [] },
            { id: "other", fullName: "Paul Vella", spouseIds: [] },
          ]}
          familyPersonIds={["person", "other"]}
          personFamilyGroupCount={2}
          selectedPersonId="person"
          ownershipByPerson={{ person: 0.5 }}
          caseDependencyLabels={["an initial property ownership record"]}
          onChange={onChange}
          onDeletePerson={onDeletePerson}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    beginEditing();

    const removeButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Remove from this family"),
    );
    expect(removeButton).not.toBeNull();
    expect(removeButton.disabled).toBe(false);
    expect(container.textContent).toContain(
      "This removes the person from this family only; the shared record remains elsewhere.",
    );

    act(() => removeButton.click());

    expect(confirm).toHaveBeenCalledWith(
      "Remove Maria Borg from this family tree? The person will remain in the other linked family tree.",
    );
    expect(onDeletePerson).toHaveBeenCalledWith("person");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes a CM declarant from the tree while retaining their legal identity", () => {
    const onDeletePerson = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    act(() =>
      root.render(
        <PersonInspector
          people={[
            { id: "person", fullName: "Maria Borg", spouseIds: [] },
            { id: "other", fullName: "Paul Vella", spouseIds: [] },
          ]}
          familyPersonIds={["person", "other"]}
          selectedPersonId="person"
          retainedIdentityLabels={["a causa mortis declarant record"]}
          onChange={vi.fn()}
          onDeletePerson={onDeletePerson}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    beginEditing();

    const removeButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Remove from this family"),
    );
    expect(removeButton.disabled).toBe(false);
    expect(container.textContent).toContain(
      "retains their identity as an unconnected person because a Declaration Causa Mortis names them as a declarant",
    );

    act(() => removeButton.click());

    expect(confirm).toHaveBeenCalledWith(
      "Remove Maria Borg from this family tree? The person will remain as an unconnected person because a Declaration Causa Mortis names them as a declarant.",
    );
    expect(onDeletePerson).toHaveBeenCalledWith("person");
  });

  it("does not promise family-scoped removal without a scoped delete callback", () => {
    act(() =>
      root.render(
        <PersonInspector
          people={[
            { id: "person", fullName: "Maria Borg", spouseIds: [] },
            { id: "other", fullName: "Paul Vella", spouseIds: [] },
          ]}
          familyPersonIds={["person", "other"]}
          personFamilyGroupCount={2}
          selectedPersonId="person"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    beginEditing();

    const removeButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Remove from this family"),
    );
    expect(removeButton.disabled).toBe(true);
    expect(container.textContent).toContain("Family-scoped removal is unavailable in this view.");
  });

  it("ignores descendants that belong only to another family during scoped removal", () => {
    act(() =>
      root.render(
        <PersonInspector
          people={[
            { id: "person", fullName: "Maria Borg", spouseIds: [] },
            { id: "local", fullName: "Paul Vella", spouseIds: [] },
            { id: "other-child", fullName: "Anna Borg", motherId: "person", spouseIds: [] },
          ]}
          familyPersonIds={["person", "local"]}
          personFamilyGroupCount={2}
          selectedPersonId="person"
          caseDependencyLabels={["a child relationship"]}
          onChange={vi.fn()}
          onDeletePerson={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    beginEditing();

    const removeButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Remove from this family"),
    );
    expect(removeButton.disabled).toBe(false);
    expect(container.textContent).not.toContain("Remove 1 descendant first.");
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
        sex: "Male",
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

  it("links an existing partner without silently assigning that person to earlier children", () => {
    const onChange = vi.fn();
    const people = [
      {
        id: "person-a",
        fullName: "Maria Borg",
        sex: "Female",
        surnameAtBirth: "Borg",
        spouseIds: [],
      },
      { id: "person-b", fullName: "Joseph Vella", sex: "Male", spouseIds: [] },
      { id: "child", fullName: "Child Borg", motherId: "person-a", fatherId: "" },
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
    expect(updatedPeople.find((person) => person.id === "child")).toMatchObject({
      motherId: "person-a",
      fatherId: "",
    });
  });

  it("offers only opposite-sex cousins or more distant people as existing partners", () => {
    const people = [
      {
        id: "grandfather",
        fullName: "Anthony Borg",
        sex: "Male",
        spouseIds: [],
      },
      { id: "grandmother", fullName: "Carmela Borg", sex: "Female", spouseIds: [] },
      {
        id: "mother",
        fullName: "Rita Borg",
        sex: "Female",
        fatherId: "grandfather",
        motherId: "grandmother",
        spouseIds: [],
      },
      {
        id: "uncle",
        fullName: "Paul Borg",
        sex: "Male",
        fatherId: "grandfather",
        motherId: "grandmother",
        spouseIds: [],
      },
      { id: "father", fullName: "Joseph Vella", sex: "Male", spouseIds: [] },
      {
        id: "person",
        fullName: "Maria Vella",
        givenNames: "Maria",
        surname: "Vella",
        surnameAtBirth: "Vella",
        sex: "Female",
        fatherId: "father",
        motherId: "mother",
        spouseIds: [],
      },
      {
        id: "brother",
        fullName: "John Vella",
        sex: "Male",
        fatherId: "father",
        motherId: "mother",
        spouseIds: [],
      },
      { id: "cousin", fullName: "Mark Borg", sex: "Male", fatherId: "uncle", spouseIds: [] },
      { id: "unrelated", fullName: "Luke Galea", sex: "Male", spouseIds: [] },
      { id: "same-sex", fullName: "Anna Mifsud", sex: "Female", spouseIds: [] },
      { id: "unknown-sex", fullName: "Alex Camilleri", sex: "", spouseIds: [] },
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
    act(() =>
      [...container.querySelectorAll(".relationship-actions button")]
        .find((button) => button.textContent.includes("Partner"))
        .click(),
    );

    const candidateIds = [
      ...container.querySelector('select[aria-label="Existing partner"]').options,
    ]
      .map((option) => option.value)
      .filter(Boolean);
    expect(candidateIds).toEqual(["unrelated", "cousin"]);
    expect(
      container.querySelector('select[aria-label="Existing partner"] option[value="cousin"]')
        .textContent,
    ).toBe("Mark Borg s/o Paul Borg");
    expect(container.textContent).toContain("cousins and more distant relatives remain available");

    act(() =>
      [...container.querySelectorAll(".relationship-actions button")]
        .find((button) => button.textContent.includes("Wife / husband"))
        .click(),
    );
    const marriageCandidateIds = [
      ...container.querySelector('select[aria-label="Existing partner"]').options,
    ]
      .map((option) => option.value)
      .filter(Boolean);
    expect(marriageCandidateIds).toEqual(["unrelated", "cousin"]);
    expect(container.textContent).toContain("Add a wife or husband");
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

  it("records that a deceased person was unmarried or widowed at death", () => {
    const onChange = vi.fn();
    const deceased = {
      id: "deceased",
      fullName: "Joseph Borg",
      givenNames: "Joseph",
      surname: "Borg",
      sex: "Male",
      isDeceased: true,
      dateOfDeath: "2020-01-01",
      inheritanceBasis: "intestacy",
      spouseIds: ["former-spouse"],
      designations: ["Deceased"],
    };
    const formerSpouse = {
      id: "former-spouse",
      fullName: "Maria Borg",
      sex: "Female",
      spouseIds: ["deceased"],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[deceased, formerSpouse]}
          selectedPersonId="deceased"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const maritalStatus = container.querySelector(
      'input[aria-label="No spouse survived this person"]',
    );
    expect(maritalStatus).not.toBeNull();
    expect(maritalStatus.checked).toBe(false);

    act(() => maritalStatus.click());
    expect(onChange.mock.calls.at(-1)[0].find((person) => person.id === "deceased")).toMatchObject({
      unmarriedOrWidowedAtDeath: true,
    });

    act(() =>
      root.render(
        <PersonInspector
          people={[{ ...deceased, unmarriedOrWidowedAtDeath: true }, formerSpouse]}
          selectedPersonId="deceased"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    expect(container.textContent).toContain(
      "Maria Borg is excluded from this succession while this setting is selected",
    );
  });

  it("shows recorded co-parents as married without asking for confirmation or a date", () => {
    const onChange = vi.fn();
    const deceased = {
      id: "deceased",
      fullName: "Edgar Wadge",
      givenNames: "Edgar",
      surname: "Wadge",
      sex: "Male",
      isDeceased: true,
      dateOfDeath: "2005-05-20",
      inheritanceBasis: "intestacy",
      designations: ["Deceased"],
    };
    const coParent = {
      id: "co-parent",
      fullName: "Giovanna Wadge",
      givenNames: "Giovanna",
      surname: "Wadge",
      sex: "Female",
    };
    const child = {
      id: "child",
      fullName: "Roland Wadge",
      sex: "Male",
      fatherId: "deceased",
      motherId: "co-parent",
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[deceased, coParent, child]}
          selectedPersonId="deceased"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).not.toContain("Confirm the co-parent relationship");
    expect(container.textContent).not.toContain("Record marriage");
    expect(container.textContent).not.toContain("Marriage date");
    const relationshipType = container.querySelector(
      'select[aria-label="Relationship type with Giovanna Wadge"]',
    );
    expect(relationshipType).not.toBeNull();
    expect(relationshipType.value).toBe("marriage");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("immediately unlocks every succession field when a person is marked deceased", () => {
    let people = [
      {
        id: "person",
        fullName: "Joseph Borg",
        givenNames: "Joseph",
        surname: "Borg",
        surnameAtBirth: "Borg",
        sex: "Male",
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        willDate: "2019-02-03",
        willNotaryName: "Notary Test",
        willNotes: "Test will",
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
            propertyId: "property",
            date: "2020-02-01",
            notaryName: "Notary Test",
            immovablePropertyValue: "100000",
            declaredShareNumerator: 1,
            declaredShareDenominator: 1,
            declarantPersonIds: ["child"],
          },
        ],
        designations: [],
        spouseIds: [],
      },
      {
        id: "child",
        fullName: "Maria Borg",
        fatherId: "person",
        spouseIds: [],
      },
    ];
    const onChange = vi.fn((nextPeople) => {
      people = nextPeople;
      act(() =>
        root.render(
          <PersonInspector
            people={people}
            properties={[{ id: "property", address: "1 Republic Street" }]}
            selectedPersonId="person"
            onChange={onChange}
            onSelectPerson={vi.fn()}
          />,
        ),
      );
    });

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[{ id: "property", address: "1 Republic Street" }]}
          selectedPersonId="person"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector(".person-succession")).toBeNull();
    const deceasedCheckbox = [...container.querySelectorAll('input[type="checkbox"]')].find(
      (input) => input.parentElement.textContent.includes("This person is deceased."),
    );
    act(() => deceasedCheckbox.click());

    const succession = container.querySelector(".person-succession");
    expect(succession).not.toBeNull();
    expect(succession.querySelector(".succession-detail-row input").value).toBe("01/01/2020");
    expect(
      [...succession.querySelectorAll("input, select, textarea")].filter(
        (control) => control.disabled,
      ),
    ).toEqual([]);
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent.trim() === "Done",
      ),
    ).toBe(true);
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
    expect(labels).toEqual(["Name", "Surname", "Surname at birth"]);
    const statusRows = [...container.querySelectorAll(".person-status-control")];
    expect(statusRows.map((row) => row.firstElementChild.textContent)).toEqual([
      "Sex",
      "Status",
      "Transfer",
    ]);
    expect(
      [...statusRows[0].querySelectorAll('input[type="radio"]')].map(
        (input) => input.parentElement.textContent,
      ),
    ).toEqual(["Female", "Male", "Other"]);
  });

  it("toggles the estimated share between fraction and percentage and derives its value", () => {
    const onShareDisplayChange = vi.fn();
    act(() =>
      root.render(
        <PersonInspector
          people={[
            {
              id: "person",
              fullName: "Maria Example",
              sex: "Female",
              designations: [],
              spouseIds: [],
            },
          ]}
          properties={[{ id: "property", saleValue: "400000" }]}
          ownershipByPerson={{ person: 0.25 }}
          selectedPersonId="person"
          shareDisplay="fraction"
          onShareDisplayChange={onShareDisplayChange}
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector(".person-share-value strong").textContent).toBe("1/4");
    expect(container.querySelector(".person-share-value small").textContent).toContain(
      "€100,000.00",
    );

    const percentageButton = [...container.querySelectorAll(".person-share-toggle button")].find(
      (button) => button.textContent === "Percentage",
    );
    act(() => percentageButton.click());

    expect(container.querySelector(".person-share-value strong").textContent).toBe("25%");
    expect(onShareDisplayChange).toHaveBeenCalledWith("percentage");

    const bothButton = [...container.querySelectorAll(".person-share-toggle button")].find(
      (button) => button.textContent === "Both",
    );
    act(() => bothButton.click());

    expect(container.querySelector(".person-share-value strong").textContent).toBe("1/4 · 25%");
    expect(onShareDisplayChange).toHaveBeenCalledWith("both");
  });

  it("shows the selected living vendor's calculated Final Withholding Tax", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        willDate: "2019-12-01",
        willHeirs: [{ id: "share", personId: "child", sharePercent: 100 }],
        spouseIds: [],
        causaMortisDeclarations: [
          {
            id: "cm",
            propertyId: "property",
            status: "complete",
            declaredShareNumerator: 1,
            declaredShareDenominator: 1,
            immovablePropertyValue: "100000",
            date: "2020-04-01",
            notaryName: "Maria Notary",
            declarantPersonIds: ["child"],
          },
        ],
      },
      {
        id: "child",
        fullName: "Maria Borg",
        fatherId: "deceased",
        spouseIds: [],
      },
    ];
    const property = {
      id: "property",
      saleValue: "120000",
      owners: [{ personId: "deceased", sharePercent: 100 }],
      transfers: [],
      declarations: [],
      saleLots: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[property]}
          ownershipByPerson={{ child: 1 }}
          selectedPersonId="child"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const tax = container.querySelector(".person-final-withholding-tax");
    expect(tax.textContent).toContain("Final Withholding Tax");
    expect(tax.querySelector("strong").textContent).toBe("€2,400.00");
    expect(tax.querySelector("small").textContent).toContain("Tax Calculation panel");
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
    expect(container.querySelector(".succession-detail-row input").value).toBe("03/02/2024");
    expect(container.querySelector(".succession-detail-row input").disabled).toBe(false);
    expect(container.querySelector('select[aria-label="Inheritance basis"]').disabled).toBe(false);
    expect(container.textContent).not.toContain("Succession on death");
    expect(container.textContent).toContain("Intestate");
  });

  it("uses proposed intestate heirs automatically and lets edited shares override them", () => {
    let latestPeople = [];
    const initialPeople = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2024-02-03",
        inheritanceBasis: "intestacy",
        designations: ["Deceased"],
        spouseIds: ["spouse"],
      },
      {
        id: "spouse",
        fullName: "Maria Borg",
        spouseIds: ["deceased"],
        designations: [],
      },
      {
        id: "child",
        fullName: "Paul Borg",
        fatherId: "deceased",
        motherId: "spouse",
        spouseIds: [],
        designations: [],
      },
    ];
    function Harness() {
      const [people, setPeople] = useState(initialPeople);
      latestPeople = people;
      return (
        <PersonInspector
          people={people}
          selectedPersonId="deceased"
          shareDisplay="fraction"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));

    expect(container.textContent).toContain("Beneficiaries");
    expect(container.textContent).toContain("Calculated beneficiaries");
    expect(container.textContent).toContain("1/2");

    const editBeneficiaries = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Edit Beneficiaries"),
    );
    act(() => editBeneficiaries.click());

    expect(latestPeople[0].intestateHeirs).toBeUndefined();
    expect(container.querySelectorAll(".confirmed-heir-row")).toHaveLength(2);
    expect(container.querySelectorAll(".confirmed-heir-fraction")).toHaveLength(2);
    expect(container.querySelectorAll(".confirmed-heir-percent")).toHaveLength(0);

    const cancel = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Cancel",
    );
    act(() => cancel.click());
    expect(latestPeople[0].intestateHeirs).toBeUndefined();
    expect(container.querySelectorAll(".confirmed-heir-row")).toHaveLength(0);
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Edit Beneficiaries"))
        .click(),
    );

    const setNumberInput = (input, value) => {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    let childDenominator = container.querySelector(
      'input[aria-label="Share denominator for Paul Borg"]',
    );
    setNumberInput(childDenominator, "");
    childDenominator = container.querySelector(
      'input[aria-label="Share denominator for Paul Borg"]',
    );
    expect(childDenominator.value).toBe("");

    setNumberInput(childDenominator, "4");
    expect(latestPeople[0].intestateHeirs).toBeUndefined();
    expect(
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent.includes("Apply edited beneficiaries"),
      ).disabled,
    ).toBe(true);

    const childNumerator = container.querySelector(
      'input[aria-label="Share numerator for Paul Borg"]',
    );
    setNumberInput(childNumerator, "2");
    expect(latestPeople[0].intestateHeirs).toBeUndefined();

    const percentageButton = [...container.querySelectorAll(".person-share-toggle button")].find(
      (button) => button.textContent === "Percentage",
    );
    act(() => percentageButton.click());
    expect(container.textContent).toContain("50%");
    expect(container.querySelectorAll(".confirmed-heir-fraction")).toHaveLength(0);
    expect(container.querySelectorAll(".confirmed-heir-percent")).toHaveLength(2);

    const childPercentage = container.querySelector(
      'input[aria-label="Share percentage for Paul Borg"]',
    );
    setNumberInput(childPercentage, "45");
    expect(latestPeople[0].intestateHeirs).toBeUndefined();
    setNumberInput(
      container.querySelector('input[aria-label="Share percentage for Paul Borg"]'),
      "50",
    );

    const applyEdited = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Apply edited beneficiaries"),
    );
    expect(applyEdited.disabled).toBe(false);
    act(() => applyEdited.click());

    expect(latestPeople[0].intestateHeirsConfirmed).toBe(true);
    expect(latestPeople[0].intestateConfirmationBasis).toMatch(/^v3::/);
    expect(latestPeople[0].intestateHeirs.map((heir) => heir.sharePercent)).toEqual([50, 50]);
    expect(container.textContent).toContain("Edited beneficiaries active");

    setNumberInput(container.querySelector(".succession-detail-row input"), "04/02/2024");
    expect(latestPeople[0].dateOfDeath).toBe("2024-02-04");
    expect(container.textContent).toContain(
      "saved against an earlier death date or family context",
    );
    expect(container.textContent).toContain("Edited beneficiaries require review");

    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Use automatic calculation")
        .click(),
    );
    expect(latestPeople[0]).toMatchObject({
      intestateHeirs: [],
      intestateHeirsConfirmed: false,
      intestateConfirmationBasis: "",
    });
  });

  it("warns when an edited heir row points to a deleted person", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2024-02-03",
        inheritanceBasis: "intestacy",
        designations: ["Deceased"],
        spouseIds: [],
        intestateHeirs: [{ id: "missing-row", personId: "missing", sharePercent: 100 }],
      },
      {
        id: "child",
        fullName: "Paul Borg",
        fatherId: "deceased",
        spouseIds: [],
        designations: [],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="deceased"
          shareDisplay="percentage"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).toContain("no longer on the family tree");
    expect(container.textContent).toContain("automatic proposal remains in force");
  });

  it("allows a deceased linked partner's death date to be completed in the succession workflow", () => {
    const onChange = vi.fn();
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2024-02-03",
        inheritanceBasis: "intestacy",
        designations: ["Deceased"],
        spouseIds: ["spouse"],
      },
      {
        id: "spouse",
        fullName: "Maria Borg",
        isDeceased: true,
        dateOfDeath: "",
        spouseIds: ["deceased"],
        designations: ["Deceased"],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="deceased"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const spouseDeathDate = container.querySelector(
      'input[aria-label="Date of death for Maria Borg"]',
    );
    expect(spouseDeathDate).not.toBeNull();
    expect(container.textContent).toContain("before relying on the automatic heirs");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        spouseDeathDate,
        "2025-01-01",
      );
      spouseDeathDate.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange.mock.calls.at(-1)[0][1].dateOfDeath).toBe("2025-01-01");
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
          status: "draft",
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
            {
              id: "property-1",
              address: "1 Republic Street",
              saleValue: 240000,
            },
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

    expect(container.textContent).toContain("Testate");
    expect(container.textContent).toContain("Add will");
    expect(container.textContent).toContain("The most recent dated will applies");
    expect(container.textContent).toContain("Notary (optional)");
    expect(container.textContent).toContain("Description (optional)");
    expect(container.textContent).toContain("Suggested Heirs");
    expect(container.textContent).toContain("Confirm Heirs?");
    expect(container.textContent).not.toContain("Will notes");
    expect(container.textContent).toContain("Declarations Causa Mortis");
    expect(container.textContent).toContain("Date of Declaration Causa Mortis");
    expect(container.textContent).toContain("Declarants / heirs");
    expect(container.textContent).toContain("Required 1/2");
    expect(container.textContent).toContain("Required share of selling price €120,000.00");
    expect(container.textContent).toContain("Missing 1/2");
    expect(container.textContent).toContain("Declaration Causa Mortis 1");
    expect(container.textContent).not.toContain("Draft");
    expect(container.textContent).toContain("Notary");
    expect(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent.trim() === "OK",
      ),
    ).not.toBeNull();
    expect(
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent.includes("Close CM Declaration"),
      ).disabled,
    ).toBe(false);
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

  it("adds multiple wills and marks the latest dated will as operative", () => {
    let latestPeople = [];
    const initialPeople = [
      {
        id: "paul",
        fullName: "Paul Farrugia",
        sex: "Male",
        isDeceased: true,
        dateOfDeath: "2017-01-04",
        inheritanceBasis: "will",
        wills: [{ id: "english", date: "1981-10-15", notaryName: "" }],
        willHeirs: [],
        designations: ["Deceased"],
        spouseIds: [],
      },
    ];

    function Harness() {
      const [people, setPeople] = useState(initialPeople);
      latestPeople = people;
      return (
        <PersonInspector
          people={people}
          selectedPersonId="paul"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));
    const addWillButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Add will",
    );
    act(() => addWillButton.click());

    expect(latestPeople[0].wills).toHaveLength(2);
    expect(container.querySelectorAll(".will-record")).toHaveLength(2);

    const secondWillDate = container.querySelector('input[aria-label="Will date 2"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        secondWillDate,
        "27/01/1997",
      );
      secondWillDate.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(latestPeople[0].willDate).toBe("1997-01-27");
    expect(container.textContent).toContain("Latest — applies");

    const secondWillDescription = container.querySelector(
      'input[aria-label="Description for will 2"]',
    );
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        secondWillDescription,
        "UK will",
      );
      secondWillDescription.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(latestPeople[0].wills[1].description).toBe("UK will");
  });

  it("suppresses causa mortis forms for a death before 25 November 1992", () => {
    const deceased = {
      id: "deceased",
      fullName: "Joseph Borg",
      sex: "Male",
      isDeceased: true,
      dateOfDeath: "1992-11-24",
      inheritanceBasis: "intestacy",
      causaMortisDeclarations: [
        {
          id: "legacy-cm",
          status: "draft",
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
      fatherId: "deceased",
      spouseIds: [],
      siblingIds: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[deceased, child]}
          properties={[{ id: "property-1", address: "1 Republic Street" }]}
          causaMortisCoverage={[]}
          selectedPersonId="deceased"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).toContain(
      "No Declaration Causa Mortis applies because the succession opened before 25 November 1992.",
    );
    expect(container.textContent).toContain("taxed at 7% of its transfer value");
    expect(container.querySelector(".causa-mortis-records")).toBeNull();
    expect(
      container.querySelector('input[aria-label="Date of Declaration Causa Mortis 1"]'),
    ).toBeNull();
  });

  it("allows a causa mortis declaration when the death occurred on 25 November 1992", () => {
    const deceased = {
      id: "deceased",
      fullName: "Joseph Borg",
      sex: "Male",
      isDeceased: true,
      dateOfDeath: "1992-11-25",
      inheritanceBasis: "intestacy",
      causaMortisDeclarations: [],
      designations: ["Deceased"],
      spouseIds: [],
      siblingIds: [],
    };
    const child = {
      id: "child",
      fullName: "Maria Borg",
      fatherId: "deceased",
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
              requiredShare: 1,
              declaredShare: 0,
              difference: -1,
              status: "under",
            },
          ]}
          selectedPersonId="deceased"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector(".causa-mortis-records")).not.toBeNull();
    expect(container.textContent).toContain("Required for a death on or after 25 November 1992");
  });

  it("confirms suggested heirs for a testate estate and allows editable will fractions", () => {
    let latestPeople = [];
    const initialPeople = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        sex: "Male",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        willHeirs: [],
        designations: ["Deceased"],
        spouseIds: ["spouse"],
        siblingIds: [],
      },
      {
        id: "spouse",
        fullName: "Maria Borg",
        sex: "Female",
        spouseIds: ["deceased"],
        designations: [],
      },
      {
        id: "child",
        fullName: "Paul Borg",
        sex: "Male",
        fatherId: "deceased",
        motherId: "spouse",
        spouseIds: [],
        designations: [],
      },
    ];

    function Harness() {
      const [people, setPeople] = useState(initialPeople);
      latestPeople = people;
      return (
        <PersonInspector
          people={people}
          selectedPersonId="deceased"
          shareDisplay="fraction"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));

    expect(container.textContent).toContain("Suggested Heirs");
    expect(container.textContent).toContain("Maria Borg");
    expect(container.textContent).toContain("Paul Borg");
    expect(container.textContent).toContain("1/2");

    const confirmHeirs = container.querySelector('input[aria-label="Confirm Heirs?"]');
    expect(confirmHeirs.checked).toBe(false);
    act(() => confirmHeirs.click());

    expect(latestPeople[0].willHeirs).toHaveLength(2);
    expect(latestPeople[0].willHeirs.map((heir) => heir.sharePercent)).toEqual([50, 50]);
    expect(latestPeople[0]).toMatchObject({
      willHeirsConfirmed: true,
      willHeirsConfirmationSource: "suggested",
    });
    expect(container.querySelector('input[aria-label="Confirm Heirs?"]').checked).toBe(true);
    expect(container.querySelectorAll(".will-heir-fraction")).toHaveLength(2);
    expect(container.querySelectorAll(".will-heir-percent")).toHaveLength(0);

    const denominator = container.querySelectorAll('input[aria-label="Will share denominator"]')[1];
    const setNumberInput = (input, value) => {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    setNumberInput(denominator, "");

    const updatedDenominator = container.querySelectorAll(
      'input[aria-label="Will share denominator"]',
    )[1];
    expect(updatedDenominator.value).toBe("");

    setNumberInput(updatedDenominator, "4");
    expect(latestPeople[0].willHeirs[1].sharePercent).toBe(25);

    act(() => container.querySelector('input[aria-label="Confirm Heirs?"]').click());
    expect(latestPeople[0].willHeirs).toEqual([]);
    expect(latestPeople[0].willHeirsConfirmed).toBe(false);
    expect(latestPeople[0].willHeirsConfirmationSource).toBe("");
  });

  it("selects the calculated heirs when adding a causa mortis declaration", () => {
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
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const addButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Insert CM Declaration"),
    );
    beginEditing();
    act(() => addButton.click());
    expect(onChange.mock.calls.at(-1)[0][0].causaMortisDeclarations[0]).toMatchObject({
      status: "draft",
      propertyId: "property-1",
      declaredShareNumerator: 1,
      declaredShareDenominator: 2,
      declarantPersonIds: ["child"],
    });
  });

  it("allows a known causa mortis deed to be recorded before ownership is assigned", () => {
    const onChange = vi.fn();
    const deceased = {
      id: "deceased",
      fullName: "Paul Farrugia",
      sex: "Male",
      isDeceased: true,
      dateOfDeath: "2017-01-04",
      inheritanceBasis: "will",
      wills: [{ id: "will", date: "1997-01-27", notaryName: "Paul Pullicino" }],
      willHeirs: [],
      causaMortisDeclarations: [],
      designations: ["Deceased"],
      spouseIds: [],
      siblingIds: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[deceased]}
          properties={[{ id: "property-1", address: "1 Republic Street" }]}
          causaMortisCoverage={[]}
          selectedPersonId="deceased"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const addButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Insert CM Declaration"),
    );
    expect(addButton.disabled).toBe(false);
    expect(addButton.title).toContain("first Declaration Causa Mortis");

    act(() => addButton.click());
    expect(onChange.mock.calls.at(-1)[0][0].causaMortisDeclarations[0]).toMatchObject({
      status: "draft",
      propertyId: "property-1",
      declaredShareNumerator: 0,
      declaredShareDenominator: 1,
      declarantPersonIds: [],
    });
  });

  it("keeps the first CM declaration available after intestate beneficiaries change", () => {
    const onChange = vi.fn();
    const deceased = {
      id: "nathalie",
      fullName: "Nathalie Vella",
      sex: "Female",
      isDeceased: true,
      dateOfDeath: "2020-11-04",
      inheritanceBasis: "intestacy",
      intestateHeirs: [
        {
          id: "edited-heir",
          personId: "beneficiary",
          sharePercent: 100,
          shareNumerator: 1,
          shareDenominator: 1,
        },
      ],
      intestateHeirsConfirmed: false,
      causaMortisDeclarations: [],
      designations: ["Deceased"],
      spouseIds: [],
      siblingIds: [],
    };
    const beneficiary = {
      id: "beneficiary",
      fullName: "Maria Vella",
      sex: "Female",
      spouseIds: [],
      siblingIds: [],
      designations: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[deceased, beneficiary]}
          properties={[{ id: "property-1", address: "1 Republic Street" }]}
          causaMortisCoverage={[
            {
              personId: "nathalie",
              propertyId: "property-1",
              propertyAddress: "1 Republic Street",
              requiredShare: 0,
              declaredShare: 0,
              difference: 0,
              status: "complete",
            },
          ]}
          selectedPersonId="nathalie"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const addButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Insert CM Declaration"),
    );
    expect(addButton.disabled).toBe(false);

    act(() => addButton.click());
    expect(onChange.mock.calls.at(-1)[0][0].causaMortisDeclarations).toHaveLength(1);
  });

  it("counts a declaration only after OK and enables another only for a remaining share", () => {
    const property = { id: "property-1", address: "1 Republic Street" };
    const initialPeople = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        sex: "Male",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        willHeirs: [{ id: "heir-record", personId: "child", sharePercent: 100 }],
        causaMortisDeclarations: [],
        designations: ["Deceased"],
        spouseIds: [],
        siblingIds: [],
      },
      {
        id: "child",
        fullName: "Maria Borg",
        sex: "Female",
        surnameAtBirth: "Borg",
        fatherId: "deceased",
        designations: [],
        spouseIds: [],
        siblingIds: [],
      },
    ];

    function Harness() {
      const [people, setPeople] = useState(initialPeople);
      const completedShare = (people[0].causaMortisDeclarations || [])
        .filter((declaration) => declaration.status === "complete")
        .reduce(
          (total, declaration) =>
            total +
            Number(declaration.declaredShareNumerator) /
              Number(declaration.declaredShareDenominator),
          0,
        );
      const requiredShare = 0.5;
      const difference = completedShare - requiredShare;
      return (
        <PersonInspector
          people={people}
          properties={[property]}
          causaMortisCoverage={[
            {
              personId: "deceased",
              propertyId: property.id,
              propertyAddress: property.address,
              requiredShare,
              declaredShare: completedShare,
              difference,
              status: Math.abs(difference) < 1e-10 ? "complete" : difference < 0 ? "under" : "over",
            },
          ]}
          selectedPersonId="deceased"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));

    const declarationActionButton = () =>
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent.includes("CM Declaration"),
      );
    act(() => declarationActionButton().click());
    expect(declarationActionButton().textContent).toContain("Close CM Declaration");
    expect(container.textContent).toContain("Declared 0/1");
    expect(container.querySelector(".causa-mortis-card")).not.toBeNull();

    act(() => declarationActionButton().click());
    expect(declarationActionButton().textContent).toContain("Open CM Declaration");
    expect(container.querySelector(".causa-mortis-card")).toBeNull();

    act(() => declarationActionButton().click());
    expect(declarationActionButton().textContent).toContain("Close CM Declaration");
    expect(container.querySelector(".causa-mortis-card")).not.toBeNull();

    const setInput = (selector, value) => {
      const input = container.querySelector(selector);
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    setInput('input[aria-label="Causa mortis share numerator 1"]', "1");
    setInput('input[aria-label="Causa mortis share denominator 1"]', "4");
    setInput('input[aria-label="Date of Declaration Causa Mortis 1"]', "2020-01-01");
    setInput('input[aria-label="Notary for Declaration Causa Mortis 1"]', "Dr Maria Vella");
    setInput('input[aria-label="Immovable property value declared causa mortis 1"]', "100000");

    const okButton = () =>
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent.trim() === "OK" && !button.disabled,
      );
    act(() => okButton().click());
    expect(container.textContent).toContain(
      "Declaration causa mortis date must be after the date of death.",
    );

    setInput('input[aria-label="Date of Declaration Causa Mortis 1"]', "2020-06-01");
    act(() => okButton().click());

    expect(container.textContent).toContain("Declared 1/4");
    expect(declarationActionButton().disabled).toBe(false);
    expect(declarationActionButton().textContent).toContain("Insert CM Declaration");
    expect(container.textContent).not.toContain("Completed");

    act(() => declarationActionButton().click());
    expect(declarationActionButton().textContent).toContain("Close CM Declaration");

    setInput('input[aria-label="Date of Declaration Causa Mortis 2"]', "2021-04-02");
    setInput('input[aria-label="Notary for Declaration Causa Mortis 2"]', "Dr Paul Galea");
    setInput('input[aria-label="Immovable property value declared causa mortis 2"]', "110000");
    act(() => okButton().click());

    expect(container.textContent).toContain("Declared 1/2");
    expect(declarationActionButton().disabled).toBe(true);
    expect(declarationActionButton().textContent).toContain("Insert CM Declaration");
    expect(declarationActionButton().title).toBe("No undeclared share remains.");
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

  it("unlocks identity fields with Edit without showing parent-link dropdowns", () => {
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
    expect(nameInput.matches(":disabled")).toBe(true);
    expect(container.querySelector('select[aria-label="Father"]')).toBeNull();
    expect(container.querySelector('select[aria-label="Mother"]')).toBeNull();

    beginEditing();
    expect(nameInput.matches(":disabled")).toBe(false);
    expect(container.textContent).toContain("Done");
  });

  it("does not show parent-link dropdowns when one parent is assigned", () => {
    act(() =>
      root.render(
        <PersonInspector
          people={[
            {
              id: "child",
              fullName: "Anna Borg",
              motherId: "mother",
              spouseIds: [],
            },
            { id: "mother", fullName: "Maria Borg", spouseIds: [] },
            { id: "father", fullName: "Joseph Borg", spouseIds: [] },
          ]}
          selectedPersonId="child"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector('select[aria-label="Mother"]')).toBeNull();
    expect(container.querySelector('select[aria-label="Father"]')).toBeNull();
  });

  it("creates marriages and unmarried partnerships as distinct relationships", () => {
    let latestPeople;
    function Harness() {
      const [people, setPeople] = useState([
        {
          id: "roland",
          fullName: "Roland Wadge",
          givenNames: "Roland",
          surname: "Wadge",
          surnameAtBirth: "Wadge",
          sex: "Male",
          spouseIds: [],
        },
      ]);
      latestPeople = people;
      return (
        <PersonInspector
          people={people}
          selectedPersonId="roland"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));
    act(() =>
      [...container.querySelectorAll(".relationship-actions button")]
        .find((button) => button.textContent.includes("Wife / husband"))
        .click(),
    );
    // No date field is shown until the other person has been created or linked.
    expect(container.querySelector(".partner-date-field input")).toBeNull();
    act(() =>
      [...container.querySelectorAll(".spouse-chooser button")]
        .find((button) => button.textContent.includes("Create new wife / husband"))
        .click(),
    );
    const spouseId = latestPeople.find((person) => person.id !== "roland").id;
    expect(latestPeople.find((person) => person.id === spouseId).sex).toBe("Female");
    expect(findPartnerRelationship(latestPeople, "roland", spouseId)).toMatchObject({
      type: "marriage",
    });
    const relationshipType = container.querySelector(".person-partner-link-row select");
    expect(relationshipType.disabled).toBe(false);
    expect(container.querySelector('input[aria-label^="Marriage start date with"]')).toBeNull();
    expect(container.textContent).not.toContain("Marriage date");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        relationshipType,
        "former-marriage",
      );
      relationshipType.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const marriageEndDate = container.querySelector('input[aria-label^="Marriage end date with"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        marriageEndDate,
        "01/03/2020",
      );
      marriageEndDate.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(findPartnerRelationship(latestPeople, "roland", spouseId)).toMatchObject({
      type: "marriage",
      endDate: "2020-03-01",
      endReason: "divorce",
    });

    act(() =>
      [...container.querySelectorAll(".relationship-actions button")]
        .find((button) => button.textContent.includes("Partner"))
        .click(),
    );
    act(() =>
      [...container.querySelectorAll(".spouse-chooser button")]
        .find((button) => button.textContent.includes("Create new partner"))
        .click(),
    );
    const partnerId = latestPeople.at(-1).id;
    expect(findPartnerRelationship(latestPeople, "roland", partnerId)).toMatchObject({
      type: "partnership",
    });
    const partnershipStartDate = container.querySelector(
      'input[aria-label^="Partnership start date with"]',
    );
    expect(partnershipStartDate).not.toBeNull();
    expect(latestPeople.find((person) => person.id === "roland").spouseIds).toHaveLength(2);
  });

  it("adds another tree person or a new unconnected company directly as an heir", () => {
    let latestPeople;
    let latestOutsideParties;
    function Harness() {
      const [people, setPeople] = useState([
        {
          id: "deceased",
          fullName: "Joseph Borg",
          givenNames: "Joseph",
          surname: "Borg",
          surnameAtBirth: "Borg",
          sex: "Male",
          isDeceased: true,
          designations: ["Deceased"],
          dateOfDeath: "2020-01-01",
          spouseIds: [],
        },
        {
          id: "child",
          fullName: "Maria Borg",
          givenNames: "Maria",
          surname: "Borg",
          surnameAtBirth: "Borg",
          sex: "Female",
          fatherId: "deceased",
          spouseIds: [],
        },
        {
          id: "friend",
          fullName: "Anna Vella",
          givenNames: "Anna",
          surname: "Vella",
          surnameAtBirth: "Vella",
          sex: "Female",
          spouseIds: [],
        },
      ]);
      const [outsideParties, setOutsideParties] = useState([]);
      latestPeople = people;
      latestOutsideParties = outsideParties;
      return (
        <PersonInspector
          people={people}
          outsideParties={outsideParties}
          selectedPersonId="deceased"
          onChange={setPeople}
          onOutsidePartiesChange={setOutsideParties}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));
    const editBeneficiaries = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Edit Beneficiaries"),
    );
    if (editBeneficiaries) act(() => editBeneficiaries.click());
    let heirSelect = container.querySelector(
      'select[aria-label="Add an heir or override the intestacy proposal"]',
    );
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        heirSelect,
        "friend",
      );
      heirSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(latestPeople[0].intestateHeirs).toBeUndefined();
    expect(
      [...container.querySelectorAll(".confirmed-heir-name")].map((node) => node.textContent),
    ).toContain("Anna Vella");

    heirSelect = container.querySelector(
      'select[aria-label="Add an heir or override the intestacy proposal"]',
    );
    const createOption = [...heirSelect.options].find((option) =>
      option.textContent.includes("Create unconnected"),
    );
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        heirSelect,
        createOption.value,
      );
      heirSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const typeSelect = container.querySelector('select[aria-label="Unconnected heir type"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        typeSelect,
        "company",
      );
      typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const nameInput = container.querySelector('input[aria-label="Unconnected heir name"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        nameInput,
        "Legacy Holdings Ltd",
      );
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() =>
      [...container.querySelectorAll(".outside-party-creator button")]
        .find((button) => button.textContent.includes("Add as heir"))
        .click(),
    );

    expect(latestOutsideParties).toHaveLength(1);
    expect(latestOutsideParties[0]).toMatchObject({
      name: "Legacy Holdings Ltd",
      type: "company",
    });
    expect(latestPeople).toHaveLength(3);
    expect(latestPeople[0].intestateHeirs).toBeUndefined();
    expect(
      [...container.querySelectorAll(".confirmed-heir-name")].map((node) => node.textContent),
    ).toContain("Legacy Holdings Ltd");
  });
});

describe("PersonInspector pre-1992 succession note", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const deceasedBefore1992 = (extra = {}) => ({
    id: "ancestor",
    fullName: "Enrico Borg",
    dateOfDeath: "1980-01-01",
    isDeceased: true,
    designations: [],
    spouseIds: [],
    ...extra,
  });

  const renderFor = (people) =>
    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="ancestor"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

  it("states the 7% sale rate while an heir still holds the share", () => {
    renderFor([
      deceasedBefore1992(),
      { id: "heir", fullName: "Maria Borg", fatherId: "ancestor", spouseIds: [], designations: [] },
    ]);

    expect(container.textContent).toContain("succession opened before 25");
    expect(container.textContent).toContain("Article 5A(5)(c)(i)");
  });

  it("drops the rate once every heir has died and the share has passed again", () => {
    renderFor([
      deceasedBefore1992(),
      {
        id: "heir",
        fullName: "Maria Borg",
        fatherId: "ancestor",
        dateOfDeath: "2015-06-01",
        isDeceased: true,
        spouseIds: [],
        designations: [],
      },
    ]);

    // Sales tax looks only at the last passage of title, so this succession's
    // rate says nothing about a later sale.
    expect(container.textContent).toContain("succession opened before 25");
    expect(container.textContent).not.toContain("Article 5A(5)(c)(i)");
  });
});

describe("PersonInspector provenance designation", () => {
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
    vi.restoreAllMocks();
  });

  const people = [
    { id: "seller", fullName: "Joseph Borg", spouseIds: [], designations: [] },
    { id: "other", fullName: "Maria Vella", spouseIds: [], designations: [] },
  ];
  const property = {
    id: "prop",
    owners: [
      { id: "o1", personId: "seller", sharePercent: 50 },
      { id: "o2", personId: "other", sharePercent: 50 },
    ],
    declarations: [],
    transfers: [
      {
        id: "t1",
        sellerId: "other",
        buyerId: "seller",
        numerator: 1,
        denominator: 4,
        amountType: "whole-property",
        date: "2020-01-01",
      },
    ],
    saleLots: [],
  };

  it("keeps death succession and inter vivos transfer details open together", () => {
    const deceasedPeople = people.map((person) =>
      person.id === "seller"
        ? {
            ...person,
            isDeceased: true,
            dateOfDeath: "2022-01-01",
            inheritanceBasis: "intestacy",
            designations: ["Deceased"],
          }
        : person,
    );
    const vendorReport = buildPropertyVendorTaxReport(property, deceasedPeople, []);

    act(() =>
      root.render(
        <PersonInspector
          people={deceasedPeople}
          properties={[property]}
          vendorReport={vendorReport}
          selectedPersonId="seller"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onRecordDonation={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector(".person-succession")).not.toBeNull();
    const transferCheckbox = container.querySelector(
      'input[aria-label="Sold/Donated Property Share"]',
    );
    expect(transferCheckbox.checked).toBe(false);
    expect(container.querySelector(".person-donation-form")).toBeNull();
    act(() => transferCheckbox.click());
    expect(container.querySelector(".person-succession")).not.toBeNull();
    expect(container.querySelector(".person-donation-form")).not.toBeNull();
  });

  it("reopens a persisted transfer disclosure for a deceased person without relying on local state", () => {
    const deceasedPeople = people.map((person) =>
      person.id === "seller"
        ? {
            ...person,
            isDeceased: true,
            dateOfDeath: "2022-01-01",
            inheritanceBasis: "intestacy",
            designations: ["Deceased"],
          }
        : person,
    );
    const vendorReport = buildPropertyVendorTaxReport(property, deceasedPeople, []);
    const renderInspector = (interVivosStatusSession = null) =>
      root.render(
        <PersonInspector
          people={deceasedPeople}
          properties={[property]}
          vendorReport={vendorReport}
          selectedPersonId="seller"
          interVivosStatusSession={interVivosStatusSession}
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onRecordDonation={vi.fn()}
        />,
      );

    act(() => renderInspector());
    expect(container.querySelector(".person-donation-form")).toBeNull();

    act(() =>
      renderInspector({
        id: "status-toggle:inter-vivos:seller:session",
        type: "inter-vivos",
        personId: "seller",
        propertyId: "prop",
      }),
    );

    expect(container.querySelector('input[aria-label="Sold/Donated Property Share"]').checked).toBe(
      true,
    );
    expect(container.querySelector(".person-succession")).not.toBeNull();
    expect(container.querySelector(".person-donation-form")).not.toBeNull();
  });

  it("asks which provenance a partial transfer comes from and records the answer", () => {
    const vendorReport = buildPropertyVendorTaxReport(property, people, []);
    const onRecordDonation = vi.fn();
    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[property]}
          vendorReport={vendorReport}
          selectedPersonId="seller"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onRecordDonation={onRecordDonation}
        />,
      ),
    );

    const toggle = container.querySelector('input[aria-label="Sold/Donated Property Share"]');
    expect(toggle).toBeTruthy();
    act(() => toggle.click());

    const measurement = container.querySelector('select[aria-label="Transfer measurement"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        measurement,
        "defined-share",
      );
      measurement.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const numerator = container.querySelector('input[aria-label="Transfer numerator"]');
    const denominator = container.querySelector('input[aria-label="Transfer denominator"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(numerator, "1");
      numerator.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        denominator,
        "2",
      );
      denominator.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Transferring 1/2 of the whole property is part of a 3/4 holding with two provenances.
    expect(container.textContent).toContain("Which provenance is being transferred?");
    expect(container.textContent).toContain("Initial ownership");
    expect(container.textContent).toContain("Acquired from Maria Vella");

    const acquirer = container.querySelector('select[aria-label="Existing acquirer"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        acquirer,
        "other",
      );
      acquirer.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const firstProvenance = container.querySelector('.provenance-pick input[type="checkbox"]');
    act(() => firstProvenance.click());

    const donationDate = container.querySelector('input[aria-label="Donation date"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        donationDate,
        "01/01/2021",
      );
      donationDate.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const submit = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Record donation",
    );
    act(() => submit.click());

    expect(onRecordDonation).toHaveBeenCalledTimes(1);
    const { transfer } = onRecordDonation.mock.calls[0][0];
    expect(transfer.kind).toBe("donation");
    // The selected half of the property comes entirely from initial ownership.
    expect(transfer.provenance).toEqual([
      {
        trancheId: "initial-o1",
        label: "Initial ownership",
        cause: "initial",
        acquiredOn: "",
        numerator: 1,
        denominator: 2,
      },
    ]);
  });

  it("attributes a whole-holding transfer automatically without asking", () => {
    const vendorReport = buildPropertyVendorTaxReport(property, people, []);
    const onRecordDonation = vi.fn();
    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[property]}
          vendorReport={vendorReport}
          selectedPersonId="seller"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onRecordDonation={onRecordDonation}
        />,
      ),
    );

    const toggle = container.querySelector('input[aria-label="Sold/Donated Property Share"]');
    act(() => toggle.click());

    expect(container.querySelector(".transfer-fraction")).toBeNull();
    expect(container.textContent).not.toContain("Which provenance is being transferred?");

    const acquirer = container.querySelector('select[aria-label="Existing acquirer"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        acquirer,
        "other",
      );
      acquirer.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const donationDate = container.querySelector('input[aria-label="Donation date"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        donationDate,
        "01/01/2021",
      );
      donationDate.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Record donation",
    );
    act(() => submit.click());

    const { transfer } = onRecordDonation.mock.calls[0][0];
    expect(transfer).toMatchObject({
      numerator: "1",
      denominator: "1",
      amountType: "seller-holding",
    });
    // The whole 3/4 holding moves, carrying both provenances with their own fractions.
    expect(transfer.provenance.map((portion) => portion.trancheId).sort()).toEqual([
      "initial-o1",
      "transfer-t1",
    ]);
  });

  it("prevents a defined fraction from exceeding the transferor's exact holding", () => {
    const vendorReport = buildPropertyVendorTaxReport(property, people, []);
    const onRecordDonation = vi.fn();
    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[property]}
          vendorReport={vendorReport}
          selectedPersonId="seller"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onRecordDonation={onRecordDonation}
        />,
      ),
    );

    act(() => container.querySelector('input[aria-label="Sold/Donated Property Share"]').click());
    const measurement = container.querySelector('select[aria-label="Transfer measurement"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        measurement,
        "defined-share",
      );
      measurement.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const numerator = container.querySelector('input[aria-label="Transfer numerator"]');
    const denominator = container.querySelector('input[aria-label="Transfer denominator"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(numerator, "4");
      numerator.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        denominator,
        "5",
      );
      denominator.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.textContent).toContain(
      "The transferred share cannot be greater than this person's current holding.",
    );
    const submit = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Record donation",
    );
    expect(submit.disabled).toBe(true);
    act(() => submit.click());
    expect(onRecordDonation).not.toHaveBeenCalled();
  });

  it("prevents a defined percentage from exceeding the transferor's exact holding", () => {
    const vendorReport = buildPropertyVendorTaxReport(property, people, []);
    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[property]}
          vendorReport={vendorReport}
          selectedPersonId="seller"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onRecordDonation={vi.fn()}
        />,
      ),
    );

    act(() => container.querySelector('input[aria-label="Sold/Donated Property Share"]').click());
    const measurement = container.querySelector('select[aria-label="Transfer measurement"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        measurement,
        "defined-share",
      );
      measurement.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const format = container.querySelector('select[aria-label="Transfer share format"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        format,
        "percentage",
      );
      format.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const percentage = container.querySelector('input[aria-label="Transfer percentage"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        percentage,
        "75.01",
      );
      percentage.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.textContent).toContain(
      "The transferred share cannot be greater than this person's current holding.",
    );
    const submit = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Record donation",
    );
    expect(submit.disabled).toBe(true);
  });
});

describe("PersonInspector legacy lifetime disposal records", () => {
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
    vi.restoreAllMocks();
  });

  it("does not treat a legacy lifetime-disposal marker alone as a saved transfer disclosure", () => {
    act(() =>
      root.render(
        <PersonInspector
          people={[
            {
              id: "d",
              fullName: "Joseph Borg",
              isDeceased: true,
              dateOfDeath: "2020-01-01",
              inheritanceBasis: "lifetime-disposal",
              spouseIds: [],
              designations: ["Deceased"],
            },
          ]}
          selectedPersonId="d"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).not.toContain("Sold / donated during lifetime");
    expect(container.querySelector(".person-succession")).not.toBeNull();
    expect(container.querySelector('input[aria-label="Sold/Donated Property Share"]').checked).toBe(
      false,
    );
    expect(container.querySelector('[data-person-section="donation"]')).toBeNull();
  });

  it("keeps a completed full transfer available for undo and omits property succession controls", () => {
    const people = [
      {
        id: "d",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "lifetime-disposal",
        spouseIds: [],
        designations: ["Deceased"],
      },
      { id: "buyer", fullName: "Maria Vella", spouseIds: [], designations: [] },
    ];
    const property = {
      id: "property",
      owners: [{ id: "owner", personId: "d", sharePercent: 100 }],
      transfers: [
        {
          id: "transfer",
          sellerId: "d",
          buyerId: "buyer",
          numerator: 1,
          denominator: 1,
          amountType: "seller-holding",
          date: "2019-01-01",
        },
      ],
    };

    const onInterVivosStatusChange = vi.fn();

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[property]}
          selectedPersonId="d"
          onChange={vi.fn()}
          onInterVivosStatusChange={onInterVivosStatusChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const transferCheckbox = container.querySelector(
      'input[aria-label="Sold/Donated Property Share"]',
    );
    expect(transferCheckbox.checked).toBe(true);
    expect(transferCheckbox.disabled).toBe(false);
    expect(container.textContent).toContain("No share remained to pass through this succession.");
    expect(container.querySelector(".person-succession").classList).toContain("fully-transferred");

    act(() => transferCheckbox.click());
    expect(onInterVivosStatusChange).toHaveBeenCalledWith({
      checked: false,
      personId: "d",
      propertyId: "property",
    });
  });
});

describe("PersonInspector reversible status controls", () => {
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
    vi.restoreAllMocks();
  });

  it("restores the pre-click person and deletes parent records created by the deceased session", () => {
    const initialCase = normaliseCase({
      id: "case",
      title: "Borg family",
      activeFamilyGroupId: "family",
      people: [
        {
          id: "person",
          fullName: "Michael Borg",
          givenNames: "Michael",
          surname: "Borg",
          sex: "Male",
          designations: ["Owner"],
          isDeceased: false,
          dateOfDeath: "2020-01-01",
          inheritanceBasis: "intestacy",
          fatherId: "",
          fatherExplicitlyUnassigned: false,
          motherId: "",
          motherExplicitlyUnassigned: false,
          spouseIds: [],
          siblingIds: [],
        },
      ],
      familyGroups: [
        {
          id: "family",
          title: "Borg family",
          rootPersonId: "person",
          personIds: ["person"],
        },
      ],
      properties: [],
      outsideParties: [],
    });
    const originalPerson = structuredClone(initialCase.people[0]);

    function Harness() {
      const [caseData, setCaseData] = useState(initialCase);
      const session = statusToggleSession(caseData, "deceased", "person");
      const replacePeople = (current, nextPeople) =>
        normaliseCase({
          ...current,
          people: nextPeople,
          familyGroups: current.familyGroups.map((group) =>
            group.id === "family"
              ? { ...group, personIds: nextPeople.map((person) => person.id) }
              : group,
          ),
        });

      const changeDeceasedStatus = ({ checked, personId, people, patch }) => {
        setCaseData((current) => {
          let next = checked
            ? beginStatusToggleSession(current, { type: "deceased", personId })
            : current;
          next = replacePeople(
            next,
            people.map((person) => (person.id === personId ? { ...person, ...patch } : person)),
          );
          return checked
            ? next
            : endStatusToggleSession(next, {
                type: "deceased",
                personId,
                activeFamilyGroupId: "family",
              });
        });
      };

      return (
        <>
          <PersonInspector
            people={caseData.people}
            selectedPersonId="person"
            familyPersonIds={caseData.familyGroups[0].personIds}
            deceasedStatusSession={session}
            onChange={(people) => setCaseData((current) => replacePeople(current, people))}
            onDeceasedStatusChange={changeDeceasedStatus}
            onSelectPerson={vi.fn()}
          />
          <output data-testid="case-state">{JSON.stringify(caseData)}</output>
        </>
      );
    }

    act(() => root.render(<Harness />));
    const deceasedCheckbox = () =>
      [...container.querySelectorAll('input[type="checkbox"]')].find((input) =>
        input.parentElement.textContent.includes("This person is deceased."),
      );

    act(() => deceasedCheckbox().click());
    const addParents = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Add missing parents"),
    );
    expect(addParents).toBeTruthy();
    act(() => addParents.click());

    let caseState = JSON.parse(container.querySelector('[data-testid="case-state"]').textContent);
    expect(caseState.people).toHaveLength(3);
    expect(
      caseState.people.filter((person) => person.statusToggleSessionRole === "potential-parent"),
    ).toHaveLength(2);
    expect(caseState.people.find((person) => person.id === "person")).toMatchObject({
      isDeceased: true,
      fatherId: expect.any(String),
      motherId: expect.any(String),
    });

    act(() => deceasedCheckbox().click());
    caseState = JSON.parse(container.querySelector('[data-testid="case-state"]').textContent);
    expect(caseState.people).toEqual([originalPerson]);
    expect(caseState.familyGroups[0].personIds).toEqual(["person"]);
    expect(caseState.statusToggleSessions).toEqual([]);
    expect(container.querySelector(".person-succession")).toBeNull();
  });

  it("clears an unfinished transfer draft when unchecked and starts clean when reopened", () => {
    const people = [
      { id: "seller", fullName: "Joseph Borg", spouseIds: [], designations: [] },
      { id: "buyer", fullName: "Maria Vella", spouseIds: [], designations: [] },
    ];
    const property = {
      id: "property",
      owners: [{ id: "owner", personId: "seller", sharePercent: 100 }],
      transfers: [],
      declarations: [],
      saleLots: [],
    };
    const onInterVivosStatusChange = vi.fn();
    const vendorReport = buildPropertyVendorTaxReport(property, people, []);

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[property]}
          vendorReport={vendorReport}
          selectedPersonId="seller"
          onChange={vi.fn()}
          onRecordDonation={vi.fn()}
          onInterVivosStatusChange={onInterVivosStatusChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const transferCheckbox = () =>
      container.querySelector('input[aria-label="Sold/Donated Property Share"]');
    act(() => transferCheckbox().click());
    const acquirer = container.querySelector('select[aria-label="Existing acquirer"]');
    const transferDate = container.querySelector('input[aria-label="Donation date"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        acquirer,
        "buyer",
      );
      acquirer.dispatchEvent(new Event("change", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        transferDate,
        "01/02/2020",
      );
      transferDate.dispatchEvent(new Event("input", { bubbles: true }));
    });

    act(() => transferCheckbox().click());
    expect(container.querySelector(".person-donation-form")).toBeNull();
    expect(onInterVivosStatusChange).toHaveBeenNthCalledWith(2, {
      checked: false,
      personId: "seller",
      propertyId: "property",
    });

    act(() => transferCheckbox().click());
    expect(container.querySelector('select[aria-label="Existing acquirer"]').value).toBe("");
    expect(container.querySelector('input[aria-label="Donation date"]').value).toBe("");
    expect(container.querySelector('select[aria-label="Transfer measurement"]').value).toBe(
      "all-share",
    );
  });
});
