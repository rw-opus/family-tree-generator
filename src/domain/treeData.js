import { CASE_SCHEMA_VERSION } from "./caseModel.js";

export const TREE_SCHEMA_VERSION_FIELD = "tree_schema_version";
export const LEGACY_TREE_SCHEMA_VERSION = 1;
export const CURRENT_TREE_SCHEMA_VERSION = 2;

export const TREE_DATA_ERROR_CODES = Object.freeze({
  INVALID: "TREE_DATA_INVALID",
  TOO_LARGE: "TREE_DATA_TOO_LARGE",
  UNSUPPORTED_VERSION: "TREE_DATA_UNSUPPORTED_VERSION",
});

// These limits are intentionally far above a normal professional matter, but
// finite so a malformed browser payload cannot turn persistence into an
// unbounded JSON walk. Keep the database policy at least as strict as this one.
export const TREE_DATA_LIMITS = Object.freeze({
  maxTreeBytes: 8 * 1024 * 1024,
  maxDepth: 20,
  maxNodes: 100_000,
  maxStringBytes: 50_000,
  maxKeyBytes: 200,
  maxArrayItems: 20_000,
  maxObjectKeys: 2_000,
  maxIdBytes: 200,
  maxTitleCharacters: 200,
  maxPeople: 2_000,
  maxFamilyGroups: 500,
  maxProperties: 100,
  maxOutsideParties: 2_000,
  maxRelationshipReferences: 50_000,
  maxAncestryPairs: 100_000,
  maxOwners: 20_000,
  maxTransfers: 20_000,
  maxDeclarations: 20_000,
  maxSaleLots: 20_000,
  maxWorkspaceBytes: 32 * 1024 * 1024,
  maxWorkspaceTrees: 500,
});

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_REPORTED_ISSUES = 25;

const utf8Encoder = new TextEncoder();

export const utf8ByteLength = (value) => utf8Encoder.encode(String(value ?? "")).byteLength;

const isRecord = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const pathKey = (path, key) =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;

export class TreeDataValidationError extends Error {
  constructor(code, message, issues = []) {
    super(message);
    this.name = "TreeDataValidationError";
    this.code = code;
    this.issues = issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => ({ ...issue }));
  }
}

export const isTreeDataValidationError = (error) =>
  error instanceof TreeDataValidationError ||
  Object.values(TREE_DATA_ERROR_CODES).includes(error?.code);

const validationError = (issues, message = "This family record has an invalid structure.") =>
  new TreeDataValidationError(TREE_DATA_ERROR_CODES.INVALID, message, issues);

const issue = (code, path, message) => ({ code, path, message });

function requireRecord(value, path, issues) {
  if (isRecord(value)) return true;
  issues.push(issue("record-required", path, "An object is required."));
  return false;
}

function requireArray(value, path, issues) {
  if (Array.isArray(value)) return true;
  issues.push(issue("array-required", path, "An array is required."));
  return false;
}

function validateIdentifier(value, path, issues, { required = true } = {}) {
  if (!required && (value === undefined || value === "")) return "";
  if (typeof value !== "string" || !value.trim()) {
    issues.push(issue("invalid-id", path, "A non-empty text identifier is required."));
    return "";
  }
  if (utf8ByteLength(value) > TREE_DATA_LIMITS.maxIdBytes) {
    issues.push(issue("id-too-long", path, "The identifier is too long."));
    return "";
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    issues.push(issue("invalid-id", path, "The identifier contains control characters."));
    return "";
  }
  return value;
}

function uniqueRecordIds(records, path, issues) {
  const ids = new Set();
  records.forEach((record, index) => {
    const itemPath = `${path}[${index}]`;
    if (!requireRecord(record, itemPath, issues)) return;
    const id = validateIdentifier(record.id, `${itemPath}.id`, issues);
    if (!id) return;
    if (ids.has(id)) {
      issues.push(issue("duplicate-id", `${itemPath}.id`, "Identifiers must be unique."));
      return;
    }
    ids.add(id);
  });
  return ids;
}

