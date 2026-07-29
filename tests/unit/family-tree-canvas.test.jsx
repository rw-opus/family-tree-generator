// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FamilyTreeCanvas } from "../../src/components/FamilyTreeCanvas.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
describe("FamilyTreeCanvas", () => {
  let container; let root;
  beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  it("shows relations and sends the printable tree to its print handler", () => {
    const onPrint = vi.fn();
    act(() => root.render(<FamilyTreeCanvas onPrint={onPrint} people={[{ id: "d", fullName: "Joseph Example", designations: ["Deceased"] }, { id: "c", fullName: "Anna Example", designations: ["Child"] }, { id: "n", fullName: "Claire Example", designations: ["Nephew or Niece"] }]} />));
    expect(container.textContent).toContain("Family Tree of Joseph Example");
    expect(container.textContent).toContain("Children");
    expect(container.textContent).toContain("Brother/Sister");
    act(() => [...container.querySelectorAll("button")].find((button) => button.textContent.includes("Print")).click());
    expect(onPrint).toHaveBeenCalledWith(expect.any(HTMLElement));
  });
  it("uses the editable tree name as the diagram heading", () => {
    act(() => root.render(
      <FamilyTreeCanvas
        treeTitle="The Borg Family"
        people={[
          { id: "parent", fullName: "Joseph Borg" },
          { id: "child", fullName: "Anna Borg", fatherId: "parent" },
        ]}
      />,
    ));

    expect(
      [...container.querySelectorAll("h2")].every(
        (heading) => heading.textContent === "The Borg Family",
      ),
    ).toBe(true);
    expect(container.textContent).not.toContain("Family tree");
  });
  it("renders parent-linked people without numbered generation captions and highlights the selected person", () => {
    act(() => root.render(<FamilyTreeCanvas selectedPersonId="c" people={[{ id: "f", fullName: "Father", sex: "Male" }, { id: "m", fullName: "Mother", sex: "Female" }, { id: "c", fullName: "Child", sex: "Female", isDeceased: true, fatherId: "f", motherId: "m" }]} />));
    expect(container.textContent).toContain("Father");
    expect(container.textContent).toContain("Child");
    expect(container.textContent).not.toContain("Generation");
    expect(container.querySelector('[data-person-id="f"]').className).toContain("male");
    expect(container.querySelector('[data-person-id="m"]').className).toContain("female");
    expect(container.querySelector('[data-person-id="c"]').className).toContain("deceased");
    expect(container.querySelector('[data-person-id="c"]').className).toContain("selected");
    expect(container.querySelectorAll(".family-partner-link")).toHaveLength(1);
    expect(container.querySelectorAll(".family-union-stem")).toHaveLength(1);
    expect(container.querySelectorAll(".family-child-branch-item")).toHaveLength(1);
    expect(container.textContent).not.toContain("Partner");
  });

  it("uses a two-finger pinch to zoom the tree", () => {
    const onZoomChange = vi.fn();
    act(() => root.render(
      <FamilyTreeCanvas
        zoom={100}
        onZoomChange={onZoomChange}
        people={[{ id: "person", fullName: "Joseph Borg" }]}
      />,
    ));
    const chart = container.querySelector(".family-chart");
    const touchEvent = (type, touches) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", { value: touches });
      return event;
    };

    act(() => {
      chart.dispatchEvent(touchEvent("touchstart", [
        { clientX: 0, clientY: 0 },
        { clientX: 200, clientY: 0 },
      ]));
    });
    const move = touchEvent("touchmove", [
      { clientX: 0, clientY: 0 },
      { clientX: 100, clientY: 0 },
    ]);
    act(() => chart.dispatchEvent(move));

    expect(move.defaultPrevented).toBe(true);
    expect(onZoomChange).toHaveBeenCalledWith(50);
  });

  it("keeps an unnamed central person visible while adding unnamed relatives", () => {
    act(() => root.render(
      <FamilyTreeCanvas
        selectedPersonId="parent"
        people={[
          { id: "parent", fullName: "", spouseIds: [], siblingIds: [] },
          { id: "child", fullName: "", fatherId: "parent", spouseIds: [], siblingIds: [] },
        ]}
      />,
    ));
    expect(container.querySelector('[data-person-id="parent"]')).not.toBeNull();
    expect(container.querySelector('[data-person-id="child"]')).not.toBeNull();
    expect(container.textContent).not.toContain("0/1");
  });

  it("shows compact capitalised names without relationship subtitles", () => {
    act(() => root.render(
      <FamilyTreeCanvas
        people={[
          {
            id: "person",
            fullName: "roland wadge",
            designations: ["Parent"],
          },
        ]}
      />,
    ));
    const person = container.querySelector('[data-person-id="person"]');

    expect(person.textContent).toBe("Roland Wadge");
    expect(person.querySelector(".family-node-meta")).toBeNull();
    expect(person.style.getPropertyValue("--family-node-width")).toBe("112px");
  });

  it("omits a surname only when it matches a recorded parent", () => {
    act(() => root.render(
      <FamilyTreeCanvas
        people={[
          {
            id: "father",
            fullName: "joseph borg",
          },
          {
            id: "matching-child",
            fullName: "roland borg",
            fatherId: "father",
          },
          {
            id: "different-child",
            fullName: "anna vella",
            fatherId: "father",
          },
        ]}
      />,
    ));

    const fatherName = container.querySelector(
      '[data-person-id="father"] .family-node-name',
    );
    const matchingChildName = container.querySelector(
      '[data-person-id="matching-child"] .family-node-name',
    );
    const differentChildName = container.querySelector(
      '[data-person-id="different-child"] .family-node-name',
    );

    expect(fatherName.textContent).toBe("Joseph Borg");
    expect(matchingChildName.textContent).toBe("Roland");
    expect(matchingChildName.title).toBe("Roland Borg");
    expect(differentChildName.textContent).toBe("Anna Vella");
  });

  it("labels an unnamed relative by relationship to the named person", () => {
    act(() => root.render(
      <FamilyTreeCanvas
        selectedPersonId="person"
        people={[
          {
            id: "father",
            fullName: "",
            sex: "Male",
            spouseIds: [],
            siblingIds: [],
          },
          {
            id: "person",
            fullName: "Joseph Borg",
            fatherId: "father",
            spouseIds: [],
            siblingIds: [],
          },
        ]}
      />,
    ));
    expect(container.textContent).toContain("Father of Joseph Borg");
    expect(container.textContent).not.toContain("Unnamed person");
  });

  it("shows an incomplete causa mortis share in red on the deceased person", () => {
    act(() => root.render(
      <FamilyTreeCanvas
        people={[
          {
            id: "deceased",
            fullName: "Joseph Borg",
            isDeceased: true,
            dateOfDeath: "2020-01-01",
          },
        ]}
        causaMortisCoverageByPerson={{
          deceased: [
            {
              propertyId: "property-1",
              requiredShare: 0.5,
              declaredShare: 0.25,
              status: "under",
            },
          ],
        }}
      />,
    ));
    const person = container.querySelector('[data-person-id="deceased"]');
    expect(person.className).toContain("cm-share-incomplete");
    expect(person.textContent).toContain("CM share 1/4 of 1/2");
    expect(person.querySelector(".family-node-cm-alert")).not.toBeNull();
  });

  it("draws a direct stem from a single parent to the child", () => {
    act(() => root.render(
      <FamilyTreeCanvas
        people={[
          { id: "parent", fullName: "Joseph Borg", sex: "Male" },
          {
            id: "child",
            fullName: "Maria Borg",
            sex: "Female",
            fatherId: "parent",
          },
        ]}
      />,
    ));
    expect(container.querySelectorAll(".family-partner-link")).toHaveLength(0);
    expect(
      container.querySelector(
        ".family-parent-row.single-parent.has-children",
      ),
    ).not.toBeNull();
    expect(container.querySelector(".family-union-stem")).not.toBeNull();
    expect(container.querySelector(".family-child-branch-item")).not.toBeNull();
  });

  it("branches siblings from the shared stem of both parents", () => {
    act(() => root.render(
      <FamilyTreeCanvas
        people={[
          { id: "father", fullName: "Joseph Borg", sex: "Male" },
          { id: "mother", fullName: "Maria Borg", sex: "Female" },
          {
            id: "child-1",
            fullName: "Anna Borg",
            fatherId: "father",
            motherId: "mother",
          },
          {
            id: "child-2",
            fullName: "Paul Borg",
            fatherId: "father",
            motherId: "mother",
          },
          {
            id: "child-3",
            fullName: "Mark Borg",
            fatherId: "father",
            motherId: "mother",
          },
        ]}
      />,
    ));
    expect(container.querySelectorAll(".family-partner-link")).toHaveLength(1);
    expect(
      container.querySelector(
        ".family-parent-row.has-children:not(.single-parent)",
      ),
    ).not.toBeNull();
    expect(container.querySelector(".family-children-branch.single")).toBeNull();
    expect(container.querySelectorAll(".family-child-branch-item")).toHaveLength(3);
    expect(container.querySelectorAll(".family-child-stem")).toHaveLength(3);
  });

  it("shows separate horizontal unions for multiple partners without text labels", () => {
    act(() => root.render(
      <FamilyTreeCanvas
        people={[
          {
            id: "person",
            fullName: "Joseph Borg",
            spouseIds: ["partner-1", "partner-2"],
          },
          {
            id: "partner-1",
            fullName: "Maria Borg",
            spouseIds: ["person"],
          },
          {
            id: "partner-2",
            fullName: "Anne Vella",
            spouseIds: ["person"],
          },
          {
            id: "child-1",
            fullName: "Paul Borg",
            fatherId: "person",
            motherId: "partner-1",
          },
          {
            id: "child-2",
            fullName: "Claire Borg",
            fatherId: "person",
            motherId: "partner-2",
          },
        ]}
      />,
    ));
    expect(container.querySelectorAll(".family-partner-link")).toHaveLength(2);
    expect(
      container.querySelectorAll(
        ".family-household-unions.multiple > .family-union-block",
      ),
    ).toHaveLength(2);
    expect(container.textContent).not.toContain("Partner");
    expect(
      container.querySelector('[data-person-id="child-1"] .family-node-name')
        .textContent,
    ).toBe("Paul");
    expect(
      container.querySelector('[data-person-id="child-2"] .family-node-name')
        .textContent,
    ).toBe("Claire");
    expect(
      container.querySelector('[data-person-id="child-1"] .family-node-name')
        .title,
    ).toBe("Paul Borg");
    expect(
      container.querySelector('[data-person-id="child-2"] .family-node-name')
        .title,
    ).toBe("Claire Borg");
  });

  it("renders one anchored person card when a partner shares existing children", () => {
    act(() => root.render(
      <FamilyTreeCanvas
        people={[
          {
            id: "ancestor",
            fullName: "Roland's Father",
            sex: "Male",
          },
          {
            id: "roland",
            fullName: "Roland Wadge",
            sex: "Male",
            fatherId: "ancestor",
            spouseIds: ["partner"],
          },
          {
            id: "partner",
            fullName: "Partner of Roland Wadge",
            sex: "Female",
            spouseIds: ["roland"],
          },
          {
            id: "child-1",
            fullName: "Child One",
            fatherId: "roland",
            motherId: "partner",
          },
          {
            id: "child-2",
            fullName: "Child Two",
            fatherId: "roland",
            motherId: "partner",
          },
          {
            id: "child-3",
            fullName: "Child Three",
            fatherId: "roland",
            motherId: "partner",
          },
        ]}
      />,
    ));

    expect(
      container.querySelectorAll('[data-person-id="roland"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('[data-person-id="partner"]'),
    ).toHaveLength(1);
    expect(container.querySelectorAll(".family-parent-balance")).toHaveLength(0);
    expect(container.querySelectorAll(".family-partner-link")).toHaveLength(1);
    const rolandUnion = container
      .querySelector('[data-person-id="roland"]')
      .closest(".family-union-block");
    expect(
      rolandUnion.querySelectorAll(
        ":scope > .family-children-branch > .family-child-branch-item > .family-child-stem",
      ),
    ).toHaveLength(3);
    expect(
      container
        .querySelector('[data-person-id="roland"]')
        .closest(".family-child-branch-item")
        .style.getPropertyValue("--branch-anchor-offset"),
    ).toBe("-127px");
  });
});
