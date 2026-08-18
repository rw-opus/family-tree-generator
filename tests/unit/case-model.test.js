import { describe, expect, it } from "vitest";
import {
  CASE_SCHEMA_VERSION,
  addPersonIdsToFamilyGroup,
  casePersonDependencyLabels,
  createFamilyGroup,
  findFamilyGroupsForPerson,
  normalizeCase,
  promoteOutsideIndividual,
  reconcilePeopleUpdate,
  removePersonFromFamilyGroup,
} from "../../src/domain/caseModel.js";
import {
  buildPropertyOwnership,
  confirmedIntestacyAllocations,
  intestateAllocations,
  legacyIntestacyAllocationSignature,
} from "../../src/domain/familyOwnership.js";

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
  it("canonicalises legacy null relationship fields before strict persistence", () => {
    const result = normalizeCase({
      id: "legacy-null-references",
      people: [
        {
          id: "person-1",
          fullName: "Joseph Borg",
          fatherId: null,
          motherId: null,
          survivalStatusReferencePersonId: null,
          spouseIds: null,
          siblingIds: null,
          partnerRelationships: null,
          willHeirs: null,
          intestateHeirs: null,
          causaMortisDeclarations: null,
          designations: null,
        },
      ],
    });

    expect(result.people[0]).toMatchObject({
      fatherId: "",
      motherId: "",
      survivalStatusReferencePersonId: "",
      spouseIds: [],
      siblingIds: [],
      partnerRelationships: [],
      willHeirs: [],
      intestateHeirs: [],
      causaMortisDeclarations: [],
      designations: [],
    });
  });

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

  it("binds an unscoped legacy causa mortis declaration to the sole property", () => {
    const result = normalizeCase({
      id: "legacy-cm-property",
      properties: [{ id: "property-1", owners: [] }],
      people: [
        {
          id: "deceased",
          fullName: "Maria Borg",
          causaMortisDeclarations: [{ id: "legacy-cm", propertyId: "", status: "complete" }],
        },
      ],
    });

    expect(result.people[0].causaMortisDeclarations[0].propertyId).toBe("property-1");
    expect(normalizeCase(result)).toEqual(result);
  });

  it("leaves an unscoped legacy causa mortis declaration unresolved across properties", () => {
    const result = normalizeCase({
      id: "ambiguous-cm-property",
      properties: [{ id: "property-1" }, { id: "property-2" }],
      people: [
        {
          id: "deceased",
          fullName: "Maria Borg",
          causaMortisDeclarations: [{ id: "legacy-cm", propertyId: "", status: "complete" }],
        },
      ],
    });

    expect(result.people[0].causaMortisDeclarations[0].propertyId).toBe("");
  });

  it("reopens legacy owners, transfers and will beneficiaries with the same durable IDs", () => {
    const legacy = {
      id: "legacy-record-ids",
      people: [
        {
          id: "owner",
          fullName: "Joseph Borg",
          willHeirs: [{ personId: "beneficiary", sharePercent: 100 }],
        },
        { id: "beneficiary", fullName: "Maria Borg" },
      ],
      properties: [
        {
          id: "property",
          owners: [{ personId: "owner", sharePercent: 100 }],
          transfers: [
            {
              kind: "donation",
              sellerId: "owner",
              buyerId: "beneficiary",
              numerator: 1,
              denominator: 2,
              amountType: "whole-property",
              date: "2020-01-01",
            },
          ],
        },
      ],
    };

    const restored = normalizeCase(legacy);
    const reopened = normalizeCase(JSON.parse(JSON.stringify(restored)));

    expect(restored.properties[0].owners[0].id).toBe("property:owner:1");
    expect(restored.properties[0].transfers[0].id).toBe("property:transfer:1");
    expect(restored.people[0].willHeirs[0].id).toBe("owner:will-heir:1");
    expect(reopened.properties[0].owners[0].id).toBe(restored.properties[0].owners[0].id);
    expect(reopened.properties[0].transfers[0].id).toBe(restored.properties[0].transfers[0].id);
    expect(reopened.people[0].willHeirs[0].id).toBe(restored.people[0].willHeirs[0].id);
    const ownership = buildPropertyOwnership(restored.people, restored.properties[0]);
    expect(ownership.tranchesByOwner.get("beneficiary")?.[0]?.sourceTransferId).toBe(
      "property:transfer:1",
    );
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

  it("migrates a valid old-format intestacy confirmation without changing its shares", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        spouseIds: ["spouse"],
        intestateHeirs: [
          { id: "spouse-share", personId: "spouse", sharePercent: 60 },
          { id: "child-share", personId: "child", sharePercent: 40 },
        ],
      },
      { id: "spouse", fullName: "Maria Borg", spouseIds: ["deceased"] },
      {
        id: "child",
        fullName: "Anna Borg",
        fatherId: "deceased",
        motherId: "spouse",
      },
    ];
    const calculated = intestateAllocations(people, "deceased");
    people[0] = {
      ...people[0],
      intestateHeirsConfirmed: true,
      intestateConfirmationBasis: legacyIntestacyAllocationSignature(people[0], calculated),
    };

    const normalized = normalizeCase({ id: "migration", people });
    const migrated = normalized.people.find((person) => person.id === "deceased");
    const migratedCalculation = intestateAllocations(normalized.people, "deceased");
    const confirmed = confirmedIntestacyAllocations(
      normalized.people,
      "deceased",
      migratedCalculation,
    );

    expect(migrated.intestateConfirmationBasis).toMatch(/^v3::/);
    expect(migrated.intestateConfirmationMigratedFromV1).toBe(true);
    expect(confirmed.valid).toBe(true);
    expect(confirmed.shares.get("spouse")).toBeCloseTo(0.6);
    expect(confirmed.shares.get("child")).toBeCloseTo(0.4);
  });

  it("preserves duplicate-ID records under recovery IDs and reports them", () => {
    const result = normalizeCase({
      id: "duplicates",
      people: [
        { id: "same", fullName: "First record" },
        { id: "same", fullName: "Duplicate record" },
      ],
    });
    expect(result.people).toEqual([
      { id: "same", fullName: "First Record" },
      { id: "same:duplicate:2", fullName: "Duplicate Record" },
    ]);
    expect(result.familyGroups[0].personIds).toEqual(["same", "same:duplicate:2"]);
    expect(result.dataWarnings.join(" ")).toContain("Duplicate person identifier");
  });

  it("capitalises person names whenever a case is normalised for saving", () => {
    const result = normalizeCase({
      id: "capitalised-names",
      people: [
        {
          id: "person",
          givenNames: "edgar anthony",
          surname: "wadge",
          surnameAtBirth: "wadge",
          fullName: "edgar anthony wadge",
        },
      ],
    });

    expect(result.people[0]).toMatchObject({
      givenNames: "Edgar Anthony",
      surname: "Wadge",
      surnameAtBirth: "Wadge",
      fullName: "Edgar Anthony Wadge",
    });
  });

  it("removes untouched parents created silently by the legacy person-card effect", () => {
    const result = normalizeCase({
      id: "legacy-generated-parents",
      people: [
        {
          id: "edgar",
          givenNames: "Edgar",
          surname: "Wadge",
          fullName: "Edgar Wadge",
          fatherId: "generated-father",
          motherId: "generated-mother",
        },
        {
          id: "generated-father",
          givenNames: "Father of Edgar",
          fullName: "Father of Edgar",
          surname: "",
          surnameAtBirth: "",
          sex: "Male",
          designations: ["Parent"],
          fatherId: "",
          motherId: "",
          spouseIds: [],
          siblingIds: [],
          dateOfBirth: "",
          dateOfDeath: "",
          wills: [],
          notes: "",
          isPotentialIntestateParent: true,
          survivalStatusRequired: true,
          survivalStatusReferencePersonId: "edgar",
        },
        {
          id: "generated-mother",
          givenNames: "Mother of Edgar",
          fullName: "Mother of Edgar",
          surname: "",
          surnameAtBirth: "",
          sex: "Female",
          designations: ["Parent"],
          fatherId: "",
          motherId: "",
          spouseIds: [],
          siblingIds: [],
          dateOfBirth: "",
          dateOfDeath: "",
          wills: [],
          notes: "",
          isPotentialIntestateParent: true,
          survivalStatusRequired: true,
          survivalStatusReferencePersonId: "edgar",
        },
      ],
    });

    expect(result.people).toHaveLength(1);
    expect(result.people[0]).toMatchObject({ id: "edgar", fatherId: "", motherId: "" });
    expect(result.familyGroups[0].personIds).toEqual(["edgar"]);
  });

  it("ignores harmless person defaults when removing silent legacy parents", () => {
    const result = normalizeCase({
      id: "legacy-generated-parent-with-defaults",
      people: [
        {
          id: "edgar",
          givenNames: "Edgar",
          surname: "Wadge",
          fullName: "Edgar Wadge",
          fatherId: "generated-father",
        },
        {
          id: "generated-father",
          givenNames: "Father of Edgar",
          fullName: "Father of Edgar",
          sex: "Male",
          designations: ["Parent"],
          isPotentialIntestateParent: true,
          survivalStatusRequired: true,
          survivalStatusReferencePersonId: "edgar",
          inheritanceBasis: "intestacy",
          intestateHeirs: [],
          causaMortisDeclarations: [],
          isDeceased: false,
          showOwnership: false,
        },
      ],
    });

    expect(result.people).toEqual([
      expect.objectContaining({ id: "edgar", fatherId: "", fullName: "Edgar Wadge" }),
    ]);
  });

  it("does not preserve a silent legacy parent solely because tax-guide progress names it", () => {
    const result = normalizeCase({
      id: "guided-legacy-parent",
      people: [
        { id: "edgar", fullName: "Edgar Wadge", fatherId: "generated-father" },
        {
          id: "generated-father",
          givenNames: "Father of Edgar",
          fullName: "Father of Edgar",
          sex: "Male",
          designations: ["Parent"],
          isPotentialIntestateParent: true,
          survivalStatusRequired: true,
          survivalStatusReferencePersonId: "edgar",
        },
      ],
      properties: [
        {
          id: "property",
          owners: [],
          taxReadinessGuide: {
            status: "paused",
            currentPersonId: "generated-father",
            historyPersonIds: ["generated-father"],
          },
        },
      ],
    });

    expect(result.people).toEqual([
      expect.objectContaining({ id: "edgar", fatherId: "", fullName: "Edgar Wadge" }),
    ]);
  });

  it("preserves a potential parent that the user added explicitly", () => {
    const result = normalizeCase({
      id: "explicit-parent",
      people: [
        { id: "michael", fullName: "Michael Wadge", motherId: "mother" },
        {
          id: "mother",
          givenNames: "Mother of Michael",
          fullName: "Mother of Michael",
          sex: "Female",
          designations: ["Parent"],
          spouseIds: [],
          siblingIds: [],
          wills: [],
          isPotentialIntestateParent: true,
          potentialParentAddedExplicitly: true,
          survivalStatusRequired: true,
          survivalStatusReferencePersonId: "michael",
        },
      ],
    });

    expect(result.people.map((person) => person.id)).toEqual(["michael", "mother"]);
    expect(result.people[0].motherId).toBe("mother");
  });

  it("repairs a stale potential-parent warning when a valid death date is recorded", () => {
    const result = normalizeCase({
      id: "resolved-potential-parent",
      people: [
        { id: "michael", fullName: "Michael Wadge", motherId: "mother" },
        {
          id: "mother",
          fullName: "Mother of Michael",
          isPotentialIntestateParent: true,
          potentialParentAddedExplicitly: true,
          survivalStatusRequired: true,
          survivalStatusConfirmed: "",
          survivalStatusReferencePersonId: "michael",
          isDeceased: true,
          designations: ["Parent", "Deceased"],
          dateOfDeath: "2020-04-12",
        },
      ],
    });

    expect(result.people.find((person) => person.id === "mother")).toMatchObject({
      survivalStatusRequired: false,
      survivalStatusConfirmed: "death-date-recorded",
      dateOfDeath: "2020-04-12",
    });
  });

  it("treats a valid saved death date as the authoritative deceased status", () => {
    const result = normalizeCase({
      id: "date-only-deceased",
      people: [
        {
          id: "owner",
          fullName: "Date Only Owner",
          isDeceased: false,
          designations: ["Owner"],
          dateOfDeath: "2020-04-12",
        },
      ],
    });

    expect(result.people[0]).toMatchObject({
      isDeceased: true,
      dateOfDeath: "2020-04-12",
      designations: ["Deceased", "Owner"],
    });
  });

  it("canonicalises a legacy lowercase deceased designation on restore", () => {
    const result = normalizeCase({
      id: "legacy-lowercase-deceased",
      people: [
        {
          id: "owner",
          fullName: "Legacy Owner",
          designations: ["Owner", "deceased"],
        },
      ],
    });

    expect(result.people[0]).toMatchObject({
      isDeceased: true,
      designations: ["Deceased", "Owner"],
    });
  });

  it("keeps a deceased potential parent unresolved while the death date is missing", () => {
    const result = normalizeCase({
      id: "unresolved-potential-parent",
      people: [
        { id: "michael", fullName: "Michael Wadge", motherId: "mother" },
        {
          id: "mother",
          fullName: "Mother of Michael",
          isPotentialIntestateParent: true,
          potentialParentAddedExplicitly: true,
          survivalStatusRequired: true,
          survivalStatusConfirmed: "",
          survivalStatusReferencePersonId: "michael",
          isDeceased: true,
          designations: ["Parent", "Deceased"],
          dateOfDeath: "",
        },
      ],
    });

    expect(result.people.find((person) => person.id === "mother")).toMatchObject({
      survivalStatusRequired: true,
      survivalStatusConfirmed: "",
      dateOfDeath: "",
    });
  });

  it("repairs a stale potential-parent warning after an explicit living confirmation", () => {
    const result = normalizeCase({
      id: "living-potential-parent",
      people: [
        { id: "michael", fullName: "Michael Wadge", motherId: "mother" },
        {
          id: "mother",
          fullName: "Mother of Michael",
          isPotentialIntestateParent: true,
          potentialParentAddedExplicitly: true,
          survivalStatusRequired: true,
          survivalStatusConfirmed: "alive",
          survivalStatusReferencePersonId: "michael",
          isDeceased: false,
          designations: ["Parent"],
          dateOfDeath: "",
        },
      ],
    });

    expect(result.people.find((person) => person.id === "mother")).toMatchObject({
      survivalStatusRequired: false,
      survivalStatusConfirmed: "alive",
      isDeceased: false,
    });
  });

  it("preserves a legacy potential parent once the record contains user data", () => {
    const result = normalizeCase({
      id: "edited-parent",
      people: [
        { id: "michael", fullName: "Michael Wadge", motherId: "mother" },
        {
          id: "mother",
          givenNames: "Mother of Michael",
          fullName: "Mother of Michael",
          sex: "Female",
          designations: ["Parent"],
          spouseIds: [],
          siblingIds: [],
          wills: [],
          notes: "Survival still being researched",
          isPotentialIntestateParent: true,
          survivalStatusRequired: true,
          survivalStatusReferencePersonId: "michael",
        },
      ],
    });

    expect(result.people.map((person) => person.id)).toEqual(["michael", "mother"]);
  });

  it("preserves a legacy potential parent referenced by a property record", () => {
    const result = normalizeCase({
      id: "property-owner-parent",
      people: [
        { id: "michael", fullName: "Michael Wadge", motherId: "mother" },
        {
          id: "mother",
          givenNames: "Mother of Michael",
          fullName: "Mother of Michael",
          sex: "Female",
          designations: ["Parent"],
          spouseIds: [],
          siblingIds: [],
          wills: [],
          isPotentialIntestateParent: true,
          survivalStatusRequired: true,
          survivalStatusReferencePersonId: "michael",
        },
      ],
      properties: [{ id: "property", owners: [{ personId: "mother", share: 100 }] }],
    });

    expect(result.people.map((person) => person.id)).toEqual(["michael", "mother"]);
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

  it("retains a person's legacy starting-ownership field", () => {
    const input = removableCase({
      people: [
        {
          id: "person",
          fullName: "Maria Borg",
          spouseIds: [],
          siblingIds: [],
          ownershipSharePercent: 100,
        },
        { id: "keeper", fullName: "Paul Borg", spouseIds: [], siblingIds: [] },
      ],
    });

    expect(casePersonDependencyLabels(input, "person")).toContain(
      "a legacy property ownership record",
    );

    const result = removePersonFromFamilyGroup(input, "family-a", "person");

    expect(result.familyGroups[0].personIds).toEqual(["keeper"]);
    expect(result.people.find((person) => person.id === "person")).toMatchObject({
      ownershipSharePercent: 100,
    });
  });

  it("retains a person's own succession records after removing them from the tree", () => {
    const input = removableCase({
      people: [
        {
          id: "person",
          fullName: "Maria Borg",
          inheritanceBasis: "will",
          wills: [
            {
              id: "will",
              date: "2019-03-04",
              notaryName: "Dr Example",
              description: "Recorded will",
            },
          ],
          willHeirs: [{ id: "heir", personId: "keeper", sharePercent: 100 }],
          causaMortisDeclarations: [
            {
              id: "cm",
              status: "draft",
              declarantPersonIds: ["keeper"],
            },
          ],
          spouseIds: [],
        },
        { id: "keeper", fullName: "Paul Borg", spouseIds: [] },
      ],
    });
    const normalizedPerson = normalizeCase(input).people.find((person) => person.id === "person");

    expect(casePersonDependencyLabels(input, "person")).toContain(
      "recorded succession or legal details",
    );

    const result = removePersonFromFamilyGroup(input, "family-a", "person");
    const retainedPerson = result.people.find((person) => person.id === "person");

    expect(result.familyGroups[0].personIds).toEqual(["keeper"]);
    expect(retainedPerson).toBeDefined();
    expect(retainedPerson.wills).toEqual(normalizedPerson.wills);
    expect(retainedPerson.willHeirs).toEqual(normalizedPerson.willHeirs);
    expect(retainedPerson.causaMortisDeclarations).toEqual(
      normalizedPerson.causaMortisDeclarations,
    );
  });

  it("retains a deceased identity selected as a stored inheritance tax source", () => {
    const input = removableCase({
      properties: [
        {
          id: "property",
          owners: [],
          transfers: [],
          saleLots: [
            {
              id: "tax-lot",
              ownerId: "keeper",
              inheritanceSourceDeceasedId: "person",
            },
          ],
          declarations: [],
        },
      ],
    });

    expect(casePersonDependencyLabels(input, "person")).toContain(
      "an inheritance tax source record",
    );

    const result = removePersonFromFamilyGroup(input, "family-a", "person");

    expect(result.familyGroups[0].personIds).toEqual(["keeper"]);
    expect(result.people.some((person) => person.id === "person")).toBe(true);
    expect(result.properties[0].saleLots).toEqual(input.properties[0].saleLots);
  });

  it("retains a deceased identity referenced by saved transfer provenance", () => {
    const input = removableCase({
      properties: [
        {
          id: "property",
          owners: [],
          transfers: [
            {
              id: "transfer",
              sellerId: "keeper",
              buyerId: "outside-buyer",
              provenance: [
                {
                  trancheId: "inheritance-person",
                  numerator: 1,
                  denominator: 2,
                },
              ],
            },
          ],
          saleLots: [],
          declarations: [],
        },
      ],
      outsideParties: [{ id: "outside-buyer", name: "Outside Buyer" }],
    });

    expect(casePersonDependencyLabels(input, "person")).toContain(
      "an inheritance provenance record",
    );

    const result = removePersonFromFamilyGroup(input, "family-a", "person");

    expect(result.familyGroups[0].personIds).toEqual(["keeper"]);
    expect(result.people.some((person) => person.id === "person")).toBe(true);
    expect(result.properties[0].transfers[0].provenance).toEqual(
      input.properties[0].transfers[0].provenance,
    );
  });

  it.each([
    {
      name: "Article 616 status rows",
      personPatch: {
        legacyArticle616Statuses: [{ personId: "person", participation: "renounced" }],
      },
      label: "an Article 616 status record",
    },
    {
      name: "saved will-beneficiary review rows",
      personPatch: {
        willHeirsConfirmationSnapshot: {
          willHeirs: [{ id: "saved-heir", personId: "person", sharePercent: 100 }],
          willHeirsConfirmed: false,
        },
      },
      label: "a saved will-beneficiary review",
    },
    {
      name: "pending-session will beneficiaries",
      sessionField: "willHeirs",
      sessionValue: [{ id: "saved-heir", personId: "person", sharePercent: 100 }],
      label: "a will beneficiary record",
    },
    {
      name: "pending-session intestate heirs",
      sessionField: "intestateHeirs",
      sessionValue: [{ id: "saved-heir", personId: "person", sharePercent: 100 }],
      label: "a confirmed intestate-heir record",
    },
    {
      name: "pending-session saved will review",
      sessionField: "willHeirsConfirmationSnapshot",
      sessionValue: {
        willHeirs: [{ id: "saved-heir", personId: "person", sharePercent: 100 }],
      },
      label: "a saved will-beneficiary review",
    },
    {
      name: "pending-session Article 616 statuses",
      sessionField: "legacyArticle616Statuses",
      sessionValue: [{ personId: "person", participation: "renounced" }],
      label: "an Article 616 status record",
    },
    {
      name: "pending-session causa mortis declarations",
      sessionField: "causaMortisDeclarations",
      sessionValue: [{ id: "saved-cm", declarantPersonIds: ["person"] }],
      label: "a causa mortis declarant record",
    },
  ])("retains identities used by $name", ({ personPatch, sessionField, sessionValue, label }) => {
    const statusToggleSessions = sessionField
      ? [
          {
            id: "status-session",
            type: "deceased",
            personId: "keeper",
            activeFamilyGroupId: "family-a",
            personFields: {
              [sessionField]: { present: true, value: sessionValue },
            },
          },
        ]
      : [];
    const input = removableCase({
      people: [
        { id: "person", fullName: "Maria Borg", spouseIds: [], siblingIds: [] },
        {
          id: "keeper",
          fullName: "Paul Borg",
          spouseIds: [],
          siblingIds: [],
          ...personPatch,
        },
      ],
      statusToggleSessions,
    });
    const normalizedInput = normalizeCase(input);

    expect(casePersonDependencyLabels(input, "person")).toContain(label);

    const result = removePersonFromFamilyGroup(input, "family-a", "person");

    expect(result.familyGroups[0].personIds).toEqual(["keeper"]);
    expect(result.people.some((person) => person.id === "person")).toBe(true);
    expect(result.people.find((person) => person.id === "keeper")).toEqual(
      normalizedInput.people.find((person) => person.id === "keeper"),
    );
    expect(result.statusToggleSessions).toEqual(normalizedInput.statusToggleSessions);
  });

  it("retains a person referenced by persisted guided tax progress", () => {
    const taxReadinessGuide = {
      version: 1,
      status: "paused",
      currentPersonId: "person",
      historyPersonIds: ["person"],
      reviewedPersonIds: ["person"],
      skippedPersonIds: ["person"],
      skippedIssueKeys: { person: ["identity-name"] },
      skippedReviewVisitedPersonIds: ["person"],
    };
    const input = removableCase({
      properties: [
        {
          id: "property",
          owners: [],
          transfers: [],
          saleLots: [],
          declarations: [],
          taxReadinessGuide,
        },
      ],
    });

    expect(casePersonDependencyLabels(input, "person")).toContain("a guided tax-review record");

    const result = removePersonFromFamilyGroup(input, "family-a", "person");

    expect(result.familyGroups[0].personIds).toEqual(["keeper"]);
    expect(result.people.some((person) => person.id === "person")).toBe(true);
    expect(result.properties[0].taxReadinessGuide).toEqual(taxReadinessGuide);
  });

  it.each([null, "malformed", []])(
    "ignores a malformed guided tax record without breaking person removal (%j)",
    (taxReadinessGuide) => {
      const input = removableCase({
        properties: [
          {
            id: "property",
            owners: [],
            transfers: [],
            saleLots: [],
            declarations: [],
            taxReadinessGuide,
          },
        ],
      });

      expect(() => casePersonDependencyLabels(input, "person")).not.toThrow();
      expect(
        removePersonFromFamilyGroup(input, "family-a", "person").people.some(
          (person) => person.id === "person",
        ),
      ).toBe(false);
    },
  );

  it("removes a CM declarant from the family group but retains their canonical identity", () => {
    const input = removableCase({
      people: [
        { id: "person", fullName: "Maria Borg", spouseIds: [], siblingIds: [] },
        {
          id: "keeper",
          fullName: "Paul Borg",
          spouseIds: [],
          siblingIds: [],
          causaMortisDeclarations: [{ id: "cm-declaration", declarantPersonIds: ["person"] }],
        },
      ],
    });

    const result = removePersonFromFamilyGroup(input, "family-a", "person");

    expect(result.familyGroups[0]).toMatchObject({
      rootPersonId: "keeper",
      personIds: ["keeper"],
    });
    expect(result.people.find((person) => person.id === "person")).toMatchObject({
      fullName: "Maria Borg",
    });
    expect(result.people.find((person) => person.id === "keeper").causaMortisDeclarations).toEqual([
      { id: "cm-declaration", declarantPersonIds: ["person"] },
    ]);
  });

  it("retains a person referenced by a pending legal-status change", () => {
    const input = removableCase({
      statusToggleSessions: [
        {
          id: "status-session",
          type: "deceased",
          personId: "person",
          activeFamilyGroupId: "family-a",
          personFields: {},
          createdRecordIds: [],
        },
      ],
    });

    expect(casePersonDependencyLabels(input, "person")).toContain("a pending legal-status change");
    const result = removePersonFromFamilyGroup(input, "family-a", "person");
    expect(result.people.some((person) => person.id === "person")).toBe(true);
    expect(result.statusToggleSessions[0].personId).toBe("person");
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

  it("deletes a person referenced only by family relationships and scrubs every link", () => {
    const input = removableCase({
      people: [
        {
          id: "person",
          fullName: "Maria Borg",
          spouseIds: ["keeper"],
          partnerRelationships: [{ personId: "keeper", type: "marriage" }],
        },
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
    expect(result.people.some((person) => person.id === "person")).toBe(false);
    expect(result.people.find((person) => person.id === "keeper")).toMatchObject({
      fatherId: "",
      spouseIds: [],
      siblingIds: [],
      partnerRelationships: [],
    });
  });

  it("does not regenerate a deleted parent when another person is added", () => {
    const input = removableCase({
      people: [
        { id: "person", fullName: "Maria Borg" },
        { id: "keeper", fullName: "Paul Borg", motherId: "person" },
      ],
    });

    const removed = removePersonFromFamilyGroup(input, "family-a", "person");
    const result = reconcilePeopleUpdate(removed, "family-a", [
      ...removed.people,
      { id: "new-person", fullName: "New Person" },
    ]);

    expect(result.people.some((person) => person.id === "person")).toBe(false);
    expect(result.familyGroups[0].personIds).toEqual(["keeper", "new-person"]);
    expect(result.people.find((person) => person.id === "keeper").motherId).toBe("");
  });

  it("keeps a retained marriage record without restoring the hidden parent for a new child", () => {
    const input = removableCase({
      people: [
        {
          id: "person",
          fullName: "Maria Borg",
          spouseIds: ["keeper"],
          partnerRelationships: [
            {
              personId: "keeper",
              type: "marriage",
              startDate: "1990-04-12",
              endDate: "2020-05-16",
              endReason: "divorce",
            },
          ],
        },
        {
          id: "keeper",
          fullName: "Paul Borg",
          spouseIds: ["person"],
          causaMortisDeclarations: [{ id: "cm-declaration", declarantPersonIds: ["person"] }],
        },
      ],
    });

    const removed = removePersonFromFamilyGroup(input, "family-a", "person");
    const result = reconcilePeopleUpdate(removed, "family-a", [
      ...removed.people,
      {
        id: "new-child",
        fullName: "New Child",
        fatherId: "keeper",
        motherId: "person",
      },
    ]);

    expect(result.people.find((person) => person.id === "person")).toMatchObject({
      spouseIds: ["keeper"],
    });
    expect(result.people.find((person) => person.id === "keeper")).toMatchObject({
      spouseIds: ["person"],
      partnerRelationships: [
        {
          personId: "person",
          type: "marriage",
          startDate: "1990-04-12",
          endDate: "2020-05-16",
          endReason: "divorce",
        },
      ],
    });
    expect(result.familyGroups[0]).toMatchObject({
      personIds: ["keeper", "new-child"],
      excludedPersonIds: ["person"],
    });

    const restored = addPersonIdsToFamilyGroup(result, "family-a", ["person"]);
    expect(restored.familyGroups[0].personIds).toEqual(["keeper", "new-child", "person"]);
    expect(restored.familyGroups[0].excludedPersonIds).toBeUndefined();
  });

  it("clears survival references when their subject is permanently deleted", () => {
    const input = removableCase({
      people: [
        { id: "person", fullName: "Maria Borg" },
        {
          id: "keeper",
          fullName: "Paul Borg",
          survivalStatusReferencePersonId: "person",
        },
      ],
    });

    const result = removePersonFromFamilyGroup(input, "family-a", "person");

    expect(result.people.some((person) => person.id === "person")).toBe(false);
    expect(result.people.find((person) => person.id === "keeper")).toMatchObject({
      survivalStatusReferencePersonId: "",
    });
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
