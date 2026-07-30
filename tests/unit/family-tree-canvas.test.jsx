// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FamilyTreeCanvas } from "../../src/components/FamilyTreeCanvas.jsx";
import { anchoredBranchOffset } from "../../src/components/familyTree/MultiplePartnerHousehold.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
describe("FamilyTreeCanvas", () => {
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
  it("shows relations and sends the printable tree to its print handler", () => {
    const onPrint = vi.fn();
    act(() =>
      root.render(
        <FamilyTreeCanvas
          onPrint={onPrint}
          people={[
            { id: "d", fullName: "Joseph Example", designations: ["Deceased"] },
            { id: "c", fullName: "Anna Example", designations: ["Child"] },
            { id: "n", fullName: "Claire Example", designations: ["Nephew or Niece"] },
          ]}
        />,
      ),
    );
    expect(container.textContent).toContain("Family Tree of Joseph Example");
    expect(container.textContent).toContain("Children");
    expect(container.textContent).toContain("Brother/Sister");
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Print"))
        .click(),
    );
    expect(onPrint).toHaveBeenCalledWith(expect.any(HTMLElement));
  });
  it("uses the editable tree name as the diagram heading", () => {
    act(() =>
      root.render(
        <FamilyTreeCanvas
          treeTitle="The Borg Family"
          people={[
            { id: "parent", fullName: "Joseph Borg" },
            { id: "child", fullName: "Anna Borg", fatherId: "parent" },
          ]}
        />,
      ),
    );

    expect(
      [...container.querySelectorAll("h2")].every(
        (heading) => heading.textContent === "The Borg Family",
      ),
    ).toBe(true);
    expect(container.textContent).not.toContain("Family tree");
  });
  it("renders parent-linked people without numbered generation captions and highlights the selected person", () => {
    act(() =>
      root.render(
        <FamilyTreeCanvas
          selectedPersonId="c"
          people={[
            { id: "f", fullName: "Father", sex: "Male" },
            { id: "m", fullName: "Mother", sex: "Female" },
            {
              id: "c",
              fullName: "Child",
              sex: "Female",
              isDeceased: true,
              fatherId: "f",
              motherId: "m",
            },
          ]}
        />,
      ),
    );
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
    act(() =>
      root.render(
        <FamilyTreeCanvas
          zoom={100}
          onZoomChange={onZoomChange}
          people={[{ id: "person", fullName: "Joseph Borg" }]}
        />,
      ),
    );
    const chart = container.querySelector(".family-chart");
    const touchEvent = (type, touches) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", { value: touches });
      return event;
    };

    act(() => {
      chart.dispatchEvent(
        touchEvent("touchstart", [
          { clientX: 0, clientY: 0 },
          { clientX: 200, clientY: 0 },
        ]),
      );
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
    act(() =>
      root.render(
        <FamilyTreeCanvas
          selectedPersonId="parent"
          people={[
            { id: "parent", fullName: "", spouseIds: [], siblingIds: [] },
            { id: "child", fullName: "", fatherId: "parent", spouseIds: [], siblingIds: [] },
          ]}
        />,
      ),
    );
    expect(container.querySelector('[data-person-id="parent"]')).not.toBeNull();
    expect(container.querySelector('[data-person-id="child"]')).not.toBeNull();
    expect(container.textContent).not.toContain("0/1");
  });

  it("shows compact capitalised names without relationship subtitles", () => {
    act(() =>
      root.render(
        <FamilyTreeCanvas
          people={[
            {
              id: "person",
              fullName: "roland wadge",
              designations: ["Parent"],
            },
          ]}
        />,
      ),
    );
    const person = container.querySelector('[data-person-id="person"]');

    expect(person.textContent).toBe("Roland Wadge");
    expect(person.querySelector(".family-node-meta")).toBeNull();
    expect(person.style.getPropertyValue("--family-node-width")).toBe("112px");
  });

  it("omits a surname only when it matches a recorded parent", () => {
    act(() =>
      root.render(
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
      ),
    );

    const fatherName = container.querySelector('[data-person-id="father"] .family-node-name');
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
    act(() =>
      root.render(
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
      ),
    );
    expect(container.textContent).toContain("Father of Joseph Borg");
    expect(container.textContent).not.toContain("Unnamed person");
  });

  it("marks incomplete causa mortis coverage without putting succession details in the card", () => {
    act(() =>
      root.render(
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
      ),
    );
    const person = container.querySelector('[data-person-id="deceased"]');
    expect(person.className).toContain("cm-share-incomplete");
    expect(person.textContent).not.toContain("CM share");
    expect(person.textContent).not.toContain("2020");
    expect(person.querySelector(".family-node-cm-alert")).toBeNull();
  });

  it("shows a missing spouse death date directly on the deceased person's card", () => {
    act(() =>
      root.render(
        <FamilyTreeCanvas
          people={[
            {
              id: "edgar",
              fullName: "Edgar Wadge",
              isDeceased: true,
              dateOfDeath: "2020-01-01",
              inheritanceBasis: "intestacy",
              spouseIds: ["wife"],
            },
            {
              id: "wife",
              fullName: "Maria Wadge",
              isDeceased: true,
              dateOfDeath: "",
              spouseIds: ["edgar"],
            },
            {
              id: "son",
              fullName: "Paul Wadge",
              fatherId: "edgar",
              motherId: "wife",
              spouseIds: [],
            },
          ]}
        />,
      ),
    );

    const edgar = container.querySelector('[data-person-id="edgar"]');
    expect(edgar.className).toContain("succession-date-incomplete");
    expect(edgar.textContent).toContain("Missing spouse death date: Maria Wadge");
    expect(edgar.getAttribute("aria-label")).toContain("Missing spouse death date for Maria Wadge");
  });

  it("shows only the person-card details selected in the separate control", () => {
    act(() =>
      root.render(
        <FamilyTreeCanvas
          people={[
            {
              id: "deceased",
              fullName: "Joseph Borg",
              isDeceased: true,
              dateOfDeath: "2020-01-02",
              inheritanceBasis: "will",
              willDate: "2019-03-04",
              willNotaryName: "Dr Maria Vella",
              causaMortisDeclarations: [
                {
                  id: "cm-1",
                  status: "complete",
                  date: "2020-05-06",
                  notaryName: "Dr Paul Galea",
                },
                {
                  id: "cm-2",
                  status: "complete",
                  date: "2021-07-08",
                  notaryName: "Dr Anne Borg",
                },
              ],
            },
          ]}
          ownershipByPerson={{ deceased: 0.25 }}
          propertyValue={200000}
          personCardFields={{
            ownershipFraction: true,
            ownershipPercentage: true,
            ownershipValue: true,
            dateOfDeath: true,
            successionBasis: true,
            willDetails: true,
            causaMortisDetails: true,
          }}
        />,
      ),
    );

    const person = container.querySelector('[data-person-id="deceased"]');
    expect(person.textContent).toContain("1/4");
    expect(person.textContent).toContain("25%");
    expect(person.textContent).toContain("50,000");
    expect(person.textContent).toContain("Died 02/01/2020");
    expect(person.textContent).toContain("Testate");
    expect(person.textContent).toContain("Will 04/03/2019 · Dr Maria Vella");
    expect(person.textContent).toContain("CM 06/05/2020 · Dr Paul Galea");
    expect(person.textContent).toContain("08/07/2021 · Dr Anne Borg");
    expect(person.textContent).not.toContain("ownership");
  });

  it("draws a direct stem from a single parent to the child", () => {
    act(() =>
      root.render(
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
      ),
    );
    expect(container.querySelectorAll(".family-partner-link")).toHaveLength(0);
    expect(container.querySelector(".family-parent-row.single-parent.has-children")).not.toBeNull();
    expect(container.querySelector(".family-union-stem")).not.toBeNull();
    expect(container.querySelector(".family-child-branch-item")).not.toBeNull();
  });

  it("branches siblings from the shared stem of both parents", () => {
    act(() =>
      root.render(
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
      ),
    );
    expect(container.querySelectorAll(".family-partner-link")).toHaveLength(1);
    expect(
      container.querySelector(".family-parent-row.has-children:not(.single-parent)"),
    ).not.toBeNull();
    expect(container.querySelector(".family-children-branch.single")).toBeNull();
    expect(container.querySelectorAll(".family-child-branch-item")).toHaveLength(3);
    expect(container.querySelectorAll(".family-child-stem")).toHaveLength(3);
  });

  it("keeps one anchored person connected to separate unions for multiple partners", () => {
    act(() =>
      root.render(
        <FamilyTreeCanvas
          people={[
            {
              id: "person",
              fullName: "Joseph Borg",
              spouseIds: ["partner-1", "partner-2", "partner-3"],
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
              id: "partner-3",
              fullName: "Elena Zammit",
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
            {
              id: "child-3",
              fullName: "Mark Borg",
              fatherId: "person",
              motherId: "partner-3",
            },
          ]}
        />,
      ),
    );
    expect(container.querySelectorAll('[data-person-id="person"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-person-id="partner-1"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-person-id="partner-2"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-person-id="partner-3"]')).toHaveLength(1);
    expect(
      container.querySelectorAll(
        ".family-household-unions.anchored-multiple > .family-remarriage-layout > .family-remarriage-union",
      ),
    ).toHaveLength(3);
    expect(container.querySelectorAll(".family-multi-anchor-node")).toHaveLength(1);
    expect(container.querySelectorAll("[data-remarriage-key]")).toHaveLength(3);
    expect(container.querySelectorAll(".family-remarriage-child-link")).toHaveLength(3);
    expect(container.querySelectorAll(".family-remarriage-junction")).toHaveLength(3);
    expect(container.querySelectorAll(".family-remarriage-descendants")).toHaveLength(3);
    expect(container.querySelectorAll('[data-person-id="child-1"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-person-id="child-2"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-person-id="child-3"]')).toHaveLength(1);
    expect(container.textContent).not.toContain("Partner");
    expect(
      container.querySelector('[data-person-id="child-1"] .family-node-name').textContent,
    ).toBe("Paul");
    expect(
      container.querySelector('[data-person-id="child-2"] .family-node-name').textContent,
    ).toBe("Claire");
    expect(
      container.querySelector('[data-person-id="child-3"] .family-node-name').textContent,
    ).toBe("Mark");
    expect(container.querySelector('[data-person-id="child-1"] .family-node-name').title).toBe(
      "Paul Borg",
    );
    expect(container.querySelector('[data-person-id="child-2"] .family-node-name').title).toBe(
      "Claire Borg",
    );
  });

  it("renders one anchored person card when a partner shares existing children", () => {
    act(() =>
      root.render(
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
      ),
    );

    expect(container.querySelectorAll('[data-person-id="roland"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-person-id="partner"]')).toHaveLength(1);
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

  it("keeps partnered cousins in their own branches and renders their child once", () => {
    act(() =>
      root.render(
        <FamilyTreeCanvas
          people={[
            {
              id: "grandfather",
              fullName: "Anthony Borg",
              sex: "Male",
            },
            {
              id: "grandmother",
              fullName: "Maria Borg",
              sex: "Female",
            },
            {
              id: "branch-one",
              fullName: "Joseph Borg",
              fatherId: "grandfather",
              motherId: "grandmother",
            },
            {
              id: "branch-two",
              fullName: "Paul Borg",
              fatherId: "grandfather",
              motherId: "grandmother",
            },
            {
              id: "branch-one-partner",
              fullName: "Anne Vella",
            },
            {
              id: "branch-two-partner",
              fullName: "Claire Zammit",
            },
            {
              id: "cousin-a",
              fullName: "Mark Borg",
              fatherId: "branch-one",
              motherId: "branch-one-partner",
              spouseIds: ["cousin-b"],
            },
            {
              id: "cousin-b",
              fullName: "Elena Borg",
              fatherId: "branch-two",
              motherId: "branch-two-partner",
              spouseIds: ["cousin-a"],
            },
            {
              id: "cousins-child",
              fullName: "Daniel Borg",
              fatherId: "cousin-a",
              motherId: "cousin-b",
            },
          ]}
        />,
      ),
    );

    expect(container.querySelectorAll('[data-person-id="cousin-a"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-person-id="cousin-b"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-person-id="cousins-child"]')).toHaveLength(1);

    const crossUnion = container.querySelector(
      '.family-cross-union[data-cross-union-key="cousin-a::cousin-b"]',
    );
    expect(crossUnion).not.toBeNull();
    expect(crossUnion.querySelector(".family-cross-partner-link")).not.toBeNull();
    expect(crossUnion.querySelector(".family-cross-child-link")).not.toBeNull();
    expect(crossUnion.querySelector(".family-cross-union-junction")).not.toBeNull();

    const descendants = container.querySelector(
      '.family-cross-union-descendants[data-cross-union-key="cousin-a::cousin-b"]',
    );
    expect(descendants).not.toBeNull();
    expect(descendants.querySelector('[data-person-id="cousins-child"]')).not.toBeNull();
    expect(
      container.querySelector('[data-person-id="cousin-a"]').closest(".family-household"),
    ).not.toBe(container.querySelector('[data-person-id="cousin-b"]').closest(".family-household"));
  });

  it("targets an incoming branch at the anchored card rather than the household centre", () => {
    expect(anchoredBranchOffset({ left: 350, width: 100 }, { left: 100, width: 500 }, 0.5)).toBe(
      100,
    );
  });

  it("renders every person and child once in a non-star partner network", () => {
    act(() =>
      root.render(
        <FamilyTreeCanvas
          people={[
            { id: "ancestor", fullName: "Anthony Borg" },
            {
              id: "person-a",
              fullName: "Anna Borg",
              fatherId: "ancestor",
              spouseIds: ["person-b"],
            },
            {
              id: "person-b",
              fullName: "Ben Vella",
              spouseIds: ["person-a", "person-c"],
            },
            {
              id: "person-c",
              fullName: "Claire Zammit",
              spouseIds: ["person-b", "person-d"],
            },
            {
              id: "person-d",
              fullName: "Daniel Galea",
              spouseIds: ["person-c"],
            },
            {
              id: "child-ab",
              fullName: "Child AB",
              fatherId: "person-a",
              motherId: "person-b",
            },
            {
              id: "child-bc",
              fullName: "Child BC",
              fatherId: "person-b",
              motherId: "person-c",
            },
            {
              id: "child-cd",
              fullName: "Child CD",
              fatherId: "person-c",
              motherId: "person-d",
            },
          ]}
        />,
      ),
    );

    ["person-a", "person-b", "person-c", "person-d", "child-ab", "child-bc", "child-cd"].forEach(
      (personId) => {
        expect(container.querySelectorAll(`[data-person-id="${personId}"]`), personId).toHaveLength(
          1,
        );
      },
    );
    expect(container.querySelectorAll(".family-partner-network")).toHaveLength(1);
    expect(container.querySelectorAll(".family-partner-network-person")).toHaveLength(4);
    expect(container.querySelectorAll(".family-partner-network-relationship")).toHaveLength(3);
    expect(container.querySelectorAll(".family-partner-network-child-link")).toHaveLength(3);
  });
});