function inspectJsonValue(root) {
  const issues = [];
  const seen = new WeakSet();
  const stack = [{ value: root, path: "$", depth: 0 }];
  let nodes = 0;

  while (stack.length && issues.length < MAX_REPORTED_ISSUES) {
    const { value, path, depth } = stack.pop();
    nodes += 1;
    if (nodes > TREE_DATA_LIMITS.maxNodes) {
      issues.push(issue("too-many-nodes", "$", "The family record contains too many values."));
      break;
    }
    if (depth > TREE_DATA_LIMITS.maxDepth) {
      issues.push(issue("too-deep", path, "The family record is nested too deeply."));
      continue;
    }

    if (value === null || typeof value === "boolean") continue;
    if (typeof value === "string") {
      if (utf8ByteLength(value) > TREE_DATA_LIMITS.maxStringBytes) {
        issues.push(issue("string-too-long", path, "A text value is too long."));
      }
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        issues.push(issue("non-finite-number", path, "Numbers must be finite."));
      }
      continue;
    }
    if (typeof value !== "object") {
      issues.push(issue("non-json-value", path, "Only JSON-compatible values are allowed."));
      continue;
    }
    if (seen.has(value)) {
      issues.push(issue("cyclic-value", path, "Cyclic object references are not allowed."));
      continue;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      if (value.length > TREE_DATA_LIMITS.maxArrayItems) {
        issues.push(issue("array-too-long", path, "An array contains too many entries."));
        continue;
      }
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: value[index], path: `${path}[${index}]`, depth: depth + 1 });
      }
      continue;
    }

    if (!isRecord(value)) {
      issues.push(issue("non-json-object", path, "Only plain JSON objects are allowed."));
      continue;
    }
    const keys = Object.keys(value);
    if (keys.length > TREE_DATA_LIMITS.maxObjectKeys) {
      issues.push(issue("object-too-large", path, "An object contains too many fields."));
      continue;
    }
    keys.forEach((key) => {
      const keyPath = pathKey(path, key);
      if (DANGEROUS_KEYS.has(key)) {
        issues.push(issue("unsafe-key", keyPath, "This field name is not allowed."));
      } else if (utf8ByteLength(key) > TREE_DATA_LIMITS.maxKeyBytes) {
        issues.push(issue("key-too-long", keyPath, "A field name is too long."));
      }
      stack.push({ value: value[key], path: keyPath, depth: depth + 1 });
    });
  }

  if (issues.length) throw validationError(issues);

  let serialized;
  try {
    serialized = JSON.stringify(root);
  } catch {
    throw validationError([
      issue("not-serializable", "$", "The family record cannot be serialized safely."),
    ]);
  }
  if (utf8ByteLength(serialized) > TREE_DATA_LIMITS.maxTreeBytes) {
    throw new TreeDataValidationError(
      TREE_DATA_ERROR_CODES.TOO_LARGE,
      "This family record is too large to save safely.",
      [issue("tree-too-large", "$", "The serialized family record exceeds the size limit.")],
    );
  }
}

export function readTreeSchemaVersion(value) {
  if (!isRecord(value)) {
    throw validationError([issue("record-required", "$", "A family object is required.")]);
  }
  if (!Object.prototype.hasOwnProperty.call(value, TREE_SCHEMA_VERSION_FIELD)) {
    return LEGACY_TREE_SCHEMA_VERSION;
  }

  const version = value[TREE_SCHEMA_VERSION_FIELD];
  if (!Number.isSafeInteger(version) || version < LEGACY_TREE_SCHEMA_VERSION) {
    throw validationError(
      [
        issue(
          "invalid-schema-version",
          `$.${TREE_SCHEMA_VERSION_FIELD}`,
          "The family schema version must be a positive integer.",
        ),
      ],
      "This family record has an invalid schema version and has not been changed.",
    );
  }
  if (version > CURRENT_TREE_SCHEMA_VERSION) {
    throw new TreeDataValidationError(
      TREE_DATA_ERROR_CODES.UNSUPPORTED_VERSION,
      "This family was saved by a newer version of the application and has not been changed.",
      [
        issue(
          "unsupported-schema-version",
          `$.${TREE_SCHEMA_VERSION_FIELD}`,
          "The family schema version is newer than this application supports.",
        ),
      ],
    );
  }
  return version;
}

