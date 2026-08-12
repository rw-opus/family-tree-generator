import { normaliseCase } from "./caseModel.js";

export const STATUS_TOGGLE_TYPES = Object.freeze({
  DECEASED: "deceased",
  INTER_VIVOS: "inter-vivos",
});

/**
 * Fields whose values belong to the deceased-status workflow. A session stores
 * both the value and whether the property existed so cancelling the workflow
 * can restore the saved Person record exactly, rather than merely blanking its
 * visible inputs.
 */
export const DECEASED_STATUS_FIELDS = Object.freeze([
  "isDeceased",
  "designations",
  "dateOfDeath",
  "unmarriedOrWidowedAtDeath",
  "unmarriedOrWidowedAtDeathSource",
  "survivalStatusRequired",
  "survivalStatusConfirmed",
  "inheritanceBasis",
  "wills",
  "willDate",
  "willNotaryName",
  "willDescription",
  "willNotes",
  "willHeirs",
  "willHeirsConfirmed",
  "willHeirsConfirmationSource",
  "willHeirsConfirmationSnapshot",
  "intestateHeirs",
  "intestateHeirsConfirmed",
  "intestateConfirmationBasis",
  "intestateConfirmationMigratedFromV1",
  "legacyArticle616Statuses",
  "legacyArticle616Estate",
  "causaMortisDeclarations",
]);

// The transfer disclosure no longer owns a Person field. In particular it must
// not snapshot/restore `inheritanceBasis`, because the deceased workflow may
// legitimately change that field while both disclosures are open.
export const INTER_VIVOS_STATUS_FIELDS = Object.freeze([]);

export const STATUS_TOGGLE_SESSION_ID_FIELD = "statusToggleSessionId";
export const STATUS_TOGGLE_SESSION_TYPE_FIELD = "statusToggleSessionType";
export const STATUS_TOGGLE_SESSION_ROLE_FIELD = "statusToggleSessionRole";

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [key, cloneValue(nestedValue)]),
  );
}

const cleanText = (value) => (typeof value === "string" ? value.trim() : "");

function isStatusType(type) {
  return type === STATUS_TOGGLE_TYPES.DECEASED || type === STATUS_TOGGLE_TYPES.INTER_VIVOS;
}

function sessionFields(type) {
  return type === STATUS_TOGGLE_TYPES.DECEASED ? DECEASED_STATUS_FIELDS : INTER_VIVOS_STATUS_FIELDS;
}

function captureFields(person, fields) {
  return Object.fromEntries(
    fields.map((field) => [
      field,
      Object.hasOwn(person, field)
        ? { present: true, value: cloneValue(person[field]) }
        : { present: false },
    ]),
  );
}

function restoreFields(person, snapshot = {}) {
  const restored = { ...person };
  Object.entries(snapshot).forEach(([field, state]) => {
    if (state?.present === true) restored[field] = cloneValue(state.value);
    else delete restored[field];
  });
  return restored;
}

function sessionId(type, personId) {
  const uniqueId =
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `status-toggle:${type}:${personId}:${uniqueId}`;
}

function sessionsFrom(caseData) {
  return Array.isArray(caseData?.statusToggleSessions)
    ? caseData.statusToggleSessions.filter(isRecord)
    : [];
}

/**
 * Returns the active reversible session for a person's status. A fourth,
 * optional propertyId is accepted for callers that later support more than one
 * property in a case; the current person-card status remains person-wide.
 */
export function statusToggleSession(caseData, type, personId, propertyId = "") {
  const requestedType = cleanText(type);
  const requestedPersonId = cleanText(personId);
  const requestedPropertyId = cleanText(propertyId);
  const session = sessionsFrom(caseData).find(
    (candidate) =>
      candidate.type === requestedType &&
      candidate.personId === requestedPersonId &&
      (!requestedPropertyId || candidate.propertyId === requestedPropertyId),
  );
  return session ? cloneValue(session) : null;
}

/**
 * Starts an idempotent, persisted undo boundary before a status is enabled.
 */
export function beginStatusToggleSession(caseValue, { type, personId, propertyId = "" } = {}) {
  const caseData = normaliseCase(caseValue);
  const requestedType = cleanText(type);
  const requestedPersonId = cleanText(personId);
  const requestedPropertyId = cleanText(propertyId);
  if (!isStatusType(requestedType) || !requestedPersonId) return caseData;

  const person = caseData.people.find((candidate) => candidate.id === requestedPersonId);
  if (!person || statusToggleSession(caseData, requestedType, requestedPersonId)) return caseData;

  const session = {
    id: sessionId(requestedType, requestedPersonId),
    type: requestedType,
    personId: requestedPersonId,
    propertyId: requestedPropertyId,
    activeFamilyGroupId: cleanText(caseData.activeFamilyGroupId),
    personFields: captureFields(person, sessionFields(requestedType)),
  };

  return normaliseCase({
    ...caseData,
    statusToggleSessions: [...sessionsFrom(caseData), session],
  });
}

/**
 * Marks a record as having been created inside a reversible status workflow.
 * It intentionally does not mutate the supplied record or session.
 */
