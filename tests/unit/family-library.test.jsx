// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FamilyLibrary } from "../../src/components/FamilyLibrary.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const renderLibrary = (root, props = {}) => {
  const handlers = {
    onCreate: vi.fn(),
    onImport: vi.fn(),
    onOpen: vi.fn(),
    onRename: vi.fn(),
    onRemove: vi.fn(),
    onSignIn: vi.fn(),
    onSignOut: vi.fn(),
    ...props,
  };
  act(() =>
    root.render(
      <FamilyLibrary
        trees={[
          {
            id: "borg",
            title: "Borg family",
            createdAt: "2026-07-29T00:00:00Z",
          },
          {
            id: "vella",
            title: "Vella family",
            createdAt: "2026-07-28T00:00:00Z",
          },
        ]}
        activeTreeId="borg"
        session={{
          user: {
            email: "roland@example.com",
            user_metadata: { full_name: "Roland Wadge" },
          },
        }}
        supabaseConfigured
        {...handlers}
      />,
    ),
  );
  return handlers;
};

describe("FamilyLibrary", () => {
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

  it("shows account details, added dates and opens the chosen family", () => {
    const handlers = renderLibrary(root);

    expect(container.textContent).toContain("Account Details");
    expect(container.textContent).toContain("Roland Wadge");
    expect(container.textContent).toContain("29-07-2026");
    expect(container.textContent).toContain("Borg family");
    expect(container.textContent).toContain("Vella family");

    const open = [...container.querySelectorAll(".family-name-button")].find((button) =>
      button.textContent.includes("Vella family"),
    );
    act(() => open.click());
    expect(handlers.onOpen).toHaveBeenCalledWith("vella");
  });

  it("offers a clearly labelled delete action on Home", () => {
    const handlers = renderLibrary(root);
    const remove = container.querySelector('button[aria-label="Delete Vella family"]');

    act(() => remove.click());

    expect(handlers.onRemove).toHaveBeenCalledWith("vella");
  });

  it("filters and renames families inline", () => {
    const handlers = renderLibrary(root);
    const search = container.querySelector('input[placeholder="Find a family"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        search,
        "vella",
      );
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).not.toContain("Borg family");
    expect(container.textContent).toContain("Vella family");

    const rename = container.querySelector('button[aria-label="Rename Vella family"]');
    act(() => rename.click());
    const name = container.querySelector('input[aria-label="New name for Vella family"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        name,
        "Vella descendants",
      );
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = container.querySelector('button[aria-label="Save family name"]');
    act(() => save.click());
    expect(handlers.onRename).toHaveBeenCalledWith("vella", "Vella descendants");
  });

  it("offers both creation and GEDCOM import from the first screen", () => {
    const handlers = renderLibrary(root);
    const create = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Create new family"),
    );
    act(() => create.click());
    expect(handlers.onCreate).toHaveBeenCalledOnce();

    const file = new File(["0 HEAD"], "Imported-family.ged", { type: "text/plain" });
    const input = container.querySelector('input[type="file"]');
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(handlers.onImport).toHaveBeenCalledWith(file);
  });

  it("shows the five-free pricing state and blocks creation until a paid credit exists", () => {
    const handlers = renderLibrary(root, {
      commercialMode: true,
      entitlement: {
        freeTreeLimit: 5,
        freeTreesUsed: 5,
        freeTreesRemaining: 0,
        paidTreeCredits: 0,
        totalTreesCreated: 5,
        canCreate: false,
      },
      canCreate: false,
      billingMessage: "Payment required",
      onBuyTree: vi.fn(),
    });

    expect(container.textContent).toContain("Additional tree · €30");
    expect(container.textContent).toContain("Payment required");
    expect(container.querySelector('input[type="file"]').disabled).toBe(true);
    const create = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Create new family"),
    );
    expect(create.disabled).toBe(true);

    const buy = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Buy one tree"),
    );
    act(() => buy.click());
    expect(handlers.onBuyTree).toHaveBeenCalledOnce();
  });
});
