import { test, expect, openEstate, openPropertyWorkspace, PEOPLE } from "./fixtures.js";

const recordOutsideSale = async (page, { date = "02/02/2020", acquirer = /Pawlu/ } = {}) => {
  await page.locator(".outside-owner-link").first().click();
  await page.getByRole("button", { name: /Add sale or donation/ }).click();
  await page.getByLabel("Outside owner transfer date").fill(date);
  await page.getByLabel("Outside owner acquirer", { exact: true }).selectOption({
    label: (
      await page
        .getByLabel("Outside owner acquirer", { exact: true })
        .locator("option")
        .filter({ hasText: acquirer })
        .first()
        .textContent()
    ).trim(),
  });
  await page.getByRole("button", { name: "Record transfer" }).click();
};

const openTransferSellerFromTrace = async (page) => {
  await page.getByRole("button", { name: "View full history" }).click();
  const history = page.locator(".succession-history-dialog");
  await history.getByRole("button", { name: /^Open seller / }).click();
};

test.describe("ownership transfers", () => {
  test.beforeEach(async ({ seeded, page }) => {
    await seeded();
    await openEstate(page);
  });

  test("records a sale from an outside owner card", async ({ page }) => {
    await openPropertyWorkspace(page);
    await recordOutsideSale(page);

    await expect(page.locator(".outside-owner-dialog")).toContainText("Sale recorded.");
    await page.getByRole("button", { name: "Back to ownership" }).click();

    const ownership = page.locator("#property-workspace-ownership");
    await expect(ownership).not.toContainText("Recorded transfer history");
    await expect(ownership.locator(".ledger-total")).toContainText("100%");

    await page.getByRole("button", { name: "View full history" }).click();
    const history = page.locator(".succession-history-dialog");
    await expect(history).toContainText("Property share sale");
    await expect(history).toContainText("sells 1/2 (50%)");
  });

  test("reopens a sold-out owner and edits the recorded share", async ({ page }) => {
    await openPropertyWorkspace(page);
    await recordOutsideSale(page);
    await page.getByRole("button", { name: "Back to ownership" }).click();

    // The company now holds nothing, but its seller link remains in Trace succession.
    await openTransferSellerFromTrace(page);
    await expect(page.locator(".outside-owner-dialog")).toContainText("0/1");

    await page.getByRole("button", { name: /Edit sale record/ }).click();
    await page.getByLabel("Outside owner transfer measurement").selectOption("defined-share");
    await page.getByLabel("Outside owner transfer numerator").fill("1");
    await page.getByLabel("Outside owner transfer denominator").fill("4");
    await page.getByRole("button", { name: "Save transfer" }).click();

    await expect(page.locator(".outside-owner-dialog")).toContainText("1/4");
    await page.getByRole("button", { name: "Back to ownership" }).click();
    await page.getByRole("button", { name: "View full history" }).click();
    await expect(page.locator(".succession-history-dialog")).toContainText("sells 1/4 (25%)");
  });

  test("deletes a transfer and restores the previous title", async ({ page }) => {
    await openPropertyWorkspace(page);
    await recordOutsideSale(page);
    await page.getByRole("button", { name: "Back to ownership" }).click();
    await openTransferSellerFromTrace(page);

    await page.getByRole("button", { name: /Delete sale record/ }).click();
    await expect(page.locator(".outside-owner-dialog")).toContainText("Transfer deleted.");
    await expect(page.locator(".outside-owner-dialog")).toContainText("1/2");
  });

  test("refuses a share larger than the owner holds", async ({ page }) => {
    await openPropertyWorkspace(page);
    await page.locator(".outside-owner-link").first().click();
    await page.getByRole("button", { name: /Add sale or donation/ }).click();
    await page.getByLabel("Outside owner transfer date").fill("02/02/2020");
    await page.getByLabel("Outside owner transfer measurement").selectOption("defined-share");
    await page.getByLabel("Outside owner transfer numerator").fill("3");
    await page.getByLabel("Outside owner transfer denominator").fill("4");

    await expect(page.locator(".transfer-error")).toContainText(
      "larger share than the calculator shows it owned",
    );
  });

  test("records a person-card sale to a newly created company", async ({ page }) => {
    await page.locator(`[data-person-id="${PEOPLE.gorg}"]`).click();
    await page.getByText("Sold/Donated Property Share", { exact: true }).click();
    await page.getByLabel("Type of contract").selectOption("sale");
    await page.getByLabel("Acquirer source").selectOption("new");
    await page.getByLabel("New acquirer type").selectOption("company");
    await page.getByLabel("New acquirer full name").fill("Falzon Trading Ltd");
    await page.getByLabel("Sale date").fill("03/03/2021");
    await page.getByRole("button", { name: /^Record sale$/ }).click();

    // A company acquirer becomes an outside party, never a person on the tree.
    await expect(page.locator("[data-person-id]")).toHaveCount(3);
    await page.getByRole("button", { name: "Back to Tree" }).click();
    await openPropertyWorkspace(page);
    await expect(page.locator("#property-workspace-ownership")).toContainText("Falzon Trading Ltd");
  });

  test("opens the source owner card from a recipient's tax details", async ({ page }) => {
    await openPropertyWorkspace(page);
    await recordOutsideSale(page);
    await page.getByRole("button", { name: "Back to ownership" }).click();

    await page.getByRole("button", { name: "Tax Calculation" }).first().click();
    await page.locator(".tax-provenance-link").filter({ hasText: /Vella/ }).first().click();

    await expect(page.locator("#outside-owner-title")).toHaveText("Vella Holdings Ltd");
  });

  test("closes the owner card with Escape", async ({ page }) => {
    await openPropertyWorkspace(page);
    await page.locator(".outside-owner-link").first().click();
    await expect(page.locator(".outside-owner-dialog")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator(".outside-owner-dialog")).toHaveCount(0);
  });
});
