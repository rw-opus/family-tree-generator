import { test, expect, openEstate, WORKSPACE_KEY, PEOPLE, TERMS_KEY } from "./fixtures.js";

test.describe("workspace and persistence", () => {
  test("keeps an edit across a reload", async ({ seeded, page }) => {
    await seeded();
    await openEstate(page);

    await page.locator("[data-person-id]").first().click();
    await page.getByRole("button", { name: "Edit identity" }).click();
    await page.getByLabel("Name", { exact: true }).first().fill("Gorgina");

    // Wait for the write to land rather than sleeping a guessed interval.
    await expect
      .poll(() => page.evaluate((key) => window.localStorage.getItem(key) || "", WORKSPACE_KEY))
      .toContain("Gorgina");

    // A reload returns to the library, so the family is reopened to check the
    // edit survived rather than merely reaching the browser's storage.
    await page.reload();
    await openEstate(page);
    await expect(page.locator(`[data-person-id="${PEOPLE.gorg}"]`)).toContainText("Gorgina");

    const stored = await page.evaluate((key) => window.localStorage.getItem(key), WORKSPACE_KEY);
    expect(stored).toContain("Gorgina");
  });

  test("creates a family from empty and lists it", async ({ page }) => {
    await page.addInitScript((terms) => window.localStorage.setItem(terms, "yes"), TERMS_KEY);
    await page.goto("/");

    await expect(page.locator("button.family-name-button")).toHaveCount(0);
    await page.getByRole("button", { name: /Create new family/ }).click();

    const dialog = page.locator('[role="dialog"]');
    await dialog.getByLabel("Family name").fill("Testa Fictional");
    await dialog.getByLabel("Given name(s)").fill("Anna");
    await dialog.getByLabel("Surname").fill("Testa");
    await dialog.locator("label").filter({ hasText: "Female" }).first().click();
    await dialog.getByRole("button", { name: "Create family" }).click();

    await expect(page.locator(".tree-stage")).toBeVisible();
    await expect(page.getByLabel("Edit tree name: Testa Fictional")).toBeVisible();
  });

  test("renames a family from the library", async ({ seeded, page }) => {
    await seeded();
    await page.goto("/");

    await page.getByRole("button", { name: /Rename Borg Fictional Estate/ }).click();
    const field = page.locator(".family-library-row input").first();
    await field.fill("Renamed Estate");
    await field.press("Enter");

    await expect(page.getByRole("button", { name: /Open Renamed Estate/ })).toBeVisible();
  });

  test("moves a family to Trash, restores it, and confirms deletion forever", async ({
    seeded,
    page,
  }) => {
    await seeded();
    await page.goto("/");

    await page.getByRole("button", { name: "Move Borg Fictional Estate to Trash" }).click();
    let dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("restore this family from Trash for 30 days");
    await dialog.getByRole("button", { name: "Move to Trash" }).click();

    await expect(page.locator("button.family-name-button")).toHaveCount(0);
    await page.getByRole("button", { name: "Trash (1)" }).click();
    await expect(page.getByText("Borg Fictional Estate", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Restore Borg Fictional Estate" }).click();
    await expect(page.getByRole("button", { name: /Open Borg Fictional Estate/ })).toBeVisible();

    await page.getByRole("button", { name: "Move Borg Fictional Estate to Trash" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Move to Trash" }).click();
    await page.getByRole("button", { name: "Delete Borg Fictional Estate forever" }).click();
    dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("cannot be restored");
    await dialog.getByRole("button", { name: "Delete forever" }).click();

    await expect(page.getByRole("button", { name: "Trash (0)" })).toBeVisible();
    const stored = await page.evaluate(
      (key) => JSON.parse(window.localStorage.getItem(key)),
      WORKSPACE_KEY,
    );
    expect(stored).toMatchObject({ version: 2, trees: [], trashedTrees: [] });
  });

  test("downloads a workspace backup containing the family", async ({ seeded, page }) => {
    await seeded();
    await page.goto("/");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Download workspace backup/ }).click(),
    ]);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const backup = JSON.parse(Buffer.concat(chunks).toString());

    const trees = backup.trees || backup.families || [];
    expect(Array.isArray(trees)).toBe(true);
    expect(JSON.stringify(backup)).toContain("Borg Fictional Estate");
    // The backup is the user's recovery copy; it must carry the ownership data.
    expect(JSON.stringify(backup)).toContain("12, Triq il-Kbira, Fictionville");
  });

  test("survives a corrupt saved workspace instead of failing to boot", async ({ page }) => {
    await page.addInitScript(
      ([key, terms]) => {
        window.localStorage.setItem(terms, "yes");
        window.localStorage.setItem(key, "{ this is not json");
      },
      [WORKSPACE_KEY, TERMS_KEY],
    );
    await page.goto("/");

    // The stored value is preserved for recovery rather than silently replaced.
    await expect(page.locator("#root")).not.toBeEmpty();
    const stored = await page.evaluate((key) => window.localStorage.getItem(key), WORKSPACE_KEY);
    expect(stored).toBe("{ this is not json");
  });
});