export function tagStatusCreatedRecord(record, session, { role = "" } = {}) {
  if (!isRecord(record) || !cleanText(session?.id)) return cloneValue(record);
  const tagged = {
    ...cloneValue(record),
    [STATUS_TOGGLE_SESSION_ID_FIELD]: session.id,
    [STATUS_TOGGLE_SESSION_TYPE_FIELD]: session.type,
  };
  if (cleanText(role)) tagged[STATUS_TOGGLE_SESSION_ROLE_FIELD] = cleanText(role);
  return tagged;
}

function belongsToSession(record, session) {
  return isRecord(record) && record[STATUS_TOGGLE_SESSION_ID_FIELD] === session.id;
}

function shouldRemoveTransfer(transfer, { session, type, personId, legacy }) {
  if (session) return belongsToSession(transfer, session);
  return legacy && type === STATUS_TOGGLE_TYPES.INTER_VIVOS && transfer?.sellerId === personId;
}

function cleanTransfers(caseData, options) {
  const requestedPropertyId = cleanText(options.propertyId || options.session?.propertyId);
  const cleanContainer = (container) => {
    if (!isRecord(container) || !Array.isArray(container.transfers)) return container;
    if (
      !options.session &&
      requestedPropertyId &&
      cleanText(container.id) !== requestedPropertyId
    ) {
      return container;
    }
    return {
      ...container,
      transfers: container.transfers.filter((transfer) => !shouldRemoveTransfer(transfer, options)),
    };
  };

  const result = {
    ...caseData,
    properties: Array.isArray(caseData.properties)
      ? caseData.properties.map(cleanContainer)
      : caseData.properties,
  };
  if (isRecord(caseData.property)) result.property = cleanContainer(caseData.property);
  if (
    Array.isArray(caseData.transfers) &&
    (options.session || !requestedPropertyId || !Array.isArray(caseData.properties))
  ) {
    result.transfers = caseData.transfers.filter(
      (transfer) => !shouldRemoveTransfer(transfer, options),
    );
  }
  return result;
}

function legacyDeceasedCleanup(person) {
  const cleaned = { ...person };
  DECEASED_STATUS_FIELDS.forEach((field) => delete cleaned[field]);
  cleaned.isDeceased = false;
  cleaned.designations = Array.isArray(person.designations)
    ? person.designations.filter(
        (designation) => String(designation).trim().toLowerCase() !== "deceased",
      )
    : [];
  cleaned.dateOfDeath = "";
  cleaned.unmarriedOrWidowedAtDeath = false;
  if (person.isPotentialIntestateParent === true) {
    cleaned.survivalStatusRequired = false;
    cleaned.survivalStatusConfirmed = "alive";
  }
  return cleaned;
}

function legacyInterVivosCleanup(person) {
  if (person.inheritanceBasis !== "lifetime-disposal") return person;
  return { ...person, inheritanceBasis: "intestacy" };
}

function restoreOrCleanPerson(caseData, { session, type, personId }) {
  return {
    ...caseData,
    people: caseData.people.map((person) => {
      if (person.id !== personId) return person;
      if (session) {
        const restored = restoreFields(person, session.personFields);
        return type === STATUS_TOGGLE_TYPES.INTER_VIVOS
          ? legacyInterVivosCleanup(restored)
          : restored;
      }
      return type === STATUS_TOGGLE_TYPES.DECEASED
        ? legacyDeceasedCleanup(person)
        : legacyInterVivosCleanup(person);
    }),
  };
}

function excludesIds(records, removedIds, fields) {
  if (!Array.isArray(records)) return records;
  return records.filter((record) =>
    fields.every((field) => !removedIds.has(cleanText(record?.[field]))),
  );
}

function scrubDeclarationReferences(declaration, removedIds) {
  if (!isRecord(declaration)) return declaration;
  const scrubbed = { ...declaration };
  if (Array.isArray(declaration.participants)) {
    scrubbed.participants = excludesIds(declaration.participants, removedIds, [
      "heirId",
      "personId",
    ]);
  }
  if (Array.isArray(declaration.heirIds)) {
    scrubbed.heirIds = declaration.heirIds.filter(
      (personId) => !removedIds.has(cleanText(personId)),
    );
  }
  if (Array.isArray(declaration.declarantPersonIds)) {
    scrubbed.declarantPersonIds = declaration.declarantPersonIds.filter(
      (personId) => !removedIds.has(cleanText(personId)),
    );
  }
  return scrubbed;
}

function scrubPropertyReferences(property, removedIds) {
  if (!isRecord(property)) return property;
  const scrubbed = { ...property };
  if (Array.isArray(property.owners)) {
    scrubbed.owners = excludesIds(property.owners, removedIds, ["personId"]);
  }
  if (Array.isArray(property.transfers)) {
    scrubbed.transfers = excludesIds(property.transfers, removedIds, ["sellerId", "buyerId"]);
  }
  if (Array.isArray(property.saleLots)) {
    scrubbed.saleLots = excludesIds(property.saleLots, removedIds, ["ownerId"]);
  }
  if (Array.isArray(property.declarations)) {
    scrubbed.declarations = property.declarations.map((declaration) =>
      scrubDeclarationReferences(declaration, removedIds),
    );
  }
  return scrubbed;
}