function validateLegacyTree(tree) {
  inspectJsonValue(tree);
  const issues = [];
  validateIdentifier(tree.id, "$.id", issues);
  if (requireArray(tree.people, "$.people", issues)) {
    if (tree.people.length > TREE_DATA_LIMITS.maxPeople) {
      issues.push(issue("too-many-people", "$.people", "The family has too many people."));
    }
    // Historical data is normalised after this storage gate. In particular,
    // normaliseCase deliberately assigns recovery IDs to missing/duplicate
    // legacy people and exposes warnings to the user. Requiring current IDs
    // here would quarantine data the supported migrator can repair safely.
    tree.people.forEach((person, index) => requireRecord(person, `$.people[${index}]`, issues));
  }
  if (issues.length) {
    throw validationError(
      issues,
      "This saved family is incomplete or damaged and has been kept for recovery.",
    );
  }
}

function optionalRecordArray(record, field, path, issues) {
  const value = record[field];
  if (value === undefined) return [];
  if (!requireArray(value, `${path}.${field}`, issues)) return [];
  value.forEach((item, index) => requireRecord(item, `${path}.${field}[${index}]`, issues));
  return value;
}

function validateReference(value, path, validIds, issues, { required = false } = {}) {
  if (!required && (value === undefined || value === "")) return "";
  const id = validateIdentifier(value, path, issues, { required });
  if (id && !validIds.has(id)) {
    issues.push(issue("missing-reference", path, "The referenced record does not exist."));
  }
  return id;
}

function validateReferenceArray(value, path, validIds, issues) {
  if (value === undefined) return 0;
  if (!requireArray(value, path, issues)) return 0;
  value.forEach((candidate, index) =>
    validateReference(candidate, `${path}[${index}]`, validIds, issues, { required: true }),
  );
  return value.length;
}

function validateRecordPartyReferences(records, path, fields, partyIds, issues) {
  records.forEach((record, index) => {
    if (!isRecord(record)) return;
    fields.forEach((field) =>
      validateReference(record[field], `${path}[${index}].${field}`, partyIds, issues),
    );
  });
}

function validateParentGraph(people, peopleIds, issues) {
  const parentsByPerson = new Map();
  people.forEach((person, index) => {
    if (!isRecord(person) || typeof person.id !== "string") return;
    const parents = [];
    ["fatherId", "motherId"].forEach((field) => {
      const parentId = validateReference(
        person[field],
        `$.people[${index}].${field}`,
        peopleIds,
        issues,
      );
      if (!parentId) return;
      if (!peopleIds.has(parentId)) return;
      if (parentId === person.id) {
        issues.push(
          issue(
            "self-reference",
            `$.people[${index}].${field}`,
            "A person cannot be their own parent.",
          ),
        );
      } else {
        parents.push(parentId);
      }
    });
    if (person.fatherId && person.motherId && person.fatherId === person.motherId) {
      issues.push(
        issue(
          "duplicate-parent",
          `$.people[${index}]`,
          "The same person cannot fill both parent roles.",
        ),
      );
    }
    parentsByPerson.set(person.id, parents);
  });

  const state = new Map();
  const completionOrder = [];
  for (const personId of peopleIds) {
    if (state.get(personId)) continue;
    state.set(personId, 1);
    const stack = [{ personId, parents: parentsByPerson.get(personId) || [], offset: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.offset >= frame.parents.length) {
        state.set(frame.personId, 2);
        completionOrder.push(frame.personId);
        stack.pop();
        continue;
      }
      const parentId = frame.parents[frame.offset];
      frame.offset += 1;
      if (state.get(parentId) === 1) {
        issues.push(
          issue("parent-cycle", "$.people", "Parent relationships cannot contain a cycle."),
        );
        return;
      }
      if (state.get(parentId) === 2) continue;
      state.set(parentId, 1);
      stack.push({ personId: parentId, parents: parentsByPerson.get(parentId) || [], offset: 0 });
    }
  }

  const ancestorsByPerson = new Map();
  let ancestryPairs = 0;
  for (const personId of completionOrder) {
    const ancestors = new Set();
    for (const parentId of parentsByPerson.get(personId) || []) {
      ancestors.add(parentId);
      for (const ancestorId of ancestorsByPerson.get(parentId) || []) {
        ancestors.add(ancestorId);
      }
      if (ancestryPairs + ancestors.size > TREE_DATA_LIMITS.maxAncestryPairs) {
        throw new TreeDataValidationError(
          TREE_DATA_ERROR_CODES.TOO_LARGE,
          "This family contains too many ancestry relationships to save safely.",
          [
            issue(
              "too-many-ancestry-pairs",
              "$.people",
              "The ancestry graph exceeds the safe reachability limit.",
            ),
          ],
        );
      }
    }
    ancestorsByPerson.set(personId, ancestors);
    ancestryPairs += ancestors.size;
  }
}

