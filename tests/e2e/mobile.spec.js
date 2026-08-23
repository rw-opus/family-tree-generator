import { test, expect, openEstate, openTreeTools, openPropertyWorkspace } from "./fixtures.js";

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

  test("uses a labelled Tree Tools menu and labelled family actions on Home", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.getByRole("button", { name: "Back to Home" }).click();

    const trigger = page.getByRole("button", { name: "Tree Tools" });
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();

    const tools = page.locator("#tree-tools-list");
    await expect(tools).toBeVisible();
    await expect(tools.getByRole("button", { name: "Create new family" })).toBeVisible();
    await expect(tools.getByText("Import GEDCOM", { exact: true })).toBeVisible();
    await expect(tools.getByRole("button", { name: "Download workspace backup" })).toBeVisible();
    await expect(tools.getByRole("button", { name: "Trash (0)" })).toBeVisible();

    await trigger.click();
    const row = page.locator(".family-library-row:not(.family-library-table-head)").first();
    await expect(row.getByText("Rename", { exact: true })).toBeVisible();
    await expect(row.getByText("Delete", { exact: true })).toBeVisible();
    expect(await horizontalOverflow(page, ".family-library-page")).toBeLessThanOrEqual(0);
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

  test("keeps every tree utility named inside Tree Tools", async ({ page }) => {
    await openTreeTools(page);
    const menu = page.locator(".tree-view-tools-menu");

    await expect(menu.getByText("Legal workspace", { exact: true })).toBeVisible();
    await expect(menu.getByRole("button", { name: "Property & Tax" })).toBeVisible();
    await expect(menu.getByRole("button", { name: "Tree Register" })).toBeVisible();
    await expect(menu.getByText("Find person", { exact: true })).toBeVisible();
    await expect(menu.getByText("Zoom", { exact: true })).toBeVisible();
    await expect(menu.getByText("Person card details", { exact: true })).toBeVisible();
    await expect(menu.getByRole("button", { name: "Print preview" })).toBeVisible();
    await expect(menu.getByRole("button", { name: "Fit tree" })).toBeVisible();

    const layout = await menu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        insideViewport: rect.left >= 0 && rect.right <= window.innerWidth,
        fitsWidth: element.scrollWidth <= element.clientWidth + 1,
      };
    });
    expect(layout).toEqual({ insideViewport: true, fitsWidth: true });
  });

  test("keeps the Tree Register inside the phone viewport with a horizontally scrollable grid", async ({
    page,
  }) => {
    await openTreeTools(page);
    await page.getByRole("button", { name: "Tree Register" }).click();

    const dialog = page.getByRole("dialog", { name: "Tree Register" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Tree name")).toBeVisible();
    await expect(dialog.getByLabel("Value of property being sold")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Download Excel" })).toBeVisible();

    const layout = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const scroller = element.querySelector(".tree-register-scroll");
      return {
        insideViewport:
          rect.left >= 0 &&
          rect.top >= 0 &&
          rect.right <= window.innerWidth &&
          rect.bottom <= window.innerHeight,
        bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
        gridScrollsInsideDialog: scroller.scrollWidth > scroller.clientWidth,
      };
    });
    expect(layout).toEqual({
      insideViewport: true,
      bodyOverflow: 0,
      gridScrollsInsideDialog: true,
    });
  });

  test("keeps tree controls usable at 320px in legal and family-only modes", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });

    const readToolbarLayout = () =>
      page.evaluate(() => {
        const home = document.querySelector(".tree-stage-toolbar .tree-home-button");
        const title = document.querySelector(".stage-family-title").getBoundingClientRect();
        const tools = document.querySelector(".tree-view-tools > summary");
        const toolbar = document.querySelector(".tree-stage-toolbar");
        return {
          titleWidth: title.width,
          homeText: home.textContent.trim(),
          toolsText: tools.textContent.trim(),
          toolbarFits: toolbar.scrollWidth <= toolbar.clientWidth + 1,
        };
      });

    for (const familyTreeOnly of [false, true]) {
      await openTreeTools(page);
      if (familyTreeOnly) {
        await page.locator(".tree-workspace-mode-control summary").click();
        await page.getByLabel("Family tree only").check();
      }
      const layout = await readToolbarLayout();
      expect(layout.titleWidth).toBeGreaterThanOrEqual(40);
      expect(layout.homeText).toContain("Home");
      expect(layout.toolsText).toContain("Tree Tools");
      expect(layout.toolbarFits).toBe(true);
      await expect(page.locator(".tree-view-tools-menu")).toBeVisible();
    }
  });
});
