import {
  test,
  expect,
  openEstate,
  openPropertyWorkspace,
  estate,
  WORKSPACE_KEY,
  PEOPLE,
} from "./fixtures.js";

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

  test("retains exact initial ownership when the page reloads during an active edit", async ({
    page,
  }) => {
    await openPropertyWorkspace(page);
    const percentages = page.locator('input[aria-label="Initial ownership percentage"]');
    await percentages.nth(0).fill("60");
    await percentages.nth(1).fill("40");

    // Reload without blurring or waiting for the normal cloud-style debounce.
    await page.reload();
    await page.locator("button.family-name-button").first().click();
    await openPropertyWorkspace(page);

    await expect(
      page.locator('input[aria-label="Initial ownership percentage"]').nth(0),
    ).toHaveValue("60");
    await expect(
      page.locator('input[aria-label="Initial ownership percentage"]').nth(1),
    ).toHaveValue("40");
    const owners = await page.evaluate((key) => {
      const workspace = JSON.parse(localStorage.getItem(key));
      return workspace.trees[0].properties[0].owners;
    }, WORKSPACE_KEY);
    expect(owners).toEqual([
      expect.objectContaining({
        personId: expect.any(String),
        shareNumerator: 3,
        shareDenominator: 5,
        acquisitionDate: "1990-05-01",
      }),
      expect.objectContaining({
        personId: expect.any(String),
        shareNumerator: 2,
        shareDenominator: 5,
        acquisitionDate: "2010-05-01",
      }),
    ]);
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

  test("guides person-card tax setup and preserves Skip for now across reload", async ({
    page,
  }) => {
    await page.locator(`[data-person-id="${PEOPLE.pawlu}"]`).click();
    await page.getByRole("button", { name: "Edit identity" }).click();
    await page.getByLabel("Surname", { exact: true }).fill("");
    await page.getByLabel("Surname", { exact: true }).press("Tab");
    await page.getByRole("button", { name: "Back to Tree" }).click();
    await openPropertyWorkspace(page);
    const launcher = page.locator(".tax-readiness-launcher");
    await expect(launcher).toContainText("2 people need information");

    await launcher.getByRole("button", { name: "Start guided tax setup" }).click();
    const guide = page.locator(".tax-readiness-guide-bar");
    await expect(guide).toContainText("Marija Borg");
    await expect(guide).toContainText("Enter this woman's surname at birth");
    await guide.getByRole("button", { name: "Skip for now" }).click();
    await expect(guide).toContainText("Pawlu");
    await guide.getByRole("button", { name: "Skip for now" }).click();

    await expect(page.locator(".property-workspace-page")).toBeVisible();
    await expect(page.locator(".tax-readiness-launcher")).toContainText("2 skipped for now");
    await page.reload();
    await page.locator("button.family-name-button").first().click();
    await openPropertyWorkspace(page);
    await expect(page.locator(".tax-readiness-launcher")).toContainText("2 skipped for now");

    await page.getByRole("button", { name: "Resume guided tax setup" }).click();
    await expect(guide).toContainText("Marija Borg");
    await expect(guide).toContainText("Person 1 of 2");
    await expect(guide.getByRole("button", { name: "Previous" })).toBeDisabled();
    await guide.getByRole("button", { name: "Go to section" }).click();
    const surnameAtBirth = page.getByLabel("Surname at birth");
    await expect(surnameAtBirth).toBeEnabled();
    await expect(surnameAtBirth).toBeFocused();
    const visibleClearance = await page.evaluate(() => {
      const guideBottom = document
        .querySelector(".tax-readiness-guide-bar")
        .getBoundingClientRect().bottom;
      const fieldTop = document
        .querySelector('[data-person-field="surname-at-birth"]')
        .getBoundingClientRect().top;
      return fieldTop - guideBottom;
    });
    expect(visibleClearance).toBeGreaterThanOrEqual(0);
    await surnameAtBirth.fill("Borg");
    await surnameAtBirth.press("Tab");
    await expect(guide.getByRole("button", { name: /Next card/ })).toBeVisible();
    await guide.getByRole("button", { name: /Next card/ }).click();
    await expect(guide).toContainText("Pawlu");
    await expect(guide).toContainText("Person 2 of 2");
    await guide.getByRole("button", { name: "Go to section" }).click();
    const surname = page.getByLabel("Surname", { exact: true });
    await expect(surname).toBeFocused();
    await surname.fill("Camilleri");
    await expect(surname).toHaveValue("Camilleri");
    await expect(surname).toBeFocused();
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

test.describe("percentage reconciliation", () => {
  test("shows exact thirds to two decimals while the visible group totals 100%", async ({
    seeded,
    page,
  }) => {
    const thirds = estate();
    thirds.properties[0].owners = thirds.people.map((person, index) => ({
      id: `third-owner-${index}`,
      personId: person.id,
      shareNumerator: 1,
      shareDenominator: 3,
      sharePercent: 100 / 3,
      acquisitionDate: "2010-05-01",
    }));
    await seeded(thirds);
    await openEstate(page);
    await openPropertyWorkspace(page);

    const inputs = page.locator('input[aria-label="Initial ownership percentage"]');
    await expect(inputs).toHaveCount(3);
    await expect(inputs.nth(0)).toHaveValue("33.34");
    await expect(inputs.nth(1)).toHaveValue("33.33");
    await expect(inputs.nth(2)).toHaveValue("33.33");

    const currentLabels = await page
      .locator(".read-only-owner-row .owner-share > small:first-of-type")
      .allTextContents();
    expect(currentLabels).toEqual(["33.34%", "33.33%", "33.33%"]);
    expect(currentLabels.reduce((total, label) => total + Number.parseFloat(label), 0)).toBe(100);
  });
});
