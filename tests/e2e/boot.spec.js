import { test, expect, openEstate } from "./fixtures.js";

test.describe("boot", () => {
  test("gates on the terms notice and remembers acceptance", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("BEFORE YOU CONTINUE")).toBeVisible();
    const accept = page.getByRole("button", { name: "Accept and continue" });
    // The gate must not be dismissible without the explicit agreement tick.
    await expect(accept).toBeDisabled();

    await page.locator('input[type="checkbox"]').first().check();
    await expect(accept).toBeEnabled();
    await accept.click();

    await expect(page.getByText("BEFORE YOU CONTINUE")).toBeHidden();
    await page.reload();
    await expect(page.getByText("BEFORE YOU CONTINUE")).toBeHidden();
  });

  test("loads the workspace without a console error", async ({ seeded, page }) => {
    await seeded();
    await openEstate(page);

    await expect(page.getByLabel("Edit tree name: Borg Fictional Estate")).toBeVisible();
    await expect(page.locator("[data-person-id]")).toHaveCount(3);
  });

  test("keeps the application mounted rather than showing a blank page", async ({
    seeded,
    page,
  }) => {
    await seeded();
    await page.goto("/");

    // The error boundary required by the governance brief renders in place of a
    // white screen; neither it nor a blank root is acceptable on a clean load.
    await expect(page.locator("#root")).not.toBeEmpty();
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
  });
});
