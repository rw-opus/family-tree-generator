// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateInput } from "../../src/components/DateInput.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("DateInput", () => {
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

  const changeInput = (input, value) => {
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("displays an ISO value as DD-MM-YYYY", () => {
    act(() => root.render(<DateInput value="2026-07-31" onChange={vi.fn()} />));

    const input = container.querySelector("input");
    expect(input.value).toBe("31-07-2026");
    expect(input.placeholder).toBe("dd-mm-yyyy");
    expect(input.inputMode).toBe("numeric");
  });

  it("emits ISO storage values only after a valid display date is complete", () => {
    const onChange = vi.fn();
    act(() => root.render(<DateInput value="" onChange={onChange} />));
    const input = container.querySelector("input");

    changeInput(input, "3107");
    expect(input.value).toBe("31-07");
    expect(onChange).not.toHaveBeenCalled();

    changeInput(input, "31072026");
    expect(input.value).toBe("31-07-2026");
    expect(onChange).toHaveBeenLastCalledWith("2026-07-31");
  });

  it("marks a complete invalid calendar date without emitting it", () => {
    const onChange = vi.fn();
    act(() => root.render(<DateInput value="" onChange={onChange} />));
    const input = container.querySelector("input");

    changeInput(input, "31042026");

    expect(input.value).toBe("31-04-2026");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(container.textContent).toContain("Not saved");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("emits an empty ISO value when cleared", () => {
    const onChange = vi.fn();
    act(() => root.render(<DateInput value="2026-07-31" onChange={onChange} />));
    const input = container.querySelector("input");

    changeInput(input, "");

    expect(input.value).toBe("");
    expect(onChange).toHaveBeenLastCalledWith("");
  });
});
