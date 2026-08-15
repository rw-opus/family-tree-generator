import { test, expect, openEstate, openPropertyWorkspace } from "./fixtures.js";

const horizontalOverflow = (page, selector) =>
  page.evaluate((target) => {
    const element = document.querySelector(target);
    return element.scrollWidth - element.clientWidth;
  }, selector);

test.describe("phone layout", () => {
  test.beforeEach(async ({ seeded, page }) => {
    await seeded();
    await openEstate(page);
  });

  test("fits the property workspace without sideways scrolling", async ({ page }) => {
    await openPropertyWorkspace(page);

    expect(await horizontalOverflow(page, ".property-workspace-page")).toBeLessThanOrEqual(0);
    expect(await page.evaluate(() => document.body.scrollWidth - document.body.clientWidth)).toBe(
      0,
    );
  });

  test("keeps the section menu reachable while the page scrolls", async ({ page }) => {
    await openPropertyWorkspace(page);
    await page.evaluate(() => {
      document.querySelector(".property-workspace-page").scrollTop = 600;
    });

    const shell = page.locator(".property-workspace-nav-shell");
    await expect(shell).toBeVisible();
    const top = await shell.evaluate((element) => Math.round(element.getBoundingClientRect().top));
    expect(top).toBeLessThanOrEqual(1);
  });

  test("clears the sticky menu when jumping to a section", async ({ page }) => {
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
    expect(clearance).toBeGreaterThanOrEqual(0);
  });

  test("pans the tree with one finger", async ({ page }) => {
    const before = await page.evaluate(() =>
      Math.round(document.querySelector(".family-chart").scrollLeft),
    );
    const box = await page.locator(".family-chart").boundingBox();

    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.evaluate(
      ({ x, y }) => {
        const surface = document.querySelector(".tree-panel");
        const touch = (type, clientX, clientY) => {
          const point = new Touch({ identifier: 1, target: surface, clientX, clientY });
          return new TouchEvent(type, {
            touches: type === "touchend" ? [] : [point],
            targetTouches: type === "touchend" ? [] : [point],
            changedTouches: [point],
            bubbles: true,
            cancelable: true,
          });
        };
        surface.dispatchEvent(touch("touchstart", x, y));
        for (let step = 1; step <= 10; step += 1) {
          surface.dispatchEvent(touch("touchmove", x - step * 12, y));
        }
        surface.dispatchEvent(touch("touchend", x - 120, y));
      },
      { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) },
    );

    const after = await page.evaluate(() =>
      Math.round(document.querySelector(".family-chart").scrollLeft),
    );
    expect(after).toBeGreaterThan(before);
  });

  test("opens the outside owner card as a full-height sheet", async ({ page }) => {
    await openPropertyWorkspace(page);
    await page.locator(".outside-owner-link").first().click();

    const sheet = page.locator(".outside-owner-sheet");
    await expect(sheet).toBeVisible();
    const covers = await sheet.evaluate(
      (element) => element.getBoundingClientRect().width >= window.innerWidth - 2,
    );
    expect(covers).toBe(true);
  });

  test("keeps the mini-map clear of the fraction launcher", async ({ page }) => {
    const overlapping = await page.evaluate(() => {
      const map = document.querySelector(".tree-mini-map")?.getBoundingClientRect();
      const launcher = document.querySelector(".fraction-launcher")?.getBoundingClientRect();
      if (!map || !launcher) return false;
      return (
        map.left < launcher.right &&
        launcher.left < map.right &&
        map.top < launcher.bottom &&
        launcher.top < map.bottom
      );
    });
    expect(overlapping).toBe(false);
  });

  test("keeps Person card details labelled below the toolbar and clear of Fit tree", async ({
    page,
  }) => {
    const launcher = page.locator(".person-card-display-control summary");
    await expect(launcher).toContainText("Person card details");

    const layout = await page.evaluate(() => {
      const panel = document
        .querySelector(".person-card-display-control summary")
        .getBoundingClientRect();
      const toolbar = document.querySelector(".tree-stage-toolbar").getBoundingClientRect();
      const fitTree = document
        .querySelector('.tree-navigation-tools button[title="Fit the whole tree in view"]')
        .getBoundingClientRect();
      const label = document.querySelector(".person-card-display-control summary span");
      const overlaps = (first, second) =>
        first.left < second.right &&
        second.left < first.right &&
        first.top < second.bottom &&
        second.top < first.bottom;

      return {
        belowToolbar: panel.top >= toolbar.bottom,
        overlapsFitTree: overlaps(panel, fitTree),
        insideViewport: panel.left >= 0 && panel.right <= window.innerWidth,
        toolbarInsideViewport: toolbar.left >= 0 && toolbar.right <= window.innerWidth,
        labelVisible: getComputedStyle(label).display !== "none",
      };
    });

    expect(layout).toEqual({
      belowToolbar: true,
      overlapsFitTree: false,
      insideViewport: true,
      toolbarInsideViewport: true,
      labelVisible: true,
    });
  });
});
