import { beforeEach, describe, expect, it, vi } from "vitest";

const normalisationHarness = vi.hoisted(() => ({
  maritalStatus: vi.fn(),
}));

vi.mock("../../src/domain/maritalStatusAtDeath.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    synchroniseMaritalStatusAtDeath: (...args) => {
      normalisationHarness.maritalStatus(...args);
      return actual.synchroniseMaritalStatusAtDeath(...args);
    },
  };
});

import { normalizeCase, reconcileNormalisedPeopleUpdate } from "../../src/domain/caseModel.js";

describe("live Person update normalisation boundary", () => {
  beforeEach(() => normalisationHarness.maritalStatus.mockClear());

  it("canonicalises once while preserving membership and deletion tombstones", () => {
    const canonical = normalizeCase({
      id: "case",
      title: "Family",
      settings: { workspaceMode: "property-tax" },
      people: [{ id: "root", givenNames: "Existing", surname: "Person" }],
      familyGroups: [
        {
          id: "family",
          title: "Family",
          rootPersonId: "root",
          personIds: ["root"],
          excludedPersonIds: ["deleted-person"],
        },
      ],
      activeFamilyGroupId: "family",
      properties: [{ id: "property", owners: [], transfers: [] }],
    });
    normalisationHarness.maritalStatus.mockClear();

    const result = reconcileNormalisedPeopleUpdate(canonical, "family", [
      {
        ...canonical.people[0],
        givenNames: "edited",
        fatherId: "new-parent",
        willHeirs: [{ personId: "new-parent", shareNumerator: 1, shareDenominator: 1 }],
      },
      { id: "new-parent", givenNames: "new", surname: "parent" },
      { id: "deleted-person", givenNames: "Stale", surname: "Editor" },
    ]);

    expect(normalisationHarness.maritalStatus).toHaveBeenCalledTimes(1);
    expect(result.schemaVersion).toBe(2);
    expect(result.people.map((person) => person.id)).toEqual(["root", "new-parent"]);
    expect(result.people[0].willHeirs[0].id).toBe("root:will-heir:1");
    expect(result.familyGroups[0]).toMatchObject({
      personIds: ["root", "new-parent"],
      excludedPersonIds: ["deleted-person"],
    });
  });
});
