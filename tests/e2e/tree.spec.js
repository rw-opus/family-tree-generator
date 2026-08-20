import { test, expect, openEstate, estate, workspace, PEOPLE, WORKSPACE_KEY } from "./fixtures.js";

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

  test("persists buffered will fields and percentage when immediately returning to the tree", async ({
    page,
  }) => {
    const tree = estate();
    const subject = tree.people.find((person) => person.id === PEOPLE.gorg);
    Object.assign(subject, {
      isDeceased: true,
      dateOfDeath: "2020-01-01",
      inheritanceBasis: "will",
      designations: ["Deceased"],
      wills: [{ id: "will-buffered", date: "2019-01-01", notaryName: "", description: "" }],
      willHeirs: [
        {
          id: "heir-buffered",
          personId: PEOPLE.pawlu,
          shareNumerator: 1,
          shareDenominator: 1,
          sharePercent: 100,
        },
      ],
    });
    await page.addInitScript(
      ([key, value]) => {
        if (window.sessionStorage.getItem("buffered-will-seeded") === "yes") return;
        window.localStorage.setItem(key, JSON.stringify(value));
        window.sessionStorage.setItem("buffered-will-seeded", "yes");
      },
      [WORKSPACE_KEY, workspace(tree)],
    );
    await openEstate(page);
    await page.locator(`[data-person-id="${PEOPLE.gorg}"]`).click();

    await page.getByLabel("Notary for will 1").fill("Notary Vella");
    await page.getByLabel("Description for will 1").fill("UK historic will");
    await page.getByLabel("Will share percentage").fill("33.335");
    await page.getByRole("button", { name: "Back to Tree" }).click();

    await expect
      .poll(() =>
        page.evaluate(
          ([key, personId]) => {
            const savedWorkspace = JSON.parse(window.localStorage.getItem(key) || "{}");
            return savedWorkspace.trees?.[0]?.people?.find((person) => person.id === personId);
          },
          [WORKSPACE_KEY, PEOPLE.gorg],
        ),
      )
      .toMatchObject({
        wills: [
          expect.objectContaining({
            notaryName: "Notary Vella",
            description: "UK historic will",
          }),
        ],
        willHeirs: [
          expect.objectContaining({
            shareNumerator: 6667,
            shareDenominator: 20000,
            sharePercent: 33.335,
          }),
        ],
      });

    await page.reload();
    await openEstate(page);
    await page.locator(`[data-person-id="${PEOPLE.gorg}"]`).click();
    await expect(page.getByLabel("Notary for will 1")).toHaveValue("Notary Vella");
    await expect(page.getByLabel("Description for will 1")).toHaveValue("UK historic will");
    await expect(page.getByLabel("Will share percentage")).toHaveValue("33.34");
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

  test("keeps a deleted parent removed when another relative is added", async ({ page }) => {
    await page.locator(`[data-person-id="${PEOPLE.marija}"]`).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete person" }).click();

    await expect(page.locator(`[data-person-id="${PEOPLE.marija}"]`)).toHaveCount(0);

    await page.locator(`[data-person-id="${PEOPLE.gorg}"]`).click();
    await page.getByTitle("Add father").click();

    await expect(page.locator("[data-person-id]")).toHaveCount(3);
    await expect(page.locator(`[data-person-id="${PEOPLE.marija}"]`)).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          ([key, personId]) => {
            const savedWorkspace = JSON.parse(window.localStorage.getItem(key) || "{}");
            const savedTree = savedWorkspace.trees?.[0];
            return {
              inPeople: savedTree?.people?.some((person) => person.id === personId) ?? true,
              inFamily:
                savedTree?.familyGroups?.some((group) => group.personIds?.includes(personId)) ??
                true,
            };
          },
          [WORKSPACE_KEY, PEOPLE.marija],
        ),
      )
      .toEqual({ inPeople: false, inFamily: false });

    await page.reload();
    await openEstate(page);
    await expect(page.locator(`[data-person-id="${PEOPLE.marija}"]`)).toHaveCount(0);
    await expect(page.locator("[data-person-id]")).toHaveCount(3);
  });

  test("keeps Done beside Delete and permits tree removal with retained legal records", async ({
    page,
  }) => {
    await page.locator(`[data-person-id="${PEOPLE.gorg}"]`).click();
    await page.getByRole("button", { name: "Edit identity" }).click();

    const profile = page.locator(".inspector-profile");
    const deleteButton = page.locator('[data-person-action="delete"]');
    const doneButton = page.locator('[data-person-action="done-editing"]');
    await expect(profile.getByRole("button", { name: "Done" })).toHaveCount(0);
    await expect(deleteButton).toBeEnabled();
    await expect(doneButton).toBeVisible();
    await expect(page.getByText("Switch to Property, succession & tax")).toHaveCount(0);

    const [profileBox, deleteBox, doneBox] = await Promise.all([
      profile.boundingBox(),
      deleteButton.boundingBox(),
      doneButton.boundingBox(),
    ]);
    expect(doneBox.x).toBeGreaterThanOrEqual(deleteBox.x + deleteBox.width);
    expect(Math.abs(doneBox.y - deleteBox.y)).toBeLessThan(2);
    expect(doneBox.y).toBeGreaterThan(profileBox.y + profileBox.height);

    page.once("dialog", (dialog) => dialog.accept());
    await deleteButton.click();

    await expect(page.locator(`[data-person-id="${PEOPLE.gorg}"]`)).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          ([key, personId]) => {
            const savedWorkspace = JSON.parse(window.localStorage.getItem(key) || "{}");
            const savedTree = savedWorkspace.trees?.[0];
            return {
              identityRetained:
                savedTree?.people?.some((person) => person.id === personId) ?? false,
              familyMembership:
                savedTree?.familyGroups?.some((group) => group.personIds?.includes(personId)) ??
                true,
              ownershipRetained:
                savedTree?.properties?.some((property) =>
                  property.owners?.some((owner) => owner.personId === personId),
                ) ?? false,
            };
          },
          [WORKSPACE_KEY, PEOPLE.gorg],
        ),
      )
      .toEqual({
        identityRetained: true,
        familyMembership: false,
        ownershipRetained: true,
      });

    await page.locator(`[data-person-id="${PEOPLE.marija}"]`).click();
    await page.getByLabel("Surname at birth").fill("Camilleri");
    await page.locator('[data-person-action="done-editing"]').click();
    await page.getByTitle("Add child").click();
    await expect(page.getByLabel("Child's other parent")).toHaveValue(PEOPLE.gorg);
    await page.getByRole("button", { name: "Add child", exact: true }).click();

    await expect(page.locator("[data-person-id]")).toHaveCount(3);
    await expect(page.locator(`[data-person-id="${PEOPLE.gorg}"]`)).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          ([key, personId]) => {
            const savedWorkspace = JSON.parse(window.localStorage.getItem(key) || "{}");
            const group = savedWorkspace.trees?.[0]?.familyGroups?.[0];
            return {
              visible: group?.personIds?.includes(personId) ?? true,
              excluded: group?.excludedPersonIds?.includes(personId) ?? false,
            };
          },
          [WORKSPACE_KEY, PEOPLE.gorg],
        ),
      )
      .toEqual({ visible: false, excluded: true });

    await page.locator(".person-finder > summary").click();
    await expect(page.locator(".person-finder-results > button")).toHaveCount(3);

    await page.reload();
    await openEstate(page);
    await expect(page.locator(`[data-person-id="${PEOPLE.gorg}"]`)).toHaveCount(0);
    await expect(page.locator("[data-person-id]")).toHaveCount(3);
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