function scrubPersonReferences(person, removedIds) {
  const scrubbed = { ...person };
  if (removedIds.has(cleanText(person.fatherId))) scrubbed.fatherId = "";
  if (removedIds.has(cleanText(person.motherId))) scrubbed.motherId = "";
  if (Array.isArray(person.spouseIds)) {
    scrubbed.spouseIds = person.spouseIds.filter(
      (personId) => !removedIds.has(cleanText(personId)),
    );
  }
  if (Array.isArray(person.siblingIds)) {
    scrubbed.siblingIds = person.siblingIds.filter(
      (personId) => !removedIds.has(cleanText(personId)),
    );
  }
  if (Array.isArray(person.partnerRelationships)) {
    scrubbed.partnerRelationships = excludesIds(person.partnerRelationships, removedIds, [
      "personId",
    ]);
  }
  if (Array.isArray(person.willHeirs)) {
    scrubbed.willHeirs = excludesIds(person.willHeirs, removedIds, ["personId"]);
  }
  if (Array.isArray(person.intestateHeirs)) {
    scrubbed.intestateHeirs = excludesIds(person.intestateHeirs, removedIds, ["personId"]);
  }
  if (Array.isArray(person.causaMortisDeclarations)) {
    scrubbed.causaMortisDeclarations = person.causaMortisDeclarations.map((declaration) =>
      scrubDeclarationReferences(declaration, removedIds),
    );
  }
  return scrubbed;
}

/**
 * A cancelled status is a true transaction rollback. Identities created by
 * that transaction must disappear even if they were subsequently selected in
 * another field; every known reference is removed in the same state update so
 * the case cannot retain dangling person IDs or a changed ownership position.
 */
function removeSessionCreatedRecords(caseValue, session) {
  if (!session) return caseValue;
  const caseData = normaliseCase(caseValue);
  const removedIds = new Set([
    ...caseData.people
      .filter((person) => belongsToSession(person, session))
      .map((person) => person.id),
    ...(Array.isArray(caseData.outsideParties)
      ? caseData.outsideParties
          .filter((party) => belongsToSession(party, session))
          .map((party) => party.id)
      : []),
  ]);
  if (!removedIds.size) return caseData;

  const scrubbedCase = scrubPropertyReferences(caseData, removedIds);
  return normaliseCase({
    ...scrubbedCase,
    people: caseData.people
      .filter((person) => !removedIds.has(person.id))
      .map((person) => scrubPersonReferences(person, removedIds)),
    outsideParties: Array.isArray(caseData.outsideParties)
      ? caseData.outsideParties.filter((party) => !removedIds.has(party.id))
      : caseData.outsideParties,
    familyGroups: caseData.familyGroups.map((group) => {
      const personIds = group.personIds.filter((personId) => !removedIds.has(personId));
      return {
        ...group,
        personIds,
        rootPersonId: removedIds.has(group.rootPersonId) ? personIds[0] || "" : group.rootPersonId,
      };
    }),
    properties: Array.isArray(caseData.properties)
      ? caseData.properties.map((property) => scrubPropertyReferences(property, removedIds))
      : caseData.properties,
    property: isRecord(caseData.property)
      ? scrubPropertyReferences(caseData.property, removedIds)
      : caseData.property,
    succession: isRecord(caseData.succession)
      ? {
          ...caseData.succession,
          heirs: excludesIds(caseData.succession.heirs, removedIds, ["personId"]),
        }
      : caseData.succession,
    heirs: excludesIds(caseData.heirs, removedIds, ["personId"]),
  });
}

/**
 * Cancels a status workflow. New workflows restore their exact pre-toggle
 * Person fields and delete only session-tagged records. Saved legacy workflows
 * have no undo snapshot, so the fallback deliberately clears every record
 * owned by that status (and all outgoing transfers on the selected property).
 */
export function endStatusToggleSession(caseValue, { type, personId, propertyId = "" } = {}) {
  const caseData = normaliseCase(caseValue);
  const requestedType = cleanText(type);
  const requestedPersonId = cleanText(personId);
  const requestedPropertyId = cleanText(propertyId);
  if (!isStatusType(requestedType) || !requestedPersonId) return caseData;

  const session = statusToggleSession(
    caseData,
    requestedType,
    requestedPersonId,
    requestedPropertyId,
  );
  const legacy = !session;
  let nextCase = restoreOrCleanPerson(caseData, {
    session,
    type: requestedType,
    personId: requestedPersonId,
  });
  nextCase = cleanTransfers(nextCase, {
    session,
    type: requestedType,
    personId: requestedPersonId,
    propertyId: requestedPropertyId,
    legacy,
  });
  nextCase = removeSessionCreatedRecords(nextCase, session);

  return normaliseCase({
    ...nextCase,
    statusToggleSessions: sessionsFrom(nextCase).filter(
      (candidate) => candidate.id !== session?.id,
    ),
  });
}
