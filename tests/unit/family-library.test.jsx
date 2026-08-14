// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FamilyLibrary } from "../../src/components/FamilyLibrary.jsx";
import { TREE_DATA_LIMITS } from "../../src/domain/treeData.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const renderLibrary = (root, props = {}) => {
  const handlers = {
    onCreate: vi.fn(),
    onImport: vi.fn(),
    onOpen: vi.fn(),
    onRename: vi.fn(),
    onRemove: vi.fn(),
    onChangePassword: vi.fn(),
    onSignIn: vi.fn(),
    onSignOut: vi.fn(),
    onDownloadBackup: vi.fn(),
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

const setLabelledInput = (container, labelText, value) => {
  const label = [...container.querySelectorAll("label")].find((item) =>
    item.textContent.includes(labelText),
  );
  const input = label.querySelector("input");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const submitDialog = async (dialog) => {
  await act(async () => {
    dialog.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
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
    expect(container.textContent).toContain("29/07/2026");
    expect(container.textContent).toContain("Borg family");
    expect(container.textContent).toContain("Vella family");

    const open = [...container.querySelectorAll(".family-name-button")].find((button) =>
      button.textContent.includes("Vella family"),
    );
    act(() => open.click());
    expect(handlers.onOpen).toHaveBeenCalledWith("vella");
  });

  it("confirms a clearly labelled delete action inside the application", async () => {
    const handlers = renderLibrary(root);
    const remove = container.querySelector('button[aria-label="Delete Vella family"]');

    expect(container.textContent).not.toContain("Property & tax");
    expect(container.querySelector('button[aria-label="Rename Vella family"]')).not.toBeNull();
    act(() => remove.click());

    expect(handlers.onRemove).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    const confirm = [...container.querySelectorAll('[role="alertdialog"] button')].find((button) =>
      button.textContent.includes("Delete family"),
    );
    await act(async () => confirm.click());
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

  it("collects the family and first-person details before creating a tree", async () => {
    const handlers = renderLibrary(root);
    const create = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Create new family"),
    );
    act(() => create.click());
    expect(handlers.onCreate).not.toHaveBeenCalled();

    const dialog = container.querySelector('[role="dialog"]');
    expect(
      [...dialog.querySelectorAll("label")]
        .find((item) => item.textContent.includes("Family name"))
        .querySelector("input").maxLength,
    ).toBe(TREE_DATA_LIMITS.maxTitleCharacters);
    const setInput = (labelText, value) => {
      const label = [...dialog.querySelectorAll("label")].find((item) =>
        item.textContent.includes(labelText),
      );
      const input = label.querySelector("input");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    act(() => {
      setInput("Family name", "Vella family");
      setInput("Given name", "Maria");
      setInput("Surname", "Vella");
      dialog.querySelector('input[value="Female"]').click();
    });
    await act(async () => {
      dialog.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(handlers.onCreate).toHaveBeenCalledWith({
      title: "Vella family",
      givenNames: "Maria",
      surname: "Vella",
      sex: "Female",
    });
  });

  it("closes creation and deletion dialogs with Escape", () => {
    renderLibrary(root);
    const create = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Create new family"),
    );

    act(() => create.click());
    const creationDialog = container.querySelector('[role="dialog"]');
    expect(creationDialog).not.toBeNull();
    act(() =>
      creationDialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    const remove = container.querySelector('button[aria-label="Delete Vella family"]');
    act(() => remove.click());
    const deletionDialog = container.querySelector('[role="alertdialog"]');
    expect(deletionDialog).not.toBeNull();
    act(() =>
      deletionDialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("offers GEDCOM import from the first screen", () => {
    const handlers = renderLibrary(root);

    const file = new File(["0 HEAD"], "Imported-family.ged", { type: "text/plain" });
    const input = container.querySelector('input[type="file"]');
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(handlers.onImport).toHaveBeenCalledWith(file);
  });

  it("offers a full workspace backup and public legal notices", () => {
    const handlers = renderLibrary(root);
    const backup = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Download workspace backup"),
    );

    act(() => backup.click());
    expect(handlers.onDownloadBackup).toHaveBeenCalledOnce();
    expect(container.querySelector('a[href="/?legal=terms"]')).not.toBeNull();
    expect(container.querySelector('a[href="/?legal=privacy"]')).not.toBeNull();
  });

  it("validates a signed-in password change before submitting it", async () => {
    const handlers = renderLibrary(root);
    const openPasswordDialog = container.querySelector('button[aria-label="Change password"]');
    act(() => openPasswordDialog.click());
    const dialog = container.querySelector("form.account-password-dialog");

    act(() => {
      setLabelledInput(dialog, "Current password", "old-password");
      setLabelledInput(dialog, "New password", "short");
      setLabelledInput(dialog, "Repeat new password", "short");
    });
    await submitDialog(dialog);
    expect(handlers.onChangePassword).not.toHaveBeenCalled();
    expect(dialog.querySelector('[role="alert"]').textContent).toContain("at least 10 characters");

    act(() => {
      setLabelledInput(dialog, "New password", "a-new-secure-password");
      setLabelledInput(dialog, "Repeat new password", "a-different-password");
    });
    await submitDialog(dialog);
    expect(handlers.onChangePassword).not.toHaveBeenCalled();
    expect(dialog.querySelector('[role="alert"]').textContent).toContain("do not match");
  });

  it("submits the current and new passwords and confirms success", async () => {
    const handlers = renderLibrary(root);
    const openPasswordDialog = container.querySelector('button[aria-label="Change password"]');
    act(() => openPasswordDialog.click());
    const dialog = container.querySelector("form.account-password-dialog");

    act(() => {
      setLabelledInput(dialog, "Current password", "old-password");
      setLabelledInput(dialog, "New password", "a-new-secure-password");
      setLabelledInput(dialog, "Repeat new password", "a-new-secure-password");
    });
    await submitDialog(dialog);

    expect(handlers.onChangePassword).toHaveBeenCalledWith({
      currentPassword: "old-password",
      newPassword: "a-new-secure-password",
    });
    expect(dialog.querySelector('[role="status"]').textContent).toContain(
      "Password has been changed successfully".toLowerCase(),
    );
  });

  it("keeps the password dialog usable when the change is rejected", async () => {
    const onChangePassword = vi.fn().mockRejectedValue(new Error("Current password is incorrect."));
    renderLibrary(root, { onChangePassword });
    const openPasswordDialog = container.querySelector('button[aria-label="Change password"]');
    act(() => openPasswordDialog.click());
    const dialog = container.querySelector("form.account-password-dialog");

    act(() => {
      setLabelledInput(dialog, "Current password", "wrong-password");
      setLabelledInput(dialog, "New password", "a-new-secure-password");
      setLabelledInput(dialog, "Repeat new password", "a-new-secure-password");
    });
    await submitDialog(dialog);

    expect(dialog.querySelector('[role="alert"]').textContent).toContain(
      "Current password is incorrect.",
    );
    expect(dialog.querySelector('button[type="submit"]').disabled).toBe(false);
  });

  it("keeps the family list focused on opening, renaming, and deleting trees", () => {
    const handlers = renderLibrary(root);

    expect(container.textContent).not.toContain("Property & tax");
    expect(container.querySelectorAll(".family-row-actions button")).toHaveLength(4);

    const borg = [...container.querySelectorAll(".family-name-button")].find((button) =>
      button.textContent.includes("Borg family"),
    );
    act(() => borg.click());
    expect(handlers.onOpen).toHaveBeenCalledWith("borg");
  });

  it("groups family status clearly and removes duplicate actions while renaming", () => {
    renderLibrary(root, {
      trees: [
        {
          id: "review",
          title: "Review family",
          createdAt: "2026-08-04T00:00:00Z",
          dataWarnings: [{ message: "One" }],
          importWarnings: [{ message: "Two" }],
        },
      ],
      activeTreeId: "review",
    });

    const row = container.querySelector(".family-library-row:not(.family-library-table-head)");
    expect(row.classList.contains("is-active")).toBe(true);
    expect(row.querySelector(".family-name-badges").textContent).toContain("Open now");
    expect(row.querySelector(".family-name-badges").textContent).toContain("2 reviews");
    expect(row.querySelector(".family-last-changed-label").textContent).toBe("Added");

    act(() => row.querySelector('button[aria-label="Rename Review family"]').click());
    expect(row.classList.contains("is-renaming")).toBe(true);
    expect(row.querySelector(".family-row-actions")).toBeNull();
    expect(row.querySelector('button[aria-label="Save family name"]')).not.toBeNull();

    act(() =>
      row
        .querySelector(".family-rename-form")
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(row.classList.contains("is-renaming")).toBe(false);
    expect(row.querySelector('.family-name-button[aria-label*="currently open"]')).not.toBeNull();
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

  it("shows an unlimited allowance without free-tree or checkout messaging", () => {
    renderLibrary(root, {
      commercialMode: true,
      entitlement: {
        freeTreeLimit: 5,
        freeTreesUsed: 5,
        freeTreesRemaining: 0,
        paidTreeCredits: 0,
        totalTreesCreated: 12,
        unlimitedTrees: true,
        canCreate: true,
      },
      canCreate: true,
      onBuyTree: vi.fn(),
    });

    expect(container.textContent).toContain("Tree allowance");
    expect(container.textContent).toContain("Unlimited");
    expect(container.querySelector(".tree-pricing-card")).toBeNull();
    expect(container.querySelector(".library-credit-policy")).toBeNull();
    expect(container.textContent).not.toContain("Free trees remaining");
    expect(container.textContent).not.toContain("Buy one tree");
    expect(container.textContent).not.toContain("Tree credits are consumed");
    expect(container.querySelector('input[type="file"]').disabled).toBe(false);

    const create = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Create new family"),
    );
    expect(create.disabled).toBe(false);
    act(() => create.click());
    expect(container.querySelector(".library-credit-notice")).toBeNull();

    const cancelCreate = [...container.querySelectorAll(".family-creation-dialog button")].find(
      (button) => button.textContent.includes("Cancel"),
    );
    act(() => cancelCreate.click());
    act(() => container.querySelector('button[aria-label="Delete Vella family"]').click());
    expect(container.querySelector('[role="alertdialog"]').textContent).not.toContain("credit");
  });

  it("keeps the mobile home content concise without losing accessible actions", () => {
    renderLibrary(root, {
      commercialMode: true,
      entitlement: {
        totalTreesCreated: 4,
        unlimitedTrees: true,
        canCreate: true,
      },
      canCreate: true,
      storageStatus: "Saved securely to your workspace.",
    });

    expect(container.textContent).not.toContain(
      "Choose a family to open its tree, people and property work.",
    );
    expect(container.textContent).not.toContain("Saved securely to your workspace.");
    expect(container.textContent.match(/Unlimited/g)).toHaveLength(1);
    expect(container.querySelector('button[aria-label="Change password"]')).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Download workspace backup"]'),
    ).not.toBeNull();
    expect(container.querySelector('button[aria-label="Create new family"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="Import GEDCOM"]')).not.toBeNull();
  });
});
