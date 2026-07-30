import { describe, expect, it } from "vitest";
import {
  CASE_SCHEMA_VERSION,
  addPersonIdsToFamilyGroup,
  createFamilyGroup,
  findFamilyGroupsForPerson,
  normalizeCase,
  promoteOutsideIndividual,
} from "../../src/domain/caseModel.js";

const legacyCase = () => ({
  id: "case-1",
  title: "Borg succession",
  people: [
    { id: "joseph", fullName: "Joseph Borg" },
    { id: "maria", fullName: "Maria Borg", fatherId: "joseph" },
  ],
  properties: [
    {
      id: "property-1",
      transfers: [{ id: "property-transfer", sellerId: "joseph", buyerId: "buyer" }],
      saleLots: [{ id: "property-lot", ownerId: "buyer" }],
    },
  ],
  transfers: [{ id: "legacy-transfer" }],
  saleLots: [{ id: "legacy-lot" }],
  outsideParties: [{ id: "buyer", name: "Anna Vella", type: "individual" }],
  customLegacyField: { retained: true },
});

describe("case model migration", () => {
  it("adds one deterministic family group while preserving legacy case data", () => {
    const input = legacyCase();
    const snapshot = structuredClone(input);

    const result = normalizeCase(input);

    expect(result).toMatchObject({
      schemaVersion: CASE_SCHEMA_VERSION,
      id: "case-1",
      familyGroups: [
        {
          id: "case-1:family-group:1",
          title: "Borg succession",
          rootPersonId: "joseph",
          personIds: ["joseph", "maria"],
        },
      ],
      activeFamilyGroupId: "case-1:family-group:1",
      properties: input.properties,
      transfers: input.transfers,
      saleLots: input.saleLots,
      customLegacyField: { retained: true },
    });
    expect(input).toEqual(snapshot);
    expect(result.properties).not.toBe(input.properties);
  });

  it("is deterministic and idempotent", () => {
    const first = normalizeCase(legacyCase());
    expect(normalizeCase(legacyCase())).toEqual(first);
    expect(normalizeCase(first)).toEqual(first);
  });

  it("recovers safely from malformed JSON collection fields", () => {
    expect(() =>
      normalizeCase({
        schemaVersion: 2,
        id: "malformed",
        people: { unexpected: true },
        familyGroups: [{ id: "group", personIds: "not-an-array" }],
      }),
    ).not.toThrow();
    expect(
      normalizeCase({
        schemaVersion: 2,
        id: "malformed",
        people: { unexpected: true },
        familyGroups: [{ id: "group", personIds: "not-an-array" }],
      }),
    ).toMatchObject({
      people: [],
      familyGroups: [{ id: "group", rootPersonId: "", personIds: [] }],
    });
  });

  it("keeps one canonical global person for duplicate IDs", () => {
    const result = normalizeCase({
      id: "duplicates",
      people: [
        { id: "same", fullName: "First record" },
        { id: "same", fullName: "Duplicate record" },
      ],
    });
    expect(result.people).toEqual([{ id: "same", fullName: "First record" }]);
    expect(result.familyGroups[0].personIds).toEqual(["same"]);
  });

  it("does not pull an unrelated person into a group whose members were removed", () => {
    const result = normalizeCase({
      schemaVersion: 2,
      id: "separate-families",
      people: [{ id: "vella", fullName: "Maria Vella" }],
      familyGroups: [
        {
          id: "borg-tree",
          title: "Borg family",
          rootPersonId: "removed-borg",
          personIds: ["removed-borg"],
        },
        {
          id: "vella-tree",
          title: "Vella family",
          rootPersonId: "vella",
          personIds: ["vella"],
        },
      ],
    });

    expect(result.familyGroups[0]).toMatchObject({
      id: "borg-tree",
      rootPersonId: "",
      personIds: [],
    });
    expect(result.familyGroups[1].personIds).toEqual(["vella"]);
  });
});

describe("family group helpers", () => {
  it("creates a group with a new root person without duplicating global people", () => {
    const input = normalizeCase(legacyCase());
    const result = createFamilyGroup(
      input,
      { id: "anna", fullName: "Anna Vella", sex: "Female" },
      { id: "vella-tree", title: "Vella family" },
    );

    expect(result.people.filter((person) => person.id === "anna")).toHaveLength(1);
    expect(result.familyGroups.at(-1)).toEqual({
      id: "vella-tree",
      title: "Vella family",
      rootPersonId: "anna",
      personIds: ["anna"],
    });
    expect(result.activeFamilyGroupId).toBe("vella-tree");
    expect(input.people.some((person) => person.id === "anna")).toBe(false);
  });

  it("adds only known people to a group and finds every group containing a person", () => {
    let result = createFamilyGroup(
      legacyCase(),
      { id: "anna", fullName: "Anna Vella" },
      { id: "vella-tree" },
    );
    result = addPersonIdsToFamilyGroup(result, "vella-tree", ["maria", "maria", "missing-person"]);
    result = addPersonIdsToFamilyGroup(result, "case-1:family-group:1", ["maria"]);

    expect(result.familyGroups.find((group) => group.id === "vella-tree").personIds).toEqual([
      "anna",
      "maria",
    ]);
    expect(findFamilyGroupsForPerson(result, "maria").map((group) => group.id)).toEqual([
      "case-1:family-group:1",
      "vella-tree",
    ]);
  });

  it("makes the first added person the root of an empty group", () => {
    const result = addPersonIdsToFamilyGroup(
      {
        schemaVersion: 2,
        id: "replacement",
        people: [{ id: "imported", fullName: "Imported Person" }],
        familyGroups: [
          {
            id: "imported-tree",
            title: "Imported family",
            rootPersonId: "",
            personIds: [],
          },
        ],
      },
      "imported-tree",
      ["imported"],
    );

    expect(result.familyGroups[0]).toMatchObject({
      rootPersonId: "imported",
      personIds: ["imported"],
    });
  });
});

describe("outside individual promotion", () => {
  it("keeps the outside party ID for the new person and preserves ownership references", () => {
    const input = legacyCase();
    const snapshot = structuredClone(input);
    const result = promoteOutsideIndividual(input, "buyer", {
      groupId: "buyer-family",
      title: "Vella family",
      person: { sex: "Female" },
    });

    expect(result.outsideParties).toEqual([]);
    expect(result.people.find((person) => person.id === "buyer")).toMatchObject({
      id: "buyer",
      givenNames: "Anna",
      surname: "Vella",
      fullName: "Anna Vella",
      sex: "Female",
    });
    expect(result.familyGroups.at(-1)).toEqual({
      id: "buyer-family",
      title: "Vella family",
      rootPersonId: "buyer",
      personIds: ["buyer"],
    });
    expect(result.properties[0].transfers[0].buyerId).toBe("buyer");
    expect(result.properties[0].saleLots[0].ownerId).toBe("buyer");
    expect(input).toEqual(snapshot);
  });

  it("does not promote a company into a Person", () => {
    const input = {
      id: "company-case",
      people: [{ id: "owner", fullName: "Owner" }],
      outsideParties: [{ id: "company", name: "Buyer Ltd", type: "company" }],
    };
    const result = promoteOutsideIndividual(input, "company");

    expect(result.people.some((person) => person.id === "company")).toBe(false);
    expect(result.outsideParties).toHaveLength(1);
    expect(result.familyGroups).toHaveLength(1);
  });
});
