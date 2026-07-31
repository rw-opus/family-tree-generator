// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonInspector } from "../../src/components/PersonInspector.jsx";
import { findPartnerRelationship } from "../../src/domain/partnerRelationships.js";

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

  it("returns from an open person card to the tree", () => {
    const onBackToTree = vi.fn();
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
          onBackToTree={onBackToTree}
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const backButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Back to Tree",
    );
    act(() => backButton.click());
    expect(onBackToTree).toHaveBeenCalledOnce();
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
    });
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
    expect(container.textContent).toContain("Remove 1 descendant first.");
  });

  it("changes a father link to an existing case person without creating a duplicate", () => {
    const onChange = vi.fn();
    const people = [
      {
        id: "child",
        fullName: "Anna Borg",
        fatherId: "mistaken-father",
        fatherExplicitlyUnassigned: true,
        spouseIds: [],
      },
      { id: "mistaken-father", fullName: "Joseph Borg", spouseIds: [] },
      { id: "correct-father", fullName: "Paul Borg", spouseIds: [] },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="child"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const fatherRow = container.querySelector('[data-parent-link="father"]');
    expect(fatherRow.textContent).toContain("Joseph Borg");
    act(() =>
      [...fatherRow.querySelectorAll("button")]
        .find((button) => button.textContent.trim() === "Change")
        .click(),
    );

    const fatherSelect = container.querySelector('select[aria-label="Change father"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        fatherSelect,
        "correct-father",
      );
      fatherSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() =>
      [...fatherRow.querySelectorAll("button")]
        .find((button) => button.textContent.trim() === "Apply")
        .click(),
    );

    const updatedPeople = onChange.mock.calls.at(-1)[0];
    expect(updatedPeople).toHaveLength(people.length);
    expect(updatedPeople.find((person) => person.id === "child")).toMatchObject({
      fatherId: "correct-father",
      fatherExplicitlyUnassigned: false,
    });
    expect(updatedPeople.filter((person) => person.id === "correct-father")).toHaveLength(1);
  });

  it("excludes the selected person and every descendant from parent-link candidates", () => {
    const people = [
      {
        id: "person",
        fullName: "Anna Borg",
        fatherId: "current-father",
        motherId: "current-mother",
        spouseIds: [],
      },
      { id: "current-father", fullName: "Joseph Borg", spouseIds: [] },
      { id: "current-mother", fullName: "Maria Borg", spouseIds: [] },
      { id: "child", fullName: "Maria Borg", motherId: "person", spouseIds: [] },
      { id: "grandchild", fullName: "Luca Borg", motherId: "child", spouseIds: [] },
      { id: "candidate", fullName: "Paul Vella", spouseIds: [] },
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

    const fatherRow = container.querySelector('[data-parent-link="father"]');
    act(() =>
      [...fatherRow.querySelectorAll("button")]
        .find((button) => button.textContent.trim() === "Change")
        .click(),
    );

    const optionValues = [
      ...container.querySelector('select[aria-label="Change father"]').options,
    ].map((option) => option.value);
    expect(optionValues).toContain("candidate");
    expect(optionValues).not.toContain("person");
    expect(optionValues).not.toContain("current-mother");
    expect(optionValues).not.toContain("child");
    expect(optionValues).not.toContain("grandchild");
  });

  it("makes a mistaken father deletable after removing the parent link and rerendering", () => {
    let latestPeople = [
      {
        id: "child",
        fullName: "Anna Borg",
        fatherId: "mistaken-father",
        fatherExplicitlyUnassigned: true,
        spouseIds: [],
      },
      { id: "mistaken-father", fullName: "Joseph Borg", spouseIds: [] },
    ];
    const onChange = vi.fn((nextPeople) => {
      latestPeople = nextPeople;
    });
    const renderPerson = (selectedPersonId) => {
      act(() =>
        root.render(
          <PersonInspector
            people={latestPeople}
            selectedPersonId={selectedPersonId}
            onChange={onChange}
            onSelectPerson={vi.fn()}
          />,
        ),
      );
    };

    renderPerson("child");
    act(() =>
      container.querySelector('button[aria-label="Remove father link to Joseph Borg"]').click(),
    );

    expect(latestPeople.find((person) => person.id === "child")).toMatchObject({
      fatherId: "",
      fatherExplicitlyUnassigned: true,
    });

    renderPerson("mistaken-father");
    beginEditing();
    const deleteButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Delete person"),
    );
    expect(deleteButton.disabled).toBe(false);
    expect(container.textContent).toContain(
      "No partner or descendant dependencies. Confirmation is required.",
    );
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
      { id: "person-b", fullName: "Joseph Vella", spouseIds: [] },
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
    expect(succession.querySelector(".succession-detail-row input").value).toBe("01-01-2020");
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
    expect(statusRows.map((row) => row.firstElementChild.textContent)).toEqual(["Sex", "Status"]);
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
    expect(container.querySelector(".succession-detail-row input").value).toBe("03-02-2024");
    expect(container.querySelector(".succession-detail-row input").disabled).toBe(false);
    expect(container.querySelector('select[aria-label="Inheritance basis"]').disabled).toBe(false);
    expect(container.textContent).not.toContain("Succession on death");
    expect(container.textContent).toContain("Intestate");
  });

  it("requires the proposed intestate heirs and 100% shares to be confirmed", () => {
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

    expect(container.textContent).toContain("Confirm who inherited");
    expect(container.textContent).toContain("Proposed under intestacy");
    expect(container.textContent).toContain("1/2");

    const useProposal = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Use proposed shares"),
    );
    act(() => useProposal.click());

    expect(container.querySelectorAll(".confirmed-heir-row")).toHaveLength(2);
    expect(container.querySelectorAll(".confirmed-heir-fraction")).toHaveLength(2);
    expect(container.querySelectorAll(".confirmed-heir-percent")).toHaveLength(0);

    const setNumberInput = (input, value) => {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    let childDenominator = container.querySelector(
      'input[aria-label="Confirmed share denominator for Paul Borg"]',
    );
    setNumberInput(childDenominator, "");
    childDenominator = container.querySelector(
      'input[aria-label="Confirmed share denominator for Paul Borg"]',
    );
    expect(childDenominator.value).toBe("");

    setNumberInput(childDenominator, "4");
    expect(
      latestPeople[0].intestateHeirs.find((heir) => heir.personId === "child").sharePercent,
    ).toBe(25);

    const childNumerator = container.querySelector(
      'input[aria-label="Confirmed share numerator for Paul Borg"]',
    );
    setNumberInput(childNumerator, "2");
    expect(
      latestPeople[0].intestateHeirs.find((heir) => heir.personId === "child").sharePercent,
    ).toBe(50);

    const percentageButton = [...container.querySelectorAll(".person-share-toggle button")].find(
      (button) => button.textContent === "Percentage",
    );
    act(() => percentageButton.click());
    expect(container.textContent).toContain("50%");
    expect(container.querySelectorAll(".confirmed-heir-fraction")).toHaveLength(0);
    expect(container.querySelectorAll(".confirmed-heir-percent")).toHaveLength(2);

    const childPercentage = container.querySelector(
      'input[aria-label="Confirmed share percentage for Paul Borg"]',
    );
    setNumberInput(childPercentage, "45");
    expect(latestPeople[0].intestateHeirs.find((heir) => heir.personId === "child")).toMatchObject({
      sharePercent: 45,
      sharePercentInput: "45",
    });
    setNumberInput(
      container.querySelector('input[aria-label="Confirmed share percentage for Paul Borg"]'),
      "50",
    );

    const confirm = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Confirm heirs"),
    );
    expect(confirm.disabled).toBe(false);
    act(() => confirm.click());

    expect(latestPeople[0].intestateHeirsConfirmed).toBe(true);
    expect(latestPeople[0].intestateHeirs.map((heir) => heir.sharePercent)).toEqual([50, 50]);
    expect(container.textContent).toContain("Confirmed");
  });

  it("keeps confirmation disabled when an heir row points to a deleted person", () => {
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

    const confirm = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Confirm heirs"),
    );
    expect(confirm.disabled).toBe(true);
    expect(container.textContent).toContain("no longer on the family tree");
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
    expect(container.textContent).toContain("before confirming the heirs");
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

    expect(container.textContent).toContain("Testate");
    expect(container.textContent).toContain("Publishing Notary (optional)");
    expect(container.textContent).toContain("Suggested heirs if intestate");
    expect(container.textContent).toContain("Use as beneficiaries");
    expect(container.textContent).not.toContain("Will notes");
    expect(container.textContent).toContain("Declarations Causa Mortis");
    expect(container.textContent).toContain("Date of Declaration Causa Mortis");
    expect(container.textContent).toContain("Declarants / heirs");
    expect(container.textContent).toContain("Required 1/2");
    expect(container.textContent).toContain("Missing 1/2");
    expect(container.textContent).toContain("Declaration CM 1");
    expect(container.textContent).toContain("Draft");
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

  it("suggests intestate heirs for a testate estate and allows editable will fractions", () => {
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

    expect(container.textContent).toContain("Suggested heirs if intestate");
    expect(container.textContent).toContain("Maria Borg");
    expect(container.textContent).toContain("Paul Borg");
    expect(container.textContent).toContain("1/2");

    const applySuggestion = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Use as beneficiaries"),
    );
    act(() => applySuggestion.click());

    expect(latestPeople[0].willHeirs).toHaveLength(2);
    expect(latestPeople[0].willHeirs.map((heir) => heir.sharePercent)).toEqual([50, 50]);
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
    setInput('input[aria-label="Date of Declaration Causa Mortis 1"]', "2020-06-01");
    setInput('input[aria-label="Notary for Declaration Causa Mortis 1"]', "Dr Maria Vella");
    setInput('input[aria-label="Immovable property value declared causa mortis 1"]', "100000");

    const okButton = () =>
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent.trim() === "OK",
      );
    act(() => okButton().click());

    expect(container.textContent).toContain("Declared 1/4");
    expect(declarationActionButton().disabled).toBe(false);
    expect(declarationActionButton().textContent).toContain("Insert CM Declaration");
    expect(container.textContent).toContain("Completed");

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
    const marriageDate = container.querySelector(".partner-date-field input");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        marriageDate,
        "15-06-2015",
      );
      marriageDate.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() =>
      [...container.querySelectorAll(".spouse-chooser button")]
        .find((button) => button.textContent.includes("Create new wife / husband"))
        .click(),
    );
    const spouseId = latestPeople.find((person) => person.id !== "roland").id;
    expect(findPartnerRelationship(latestPeople, "roland", spouseId)).toMatchObject({
      type: "marriage",
      startDate: "2015-06-15",
    });
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.trim() === "Edit")
        .click(),
    );
    const relationshipType = container.querySelector(".person-partner-link-row select");
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
        "01-03-2020",
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
    expect(latestPeople[0].intestateHeirs[0].personId).toBe("friend");

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
    expect(latestPeople[0].intestateHeirs.map((heir) => heir.personId)).toContain(
      latestOutsideParties[0].id,
    );
  });
});
