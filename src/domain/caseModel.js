import { normalizePartnerRelationships } from "./partnerRelationships.js";
import { synchroniseMaritalStatusAtDeath } from "./maritalStatusAtDeath.js";
import { normalisePersonNameFields, personGivenNames } from "./people.js";
import {
  applyOlderGenerationDeathAssumptions,
  synchroniseDeceasedStatus,
} from "./deceasedStatus.js";
import { synchronisePotentialParentSurvival } from "./potentialParentSurvival.js";
import { personWithWills } from "./wills.js";
import { propertyTaxWorkspaceEnabled } from "./treeWorkspaceMode.js";
import {
  INTESTACY_CONFIRMATION_SIGNATURE_VERSION,
  intestacyAllocationSignature,
  intestateAllocations,
  legacyIntestacyAllocationSignature,
} from "./familyOwnership.js";

export const CASE_SCHEMA_VERSION = 2;

const DEFAULT_CASE_ID = "legacy-case";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [key, cloneValue(nestedValue)]),
  );
}

// Normalisation creates a safe, complete tree. Reuse exact canonical input
// branches in the result so a small edit does not make every family member
// look new to React. Schema and legal-state changes still receive new values.
function reuseUnchangedValue(previous, next) {
  if (Object.is(previous, next)) return previous;
  if (Array.isArray(previous) && Array.isArray(next)) {
    if (previous.length !== next.length) return next;
    const values = next.map((value, index) => reuseUnchangedValue(previous[index], value));
    return values.every((value, index) => value === previous[index]) ? previous : values;
  }
  if (!isRecord(previous) || !isRecord(next)) return next;
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  if (previousKeys.length !== nextKeys.length) return next;
  const values = {};
  let unchanged = true;
  for (const key of nextKeys) {
    if (!Object.prototype.hasOwnProperty.call(previous, key)) return next;
    const value = reuseUnchangedValue(previous[key], next[key]);
    values[key] = value;
    if (value !== previous[key]) unchanged = false;
  }
  return unchanged ? previous : values;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueIds(values = []) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  return values.filter((value) => {
    const id = text(value);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function normalizeNestedRecordIds(value, scopeId, recordType) {
  if (!Array.isArray(value)) return value;
  const reservedIds = new Set(value.map((record) => text(record?.id)).filter(Boolean));
  const usedIds = new Set();
  return value.map((record, index) => {
    if (!isRecord(record)) return cloneValue(record);
    const requestedId = text(record.id);
    if (requestedId && !usedIds.has(requestedId)) {
      usedIds.add(requestedId);
      return { ...cloneValue(record), id: requestedId };
    }

    const baseId = `${text(scopeId) || "record"}:${recordType}:${index + 1}`;
    let id = baseId;
    let recoveryOrdinal = 2;
    while (reservedIds.has(id) || usedIds.has(id)) {
      id = `${baseId}:recovered:${recoveryOrdinal}`;
      recoveryOrdinal += 1;
    }
    usedIds.add(id);
    return { ...cloneValue(record), id };
  });
}

function normalizePersonNestedRecordIds(person) {
  if (!Array.isArray(person.willHeirs)) return person;
  return {
    ...person,
    willHeirs: normalizeNestedRecordIds(person.willHeirs, person.id, "will-heir"),
  };
}

function normalizePropertyNestedRecordIds(property, scopeId) {
  if (!isRecord(property)) return cloneValue(property);
  const normalized = cloneValue(property);
  if (Array.isArray(normalized.owners)) {
    normalized.owners = normalizeNestedRecordIds(normalized.owners, scopeId, "owner");
  }
  if (Array.isArray(normalized.transfers)) {
    normalized.transfers = normalizeNestedRecordIds(normalized.transfers, scopeId, "transfer");
  }
  return normalized;
}

function bindLegacyCausaMortisDeclarationsToProperty(people = [], propertyId = "") {
  const solePropertyId = text(propertyId);
  if (!solePropertyId) return people;

  return people.map((person) => {
    if (!Array.isArray(person.causaMortisDeclarations)) return person;
    let changed = false;
    const causaMortisDeclarations = person.causaMortisDeclarations.map((declaration) => {
      if (!isRecord(declaration) || text(declaration.propertyId)) return declaration;
      changed = true;
      return { ...declaration, propertyId: solePropertyId };
    });
    return changed ? { ...person, causaMortisDeclarations } : person;
  });
}

function familyGroupId(caseId, ordinal) {
  return `${caseId}:family-group:${ordinal}`;
}

function nextFamilyGroupId(caseData) {
  const usedIds = new Set((caseData.familyGroups || []).map((group) => group.id));
  let ordinal = 1;
  while (usedIds.has(familyGroupId(caseData.id, ordinal))) ordinal += 1;
  return familyGroupId(caseData.id, ordinal);
}

const LEGACY_PERSON_REFERENCE_FIELDS = ["fatherId", "motherId", "survivalStatusReferencePersonId"];
const LEGACY_PERSON_COLLECTION_FIELDS = [
  "spouseIds",
  "siblingIds",
  "partnerRelationships",
  "wills",
  "willHeirs",
  "intestateHeirs",
  "causaMortisDeclarations",
  "designations",
];

function normalizeLegacyPersonNulls(person) {
  const normalized = cloneValue(person);
  delete normalized.legacyArticle616Statuses;
  delete normalized.legacyArticle616Estate;
  LEGACY_PERSON_REFERENCE_FIELDS.forEach((field) => {
    if (normalized[field] === null) normalized[field] = "";
  });
  LEGACY_PERSON_COLLECTION_FIELDS.forEach((field) => {
    if (normalized[field] === null) normalized[field] = [];
  });
  return normalized;
}

function normalizePeople(
  people = [],
  { applyLegalNormalisation = true, inferCoParentMarriages = true } = {},
) {
  if (!Array.isArray(people)) {
    return { people: [], warnings: ["The saved people list was malformed and needs review."] };
  }
  const seen = new Set();
  const warnings = [];
  const duplicateCounts = new Map();
  const normalized = people.reduce((result, person, index) => {
    if (!isRecord(person)) {
      warnings.push(`People record ${index + 1} was malformed and could not be restored.`);
      return result;
    }
    const requestedId = text(person.id);
    let id = requestedId || `legacy-person-${index + 1}`;
    if (!requestedId) {
      warnings.push(`Person ${index + 1} had no identifier; a recovery identifier was assigned.`);
    }
    if (seen.has(id)) {
      const ordinal = (duplicateCounts.get(id) || 1) + 1;
      duplicateCounts.set(id, ordinal);
      let recoveredId = `${id}:duplicate:${ordinal}`;
      while (seen.has(recoveredId)) recoveredId = `${recoveredId}:copy`;
      warnings.push(
        `Duplicate person identifier “${id}” was preserved as a separate unlinked record (${recoveredId}).`,
      );
      id = recoveredId;
    }
    seen.add(id);
    result.push(
      normalizePersonNestedRecordIds(
        personWithWills(normalisePersonNameFields({ ...normalizeLegacyPersonNulls(person), id })),
      ),
    );
    return result;
  }, []);
  const deceasedPeople =
    applyOlderGenerationDeathAssumptions(normalized).map(synchroniseDeceasedStatus);
  // A father and mother recorded in a pure genealogy are co-parents, not proof
  // of marriage. Persist that distinction so enabling legal tools later cannot
  // silently manufacture a surviving-spouse assumption.
  const relationshipPeople = applyLegalNormalisation
    ? deceasedPeople
    : deceasedPeople.map((person) =>
        person.fatherId && person.motherId
          ? { ...person, coParentRelationshipExplicitOnly: true }
          : person,
      );
  const relationalPeople = applySoleSpouseParentAssumptions(
    normalizePartnerRelationships(relationshipPeople, {
      inferCoParents: inferCoParentMarriages,
    }),
  );
  if (!applyLegalNormalisation) {
    return { people: relationalPeople, warnings };
  }
  const survivalNormalised = relationalPeople.map(synchronisePotentialParentSurvival);
  return {
    people: synchroniseMaritalStatusAtDeath(survivalNormalised),
    warnings,
  };
}

/**
 * A child recorded against one parent belongs to that marriage. Where the
 * recorded parent has exactly one partner there is nothing to decide, so the
 * other parent is filled in rather than raised as a question. Where the parent
 * had more than one partner the child could belong to either marriage, and the
 * gap is deliberately left for the person card to ask about.
 *
 * A parent the user has explicitly cleared is never re-inferred.
 */
function applySoleSpouseParentAssumptions(people = []) {
  // These people have already been through normalizePartnerRelationships, so
  // spouseIds is authoritative here. Calling partnerIdsForPerson instead would
  // re-normalise the entire list once per person, which is quadratic and, on a
  // large imported family, slow enough to stall the workspace.
  const partnersById = new Map(
    people.map((person) => [person.id, Array.isArray(person.spouseIds) ? person.spouseIds : []]),
  );
  let changed = false;
  const next = people.map((person) => {
    const infer = (recordedParentId, missingField, clearedFlag) => {
      if (!recordedParentId || person[missingField] || person[clearedFlag] === true) return "";
      const partners = partnersById.get(recordedParentId) || [];
      if (partners.length !== 1) return "";
      const partnerId = partners[0];
      return partnerId && partnerId !== person.id ? partnerId : "";
    };
    const motherId = infer(person.fatherId, "motherId", "motherExplicitlyUnassigned");
    const fatherId = infer(person.motherId, "fatherId", "fatherExplicitlyUnassigned");
    if (!motherId && !fatherId) return person;
    changed = true;
    return {
      ...person,
      ...(motherId ? { motherId } : {}),
      ...(fatherId ? { fatherId } : {}),
    };
  });
  return changed ? next : people;
}

function isUntouchedLegacyPotentialParent(person, people, protectedPersonIds) {
  if (
    person?.isPotentialIntestateParent !== true ||
    person?.survivalStatusRequired !== true ||
    person?.potentialParentAddedExplicitly === true ||
    protectedPersonIds.has(person?.id)
  ) {
    return false;
  }

  const sex = String(person.sex || "").toLowerCase();
  if (sex !== "female" && sex !== "male") return false;
  const role = sex === "female" ? "mother" : "father";
  const generatedName = text(person.fullName || person.givenNames).toLowerCase();
  const referencePersonId = text(person.survivalStatusReferencePersonId);
  const referencePerson = people.find((candidate) => candidate.id === referencePersonId);
  const referenceName = personGivenNames(referencePerson).trim() || text(referencePerson?.fullName);
  const expectedName = `${role} of ${referenceName}`.toLowerCase();
  if (
    !referencePerson ||
    !referenceName ||
    generatedName !== expectedName ||
    referencePerson[`${role}Id`] !== person.id
  ) {
    return false;
  }

  const children = people.filter(
    (candidate) => candidate.fatherId === person.id || candidate.motherId === person.id,
  );
  if (children.length !== 1 || children[0].id !== referencePersonId) return false;

  // Partner normalisation infers a marriage between the two recorded parents
  // of a child. That derived spouseIds link must not make old, silently-created
  // parent placeholders look user-edited and therefore permanent. Explicit
  // relationship metadata or any other spouse link remains durable user data.
  const inferredCoParentIds = new Set(
    people
      .filter((candidate) => {
        if (
          candidate.id === person.id ||
          candidate.isPotentialIntestateParent !== true ||
          candidate.survivalStatusRequired !== true ||
          candidate.potentialParentAddedExplicitly === true ||
          text(candidate.survivalStatusReferencePersonId) !== referencePersonId ||
          records(candidate.partnerRelationships).length
        ) {
          return false;
        }
        const referenceParents = new Set([referencePerson.fatherId, referencePerson.motherId]);
        return referenceParents.has(person.id) && referenceParents.has(candidate.id);
      })
      .map((candidate) => candidate.id),
  );
  const durableSpouseIds = uniqueIds(person.spouseIds).filter(
    (personId) => !inferredCoParentIds.has(personId),
  );

  const designations = Array.isArray(person.designations)
    ? person.designations.map((designation) => text(designation).toLowerCase()).filter(Boolean)
    : [];
  if (designations.some((designation) => designation !== "parent")) return false;
  if (
    text(person.surname) ||
    text(person.surnameAtBirth) ||
    text(person.fatherId) ||
    text(person.motherId) ||
    text(person.dateOfBirth) ||
    text(person.dateOfDeath) ||
    text(person.notes) ||
    person.isDeceased === true ||
    person.unmarriedOrWidowedAtDeath === true ||
    text(person.survivalStatusConfirmed) ||
    (text(person.inheritanceBasis) &&
      text(person.inheritanceBasis).toLowerCase() !== "intestacy") ||
    durableSpouseIds.length ||
    uniqueIds(person.siblingIds).length ||
    records(person.partnerRelationships).length ||
    records(person.wills).length ||
    records(person.willHeirs).length ||
    records(person.intestateHeirs).length ||
    records(person.causaMortisDeclarations).length
  ) {
    return false;
  }

  // Old Person defaults grew over time. Harmless defaults such as
  // `inheritanceBasis: "intestacy"`, empty arrays and display flags must not
  // turn a silently generated placeholder into a permanent ancestor. The
  // explicit marker and the user-entered identity/legal fields above are the
  // durable preservation boundary.
  return true;
}

/**
 * An August 2026 build created unresolved parents merely by opening a person's
 * card. Remove only those untouched generated records. Parents created through
 * the current explicit action carry a durable marker and are never migrated.
 */
function removeLegacyPotentialParents(caseData) {
  const protectedPersonIds = new Set(
    collectCasePersonReferences(caseData, { includeRelationships: false })
      .filter((reference) => reference.kind !== "workflow")
      .map((reference) => reference.personId),
  );
  const removedIds = new Set(
    caseData.people
      .filter((person) =>
        isUntouchedLegacyPotentialParent(person, caseData.people, protectedPersonIds),
      )
      .map((person) => person.id),
  );
  if (!removedIds.size) return caseData;

  const people = caseData.people
    .filter((person) => !removedIds.has(person.id))
    .map((person) => ({
      ...person,
      fatherId: removedIds.has(person.fatherId) ? "" : person.fatherId,
      motherId: removedIds.has(person.motherId) ? "" : person.motherId,
      spouseIds: uniqueIds(person.spouseIds).filter((personId) => !removedIds.has(personId)),
      siblingIds: uniqueIds(person.siblingIds).filter((personId) => !removedIds.has(personId)),
    }));
  return { ...caseData, people: normalizePartnerRelationships(people) };
}

function migrateIntestacyConfirmationSignatures(people = []) {
  return people.map((person) => {
    if (
      person.intestateHeirsConfirmed !== true ||
      !text(person.intestateConfirmationBasis) ||
      text(person.intestateConfirmationBasis).startsWith(
        `${INTESTACY_CONFIRMATION_SIGNATURE_VERSION}::`,
      )
    ) {
      return person;
    }
    const calculated = intestateAllocations(people, person.id);
    if (
      person.intestateConfirmationBasis !== legacyIntestacyAllocationSignature(person, calculated)
    ) {
      return person;
    }
    return {
      ...person,
      intestateConfirmationBasis: intestacyAllocationSignature(person, calculated),
      intestateConfirmationMigratedFromV1: true,
    };
  });
}

function normalizeFamilyGroup(group, index, caseData, validPersonIds, warnings) {
  const normalizedSource = cloneValue(isRecord(group) ? group : {});
  delete normalizedSource.excludedPersonIds;
  const requestedRootId = text(group?.rootPersonId);
  const requestedPersonIds = uniqueIds(group?.personIds);
  const personIds = requestedPersonIds.filter((personId) => validPersonIds.has(personId));
  // Exclusions are durable deletion tombstones, not live Person references.
  // Keep them even after an unreferenced Person has been removed from the
  // canonical registry so a delayed editor update cannot recreate that card.
  const excludedPersonIds = uniqueIds(group?.excludedPersonIds).filter(
    (personId) => !personIds.includes(personId),
  );
  requestedPersonIds
    .filter((personId) => !validPersonIds.has(personId))
    .forEach((personId) =>
      warnings.push(
        `Family group ${index + 1} referred to missing person “${personId}”; the reference needs review.`,
      ),
    );
  const rootPersonId =
    validPersonIds.has(requestedRootId) && !excludedPersonIds.includes(requestedRootId)
      ? requestedRootId
      : personIds[0] || "";
  if (rootPersonId && !personIds.includes(rootPersonId)) personIds.unshift(rootPersonId);

  return {
    ...normalizedSource,
    id: text(group?.id) || familyGroupId(caseData.id, index + 1),
    title:
      text(group?.title) || (index === 0 ? text(caseData.title) : "") || `Family tree ${index + 1}`,
    rootPersonId,
    personIds,
    ...(excludedPersonIds.length ? { excludedPersonIds } : {}),
  };
}

function legacyFamilyGroup(caseData) {
  if (!caseData.people.length) return [];
  return [
    {
      id: familyGroupId(caseData.id, 1),
      title: text(caseData.title) || "Family tree 1",
      rootPersonId: caseData.people[0].id,
      personIds: caseData.people.map((person) => person.id),
    },
  ];
}

/**
 * Adds the version-two family-group model around an existing saved case. Unknown
 * fields remain untouched so older ownership and tax records can continue to be
 * read during the transition.
 */
export function normalizeCase(value = {}) {
  const previous = isRecord(value) ? value : {};
  const source = cloneValue(previous);
  const caseId = text(source.id) || DEFAULT_CASE_ID;
  const applyLegalNormalisation = propertyTaxWorkspaceEnabled(source.settings?.workspaceMode);
  const peopleResult = normalizePeople(source.people, {
    applyLegalNormalisation,
    inferCoParentMarriages: applyLegalNormalisation,
  });
  const people = applyLegalNormalisation
    ? migrateIntestacyConfirmationSignatures(peopleResult.people)
    : peopleResult.people;
  const dataWarnings = [...(Array.isArray(source.dataWarnings) ? source.dataWarnings : [])];
  dataWarnings.push(...peopleResult.warnings);
  const normalizedCaseData = {
    ...source,
    id: caseId,
    people,
    schemaVersion: CASE_SCHEMA_VERSION,
  };
  if (Array.isArray(source.properties)) {
    normalizedCaseData.properties = source.properties.map((property, index) => {
      const propertyId = text(property?.id) || `${caseId}:property:${index + 1}`;
      const normalized = normalizePropertyNestedRecordIds(property, propertyId);
      return isRecord(normalized) ? { ...normalized, id: propertyId } : normalized;
    });
  }
  const legacyPropertyId = text(source.property?.id) || "legacy-property";
  if (isRecord(source.property)) {
    normalizedCaseData.property = normalizePropertyNestedRecordIds(
      source.property,
      legacyPropertyId,
    );
  }
  if (Array.isArray(source.owners)) {
    normalizedCaseData.owners = normalizeNestedRecordIds(source.owners, legacyPropertyId, "owner");
  }
  if (Array.isArray(source.transfers)) {
    normalizedCaseData.transfers = normalizeNestedRecordIds(
      source.transfers,
      legacyPropertyId,
      "transfer",
    );
  }
  const currentPropertyIds = Array.isArray(normalizedCaseData.properties)
    ? normalizedCaseData.properties.map((property) => text(property?.id)).filter(Boolean)
    : [];
  if (currentPropertyIds.length === 1) {
    normalizedCaseData.people = bindLegacyCausaMortisDeclarationsToProperty(
      normalizedCaseData.people,
      currentPropertyIds[0],
    );
  }
  const caseData = applyLegalNormalisation
    ? removeLegacyPotentialParents(normalizedCaseData)
    : normalizedCaseData;
  const validPersonIds = new Set(caseData.people.map((person) => person.id));
  const sourceGroups = Array.isArray(source.familyGroups)
    ? source.familyGroups
    : legacyFamilyGroup(caseData);
  const seenGroupIds = new Set();
  const familyGroups = sourceGroups.map((group, index) => {
    const normalized = normalizeFamilyGroup(group, index, caseData, validPersonIds, dataWarnings);
    if (!seenGroupIds.has(normalized.id)) {
      seenGroupIds.add(normalized.id);
      return normalized;
    }
    let ordinal = 2;
    let recoveredId = `${normalized.id}:duplicate:${ordinal}`;
    while (seenGroupIds.has(recoveredId)) {
      ordinal += 1;
      recoveredId = `${normalized.id}:duplicate:${ordinal}`;
    }
    seenGroupIds.add(recoveredId);
    dataWarnings.push(
      `Duplicate family-group identifier “${normalized.id}” was preserved as “${recoveredId}”.`,
    );
    return { ...normalized, id: recoveredId };
  });
  const groupIds = new Set(familyGroups.map((group) => group.id));
  const activeFamilyGroupId = groupIds.has(source.activeFamilyGroupId)
    ? source.activeFamilyGroupId
    : familyGroups[0]?.id || "";

  const result = {
    ...caseData,
    familyGroups,
    activeFamilyGroupId,
  };
  if (Array.isArray(result.statusToggleSessions)) {
    result.statusToggleSessions = result.statusToggleSessions.map((session) => {
      if (!isRecord(session?.personFields)) return session;
      const personFields = { ...session.personFields };
      delete personFields.legacyArticle616Statuses;
      delete personFields.legacyArticle616Estate;
      return { ...session, personFields };
    });
  }
  const uniqueWarnings = [...new Set(dataWarnings.map(text).filter(Boolean))];
  if (uniqueWarnings.length) result.dataWarnings = uniqueWarnings;
  else delete result.dataWarnings;
  return reuseUnchangedValue(previous, result);
}

// British spelling is retained as an alias for the codebase's existing naming style.
export const normaliseCase = normalizeCase;

function addOrMergePerson(people, person) {
  const id = text(person?.id);
  if (!id) return people;
  const index = people.findIndex((candidate) => candidate.id === id);
  if (index < 0) return [...people, { ...cloneValue(person), id }];

  const nextPeople = [...people];
  nextPeople[index] = {
    ...cloneValue(person),
    ...nextPeople[index],
    id,
  };
  return nextPeople;
}

/**
 * Creates a family-tree tab around a new or existing root person.
 */
export function createFamilyGroup(caseValue, rootPerson, options = {}) {
  const caseData = normalizeCase(caseValue);
  const requestedPerson =
    typeof rootPerson === "string"
      ? caseData.people.find((person) => person.id === rootPerson)
      : rootPerson;
  const rootPersonId = text(requestedPerson?.id);
  if (!rootPersonId) return caseData;

  const people = addOrMergePerson(caseData.people, requestedPerson);
  const id = text(options.id) || nextFamilyGroupId(caseData);
  if (caseData.familyGroups.some((group) => group.id === id)) return { ...caseData, people };

  const familyGroup = {
    id,
    title:
      text(options.title) ||
      text(requestedPerson.fullName) ||
      `Family tree ${caseData.familyGroups.length + 1}`,
    rootPersonId,
    personIds: [rootPersonId],
  };
  return {
    ...caseData,
    people,
    familyGroups: [...caseData.familyGroups, familyGroup],
    activeFamilyGroupId: familyGroup.id,
  };
}

/**
 * Adds existing canonical people to a family group, preserving their case-wide
 * identities and avoiding duplicate membership entries.
 */
export function addPersonIdsToFamilyGroup(caseValue, groupId, personIds = []) {
  const caseData = normalizeCase(caseValue);
  return addPersonIdsToNormalisedFamilyGroup(caseData, groupId, personIds);
}

/**
 * Adds group membership to a case that has already crossed the schema
 * normalisation boundary. Keeping this small mutation separate lets live
 * Person edits canonicalise the people registry once, then reconcile the
 * resulting relationship ids without running the whole legal normaliser a
 * second time.
 */
function addPersonIdsToNormalisedFamilyGroup(caseData, groupId, personIds = []) {
  const validPersonIds = new Set(caseData.people.map((person) => person.id));
  const additions = uniqueIds(personIds).filter((personId) => validPersonIds.has(personId));
  return {
    ...caseData,
    familyGroups: caseData.familyGroups.map((group) => {
      if (group.id !== groupId) return group;
      const nextPersonIds = uniqueIds([...group.personIds, ...additions]);
      const nextGroup = {
        ...group,
        rootPersonId: group.rootPersonId || nextPersonIds[0] || "",
        personIds: nextPersonIds,
      };
      const excludedPersonIds = uniqueIds(group.excludedPersonIds).filter(
        (personId) => !additions.includes(personId),
      );
      if (excludedPersonIds.length) nextGroup.excludedPersonIds = excludedPersonIds;
      else delete nextGroup.excludedPersonIds;
      return nextGroup;
    }),
  };
}

export function findFamilyGroupsForPerson(caseValue, personId) {
  const caseData = normalizeCase(caseValue);
  return caseData.familyGroups.filter((group) => group.personIds.includes(personId));
}

function records(value) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function hasRecordedPersonLegalData(person = {}) {
  const hasRecordRows = [
    person.wills,
    person.willHeirs,
    person.intestateHeirs,
    person.causaMortisDeclarations,
  ].some((value) => records(value).length > 0);
  const hasLegacyWill = [
    person.willDate,
    person.willNotaryName,
    person.willDescription,
    person.willNotes,
  ].some((value) => text(value));
  const hasRecordedConfirmation =
    person.willHeirsConfirmed === true ||
    text(person.willHeirsConfirmationSource) ||
    isRecord(person.willHeirsConfirmationSnapshot) ||
    person.intestateHeirsConfirmed === true ||
    text(person.intestateConfirmationBasis) ||
    person.intestateConfirmationMigratedFromV1 === true;
  const hasRecordedLegalStatus =
    text(person.survivalStatusConfirmed) ||
    text(person.unmarriedOrWidowedAtDeathSource) === "manual" ||
    (text(person.inheritanceBasis) && text(person.inheritanceBasis) !== "intestacy");
  return hasRecordRows || hasLegacyWill || hasRecordedConfirmation || hasRecordedLegalStatus;
}

function hasRecordedLegacyOwnership(person = {}) {
  return (
    person.ownershipSharePercent !== undefined &&
    person.ownershipSharePercent !== null &&
    person.ownershipSharePercent !== ""
  );
}

function collectCasePersonReferences(caseData, options = {}) {
  const references = [];
  const includeRelationships = options.includeRelationships !== false;
  const add = (value, label, kind = "case") => {
    const personId = text(value);
    if (personId) references.push({ personId, label, kind });
  };
  const addDeclarations = (
    declarations = [],
    resolvePersonId = (value) => value,
    label = "a declaration of succession",
  ) =>
    records(declarations).forEach((declaration) => {
      records(declaration.participants).forEach((participant) => {
        add(resolvePersonId(participant.heirId), label);
        add(resolvePersonId(participant.personId), label);
      });
      uniqueIds(declaration.heirIds).forEach((personId) => add(resolvePersonId(personId), label));
      uniqueIds(declaration.declarantPersonIds).forEach((personId) =>
        add(resolvePersonId(personId), label),
      );
    });
  const addPersonLegalReferences = (person = {}, resolvePersonId = (value) => value) => {
    records(person.willHeirs).forEach((heir) =>
      add(resolvePersonId(heir.personId), "a will beneficiary record"),
    );
    records(person.intestateHeirs).forEach((heir) =>
      add(resolvePersonId(heir.personId), "a confirmed intestate-heir record"),
    );
    records(person.willHeirsConfirmationSnapshot?.willHeirs).forEach((heir) =>
      add(resolvePersonId(heir.personId), "a saved will-beneficiary review"),
    );
    addDeclarations(
      person.causaMortisDeclarations,
      resolvePersonId,
      "a causa mortis declarant record",
    );
  };
  const addTaxReadinessGuideReferences = (guide = {}) => {
    const source = isRecord(guide) ? guide : {};
    const addGuidePerson = (personId) => add(personId, "a guided tax-review record", "workflow");
    addGuidePerson(source.currentPersonId);
    [
      source.historyPersonIds,
      source.reviewedPersonIds,
      source.skippedPersonIds,
      source.skippedReviewVisitedPersonIds,
      Object.keys(isRecord(source.skippedIssueKeys) ? source.skippedIssueKeys : {}),
    ].forEach((personIds) => uniqueIds(personIds).forEach(addGuidePerson));
  };
  const addPropertyReferences = (property = {}, resolvePersonId = (value) => value) => {
    records(property.owners).forEach((owner) =>
      add(owner.personId, "an initial property ownership record"),
    );
    records(property.transfers).forEach((transfer) => {
      add(resolvePersonId(transfer.sellerId), "an ownership transfer");
      add(resolvePersonId(transfer.buyerId), "an ownership transfer");
      records(transfer.provenance).forEach((portion) => {
        const trancheId = text(portion.trancheId);
        if (trancheId.startsWith("inheritance-")) {
          add(
            resolvePersonId(trancheId.slice("inheritance-".length)),
            "an inheritance provenance record",
          );
        }
      });
    });
    records(property.saleLots).forEach((lot) => {
      add(resolvePersonId(lot.ownerId), "a vendor tax lot");
      add(resolvePersonId(lot.inheritanceSourceDeceasedId), "an inheritance tax source record");
    });
    addDeclarations(property.declarations, resolvePersonId);
    addTaxReadinessGuideReferences(property.taxReadinessGuide);
  };

  const legacyHeirs = [...records(caseData.succession?.heirs), ...records(caseData.heirs)];
  const legacyHeirPersonIds = new Map(
    legacyHeirs
      .map((heir) => [text(heir.id), text(heir.personId)])
      .filter(([heirId, personId]) => heirId && personId),
  );
  const resolveLegacyPersonId = (value) => {
    const requestedId = text(value);
    return legacyHeirPersonIds.get(requestedId) || requestedId;
  };

  addPropertyReferences(caseData, resolveLegacyPersonId);
  records(caseData.properties).forEach((property) => addPropertyReferences(property));
  if (isRecord(caseData.property)) {
    addPropertyReferences(caseData.property, resolveLegacyPersonId);
  }

  legacyHeirs.forEach((heir) => add(heir.personId, "a succession heir record"));
  records(caseData.outsideParties).forEach((party) =>
    add(party.id, "an outside-party identity record"),
  );

  records(caseData.people).forEach((person) => {
    if (hasRecordedPersonLegalData(person)) {
      add(person.id, "recorded succession or legal details");
    }
    if (hasRecordedLegacyOwnership(person)) {
      add(person.id, "a legacy property ownership record");
    }
    if (includeRelationships) {
      if (text(person.fatherId)) add(person.fatherId, "a child relationship", "relationship");
      if (text(person.motherId)) add(person.motherId, "a child relationship", "relationship");
      uniqueIds(person.spouseIds).forEach((personId) =>
        add(personId, "a partner relationship", "relationship"),
      );
      uniqueIds(person.siblingIds).forEach((personId) =>
        add(personId, "a sibling relationship", "relationship"),
      );
    }
    addPersonLegalReferences(person);
  });

  records(caseData.statusToggleSessions).forEach((session) => {
    add(session.personId, "a pending legal-status change");
    addPersonLegalReferences(
      Object.fromEntries(
        Object.entries(session.personFields || {}).map(([field, state]) => [
          field,
          state?.present === true ? state.value : undefined,
        ]),
      ),
    );
  });

  return references;
}

/**
 * Returns every case-wide reason a canonical Person record must be retained.
 * Family-group membership is intentionally excluded because callers handle the
 * requested membership separately.
 */
export function casePersonDependencyLabels(caseValue, personId) {
  const requestedPersonId = text(personId);
  if (!requestedPersonId) return [];
  const caseData = normalizeCase(caseValue);
  return [
    ...new Set(
      collectCasePersonReferences(caseData)
        .filter((reference) => reference.personId === requestedPersonId)
        .map((reference) => reference.label),
    ),
  ];
}

function referencedPartyIds(caseData) {
  return new Set(
    collectCasePersonReferences(caseData, { includeRelationships: false }).map(
      (reference) => reference.personId,
    ),
  );
}

function scrubPeopleFromRelationships(people, personIds) {
  const removedPersonIds = new Set(uniqueIds(personIds));
  if (!removedPersonIds.size) return people;
  return people
    .filter((person) => !removedPersonIds.has(person.id))
    .map((person) => {
      const nextPerson = { ...person };

      if (removedPersonIds.has(person.fatherId)) nextPerson.fatherId = "";
      if (removedPersonIds.has(person.motherId)) nextPerson.motherId = "";
      if (removedPersonIds.has(person.survivalStatusReferencePersonId)) {
        nextPerson.survivalStatusReferencePersonId = "";
      }
      if (Array.isArray(person.spouseIds)) {
        nextPerson.spouseIds = uniqueIds(person.spouseIds).filter(
          (id) => !removedPersonIds.has(id),
        );
      }
      if (Array.isArray(person.siblingIds)) {
        nextPerson.siblingIds = uniqueIds(person.siblingIds).filter(
          (id) => !removedPersonIds.has(id),
        );
      }
      if (Array.isArray(person.partnerRelationships)) {
        nextPerson.partnerRelationships = person.partnerRelationships.filter(
          (relationship) => !removedPersonIds.has(text(relationship?.personId)),
        );
      }

      return nextPerson;
    });
}

function scrubPersonFromRelationships(people, personId) {
  return scrubPeopleFromRelationships(people, [personId]);
}

/**
 * Removes a Person from one family-tree tab. The canonical Person survives
 * while another family group or any case-wide legal/property record still
 * references it. Family relationships are scrubbed only when the canonical
 * identity is genuinely deleted; retained legal identities keep their recorded
 * relationship metadata without remaining members of the visible tree.
 */
export function removePersonFromFamilyGroup(caseValue, groupId, personId) {
  const caseData = normalizeCase(caseValue);
  const requestedGroupId = text(groupId);
  const requestedPersonId = text(personId);
  const targetGroup = caseData.familyGroups.find((group) => group.id === requestedGroupId);

  if (
    !targetGroup ||
    !requestedPersonId ||
    !targetGroup.personIds.includes(requestedPersonId) ||
    targetGroup.personIds.length <= 1
  ) {
    return caseData;
  }

  const nextPersonIds = targetGroup.personIds.filter(
    (candidateId) => candidateId !== requestedPersonId,
  );
  const familyGroups = caseData.familyGroups.map((group) =>
    group.id === requestedGroupId
      ? {
          ...group,
          rootPersonId:
            group.rootPersonId === requestedPersonId ? nextPersonIds[0] || "" : group.rootPersonId,
          personIds: nextPersonIds,
          excludedPersonIds: uniqueIds([...(group.excludedPersonIds || []), requestedPersonId]),
        }
      : group,
  );
  const neededByAnotherGroup = familyGroups.some((group) =>
    group.personIds.includes(requestedPersonId),
  );
  const neededByCaseReference = referencedPartyIds(caseData).has(requestedPersonId);

  if (neededByAnotherGroup) {
    return normalizeCase({ ...caseData, familyGroups });
  }

  if (neededByCaseReference) {
    return normalizeCase({ ...caseData, familyGroups });
  }

  return normalizeCase({
    ...caseData,
    familyGroups,
    people: scrubPersonFromRelationships(caseData.people, requestedPersonId),
  });
}

function relationshipIds(person = {}) {
  return [
    person.fatherId,
    person.motherId,
    ...(person.spouseIds || []),
    ...(person.siblingIds || []),
  ].filter(Boolean);
}

/**
 * Reconciles PersonInspector/GEDCOM updates with the canonical case-wide people
 * registry while keeping membership changes scoped to the active family group.
 */
export function reconcilePeopleUpdate(caseValue, activeGroupId, incomingPeople, options = {}) {
  return reconcileNormalisedPeopleUpdate(
    normalizeCase(caseValue),
    activeGroupId,
    incomingPeople,
    options,
  );
}

/**
 * Reconciles a live editor payload when the caller already holds a canonical
 * case. The returned case is canonical too. This is the hot path used by the
 * App: one full normalisation applies the incoming Person fields, legal
 * derived state and nested-record ids; the membership-only tail is then a
 * bounded update over the already-normalised result.
 */
export function reconcileNormalisedPeopleUpdate(
  caseData,
  activeGroupId,
  incomingPeople,
  options = {},
) {
  const people = Array.isArray(incomingPeople) ? incomingPeople : [];
  const activeGroup = caseData.familyGroups.find((group) => group.id === activeGroupId);
  if (!activeGroup) return normalizeCase({ ...caseData, people });

  const previousIds = new Set(caseData.people.map((person) => person.id));
  const incomingIds = new Set(people.map((person) => person.id).filter(Boolean));
  const activeExcludedPersonIds = new Set(activeGroup.excludedPersonIds || []);
  const addedIds = people
    .filter(
      (person) =>
        person.id && !previousIds.has(person.id) && !activeExcludedPersonIds.has(person.id),
    )
    .map((person) => person.id);
  const replacesActiveGroup =
    options.replaceFamilyGroup === true ||
    (addedIds.length > 0 &&
      activeGroup.personIds.length > 0 &&
      activeGroup.personIds.every((personId) => !incomingIds.has(personId)));

  if (replacesActiveGroup) {
    const otherGroupPersonIds = new Set(
      caseData.familyGroups
        .filter((group) => group.id !== activeGroupId)
        .flatMap((group) => group.personIds),
    );
    const caseReferenceIds = referencedPartyIds(caseData);
    const activeGroupHasCaseReference = activeGroup.personIds.some((personId) =>
      caseReferenceIds.has(personId),
    );
    const protectedIds = new Set([
      ...otherGroupPersonIds,
      ...caseReferenceIds,
      ...(activeGroupHasCaseReference ? activeGroup.personIds : []),
    ]);
    const previousById = new Map(caseData.people.map((person) => [person.id, person]));
    const mergedPeople = people.map((person) =>
      otherGroupPersonIds.has(person.id) ? previousById.get(person.id) || person : person,
    );
    const mergedIds = new Set(mergedPeople.map((person) => person.id));
    caseData.people.forEach((person) => {
      if (protectedIds.has(person.id) && !mergedIds.has(person.id)) {
        mergedPeople.push(person);
        mergedIds.add(person.id);
      }
    });

    return normalizeCase({
      ...caseData,
      people: mergedPeople,
      familyGroups: caseData.familyGroups.map((group) =>
        group.id === activeGroupId
          ? {
              ...group,
              rootPersonId: people[0]?.id || "",
              personIds: people.map((person) => person.id).filter(Boolean),
            }
          : group,
      ),
      activeFamilyGroupId: activeGroupId,
    });
  }

  // A mounted editor can finish an update after deletion (for example while a
  // new relative is being created). Do not let that stale payload put a fully
  // deleted identity back into the canonical registry. Retained legal
  // identities are already present in previousIds and continue to be updated.
  const permanentlyDeletedPersonIds = [...activeExcludedPersonIds].filter(
    (personId) => !previousIds.has(personId),
  );
  const reconciledPeople = scrubPeopleFromRelationships(people, permanentlyDeletedPersonIds);
  const nextCase = normalizeCase({ ...caseData, people: reconciledPeople });
  const nextActiveGroup = nextCase.familyGroups.find((group) => group.id === activeGroupId);
  const membershipSeeds = new Set([...(nextActiveGroup?.personIds || []), ...addedIds]);
  const excludedPersonIds = new Set(nextActiveGroup?.excludedPersonIds || []);
  const knownIds = new Set(nextCase.people.map((person) => person.id));
  const addedIdSet = new Set(addedIds);
  const previousPeopleById = new Map(caseData.people.map((person) => [person.id, person]));
  const newlyReferencedRelationshipIds = nextCase.people
    .filter((person) => membershipSeeds.has(person.id))
    .flatMap((person) => {
      const nextRelationshipIds = relationshipIds(person);
      if (addedIdSet.has(person.id)) return nextRelationshipIds;
      const previousRelationshipIds = new Set(relationshipIds(previousPeopleById.get(person.id)));
      return nextRelationshipIds.filter((personId) => !previousRelationshipIds.has(personId));
    })
    .filter((personId) => knownIds.has(personId) && !excludedPersonIds.has(personId));

  return addPersonIdsToNormalisedFamilyGroup(nextCase, activeGroupId, [
    ...addedIds,
    ...newlyReferencedRelationshipIds,
  ]);
}

function nameParts(value = "") {
  const parts = text(value).split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { givenNames: parts[0] || "", surname: "" };
  return {
    givenNames: parts.slice(0, -1).join(" "),
    surname: parts.at(-1),
  };
}

function personFromOutsideParty(party, patch = {}) {
  const fullName = text(patch.fullName) || text(party.fullName) || text(party.name);
  const parsedName = nameParts(fullName);
  const identity = cloneValue(party);
  delete identity.type;
  delete identity.kind;
  delete identity.registrationNumber;
  return {
    ...identity,
    id: party.id,
    givenNames: text(patch.givenNames) || text(party.givenNames) || parsedName.givenNames,
    surname: text(patch.surname) || text(party.surname) || parsedName.surname,
    fullName,
    surnameAtBirth: text(patch.surnameAtBirth) || text(party.surnameAtBirth),
    designations: Array.isArray(party.designations) ? cloneValue(party.designations) : [],
    sex: text(patch.sex) || text(party.sex),
    fatherId: text(patch.fatherId) || text(party.fatherId),
    motherId: text(patch.motherId) || text(party.motherId),
    spouseIds: Array.isArray(party.spouseIds) ? cloneValue(party.spouseIds) : [],
    siblingIds: Array.isArray(party.siblingIds) ? cloneValue(party.siblingIds) : [],
    dateOfBirth: text(patch.dateOfBirth) || text(party.dateOfBirth),
    dateOfDeath: text(patch.dateOfDeath) || text(party.dateOfDeath),
    notes: text(patch.notes) || text(party.notes),
    ...cloneValue(patch),
    id: party.id,
  };
}

/**
 * Turns an outside individual into a family-tree Person without changing its ID.
 * Ownership transfers and tax lots that use that ID therefore remain valid.
 */
export function promoteOutsideIndividual(caseValue, outsidePartyId, options = {}) {
  const caseData = normalizeCase(caseValue);
  const outsideParties = Array.isArray(caseData.outsideParties) ? caseData.outsideParties : [];
  const party = outsideParties.find((candidate) => candidate.id === outsidePartyId);
  const partyType = text(party?.kind || party?.type).toLowerCase();
  if (!party || (partyType && partyType !== "individual" && partyType !== "person")) {
    return caseData;
  }

  const person = personFromOutsideParty(party, options.person || {});
  const withoutParty = {
    ...caseData,
    people: addOrMergePerson(caseData.people, person),
    outsideParties: outsideParties.filter((candidate) => candidate.id !== outsidePartyId),
  };
  return createFamilyGroup(withoutParty, person.id, {
    id: options.groupId,
    title: options.title || person.fullName,
  });
}
