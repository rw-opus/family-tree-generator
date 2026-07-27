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
  it("renders parent-linked people without numbered generation captions and highlights the selected person", () => {
    act(() => root.render(<FamilyTreeCanvas selectedPersonId="c" people={[{ id: "f", fullName: "Father", sex: "Male" }, { id: "m", fullName: "Mother", sex: "Female" }, { id: "c", fullName: "Child", sex: "Female", isDeceased: true, fatherId: "f", motherId: "m" }]} />));
    expect(container.textContent).toContain("Father");
    expect(container.textContent).toContain("Child");
    expect(container.textContent).not.toContain("Generation");
    expect(container.querySelector('[data-person-id="f"]').className).toContain("male");
    expect(container.querySelector('[data-person-id="m"]').className).toContain("female");
    expect(container.querySelector('[data-person-id="c"]').className).toContain("deceased");
    expect(container.querySelector('[data-person-id="c"]').className).toContain("selected");
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
});
