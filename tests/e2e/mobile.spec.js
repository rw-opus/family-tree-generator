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

  for (const width of [320, 393, 430]) {
    test(`keeps the ownership editor and current values compact at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openPropertyWorkspace(page);

      const layout = await page.evaluate(() => {
        const within = (inner, outer) =>
          inner.left >= outer.left - 1 && inner.right <= outer.right + 1;
        const ownerRows = [...document.querySelectorAll(".initial-owner-row")];
        const actionContainer = document.querySelector(".initial-owner-actions");
        const actions = [...actionContainer.querySelectorAll(":scope > button")];
        const actionRects = actions.map((button) => button.getBoundingClientRect());
        const currentRows = [...document.querySelectorAll(".read-only-owner-row")];
        const firstCurrentRow = currentRows[0];
        const name = firstCurrentRow.querySelector(
          ".owner-identity .ownership-person-link, .owner-identity > strong",
        );
        const shareParts = [
          ...firstCurrentRow.querySelectorAll(".owner-share > strong, .owner-share > small"),
        ];

        return {
          editorRowsFit: ownerRows.every((row) => {
            const rowRect = row.getBoundingClientRect();
            return (
              row.scrollWidth <= row.clientWidth + 1 &&
              [...row.children].every((child) => within(child.getBoundingClientRect(), rowRect))
            );
          }),
          fieldFonts: [
            ...document.querySelectorAll(".initial-owner-row select, .initial-owner-row input"),
          ].map((field) => getComputedStyle(field).fontSize),
          actionCount: actions.length,
          actionsShareRow:
            actionRects.length > 0 &&
            actionRects.every((rect) => Math.abs(rect.top - actionRects[0].top) <= 1),
          actionsFit:
            actionContainer.scrollWidth <= actionContainer.clientWidth + 1 &&
            actionRects.every((rect) => within(rect, actionContainer.getBoundingClientRect())),
          actionFonts: actions.map((button) => getComputedStyle(button).fontSize),
          currentRowsFit: currentRows.every((row) => row.scrollWidth <= row.clientWidth + 1),
          currentValues: currentRows.map(
            (row) => row.querySelector(".owner-value")?.textContent.trim() || "",
          ),
          nameFont: getComputedStyle(name).fontSize,
          shareFonts: shareParts.map((part) => getComputedStyle(part).fontSize),
        };
      });

      expect(layout.editorRowsFit).toBe(true);
      expect(new Set(layout.fieldFonts)).toEqual(new Set(["11px"]));
      expect(layout.actionCount).toBe(3);
      expect(layout.actionsShareRow).toBe(true);
      expect(layout.actionsFit).toBe(true);
      expect(new Set(layout.actionFonts)).toEqual(new Set(["11px"]));
      expect(layout.currentRowsFit).toBe(true);
      expect(layout.currentValues).toEqual([
        "Current value €200,000.00",
        "Current value €200,000.00",
      ]);
      expect(new Set(layout.shareFonts)).toEqual(new Set([layout.nameFont]));

      const firstOwner = page
        .locator('.initial-owner-row select[aria-label="Initial owner"]')
        .first();
      await firstOwner.focus();
      expect(await firstOwner.evaluate((field) => getComputedStyle(field).fontSize)).toBe("16px");
    });
  }

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
