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

  it("adds a father around the selected person and selects the new record", () => {
    const onChange = vi.fn();
    const onSelectPerson = vi.fn();
    const child = {
      id: "child",
      fullName: "Maria Example",
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
    expect(onSelectPerson).toHaveBeenCalledWith(updatedPeople[1].id);
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
});
