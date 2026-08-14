import { test as base, expect } from "@playwright/test";

export const WORKSPACE_KEY = "family-tree-generator:workspace:v1";
export const TERMS_KEY = "family-tree-terms-accepted-2026-08-04-family-tax-v1";

const id = (suffix) => `e2e00000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

export const PEOPLE = { gorg: id(1), marija: id(2), pawlu: id(3) };
export const PARTIES = { vella: id(11), zammit: id(12) };
export const PROPERTY_ID = id(21);
export const CASE_ID = id(31);
const GROUP_ID = `${CASE_ID}:family-group:1`;

const person = (personId, givenNames, surname, sex, extra = {}) => ({
  id: personId,
  givenNames,
  surname,
  fullName: `${givenNames} ${surname}`,
  surnameAtBirth: sex === "Male" ? surname : "",
  designations: [],
  sex,
  fatherId: "",
  motherId: "",
  spouseIds: [],
  siblingIds: [],
  dateOfBirth: "",
  dateOfDeath: "",
  unmarriedOrWidowedAtDeath: false,
  wills: [],
  notes: "",
  ...extra,
});

/**
 * A fixed, entirely fictional Maltese-style estate. The figures asserted in
 * tax.spec.js are derived from this fixture, so changing it changes them.
 *
 * Ġorġ holds 1/2 acquired 1990 (pre-2004, so 10%); Vella Holdings Ltd holds
 * 1/2 acquired 2010 (8%). The property sells for €400,000.
 */
export const estate = () => ({
  id: CASE_ID,
  schemaVersion: 2,
  createdAt: "2026-01-02T09:00:00.000Z",
  title: "Borg Fictional Estate",
  people: [
    person(PEOPLE.gorg, "Ġorġ", "Borg", "Male", { dateOfBirth: "1950-03-04" }),
    person(PEOPLE.marija, "Marija", "Borg", "Female", {
      dateOfBirth: "1953-07-11",
      spouseIds: [PEOPLE.gorg],
    }),
    person(PEOPLE.pawlu, "Pawlu", "Borg", "Male", {
      dateOfBirth: "1980-09-21",
      fatherId: PEOPLE.gorg,
      motherId: PEOPLE.marija,
    }),
  ],
  familyGroups: [
    {
      id: GROUP_ID,
      title: "Borg Fictional Estate",
      rootPersonId: PEOPLE.gorg,
      personIds: [PEOPLE.gorg, PEOPLE.marija, PEOPLE.pawlu],
    },
  ],
  activeFamilyGroupId: GROUP_ID,
  outsideParties: [
    {
      id: PARTIES.vella,
      type: "company",
      name: "Vella Holdings Ltd",
      registrationNumber: "C-0000",
    },
    { id: PARTIES.zammit, type: "individual", name: "Rita Zammit" },
  ],
  properties: [
    {
      id: PROPERTY_ID,
      address: "12, Triq il-Kbira, Fictionville",
      description: "",
      marketValue: "",
      saleValue: "400000",
      owners: [
        {
          id: id(41),
          personId: PEOPLE.gorg,
          shareNumerator: 1,
          shareDenominator: 2,
          sharePercent: 50,
          acquisitionDate: "1990-05-01",
        },
        {
          id: id(42),
          personId: PARTIES.vella,
          shareNumerator: 1,
          shareDenominator: 2,
          sharePercent: 50,
          acquisitionDate: "2010-05-01",
        },
      ],
      declarations: [],
      transfers: [],
      saleLots: [],
    },
  ],
  settings: {
    shareDisplay: "both",
    showOwnershipOnTree: true,
    treeZoom: 100,
    activePropertyId: PROPERTY_ID,
  },
});

export const workspace = (tree = estate()) => ({
  version: 1,
  activeTreeId: tree.id,
  trees: [tree],
});

export const test = base.extend({
  // Fails the test on any console error, so a silent runtime break in one flow
  // cannot pass merely because the assertions happened to look elsewhere.
  consoleErrors: [
    async ({ page }, use) => {
      const errors = [];
      page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(`console: ${message.text()}`);
      });
      await use(errors);
      expect(errors, "the page logged errors").toEqual([]);
    },
    { auto: true },
  ],

  /** Accepts the terms gate and, unless told otherwise, seeds the estate. */
  seeded: async ({ page }, use) => {
    const seed = async (tree = estate()) => {
      await page.addInitScript(
        ([key, terms, value]) => {
          window.localStorage.setItem(terms, "yes");
          // Init scripts run on every navigation, so seeding unconditionally
          // would restore the fixture on reload and erase whatever the test
          // just did. Seed only when the workspace is genuinely empty.
          if (value && !window.localStorage.getItem(key)) {
            window.localStorage.setItem(key, JSON.stringify(value));
          }
        },
        [WORKSPACE_KEY, TERMS_KEY, tree ? workspace(tree) : null],
      );
    };
    await use(seed);
  },
});

/** Opens the seeded family from the library and waits for the tree. */
export async function openEstate(page) {
  await page.goto("/");
  await page.locator("button.family-name-button").first().click();
  await expect(page.locator(".tree-stage")).toBeVisible();
}

/** Opens the Property & Tax workspace from the tree screen. */
export async function openPropertyWorkspace(page) {
  await page.getByRole("button", { name: "Property & Tax" }).click();
  await expect(page.locator(".property-workspace-page")).toBeVisible();
}

export { expect };
