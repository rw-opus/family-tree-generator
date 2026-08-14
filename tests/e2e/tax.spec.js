import { test, expect, openEstate, openPropertyWorkspace, estate, PEOPLE } from "./fixtures.js";

/**
 * The figures below are the point of this file. They are the only assertions in
 * the suite that would catch a change silently altering money on screen, so they
 * are written as literals rather than derived from the application's own output.
 *
 * Fixture: €400,000 sale. Ġorġ holds 1/2 acquired 1990 (pre-2004 -> 10% of
 * transfer value). Vella Holdings Ltd holds 1/2 acquired 2010 (-> 8%).
 */
test.describe("tax calculation", () => {
  test("applies 10% before 2004 and 8% after, and totals them", async ({ seeded, page }) => {
    await seeded();
    await openEstate(page);
    await openPropertyWorkspace(page);

    const tax = page.locator("#property-workspace-tax");
    await expect(tax).toContainText("10% of transfer value: €20,000.00");
    await expect(tax).toContainText("8% of transfer value: €16,000.00");

    // Each vendor is attributed half of the €400,000 price.
    await expect(tax).toContainText("Total sale value €400,000.00");
    await expect(tax).toContainText("Total tax €36,000.00");
    await expect(tax).toContainText("Total net €364,000.00");
  });

  test("shows each vendor's payable and net separately", async ({ seeded, page }) => {
    await seeded();
    await openEstate(page);
    await openPropertyWorkspace(page);

    const gorg = page.locator(".tax-calculation-vendor").filter({ hasText: "Ġorġ Borg" });
    const vella = page.locator(".tax-calculation-vendor").filter({ hasText: "Vella Holdings Ltd" });

    await expect(gorg).toContainText("Tax payable €20,000.00");
    await expect(gorg).toContainText("Net balance €180,000.00");
    await expect(vella).toContainText("Tax payable €16,000.00");
    await expect(vella).toContainText("Net balance €184,000.00");
  });

  test("withholds a total while any source is incomplete", async ({ seeded, page }) => {
    const withoutDate = estate();
    delete withoutDate.properties[0].owners[1].acquisitionDate;
    await seeded(withoutDate);
    await openEstate(page);
    await openPropertyWorkspace(page);

    const tax = page.locator("#property-workspace-tax");
    // The complete half is still calculated; the overall total is deliberately
    // withheld rather than being reported as if it were the whole liability.
    await expect(tax).toContainText("10% of transfer value: €20,000.00");
    await expect(tax).toContainText("Tax is not calculated for 1 source fraction");
    await expect(tax).not.toContainText("Total tax €36,000.00");
  });

  test("never calls a detail optional when it blocks the figure", async ({ seeded, page }) => {
    const withoutDate = estate();
    delete withoutDate.properties[0].owners[1].acquisitionDate;
    await seeded(withoutDate);
    await openEstate(page);
    await openPropertyWorkspace(page);
    await page.locator(".outside-owner-link").first().click();

    const card = page.locator(".outside-owner-dialog");
    await expect(card).toContainText("Final Withholding Tax");
    await expect(card).toContainText("before the tax can be calculated");
    await expect(card).not.toContainText("optional");
  });

  test("recalculates after the missing acquisition date is supplied", async ({ seeded, page }) => {
    const withoutDate = estate();
    delete withoutDate.properties[0].owners[1].acquisitionDate;
    await seeded(withoutDate);
    await openEstate(page);
    await openPropertyWorkspace(page);
    await page.locator(".outside-owner-link").first().click();

    await page.getByLabel("Original acquisition date").fill("15/06/1995");
    await page.getByRole("button", { name: "Confirm date" }).click();

    // 1995 is before 2004, so this half now attracts 10% rather than 8%.
    await expect(page.locator(".outside-owner-dialog")).toContainText("€20,000.00");
    await page.getByRole("button", { name: "Back to ownership" }).click();
    await expect(page.locator("#property-workspace-tax")).toContainText("Total tax €40,000.00");
  });

  test("moves the liability with the share when it is sold on", async ({ seeded, page }) => {
    await seeded();
    await openEstate(page);
    await openPropertyWorkspace(page);

    await page.locator(".outside-owner-link").first().click();
    await page.getByRole("button", { name: "Add sale or donation" }).click();
    await page.getByLabel("Outside owner transfer date").fill("02/02/2020");
    await page
      .getByLabel("Outside owner acquirer", { exact: true })
      .selectOption({ label: "Pawlu Borg s/o Ġorġ Borg" });
    await page.getByRole("button", { name: "Record transfer" }).click();
    await page.getByRole("button", { name: "Back to ownership" }).click();

    const tax = page.locator("#property-workspace-tax");
    // Pawlu acquired in 2020 from a purchase, so his half is taxed at 8%.
    await expect(tax).toContainText("Acquired from Vella Holdings Ltd");
    await expect(tax).toContainText("8% of transfer value: €16,000.00");
    await expect(tax).toContainText("Total tax €36,000.00");
    // The company sold out and is no longer a vendor in this sale.
    await expect(tax).not.toContainText("Tax payable €16,000.00\n\nNet balance €184,000.00");
  });

  test("reports no liability for an owner who holds nothing", async ({ seeded, page }) => {
    await seeded();
    await openEstate(page);

    await page.locator(`[data-person-id="${PEOPLE.marija}"]`).click();
    // Marija is on the tree but owns no share, so she is not a vendor.
    await expect(page.locator(".final-withholding-tax-section")).toContainText(
      "Not a current vendor",
    );
  });
});
