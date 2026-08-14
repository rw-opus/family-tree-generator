import { describe, expect, it } from "vitest";
import {
  CURRENT_TREE_SCHEMA_VERSION,
  LEGACY_TREE_SCHEMA_VERSION,
  TREE_DATA_ERROR_CODES,
  TREE_DATA_LIMITS,
  TREE_SCHEMA_VERSION_FIELD,
  isTreeDataValidationError,
  prepareTreeForPersistence,
  readTreeForStorage,
  readTreeSchemaVersion,
} from "../../src/domain/treeData.js";

const currentTree = (overrides = {}) => ({
  [TREE_SCHEMA_VERSION_FIELD]: CURRENT_TREE_SCHEMA_VERSION,
  schemaVersion: 2,
  id: "tree-1",
  title: "Borg succession",
  people: [{ id: "person-1", givenNames: "Joseph", surname: "Borg" }],
  familyGroups: [
    {
      id: "group-1",
      title: "Borg succession",
      rootPersonId: "person-1",
      personIds: ["person-1"],
    },
  ],
  activeFamilyGroupId: "group-1",
  properties: [
    {
      id: "property-1",
      owners: [],
      transfers: [],
      declarations: [],
      saleLots: [],
    },
  ],
  outsideParties: [],
  settings: { activePropertyId: "property-1" },
  ...overrides,
});

