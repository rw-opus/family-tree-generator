// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonFinder } from "../../src/components/PersonFinder.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("PersonFinder", () => {
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

  it("finds a person by a parent's name and focuses the chosen result", () => {
    const onSelectPerson = vi.fn();
    const people = [
      { id: "father", fullName: "Joseph Borg" },
      { id: "mother", fullName: "Maria Vella" },
      {
        id: "child",
        fullName: "Anna Borg",
        fatherId: "father",
        motherId: "mother",
      },
    ];

    act(() => root.render(<PersonFinder people={people} onSelectPerson={onSelectPerson} />));
    act(() => container.querySelector("summary").click());
    const input = container.querySelector("input");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        input,
        "Maria Vella",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const result = [...container.querySelectorAll(".person-finder-results button")].find((button) =>
      button.textContent.includes("Anna Borg"),
    );
    expect(result.textContent).toContain("Mother: Maria Vella");
    act(() => result.click());

    expect(onSelectPerson).toHaveBeenCalledWith("child");
    expect(container.querySelector("details").hasAttribute("open")).toBe(false);
  });

  it("does not silently hide matches after the first twenty people", () => {
    const people = Array.from({ length: 25 }, (_, index) => ({
      id: `person-${index + 1}`,
      fullName: `Person ${index + 1}`,
    }));
    act(() => root.render(<PersonFinder people={people} onSelectPerson={vi.fn()} />));
    act(() => container.querySelector("summary").click());
    expect(container.querySelectorAll(".person-finder-results button")).toHaveLength(25);
  });
});