function validateCurrentTree(tree) {
  inspectJsonValue(tree);
  const issues = [];
  if (tree[TREE_SCHEMA_VERSION_FIELD] !== CURRENT_TREE_SCHEMA_VERSION) {
    issues.push(
      issue(
        "invalid-schema-version",
        `$.${TREE_SCHEMA_VERSION_FIELD}`,
        "The current family schema version is required for persistence.",
      ),
    );
  }
  if (tree.schemaVersion !== CASE_SCHEMA_VERSION) {
    issues.push(
      issue(
        "invalid-domain-schema-version",
        "$.schemaVersion",
        `The current case schema version (${CASE_SCHEMA_VERSION}) is required for persistence.`,
      ),
    );
  }

  validateIdentifier(tree.id, "$.id", issues);
  if (typeof tree.title !== "string" || !tree.title.trim()) {
    issues.push(issue("invalid-title", "$.title", "A family title is required."));
  } else if ([...tree.title].length > TREE_DATA_LIMITS.maxTitleCharacters) {
    issues.push(issue("title-too-long", "$.title", "The family title is too long."));
  }

  const coreCollections = ["people", "familyGroups", "properties", "outsideParties"];
  const collections = Object.fromEntries(
    coreCollections.map((field) => [
      field,
      requireArray(tree[field], `$.${field}`, issues) ? tree[field] : [],
    ]),
  );
  requireRecord(tree.settings, "$.settings", issues);

  if (collections.people.length > TREE_DATA_LIMITS.maxPeople) {
    issues.push(issue("too-many-people", "$.people", "The family has too many people."));
  } else if (!collections.people.length) {
    issues.push(
      issue("people-required", "$.people", "The family must contain at least one person."),
    );
  }
  if (collections.familyGroups.length > TREE_DATA_LIMITS.maxFamilyGroups) {
    issues.push(
      issue("too-many-family-groups", "$.familyGroups", "The family has too many tree groups."),
    );
  } else if (!collections.familyGroups.length) {
    issues.push(
      issue("family-group-required", "$.familyGroups", "The family must contain a tree group."),
    );
  }
  if (collections.properties.length > TREE_DATA_LIMITS.maxProperties) {
    issues.push(
      issue("too-many-properties", "$.properties", "The family has too many properties."),
    );
  } else if (!collections.properties.length) {
    issues.push(issue("property-required", "$.properties", "The family must contain a property."));
  }
  if (collections.outsideParties.length > TREE_DATA_LIMITS.maxOutsideParties) {
    issues.push(
      issue(
        "too-many-outside-parties",
        "$.outsideParties",
        "The family has too many outside parties.",
      ),
    );
  }

  const peopleIds = uniqueRecordIds(collections.people, "$.people", issues);
  const groupIds = uniqueRecordIds(collections.familyGroups, "$.familyGroups", issues);
  const propertyIds = uniqueRecordIds(collections.properties, "$.properties", issues);
  const outsidePartyIds = uniqueRecordIds(collections.outsideParties, "$.outsideParties", issues);
  outsidePartyIds.forEach((id) => {
    if (peopleIds.has(id)) {
      issues.push(
        issue(
          "duplicate-party-id",
          "$.outsideParties",
          "Person and outside-party identifiers must not overlap.",
        ),
      );
    }
  });
  const partyIds = new Set([...peopleIds, ...outsidePartyIds]);

  validateReference(tree.activeFamilyGroupId, "$.activeFamilyGroupId", groupIds, issues, {
    required: true,
  });
  if (isRecord(tree.settings)) {
    validateReference(
      tree.settings.activePropertyId,
      "$.settings.activePropertyId",
      propertyIds,
      issues,
      { required: true },
    );
  }

  let relationshipReferences = 0;
  let personDeclarations = 0;
  validateParentGraph(collections.people, peopleIds, issues);
  collections.people.forEach((person, personIndex) => {
    if (!isRecord(person)) return;
    const personPath = `$.people[${personIndex}]`;
    validateReference(
      person.survivalStatusReferencePersonId,
      `${personPath}.survivalStatusReferencePersonId`,
      peopleIds,
      issues,
    );
    ["spouseIds", "siblingIds"].forEach((field) => {
      const references = person[field];
      relationshipReferences += validateReferenceArray(
        references,
        `${personPath}.${field}`,
        peopleIds,
        issues,
      );
      if (Array.isArray(references) && references.includes(person.id)) {
        issues.push(
          issue(
            "self-reference",
            `${personPath}.${field}`,
            "A relationship cannot refer to itself.",
          ),
        );
      }
    });

    const partnerRelationships = optionalRecordArray(
      person,
      "partnerRelationships",
      personPath,
      issues,
    );
    partnerRelationships.forEach((relationship, index) => {
      if (!isRecord(relationship)) return;
      relationshipReferences += 1;
      const partnerId = validateReference(
        relationship.personId,
        `${personPath}.partnerRelationships[${index}].personId`,
        peopleIds,
        issues,
        { required: true },
      );
      if (partnerId && partnerId === person.id) {
        issues.push(
          issue(
            "self-reference",
            `${personPath}.partnerRelationships[${index}].personId`,
            "A relationship cannot refer to itself.",
          ),
        );
      }
    });

    ["willHeirs", "intestateHeirs"].forEach((field) => {
      const rows = optionalRecordArray(person, field, personPath, issues);
      validateRecordPartyReferences(rows, `${personPath}.${field}`, ["personId"], partyIds, issues);
    });
    optionalRecordArray(person, "wills", personPath, issues);
    if (person.designations !== undefined) {
      if (requireArray(person.designations, `${personPath}.designations`, issues)) {
        person.designations.forEach((designation, index) => {
          if (typeof designation !== "string") {
            issues.push(
              issue(
                "invalid-designation",
                `${personPath}.designations[${index}]`,
                "A designation must be text.",
              ),
            );
          }
        });
      }
    }
    const declarations = optionalRecordArray(person, "causaMortisDeclarations", personPath, issues);
    personDeclarations += declarations.length;
    declarations.forEach((declaration, index) => {
      if (!isRecord(declaration)) return;
      relationshipReferences += validateReferenceArray(
        declaration.declarantPersonIds,
        `${personPath}.causaMortisDeclarations[${index}].declarantPersonIds`,
        partyIds,
        issues,
      );
      validateReference(
        declaration.propertyId,
        `${personPath}.causaMortisDeclarations[${index}].propertyId`,
        propertyIds,
        issues,
      );
    });
  });

  collections.familyGroups.forEach((group, index) => {
    if (!isRecord(group)) return;
    const groupPath = `$.familyGroups[${index}]`;
    const members = Array.isArray(group.personIds) ? group.personIds : [];
    if (Array.isArray(group.personIds)) {
      relationshipReferences += validateReferenceArray(
        group.personIds,
        `${groupPath}.personIds`,
        peopleIds,
        issues,
      );
    } else {
      requireArray(group.personIds, `${groupPath}.personIds`, issues);
    }
    if (typeof group.rootPersonId !== "string") {
      issues.push(
        issue(
          "root-person-id-required",
          `${groupPath}.rootPersonId`,
          "The group root identifier must be text, even when blank.",
        ),
      );
    }
    const rootPersonId =
      typeof group.rootPersonId === "string"
        ? validateReference(group.rootPersonId, `${groupPath}.rootPersonId`, peopleIds, issues)
        : "";
    if (rootPersonId && !members.includes(rootPersonId)) {
      issues.push(
        issue(
          "root-not-in-group",
          `${groupPath}.rootPersonId`,
          "The group root must also be a group member.",
        ),
      );
    }
  });

  let owners = 0;
  let transfers = 0;
  let declarations = personDeclarations;
  let saleLots = 0;
  collections.properties.forEach((property, index) => {
    if (!isRecord(property)) return;
    const propertyPath = `$.properties[${index}]`;
    const propertyOwners = optionalRecordArray(property, "owners", propertyPath, issues);
    const propertyTransfers = optionalRecordArray(property, "transfers", propertyPath, issues);
    const propertyDeclarations = optionalRecordArray(
      property,
      "declarations",
      propertyPath,
      issues,
    );
    const propertySaleLots = optionalRecordArray(property, "saleLots", propertyPath, issues);
    owners += propertyOwners.length;
    transfers += propertyTransfers.length;
    declarations += propertyDeclarations.length;
    saleLots += propertySaleLots.length;
    validateRecordPartyReferences(
      propertyOwners,
      `${propertyPath}.owners`,
      ["personId"],
      partyIds,
      issues,
    );
    validateRecordPartyReferences(
      propertyTransfers,
      `${propertyPath}.transfers`,
      ["sellerId", "buyerId"],
      partyIds,
      issues,
    );
    validateRecordPartyReferences(
      propertySaleLots,
      `${propertyPath}.saleLots`,
      ["ownerId"],
      partyIds,
      issues,
    );
  });

  const rootTransfers = optionalRecordArray(tree, "transfers", "$", issues);
  const rootDeclarations = optionalRecordArray(tree, "declarations", "$", issues);
  const rootSaleLots = optionalRecordArray(tree, "saleLots", "$", issues);
  transfers += rootTransfers.length;
  declarations += rootDeclarations.length;
  saleLots += rootSaleLots.length;
  validateRecordPartyReferences(
    rootTransfers,
    "$.transfers",
    ["sellerId", "buyerId"],
    partyIds,
    issues,
  );
  validateRecordPartyReferences(rootSaleLots, "$.saleLots", ["ownerId"], partyIds, issues);

  if (tree.succession !== undefined) requireRecord(tree.succession, "$.succession", issues);
  [tree.heirs, isRecord(tree.succession) ? tree.succession.heirs : undefined].forEach(
    (heirs, sourceIndex) => {
      if (heirs === undefined) return;
      const sourcePath = sourceIndex === 0 ? "$.heirs" : "$.succession.heirs";
      if (!requireArray(heirs, sourcePath, issues)) return;
      validateRecordPartyReferences(heirs, sourcePath, ["personId"], partyIds, issues);
    },
  );

  if (tree.statusToggleSessions !== undefined) {
    const sessions = optionalRecordArray(tree, "statusToggleSessions", "$", issues);
    sessions.forEach((session, index) => {
      if (!isRecord(session)) return;
      validateReference(
        session.personId,
        `$.statusToggleSessions[${index}].personId`,
        peopleIds,
        issues,
        { required: true },
      );
      validateReference(
        session.propertyId,
        `$.statusToggleSessions[${index}].propertyId`,
        propertyIds,
        issues,
      );
      validateReference(
        session.activeFamilyGroupId,
        `$.statusToggleSessions[${index}].activeFamilyGroupId`,
        groupIds,
        issues,
      );
    });
  }

  if (relationshipReferences > TREE_DATA_LIMITS.maxRelationshipReferences) {
    issues.push(
      issue("too-many-relationships", "$", "The family contains too many relationship references."),
    );
  }
  [
    [owners, TREE_DATA_LIMITS.maxOwners, "too-many-owners", "ownership records"],
    [transfers, TREE_DATA_LIMITS.maxTransfers, "too-many-transfers", "transfer records"],
    [
      declarations,
      TREE_DATA_LIMITS.maxDeclarations,
      "too-many-declarations",
      "declaration records",
    ],
    [saleLots, TREE_DATA_LIMITS.maxSaleLots, "too-many-sale-lots", "sale-lot records"],
  ].forEach(([count, limit, code, label]) => {
    if (count > limit) issues.push(issue(code, "$", `The family contains too many ${label}.`));
  });

  if (issues.length) throw validationError(issues);
}

/**
 * Validates a saved tree without upgrading it. Legacy trees remain explicitly
 * version one until the application has normalised their old aliases/defaults.
 */
export function readTreeForStorage(value) {
  const version = readTreeSchemaVersion(value);
  const tree = { ...value, [TREE_SCHEMA_VERSION_FIELD]: version };
  if (version === CURRENT_TREE_SCHEMA_VERSION) validateCurrentTree(tree);
  else validateLegacyTree(tree);
  return tree;
}

/**
 * Removes server-owned metadata, stamps the current persisted schema and
 * validates the exact object that may cross a local or cloud storage boundary.
 */
export function prepareTreeForPersistence(value) {
  // Detect invalid/future explicit versions before stamping. An older client
  // must never silently reinterpret and overwrite a newer tree.
  readTreeSchemaVersion(value);
  const tree = { ...value };
  delete tree.storageRevision;
  delete tree.created_at;
  delete tree.updated_at;
  tree[TREE_SCHEMA_VERSION_FIELD] = CURRENT_TREE_SCHEMA_VERSION;
  validateCurrentTree(tree);
  return tree;
}
