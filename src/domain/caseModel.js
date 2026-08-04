import { normalizePartnerRelationships } from "./partnerRelationships.js";
import { normalisePersonNameFields, personGivenNames } from "./people.js";
import { personWithWills } from "./wills.js";
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

function familyGroupId(caseId, ordinal) {
  return `${caseId}:family-group:${ordinal}`;
}

function nextFamilyGroupId(caseData) {
  const usedIds = new Set((caseData.familyGroups || []).map((group) => group.id));
  let ordinal = 1;
  while (usedIds.has(familyGroupId(caseData.id, ordinal))) ordinal += 1;
  return familyGroupId(caseData.id, ordinal);
}

function normalizePeople(people = []) {
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
    result.push(personWithWills(normalisePersonNameFields({ ...cloneValue(person), id })));
    return result;
  }, []);
  return { people: normalizePartnerRelationships(normalized), warnings };
}

const LEGACY_POTENTIAL_PARENT_KEYS = new Set([
  "id",
  "givenNames",
  "surname",
  "fullName",
  "surnameAtBirth",
  "designations",
  "designation",
  "sex",
  "fatherId",
  "motherId",
  "spouseIds",
  "siblingIds",
  "partnerRelationships",
  "dateOfBirth",
  "dateOfDeath",
  "unmarriedOrWidowedAtDeath",
  "wills",
  "willDate",
  "willNotaryName",
  "willDescription",
  "notes",
  "isPotentialIntestateParent",
  "survivalStatusRequired",
  "survivalStatusReferencePersonId",
]);

function hasSavedValue(value) {
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return value != null;
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
    uniqueIds(person.spouseIds).length ||
    uniqueIds(person.siblingIds).length ||
    records(person.partnerRelationships).length ||
    records(person.wills).length
  ) {
    return false;
  }

  return !Object.entries(person).some(
    ([key, value]) => !LEGACY_POTENTIAL_PARENT_KEYS.has(key) && hasSavedValue(value),
  );
}

/**
 * An August 2026 build created unresolved parents merely by opening a person's
 * card. Remove only those untouched generated records. Parents created through
 * the current explicit action carry a durable marker and are never migrated.
 */
