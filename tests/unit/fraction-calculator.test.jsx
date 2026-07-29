// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FractionCalculator } from "../../src/components/FractionCalculator.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("FractionCalculator", () => {
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

  it("uses a visual calculator launcher and operation keypad", () => {
    act(() => root.render(<FractionCalculator />));

    const launcher = container.querySelector(".fraction-launcher");
    expect(launcher.textContent).not.toContain("Fractions");
    expect(launcher.querySelectorAll(".mini-calculator-keys i")).toHaveLength(6);

    act(() => launcher.click());
    expect(container.textContent).toContain("5/6");

    const multiply = container.querySelector('button[aria-label="Multiply"]');
    act(() => multiply.click());
    expect(multiply.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("1/6");
  });
});
