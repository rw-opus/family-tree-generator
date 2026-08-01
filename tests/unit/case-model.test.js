import { describe, expect, it } from "vitest";
import {
  CASE_SCHEMA_VERSION,
  addPersonIdsToFamilyGroup,
  casePersonDependencyLabels,
  createFamilyGroup,
  findFamilyGroupsForPerson,
  normalizeCase,
  promoteOutsideIndividual,
  removePersonFromFamilyGroup,
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

  it("migrates legacy will fields into a repeatable wills collection", () => {
    const result = normalizeCase({
      id: "legacy-will-case",
      people: [
        {
          id: "testator",
          fullName: "Paul Farrugia",
          willDate: "1997-01-27",
          willNotaryName: "Paul Pullicino",
        },
      ],
    });

    expect(result.people[0]).toMatchObject({
      willDate: "1997-01-27",
      willNotaryName: "Paul Pullicino",
      wills: [
        {
          id: "testator:legacy-will",
          date: "1997-01-27",
          notaryName: "Paul Pullicino",
        },
      ],
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

describe("family-scoped person removal", () => {
  const removableCase = (patch = {}) => ({
    schemaVersion: 2,
    id: "removal-case",
    title: "Removal case",
    people: [
      { id: "person", fullName: "Maria Borg", spouseIds: [], siblingIds: [] },
      { id: "keeper", fullName: "Paul Borg", spouseIds: [], siblingIds: [] },
    ],
    familyGroups: [
      {
        id: "family-a",
        title: "Family A",
        rootPersonId: "person",
        personIds: ["person", "keeper"],
      },
    ],
    activeFamilyGroupId: "family-a",
    properties: [],
    ...patch,
  });

  it("retains a person referenced by incomplete starting ownership", () => {
    const input = removableCase({
      properties: [
        {
          id: "property",
          owners: [{ id: "owner-row", personId: "person", sharePercent: 40 }],
          transfers: [],
          saleLots: [],
          declarations: [],
        },
      ],
    });
    const snapshot = structuredClone(input);

    expect(casePersonDependencyLabels(input, "person")).toEqual([
      "an initial property ownership record",
    ]);

    const result = removePersonFromFamilyGroup(input, "family-a", "person");

    expect(result.familyGroups[0]).toMatchObject({
      rootPersonId: "keeper",
      personIds: ["keeper"],
    });
    expect(result.people.some((person) => person.id === "person")).toBe(true);
    expect(result.properties[0].owners).toEqual(input.properties[0].owners);
    expect(input).toEqual(snapshot);
  });

  it("deduplicates legal, declaration, transfer and tax-lot dependencies case-wide", () => {
    const input = removableCase({
      succession: { heirs: [{ id: "case-heir", personId: "person" }] },
      owners: [{ id: "legacy-owner", personId: "person", sharePercent: 25 }],
      transfers: [
        { id: "legacy-transfer-1", sellerId: "case-heir", buyerId: "keeper" },
        { id: "legacy-transfer-2", sellerId: "keeper", buyerId: "case-heir" },
      ],
      saleLots: [{ id: "legacy-lot", ownerId: "case-heir" }],
      declarations: [
        {
          id: "legacy-declaration",
          heirIds: ["case-heir"],
          participants: [{ heirId: "case-heir" }],
        },
      ],
      property: {
        owners: [{ id: "nested-legacy-owner", personId: "person", sharePercent: 25 }],
        declarations: [{ id: "nested-legacy-declaration", heirIds: ["person"] }],
      },
      properties: [
        {
          id: "property-1",
          owners: [],
          transfers: [{ id: "transfer", sellerId: "person", buyerId: "keeper" }],
          saleLots: [{ id: "lot", ownerId: "person" }],
          declarations: [
            {
              id: "declaration",
              participants: [{ heirId: "person" }, { personId: "person" }],
              declarantPersonIds: ["person"],
            },
          ],
        },
      ],
      people: [
        { id: "person", fullName: "Maria Borg", spouseIds: [], siblingIds: [] },
        {
          id: "keeper",
          fullName: "Paul Borg",
          spouseIds: [],
          siblingIds: [],
          willHeirs: [{ id: "will-heir", personId: "person" }],
          intestateHeirs: [{ id: "intestate-heir", personId: "person" }],
          causaMortisDeclarations: [
            { id: "cm-declaration", declarantPersonIds: ["person", "person"] },
          ],
        },
      ],
    });

    const labels = casePersonDependencyLabels(input, "person");

    expect(labels).toEqual(
      expect.arrayContaining([
        "an initial property ownership record",
        "a declaration of succession",
        "an ownership transfer",
        "a vendor tax lot",
        "a succession heir record",
        "a will beneficiary record",
        "a confirmed intestate-heir record",
        "a causa mortis declarant record",
      ]),
    );
    expect(new Set(labels).size).toBe(labels.length);

    const result = removePersonFromFamilyGroup(input, "family-a", "person");
    expect(result.familyGroups[0].personIds).toEqual(["keeper"]);
    expect(result.people.some((person) => person.id === "person")).toBe(true);
    expect(result.properties).toEqual(input.properties);
    expect(result.transfers).toEqual(input.transfers);
    expect(result.saleLots).toEqual(input.saleLots);
    expect(result.declarations).toEqual(input.declarations);
  });

  it("retains one canonical person when another family group still contains them", () => {
    const input = removableCase({
      people: [
        { id: "person", fullName: "Maria Borg" },
        { id: "keeper-a", fullName: "Paul Borg" },
        { id: "keeper-b", fullName: "Anna Vella" },
      ],
      familyGroups: [
        {
          id: "family-a",
          title: "Family A",
          rootPersonId: "person",
          personIds: ["person", "keeper-a"],
        },
        {
          id: "family-b",
          title: "Family B",
          rootPersonId: "person",
          personIds: ["person", "keeper-b"],
        },
      ],
    });

    const result = removePersonFromFamilyGroup(input, "family-a", "person");

    expect(result.familyGroups.find((group) => group.id === "family-a")).toMatchObject({
      rootPersonId: "keeper-a",
      personIds: ["keeper-a"],
    });
    expect(result.familyGroups.find((group) => group.id === "family-b")).toMatchObject({
      rootPersonId: "person",
      personIds: ["person", "keeper-b"],
    });
    expect(result.people.filter((person) => person.id === "person")).toHaveLength(1);
  });

  it("retains a person needed by another person's family relationships", () => {
    const input = removableCase({
      people: [
        { id: "person", fullName: "Maria Borg" },
        {
          id: "keeper",
          fullName: "Paul Borg",
          fatherId: "person",
          spouseIds: ["person"],
          siblingIds: ["person"],
        },
      ],
    });

    expect(casePersonDependencyLabels(input, "person")).toEqual([
      "a child relationship",
      "a partner relationship",
      "a sibling relationship",
    ]);

    const result = removePersonFromFamilyGroup(input, "family-a", "person");
    expect(result.familyGroups[0].personIds).toEqual(["keeper"]);
    expect(result.people.some((person) => person.id === "person")).toBe(true);
  });

  it("treats a sibling link as scrub-safe when deleting the final canonical person", () => {
    const input = removableCase({
      people: [
        { id: "person", fullName: "Maria Borg", siblingIds: ["keeper"] },
        { id: "keeper", fullName: "Paul Borg", siblingIds: ["person"] },
      ],
    });

    const result = removePersonFromFamilyGroup(input, "family-a", "person");

    expect(result.people.some((person) => person.id === "person")).toBe(false);
    expect(result.people.find((person) => person.id === "keeper").siblingIds).toEqual([]);
  });

  it("deletes an unreferenced canonical person and preserves all unrelated data", () => {
    const input = removableCase({
      settings: { shareDisplay: "fraction" },
      customData: { preserved: true },
    });

    const result = removePersonFromFamilyGroup(input, "family-a", "person");

    expect(result.people).toEqual([
      expect.objectContaining({ id: "keeper", fullName: "Paul Borg" }),
    ]);
    expect(result.familyGroups[0]).toMatchObject({
      rootPersonId: "keeper",
      personIds: ["keeper"],
    });
    expect(result.settings).toEqual(input.settings);
    expect(result.customData).toEqual(input.customData);
  });

  it("never removes the sole person in a family group", () => {
    const input = removableCase({
      people: [
        { id: "person", fullName: "Maria Borg" },
        { id: "other", fullName: "Paul Vella" },
      ],
      familyGroups: [
        {
          id: "family-a",
          title: "Family A",
          rootPersonId: "person",
          personIds: ["person"],
        },
        {
          id: "family-b",
          title: "Family B",
          rootPersonId: "other",
          personIds: ["other"],
        },
      ],
    });

    const result = removePersonFromFamilyGroup(input, "family-a", "person");

    expect(result.familyGroups.find((group) => group.id === "family-a").personIds).toEqual([
      "person",
    ]);
    expect(result.people.some((person) => person.id === "person")).toBe(true);
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
