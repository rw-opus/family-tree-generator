import { test, expect, openEstate, openPropertyWorkspace, estate } from "./fixtures.js";

/**
 * F3 — hostile-looking text stored as ordinary client data.
 *
 * A Maltese notary will legitimately type quotes, ampersands and angle brackets
 * into a name or a property description. The application must render all of it
 * as text, everywhere, and must never execute any of it. Every payload below is
 * fictional.
 */

const PAYLOADS = {
  script: '<script>window.__xss__ = "person";</script>',
  image: "<img src=x onerror=\"window.__xss__='img'\">",
  svg: "<svg onload=\"window.__xss__='svg'\"></svg>",
  quotes: `O'Brien " & <Sons>`,
  handler: '" onmouseover="window.__xss__=\'handler\'" data-x="',
  entity: "&lt;script&gt;alert(1)&lt;/script&gt;",
  javascriptUrl: "javascript:window.__xss__='url'",
};

/** Nothing under test may ever set this, by any route. */
const executed = (page) => page.evaluate(() => window.__xss__ ?? null);

const hostileEstate = () => {
  const tree = estate();
  tree.title = `Borg ${PAYLOADS.quotes}`;
  tree.people[0].givenNames = PAYLOADS.script;
  tree.people[0].fullName = `${PAYLOADS.script} Borg`;
  tree.people[1].givenNames = PAYLOADS.image;
  tree.people[1].fullName = `${PAYLOADS.image} Borg`;
  tree.people[2].givenNames = PAYLOADS.svg;
  tree.people[2].fullName = `${PAYLOADS.svg} Borg`;
  tree.people[0].notes = PAYLOADS.handler;
  tree.outsideParties[0].name = `${PAYLOADS.image} Holdings Ltd`;
  tree.outsideParties[1].name = PAYLOADS.quotes;
  tree.properties[0].address = `${PAYLOADS.svg} Triq il-Kbira`;
  tree.properties[0].description = PAYLOADS.javascriptUrl;
  return tree;
};

test.describe("stored text is data, never code", () => {
  test.beforeEach(async ({ seeded, page }) => {
    await seeded(hostileEstate());
    await openEstate(page);
  });

  test("renders hostile names on the tree without executing them", async ({ page }) => {
    await expect(page.locator("[data-person-id]")).toHaveCount(3);
    // The angle brackets survive as visible characters rather than as markup.
    await expect(page.locator("[data-person-id]").first()).toContainText("<script>");
    expect(await executed(page)).toBeNull();
    // No element was created from the payload.
    expect(await page.locator("[data-person-id] script").count()).toBe(0);
    expect(await page.locator("[data-person-id] img").count()).toBe(0);
    expect(await page.locator("[data-person-id] svg[onload]").count()).toBe(0);
  });

  test("renders a hostile tree name in the title control", async ({ page }) => {
    await expect(page.getByLabel(/^Edit tree name:/)).toContainText(PAYLOADS.quotes);
    expect(await executed(page)).toBeNull();
  });

  test("renders hostile text in the person card and its notes", async ({ page }) => {
    await page.locator("[data-person-id]").first().click();

    const card = page.locator(".context-dashboard");
    await expect(card).toBeVisible();
    await expect(card).toContainText("<script>");
    expect(await executed(page)).toBeNull();
    expect(await card.locator("script, img, svg[onload]").count()).toBe(0);
  });

  test("renders a hostile address and description in the property workspace", async ({ page }) => {
    await openPropertyWorkspace(page);

    await expect(page.getByLabel("Address")).toHaveValue(/Triq il-Kbira/);
    const setup = page.locator("#property-workspace-setup");
    expect(await setup.locator("script, img, svg[onload]").count()).toBe(0);
    expect(await executed(page)).toBeNull();
  });

  test("renders a hostile outside-owner name in the ownership list", async ({ page }) => {
    await openPropertyWorkspace(page);

    const ownership = page.locator("#property-workspace-ownership");
    await expect(ownership).toContainText("Holdings Ltd");
    expect(await ownership.locator("script, img, svg[onload]").count()).toBe(0);
    expect(await executed(page)).toBeNull();
  });

  test("renders hostile names in the tax calculation", async ({ page }) => {
    await openPropertyWorkspace(page);
    await page.getByRole("button", { name: "Tax Calculation" }).first().click();

    const tax = page.locator("#property-workspace-tax");
    await expect(tax).toBeVisible();
    expect(await tax.locator("script, img, svg[onload]").count()).toBe(0);
    expect(await executed(page)).toBeNull();
  });

  test("renders hostile names in the owner card dialog", async ({ page }) => {
    await openPropertyWorkspace(page);
    await page.locator(".outside-owner-link").first().click();

    const dialog = page.locator(".outside-owner-dialog");
    await expect(dialog).toBeVisible();
    expect(await dialog.locator("script, img, svg[onload]").count()).toBe(0);
    expect(await executed(page)).toBeNull();
  });

  test("renders hostile names in the person finder", async ({ page }) => {
    await page.locator(".person-finder > summary").click();

    const finder = page.locator(".person-finder");
    expect(await finder.locator("script, img, svg[onload]").count()).toBe(0);
    expect(await executed(page)).toBeNull();
  });

  test("carries hostile text through a workspace backup as text", async ({ page }) => {
    await page.getByRole("button", { name: "Back to Home" }).click();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Download workspace backup/ }).click(),
    ]);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();

    // The export is JSON, so the payload round-trips as a string value and the
    // file is never interpreted as markup.
    const parsed = JSON.parse(raw);
    expect(JSON.stringify(parsed)).toContain("script");
    expect(await executed(page)).toBeNull();
  });

  test("survives a hostile payload in a corrupt workspace without executing it", async ({
    page,
  }) => {
    await page.evaluate((payload) => {
      window.localStorage.setItem("family-tree-generator:workspace:v1", `{"trees":[${payload}`);
    }, JSON.stringify(PAYLOADS.script));
    await page.reload();

    await expect(page.locator("#root")).not.toBeEmpty();
    expect(await executed(page)).toBeNull();
  });
});