describe("persisted family-tree schema", () => {
  it("treats an unmarked saved tree as legacy without changing the domain schemaVersion", () => {
    const legacy = {
      schemaVersion: 99,
      id: "legacy-1",
      title: "Legacy family",
      people: [{ id: "person-1" }],
    };

    expect(readTreeSchemaVersion(legacy)).toBe(LEGACY_TREE_SCHEMA_VERSION);
    expect(readTreeForStorage(legacy)).toEqual({
      ...legacy,
      [TREE_SCHEMA_VERSION_FIELD]: LEGACY_TREE_SCHEMA_VERSION,
    });
    expect(legacy).not.toHaveProperty(TREE_SCHEMA_VERSION_FIELD);
  });

  it("lets the supported normaliser repair missing or duplicate legacy person identifiers", () => {
    const legacy = {
      id: "legacy-1",
      title: "Recoverable legacy family",
      people: [{ fullName: "Missing ID" }, { id: "duplicate" }, { id: "duplicate" }],
    };

    expect(readTreeForStorage(legacy)).toEqual({
      ...legacy,
      [TREE_SCHEMA_VERSION_FIELD]: LEGACY_TREE_SCHEMA_VERSION,
    });
  });

  it("stamps current writes, removes storage metadata and leaves its input untouched", () => {
    const source = currentTree({
      [TREE_SCHEMA_VERSION_FIELD]: LEGACY_TREE_SCHEMA_VERSION,
      schemaVersion: 2,
      storageRevision: 8,
      created_at: "2026-08-14T00:00:00Z",
      updated_at: "2026-08-14T01:00:00Z",
    });

    const prepared = prepareTreeForPersistence(source);

    expect(prepared).toMatchObject({
      [TREE_SCHEMA_VERSION_FIELD]: CURRENT_TREE_SCHEMA_VERSION,
      schemaVersion: 2,
      id: source.id,
    });
    expect(prepared).not.toHaveProperty("storageRevision");
    expect(prepared).not.toHaveProperty("created_at");
    expect(prepared).not.toHaveProperty("updated_at");
    expect(source).toMatchObject({
      [TREE_SCHEMA_VERSION_FIELD]: LEGACY_TREE_SCHEMA_VERSION,
      storageRevision: 8,
    });
  });

  it("rejects a current persisted tree with an unnormalised domain schema", () => {
    expect(() => prepareTreeForPersistence(currentTree({ schemaVersion: 17 }))).toThrowError(
      expect.objectContaining({ code: TREE_DATA_ERROR_CODES.INVALID }),
    );
  });

  it("quarantines future and invalid explicit versions before they can be restamped", () => {
    const future = currentTree({
      [TREE_SCHEMA_VERSION_FIELD]: CURRENT_TREE_SCHEMA_VERSION + 1,
    });
    const invalid = currentTree({ [TREE_SCHEMA_VERSION_FIELD]: "2" });

    for (const operation of [
      () => readTreeForStorage(future),
      () => prepareTreeForPersistence(future),
    ]) {
      try {
        operation();
        throw new Error("Expected the future schema to be rejected.");
      } catch (error) {
        expect(isTreeDataValidationError(error)).toBe(true);
        expect(error).toMatchObject({ code: TREE_DATA_ERROR_CODES.UNSUPPORTED_VERSION });
      }
    }
    expect(() => prepareTreeForPersistence(invalid)).toThrowError(
      expect.objectContaining({ code: TREE_DATA_ERROR_CODES.INVALID }),
    );
  });

  it("requires the current envelope, unique identifiers and resolvable core references", () => {
    const missingCollection = currentTree({ properties: undefined });
    const brokenReferences = currentTree({
      people: [{ id: "person-1", fatherId: "missing-person" }, { id: "person-1" }],
      familyGroups: [
        {
          id: "group-1",
          rootPersonId: "missing-person",
          personIds: ["person-1", "missing-person"],
        },
      ],
      settings: { activePropertyId: "missing-property" },
    });
    const nullReference = currentTree({
      people: [{ id: "person-1", fatherId: null }],
    });
    const malformedSuccession = currentTree({ succession: "not-an-object" });

    for (const tree of [missingCollection, brokenReferences, nullReference, malformedSuccession]) {
      try {
        readTreeForStorage(tree);
        throw new Error("Expected the malformed current tree to be rejected.");
      } catch (error) {
        expect(error).toMatchObject({ code: TREE_DATA_ERROR_CODES.INVALID });
        expect(error.issues.length).toBeGreaterThan(0);
      }
    }
  });

  it("rejects cycles in parent relationships", () => {
    const tree = currentTree({
      people: [
        { id: "person-1", fatherId: "person-2" },
        { id: "person-2", fatherId: "person-1" },
      ],
      familyGroups: [
        {
          id: "group-1",
          rootPersonId: "person-1",
          personIds: ["person-1", "person-2"],
        },
      ],
    });

    try {
      readTreeForStorage(tree);
      throw new Error("Expected the parent cycle to be rejected.");
    } catch (error) {
      expect(error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "parent-cycle" })]),
      );
    }
  });

  it("bounds unique ancestry reachability pairs before the graph becomes expensive", () => {
    const people = Array.from({ length: 448 }, (_, index) => ({
      id: `ancestor-${index}`,
      ...(index > 0 ? { fatherId: `ancestor-${index - 1}` } : {}),
    }));
    const tree = currentTree({
      people,
      familyGroups: [
        {
          id: "group-1",
          rootPersonId: "ancestor-447",
          personIds: ["ancestor-447"],
        },
      ],
    });

    expect(() => readTreeForStorage(tree)).toThrowError(
      expect.objectContaining({
        code: TREE_DATA_ERROR_CODES.TOO_LARGE,
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "too-many-ancestry-pairs" }),
        ]),
      }),
    );
  });

  it("allows incomplete drafts, blank money, attempted oversales and CM over-declarations", () => {
    const tree = currentTree({
      people: [
        {
          id: "person-1",
          causaMortisDeclarations: [
            {
              id: "cm-1",
              propertyId: "property-1",
              declaredNumerator: 5,
              declaredDenominator: 2,
              declaredValue: "",
              declarantPersonIds: ["person-2"],
              status: "draft",
            },
          ],
        },
        { id: "person-2" },
      ],
      familyGroups: [
        {
          id: "group-1",
          rootPersonId: "person-1",
          personIds: ["person-1", "person-2"],
        },
      ],
      properties: [
        {
          id: "property-1",
          owners: [{ id: "owner-1", personId: "person-1", numerator: 1, denominator: 16 }],
          transfers: [
            {
              id: "transfer-1",
              sellerId: "person-1",
              buyerId: "person-2",
              numerator: 99,
              denominator: 1,
              value: "",
              status: "draft",
            },
          ],
          declarations: [],
          saleLots: [],
        },
      ],
    });

    expect(readTreeForStorage(tree)).toEqual(tree);
    expect(prepareTreeForPersistence(tree)).toEqual(tree);
  });

  it("enforces finite depth, text and collection limits", () => {
    const titleTooLong = currentTree({
      title: "x".repeat(TREE_DATA_LIMITS.maxTitleCharacters + 1),
    });
    const tooLong = currentTree({
      notes: "x".repeat(TREE_DATA_LIMITS.maxStringBytes + 1),
    });
    const tooManyPeople = currentTree({
      people: Array.from({ length: TREE_DATA_LIMITS.maxPeople + 1 }, (_, index) => ({
        id: `person-${index}`,
      })),
    });
    const tooDeep = currentTree();
    let cursor = tooDeep;
    for (let index = 0; index <= TREE_DATA_LIMITS.maxDepth; index += 1) {
      cursor.extra = {};
      cursor = cursor.extra;
    }

    for (const tree of [titleTooLong, tooLong, tooManyPeople, tooDeep]) {
      expect(() => readTreeForStorage(tree)).toThrowError(
        expect.objectContaining({ code: TREE_DATA_ERROR_CODES.INVALID }),
      );
    }
  });

  it("rejects non-JSON values and unsafe object keys", () => {
    const nonFinite = currentTree({ customAmount: Number.POSITIVE_INFINITY });
    const unsafe = currentTree({
      custom: JSON.parse('{"__proto__":{"polluted":true}}'),
    });

    for (const tree of [nonFinite, unsafe]) {
      expect(() => prepareTreeForPersistence(tree)).toThrowError(
        expect.objectContaining({ code: TREE_DATA_ERROR_CODES.INVALID }),
      );
    }
    expect({}.polluted).toBeUndefined();
  });
});
