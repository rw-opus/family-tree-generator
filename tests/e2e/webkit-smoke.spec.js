import {
  test,
  expect,
  openEstate,
  openPropertyWorkspace,
  PEOPLE,
  WORKSPACE_KEY,
} from "./fixtures.js";

test.describe("WebKit mobile workflows", () => {
  test("boots through the terms gate", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("#root")).not.toBeEmpty();
    await expect(page.getByText("BEFORE YOU CONTINUE")).toBeVisible();

    const accept = page.getByRole("button", { name: "Accept and continue" });
    await expect(accept).toBeDisabled();
    await page.locator('input[type="checkbox"]').first().check();
    await accept.click();

    await expect(page.getByText("BEFORE YOU CONTINUE")).toBeHidden();
    await expect(page.locator("button.family-name-button")).toHaveCount(0);
  });

  test("opens a family and persists a person-card edit", async ({ seeded, page }) => {
    await seeded();
    await openEstate(page);

    await page.locator(`[data-person-id="${PEOPLE.gorg}"]`).click();
    const card = page.locator(".context-dashboard");
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Edit identity" }).click();
    await card.getByLabel("Name", { exact: true }).first().fill("Gorgina");

    await expect
      .poll(() => page.evaluate((key) => window.localStorage.getItem(key) || "", WORKSPACE_KEY))
      .toContain("Gorgina");

    await page.reload();
    await openEstate(page);
    await expect(page.locator(`[data-person-id="${PEOPLE.gorg}"]`)).toContainText("Gorgina");
  });

  test("reaches the tax calculation from the tree and returns", async ({ seeded, page }) => {
    await seeded();
    await openEstate(page);
    await openPropertyWorkspace(page);

    await page.getByRole("button", { name: "Tax Calculation" }).first().click();
    const tax = page.locator("#property-workspace-tax");
    await expect(tax).toBeVisible();
    await expect(tax).toContainText("Total sale value");
    await expect(tax).toContainText("Total tax");

    await page.getByRole("button", { name: "Back to Tree" }).click();
    await expect(page.locator(".tree-stage")).toBeVisible();
  });
});
