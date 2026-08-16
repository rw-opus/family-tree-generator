import { test, expect, openEstate, PEOPLE } from "./fixtures.js";

const chartState = (page) =>
  page.evaluate(() => {
    const chart = document.querySelector(".family-chart");
    return {
      left: Math.round(chart.scrollLeft),
      top: Math.round(chart.scrollTop),
      maxLeft: chart.scrollWidth - chart.clientWidth,
    };
  });

const cardCentre = (page, personId) =>
  page.evaluate((id) => {
    const rect = document.querySelector(`[data-person-id="${id}"]`).getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  }, personId);

test.describe("family tree canvas", () => {
  test.beforeEach(async ({ seeded, page }) => {
    await seeded();
    await openEstate(page);
  });

  test("opens a person card when a card is clicked", async ({ page }) => {
    await page.locator(`[data-person-id="${PEOPLE.gorg}"]`).click();

    await expect(page.locator(".context-dashboard")).toBeVisible();
    await expect(page.locator(".context-dashboard")).toContainText("Ġorġ Borg");
  });

  test("pans by dragging from a person card without opening it", async ({ page }) => {
    await page.locator(".tree-navigation-tools").waitFor();
    const before = await chartState(page);
    test.skip(before.maxLeft < 120, "this viewport does not overflow horizontally");

    const start = await cardCentre(page, PEOPLE.pawlu);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 120, start.y, { steps: 12 });
    await page.mouse.up();

    const after = await chartState(page);
    // The drag scrolls the chart, and the card underneath is not selected.
    expect(after.left).toBeGreaterThan(before.left);
    await expect(page.locator(".context-dashboard")).toHaveCount(0);
  });

  test("holds its position while a selected person is edited", async ({ page }) => {
    await page.locator(`[data-person-id="${PEOPLE.gorg}"]`).click();
    await page.getByRole("button", { name: "Edit identity" }).click();

    await page.evaluate(() => {
      const chart = document.querySelector(".family-chart");
      chart.scrollLeft = 0;
      chart.scrollTop = 0;
    });
    const before = await chartState(page);

    // Every keystroke rebuilds the people array; the view must not jump back.
    await page.getByLabel("Name", { exact: true }).first().press("x");
    await page.waitForTimeout(600);

    expect(await chartState(page)).toEqual(before);
  });

  test("fits the whole tree into view", async ({ page }) => {
    await page.getByRole("button", { name: /Fit tree/ }).click();
    await page.waitForTimeout(800);

    const zoom = await page.evaluate(() =>
      Number(document.querySelector(".tree-stage").style.getPropertyValue("--tree-zoom")),
    );
    expect(zoom).toBeGreaterThan(0.15);
    expect(zoom).toBeLessThanOrEqual(1.4);
  });

  test("finds a person and highlights them on the tree", async ({ page }) => {
    await page.locator(".person-finder > summary").click();
    await page.locator(".person-finder").getByText("Marija Borg").first().click();

    await expect(page.locator(`[data-person-id="${PEOPLE.marija}"]`)).toHaveClass(/selected/);
  });

  test("names its controls in plain sight rather than hiding them", async ({ page }) => {
    const cardDetails = page.locator(".person-card-display-control");
    await expect(cardDetails.locator("summary")).toContainText("Person card details");
    await expect(page.locator(".fraction-launcher")).toContainText("Fractions");
    await expect(page.locator(".tree-tools-panel")).toHaveCount(0);

    await cardDetails.locator("summary").click();
    await expect(cardDetails.locator(".person-card-display-menu")).toContainText(
      "Current holding value",
    );
  });

  test("prints the family name once in normal and A3 tree output", async ({ page }) => {
    const printTitle = page.locator(".family-chart-print-title");
    await expect(printTitle).toHaveText("Borg Fictional Estate");
    await expect(printTitle).toBeHidden();

    await page.emulateMedia({ media: "print" });
    await expect(printTitle).toBeVisible();
    await page.emulateMedia({ media: "screen" });

    await page.getByRole("button", { name: "Print preview" }).click();
    const preview = page.locator("iframe.a3-preview-frame").contentFrame();
    await expect(preview.locator(".a3-page-header strong")).toHaveCount(1);
    await expect(preview.locator(".a3-page-header strong")).toHaveText("Borg Fictional Estate");
    await expect(preview.locator(".a3-print-tree .family-chart-print-title")).toBeHidden();
  });
});
