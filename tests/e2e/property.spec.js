import { test, expect, openEstate, openPropertyWorkspace, estate } from "./fixtures.js";

test.describe("Property & Tax workspace", () => {
  test.beforeEach(async ({ seeded, page }) => {
    await seeded();
    await openEstate(page);
  });

  test("shows setup, ownership and tax on one surface", async ({ page }) => {
    await openPropertyWorkspace(page);

    await expect(page.locator("#property-workspace-setup")).toBeVisible();
    await expect(page.locator("#property-workspace-ownership")).toBeVisible();
    await expect(page.locator("#property-workspace-tax")).toBeVisible();
    await expect(page.getByLabel("Address")).toHaveValue("12, Triq il-Kbira, Fictionville");
  });

  test("uses the Billing Calculator tab palette and typography", async ({ page }) => {
    await openPropertyWorkspace(page);

    const styles = await page.evaluate(async () => {
      await document.fonts.ready;
      const active = getComputedStyle(
        document.querySelector(".property-workspace-menu button.active"),
      );
      const inactive = getComputedStyle(
        document.querySelector(".property-workspace-menu button:not(.active)"),
      );
      return {
        activeBackground: active.backgroundColor,
        activeColor: active.color,
        inactiveBorder: inactive.borderColor,
        inactiveColor: inactive.color,
        fontFamily: inactive.fontFamily,
        fontSize: inactive.fontSize,
        fontWeight: inactive.fontWeight,
      };
    });

    expect(styles).toEqual({
      activeBackground: "rgb(0, 66, 37)",
      activeColor: "rgb(255, 255, 255)",
      inactiveBorder: "rgb(227, 224, 214)",
      inactiveColor: "rgb(15, 27, 45)",
      fontFamily: expect.stringContaining("Tracker Inter"),
      fontSize: "14px",
      fontWeight: "600",
    });
  });

  test("calculates current title from the initial shares", async ({ page }) => {
    await openPropertyWorkspace(page);

    const ownership = page.locator("#property-workspace-ownership");
    await expect(ownership).toContainText("Ġorġ Borg");
    await expect(ownership).toContainText("Vella Holdings Ltd");
    await expect(ownership.locator(".ledger-total")).toContainText("100%");
  });

  test("traces succession and opens the printable history from ownership", async ({ page }) => {
    await openPropertyWorkspace(page);

    const ownership = page.locator("#property-workspace-ownership");
    const trace = ownership.locator(".succession-trace-control");
    await expect(trace).toContainText("Trace succession");
    await trace.getByRole("button", { name: "Start" }).click();
    await expect(trace.locator(".succession-trace-counter")).toContainText(/1 of \d+/);

    await trace.getByRole("button", { name: "View full history" }).click();
    await expect(page.locator(".succession-history-dialog")).toBeVisible();
  });

  test("scrolls a chosen section clear of the sticky menu", async ({ page }) => {
    await openPropertyWorkspace(page);
    await page.getByRole("button", { name: "Tax Calculation" }).first().click();
    await page.waitForTimeout(1200);

    const clearance = await page.evaluate(() => {
      const navBottom = document
        .querySelector(".property-workspace-nav-shell")
        .getBoundingClientRect().bottom;
      const target = document.querySelector("#property-workspace-tax").getBoundingClientRect().top;
      return Math.round(target - navBottom);
    });

    // A fixed rem offset used to leave up to 50px of the section behind the menu.
    expect(clearance).toBeGreaterThanOrEqual(0);
  });

  test("returns to the tree and back again", async ({ page }) => {
    await openPropertyWorkspace(page);
    await page.getByRole("button", { name: "Back to Tree" }).click();

    await expect(page.locator(".tree-stage")).toBeVisible();
    await expect(page.locator(".property-workspace-page")).toHaveCount(0);

    await openPropertyWorkspace(page);
    await expect(page.locator("#property-workspace-setup")).toBeVisible();
  });

  test("assigns an initial owner by picking from the tree", async ({ page }) => {
    await openPropertyWorkspace(page);
    await page.locator("button.initial-owner-tree-pick-button").first().click();

    // The picker takes over the tree screen until a person is chosen.
    await expect(page.locator(".initial-owner-tree-picker")).toBeVisible();
    await page
      .getByRole("button", { name: /Marija/ })
      .first()
      .click();

    await expect(page.locator(".property-workspace-page")).toBeVisible();
    const owners = page.locator(".initial-owner-row select");
    await expect(owners.first()).toHaveValue(
      await page.evaluate(() => {
        const option = [...document.querySelectorAll(".initial-owner-row option")].find((entry) =>
          entry.textContent.includes("Marija"),
        );
        return option.value;
      }),
    );
  });

  test("cancels an initial-owner pick and restores the workspace", async ({ page }) => {
    await openPropertyWorkspace(page);
    await page.locator("button.initial-owner-tree-pick-button").first().click();
    await page.getByRole("button", { name: /Cancel selecting an initial owner/ }).click();

    await expect(page.locator(".property-workspace-page")).toBeVisible();
    await expect(page.locator(".initial-owner-tree-picker")).toHaveCount(0);
  });

  test("adds an outside company as an owner", async ({ page }) => {
    await openPropertyWorkspace(page);
    await page.getByRole("button", { name: "Add outside owner" }).click();
    await page.getByLabel("Outside owner type").selectOption("company");
    await page.getByLabel("Outside owner name").fill("Caruana Estates Ltd");
    await page.getByRole("button", { name: "Add owner" }).click();

    await expect(page.locator("#property-workspace-setup")).toContainText("Caruana Estates Ltd");
  });
});

// Seeded with a different fixture, so it stays outside the block above: the
// workspace is seeded once per browser context and is not replaced mid-test.
test.describe("incomplete initial ownership", () => {
  test("blocks the calculation until the shares total 100%", async ({ seeded, page }) => {
    const incomplete = estate();
    incomplete.properties[0].owners = [incomplete.properties[0].owners[0]];
    await seeded(incomplete);
    await openEstate(page);
    await openPropertyWorkspace(page);

    await expect(page.locator(".ownership-blocking-notice")).toBeVisible();
    await expect(page.locator("#property-workspace-tax")).toContainText(
      "Complete the initial ownership above to calculate tax",
    );
  });
});