function removeLegacyPotentialParents(caseData) {
  const protectedPersonIds = new Set(
    collectCasePersonReferences(caseData, { includeRelationships: false }).map(
      (reference) => reference.personId,
    ),
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
  const requestedRootId = text(group?.rootPersonId);
  const requestedPersonIds = uniqueIds(group?.personIds);
  const personIds = requestedPersonIds.filter((personId) => validPersonIds.has(personId));
  requestedPersonIds
    .filter((personId) => !validPersonIds.has(personId))
    .forEach((personId) =>
      warnings.push(
        `Family group ${index + 1} referred to missing person “${personId}”; the reference needs review.`,
      ),
    );
  const rootPersonId = validPersonIds.has(requestedRootId) ? requestedRootId : personIds[0] || "";
  if (rootPersonId && !personIds.includes(rootPersonId)) personIds.unshift(rootPersonId);

  return {
    ...cloneValue(isRecord(group) ? group : {}),
    id: text(group?.id) || familyGroupId(caseData.id, index + 1),
    title:
      text(group?.title) || (index === 0 ? text(caseData.title) : "") || `Family tree ${index + 1}`,
    rootPersonId,
    personIds,
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
  const source = isRecord(value) ? cloneValue(value) : {};
  const peopleResult = normalizePeople(source.people);
  const people = migrateIntestacyConfirmationSignatures(peopleResult.people);
  const dataWarnings = [...(Array.isArray(source.dataWarnings) ? source.dataWarnings : [])];
  dataWarnings.push(...peopleResult.warnings);
  const caseData = removeLegacyPotentialParents({
    ...source,
    id: text(source.id) || DEFAULT_CASE_ID,
    people,
    schemaVersion: CASE_SCHEMA_VERSION,
  });
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
  const uniqueWarnings = [...new Set(dataWarnings.map(text).filter(Boolean))];
  if (uniqueWarnings.length) result.dataWarnings = uniqueWarnings;
  else delete result.dataWarnings;
  return result;
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
  const validPersonIds = new Set(caseData.people.map((person) => person.id));
  const additions = uniqueIds(personIds).filter((personId) => validPersonIds.has(personId));
  return {
    ...caseData,
    familyGroups: caseData.familyGroups.map((group) => {
      if (group.id !== groupId) return group;
      const nextPersonIds = uniqueIds([...group.personIds, ...additions]);
      return {
        ...group,
        rootPersonId: group.rootPersonId || nextPersonIds[0] || "",
        personIds: nextPersonIds,
      };
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

function collectCasePersonReferences(caseData, options = {}) {
  const references = [];
  const includeRelationships = options.includeRelationships !== false;
  const add = (value, label, kind = "case") => {
    const personId = text(value);
    if (personId) references.push({ personId, label, kind });
  };
  const addDeclarations = (declarations = [], resolvePersonId = (value) => value) =>
    records(declarations).forEach((declaration) => {
      records(declaration.participants).forEach((participant) => {
        add(resolvePersonId(participant.heirId), "a declaration of succession");
        add(resolvePersonId(participant.personId), "a declaration of succession");
      });
      uniqueIds(declaration.heirIds).forEach((personId) =>
        add(resolvePersonId(personId), "a declaration of succession"),
      );
      uniqueIds(declaration.declarantPersonIds).forEach((personId) =>
        add(resolvePersonId(personId), "a declaration of succession"),
      );
    });
  const addPropertyReferences = (property = {}, resolvePersonId = (value) => value) => {
    records(property.owners).forEach((owner) =>
      add(owner.personId, "an initial property ownership record"),
    );
    records(property.transfers).forEach((transfer) => {
      add(resolvePersonId(transfer.sellerId), "an ownership transfer");
      add(resolvePersonId(transfer.buyerId), "an ownership transfer");
    });
    records(property.saleLots).forEach((lot) =>
      add(resolvePersonId(lot.ownerId), "a vendor tax lot"),
    );
    addDeclarations(property.declarations, resolvePersonId);
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
    records(person.willHeirs).forEach((heir) => add(heir.personId, "a will beneficiary record"));
    records(person.intestateHeirs).forEach((heir) =>
      add(heir.personId, "a confirmed intestate-heir record"),
    );
    records(person.causaMortisDeclarations).forEach((declaration) =>
      uniqueIds(declaration.declarantPersonIds).forEach((personId) =>
        add(personId, "a causa mortis declarant record"),
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

function scrubPersonFromRelationships(people, personId) {
  return people
    .filter((person) => person.id !== personId)
    .map((person) => ({
      ...person,
      fatherId: person.fatherId === personId ? "" : person.fatherId,
      motherId: person.motherId === personId ? "" : person.motherId,
      spouseIds: uniqueIds(person.spouseIds).filter((id) => id !== personId),
      siblingIds: uniqueIds(person.siblingIds).filter((id) => id !== personId),
    }));
}

/**
 * Removes a Person from one family-tree tab. The canonical Person survives
 * while another family group or any case-wide relationship/legal/property
 * record still references it.
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
        }
      : group,
  );
  const neededByAnotherGroup = familyGroups.some((group) =>
    group.personIds.includes(requestedPersonId),
  );
  const neededByCaseReference = casePersonDependencyLabels(caseData, requestedPersonId).some(
    (label) => label !== "a sibling relationship",
  );

  if (neededByAnotherGroup || neededByCaseReference) {
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
  const caseData = normalizeCase(caseValue);
  const people = Array.isArray(incomingPeople) ? incomingPeople : [];
  const activeGroup = caseData.familyGroups.find((group) => group.id === activeGroupId);
  if (!activeGroup) return normalizeCase({ ...caseData, people });

  const previousIds = new Set(caseData.people.map((person) => person.id));
  const incomingIds = new Set(people.map((person) => person.id).filter(Boolean));
  const addedIds = people
    .filter((person) => person.id && !previousIds.has(person.id))
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

  const nextCase = normalizeCase({ ...caseData, people });
  const nextActiveGroup = nextCase.familyGroups.find((group) => group.id === activeGroupId);
  const membershipSeeds = new Set([...(nextActiveGroup?.personIds || []), ...addedIds]);
  const knownIds = new Set(nextCase.people.map((person) => person.id));
  const referencedRelationshipIds = nextCase.people
    .filter((person) => membershipSeeds.has(person.id))
    .flatMap(relationshipIds)
    .filter((personId) => knownIds.has(personId));

  return addPersonIdsToFamilyGroup(nextCase, activeGroupId, [
    ...addedIds,
    ...referencedRelationshipIds,
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
