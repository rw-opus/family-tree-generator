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
  if (!Array.isArray(people)) return [];
  const seen = new Set();
  return people.filter(isRecord).reduce((result, person) => {
    const id = text(person.id);
    if (!id || seen.has(id)) return result;
    seen.add(id);
    result.push({ ...cloneValue(person), id });
    return result;
  }, []);
}

function normalizeFamilyGroup(group, index, caseData, validPersonIds) {
  const requestedRootId = text(group?.rootPersonId);
  const requestedPersonIds = uniqueIds(group?.personIds);
  const personIds = requestedPersonIds.filter((personId) => validPersonIds.has(personId));
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
  const caseData = {
    ...source,
    id: text(source.id) || DEFAULT_CASE_ID,
    people: normalizePeople(source.people),
    schemaVersion: CASE_SCHEMA_VERSION,
  };
  const validPersonIds = new Set(caseData.people.map((person) => person.id));
  const sourceGroups = Array.isArray(source.familyGroups)
    ? source.familyGroups
    : legacyFamilyGroup(caseData);
  const familyGroups = sourceGroups.map((group, index) =>
    normalizeFamilyGroup(group, index, caseData, validPersonIds),
  );
  const groupIds = new Set(familyGroups.map((group) => group.id));
  const activeFamilyGroupId = groupIds.has(source.activeFamilyGroupId)
    ? source.activeFamilyGroupId
    : familyGroups[0]?.id || "";

  return {
    ...caseData,
    familyGroups,
    activeFamilyGroupId,
  };
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

function referencedPartyIds(caseData) {
  const ids = new Set();
  const add = (value) => {
    if (value) ids.add(value);
  };
  const addDeclarations = (declarations = []) =>
    declarations.forEach((declaration) => {
      (declaration.participants || []).forEach((participant) => add(participant.heirId));
      (declaration.heirIds || []).forEach(add);
    });
  const addPropertyReferences = (property = {}) => {
    (property.owners || []).forEach((owner) => add(owner.personId));
    (property.transfers || []).forEach((transfer) => {
      add(transfer.sellerId);
      add(transfer.buyerId);
    });
    (property.saleLots || []).forEach((lot) => add(lot.ownerId));
    addDeclarations(property.declarations);
  };

  (caseData.properties || []).forEach(addPropertyReferences);
  (caseData.succession?.heirs || []).forEach((heir) => add(heir.personId));
  (caseData.transfers || []).forEach((transfer) => {
    add(transfer.sellerId);
    add(transfer.buyerId);
  });
  (caseData.saleLots || []).forEach((lot) => add(lot.ownerId));
  addDeclarations(caseData.declarations);
  (caseData.people || []).forEach((person) => {
    (person.willHeirs || []).forEach((heir) => add(heir.personId));
    (person.intestateHeirs || []).forEach((heir) => add(heir.personId));
    (person.causaMortisDeclarations || []).forEach((declaration) =>
      (declaration.declarantPersonIds || []).forEach(add),
    );
  });
  return ids;
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
