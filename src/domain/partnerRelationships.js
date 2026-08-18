import { isValidIsoDate, isoDateToDisplay } from "./dateFormat.js";

export const PARTNER_RELATIONSHIP_TYPES = Object.freeze({
  MARRIAGE: "marriage",
  PARTNERSHIP: "partnership",
});

export const PARTNER_RELATIONSHIP_END_REASONS = Object.freeze({
  DIVORCE: "divorce",
  ANNULMENT: "annulment",
  OTHER: "other",
});

const TYPE_ALIASES = new Map([
  ["marriage", PARTNER_RELATIONSHIP_TYPES.MARRIAGE],
  ["married", PARTNER_RELATIONSHIP_TYPES.MARRIAGE],
  ["spouse", PARTNER_RELATIONSHIP_TYPES.MARRIAGE],
  ["wife", PARTNER_RELATIONSHIP_TYPES.MARRIAGE],
  ["husband", PARTNER_RELATIONSHIP_TYPES.MARRIAGE],
  ["partnership", PARTNER_RELATIONSHIP_TYPES.PARTNERSHIP],
  ["partner", PARTNER_RELATIONSHIP_TYPES.PARTNERSHIP],
  ["cohabitation", PARTNER_RELATIONSHIP_TYPES.PARTNERSHIP],
  ["cohabiting", PARTNER_RELATIONSHIP_TYPES.PARTNERSHIP],
  ["unmarried", PARTNER_RELATIONSHIP_TYPES.PARTNERSHIP],
]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueIds(values = []) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => text(value)).filter(Boolean))];
}

function binarySex(person = {}) {
  const value = text(person.sex).toLowerCase();
  if (value === "male") return "male";
  if (value === "female") return "female";
  return "";
}

function ancestorDepths(peopleById, personId) {
  const depths = new Map();
  const person = peopleById.get(personId);
  const queue = [person?.fatherId, person?.motherId]
    .filter(Boolean)
    .map((ancestorId) => ({ ancestorId, depth: 1 }));

  while (queue.length) {
    const { ancestorId, depth } = queue.shift();
    if (!ancestorId || depth >= (depths.get(ancestorId) ?? Number.POSITIVE_INFINITY)) continue;
    depths.set(ancestorId, depth);
    const ancestor = peopleById.get(ancestorId);
    [ancestor?.fatherId, ancestor?.motherId]
      .filter(Boolean)
      .forEach((parentId) => queue.push({ ancestorId: parentId, depth: depth + 1 }));
  }

  return depths;
}

/**
 * New partner links are restricted to opposite-sex people who are not in the
 * direct line and are not closer collateral relatives than first cousins.
 * Existing/imported links are assessed elsewhere and are never removed here.
 */
export function partnerLinkEligibility(people = [], personId, otherPersonId) {
  const peopleById = new Map(
    people.filter((person) => text(person?.id)).map((person) => [text(person.id), person]),
  );
  const person = peopleById.get(text(personId));
  const otherPerson = peopleById.get(text(otherPersonId));
  if (!person || !otherPerson || person.id === otherPerson.id) {
    return { allowed: false, code: "invalid-person", reason: "Choose another person." };
  }

  const personSex = binarySex(person);
  const otherSex = binarySex(otherPerson);
  if (!personSex || !otherSex) {
    return {
      allowed: false,
      code: "sex-required",
      reason: "Both people must have Male or Female recorded before they can be linked.",
    };
  }
  if (personSex === otherSex) {
    return {
      allowed: false,
      code: "same-sex",
      reason: "A partner must be recorded as the opposite sex.",
    };
  }

  const personAncestors = ancestorDepths(peopleById, person.id);
  const otherAncestors = ancestorDepths(peopleById, otherPerson.id);
  if (personAncestors.has(otherPerson.id) || otherAncestors.has(person.id)) {
    return {
      allowed: false,
      code: "direct-blood-relative",
      reason: "A direct ancestor or descendant cannot be linked as a partner.",
    };
  }

  const explicitlySiblings =
    uniqueIds(person.siblingIds).includes(otherPerson.id) ||
    uniqueIds(otherPerson.siblingIds).includes(person.id);
  let closestCollateralDegree = Number.POSITIVE_INFINITY;
  personAncestors.forEach((personDepth, ancestorId) => {
    const otherDepth = otherAncestors.get(ancestorId);
    if (otherDepth)
      closestCollateralDegree = Math.min(closestCollateralDegree, personDepth + otherDepth);
  });
  if (explicitlySiblings || closestCollateralDegree < 4) {
    return {
      allowed: false,
      code: "close-blood-relative",
      reason: "Parents, children, siblings, uncles, aunts, nephews and nieces cannot be partners.",
    };
  }

  return { allowed: true, code: "eligible", reason: "" };
}

function validStartYear(value) {
  const year = String(value ?? "").trim();
  return /^(?:1|2)\d{3}$/.test(year) ? year : "";
}

function normalizeEndReason(value) {
  const reason = text(value).toLowerCase();
  if (reason === "divorce" || reason === "divorced") {
    return PARTNER_RELATIONSHIP_END_REASONS.DIVORCE;
  }
  if (reason === "annulment" || reason === "annulled" || reason === "nullity") {
    return PARTNER_RELATIONSHIP_END_REASONS.ANNULMENT;
  }
  return reason ? PARTNER_RELATIONSHIP_END_REASONS.OTHER : "";
}

export function normalizePartnerRelationshipType(value) {
  return TYPE_ALIASES.get(text(value).toLowerCase()) || PARTNER_RELATIONSHIP_TYPES.MARRIAGE;
}

/**
 * Produces a stable, direction-independent identity for a relationship.
 */
export function partnerRelationshipKey(personId, otherPersonId) {
  const ids = [text(personId), text(otherPersonId)].sort();
  return ids[0] && ids[1] && ids[0] !== ids[1] ? `${ids[0]}::${ids[1]}` : "";
}

function normalizedMetadata(ownerId, entry = {}) {
  const personId = text(entry.personId);
  const key = partnerRelationshipKey(ownerId, personId);
  if (!key) return null;

  const startDate = isValidIsoDate(entry.startDate) ? entry.startDate : "";
  const endDate = isValidIsoDate(entry.endDate) ? entry.endDate : "";
  return {
    key,
    ownerId,
    personId,
    type: normalizePartnerRelationshipType(entry.type),
    startDate,
    startYear: startDate.slice(0, 4) || validStartYear(entry.startYear),
    endDate,
    endReason: normalizeEndReason(entry.endReason),
  };
}

function relationshipCandidates(people = []) {
  const validPersonIds = new Set(people.map((person) => text(person?.id)).filter(Boolean));
  const candidatesByKey = new Map();

  people.forEach((person) => {
    const ownerId = text(person?.id);
    if (!ownerId) return;
    const entries = Array.isArray(person.partnerRelationships) ? person.partnerRelationships : [];
    entries.forEach((entry) => {
      const candidate = normalizedMetadata(ownerId, entry);
      if (!candidate || !validPersonIds.has(candidate.personId) || candidate.personId === ownerId) {
        return;
      }
      const candidates = candidatesByKey.get(candidate.key) || [];
      candidates.push(candidate);
      candidatesByKey.set(candidate.key, candidates);
    });
  });

  return candidatesByKey;
}

function canonicalMetadata(candidatesByKey) {
  const metadataByKey = new Map();

  candidatesByKey.forEach((candidates, key) => {
    const canonicalOwnerId = key.split("::")[0];
    const ordered = [...candidates].sort(
      (left, right) =>
        Number(right.ownerId === canonicalOwnerId) - Number(left.ownerId === canonicalOwnerId),
    );
    const preferred = ordered[0];
    const datedCandidate = ordered.find((candidate) => candidate.startDate);
    const yearCandidate = ordered.find((candidate) => candidate.startYear);
    const endDateCandidate = ordered.find((candidate) => candidate.endDate);
    const endReasonCandidate = ordered.find((candidate) => candidate.endReason);
    const startDate = preferred.startDate || datedCandidate?.startDate || "";

    metadataByKey.set(key, {
      type: preferred.type,
      startDate,
      startYear: startDate.slice(0, 4) || preferred.startYear || yearCandidate?.startYear || "",
      endDate: preferred.endDate || endDateCandidate?.endDate || "",
      endReason: preferred.endReason || endReasonCandidate?.endReason || "",
    });
  });

  return metadataByKey;
}

function topologyKeys(people, candidatesByKey, { inferCoParents = true } = {}) {
  const validPersonIds = new Set(people.map((person) => text(person?.id)).filter(Boolean));
  const keys = new Set(candidatesByKey.keys());

  people.forEach((person) => {
    const personId = text(person?.id);
    uniqueIds(person?.spouseIds).forEach((otherPersonId) => {
      if (!validPersonIds.has(otherPersonId)) return;
      const key = partnerRelationshipKey(personId, otherPersonId);
      if (key) keys.add(key);
    });
  });

  // Two people recorded as the parents of the same child are treated as
  // married by default. A marriage date is not required. An explicit
  // partnerRelationships record can still classify the pair as an unmarried
  // partnership, because its metadata is retained against the same key.
  if (inferCoParents) {
    people.forEach((child) => {
      // Pure-tree records carry this marker when parentage was entered without
      // an explicit partner link. It remains authoritative if legal tools are
      // enabled later; a recorded spouseId/metadata link still wins above.
      if (child?.coParentRelationshipExplicitOnly === true) return;
      const fatherId = text(child?.fatherId);
      const motherId = text(child?.motherId);
      if (
        !fatherId ||
        !motherId ||
        fatherId === motherId ||
        !validPersonIds.has(fatherId) ||
        !validPersonIds.has(motherId)
      ) {
        return;
      }
      const key = partnerRelationshipKey(fatherId, motherId);
      if (key) keys.add(key);
    });
  }

  return keys;
}

/**
 * Makes spouseIds reciprocal while retaining exactly one metadata record for
 * each pair. Recorded co-parents are linked as a marriage by default, without
 * requiring a marriage date. Metadata is stored on the lexically first Person
 * ID, but lookup is deliberately direction-independent.
 */
export function normalizePartnerRelationships(people = [], options = {}) {
  if (!Array.isArray(people)) return [];

  const candidatesByKey = relationshipCandidates(people);
  const metadataByKey = canonicalMetadata(candidatesByKey);
  const keys = topologyKeys(people, candidatesByKey, options);
  const partnerIdsByPerson = new Map(
    people.map((person) => [text(person?.id), uniqueIds(person?.spouseIds)]),
  );
  const metadataByOwner = new Map();

  keys.forEach((key) => {
    const [firstPersonId, secondPersonId] = key.split("::");
    const firstPartners = partnerIdsByPerson.get(firstPersonId);
    const secondPartners = partnerIdsByPerson.get(secondPersonId);
    if (!firstPartners || !secondPartners) return;
    if (!firstPartners.includes(secondPersonId)) firstPartners.push(secondPersonId);
    if (!secondPartners.includes(firstPersonId)) secondPartners.push(firstPersonId);

    const metadata = metadataByKey.get(key);
    if (!metadata) return;
    const ownerEntries = metadataByOwner.get(firstPersonId) || [];
    ownerEntries.push({
      personId: secondPersonId,
      type: metadata.type,
      ...(metadata.startDate ? { startDate: metadata.startDate } : {}),
      ...(!metadata.startDate && metadata.startYear ? { startYear: metadata.startYear } : {}),
      ...(metadata.endDate ? { endDate: metadata.endDate } : {}),
      ...(metadata.endReason ? { endReason: metadata.endReason } : {}),
    });
    metadataByOwner.set(firstPersonId, ownerEntries);
  });

  return people.map((person) => {
    const personId = text(person?.id);
    const hadMetadata = Array.isArray(person?.partnerRelationships);
    const spouseIds = partnerIdsByPerson.get(personId) || [];
    const identity = { ...person };
    delete identity.partnerRelationships;
    delete identity.spouseIds;
    const partnerRelationships = metadataByOwner.get(personId) || [];
    return {
      ...identity,
      ...(Array.isArray(person?.spouseIds) || spouseIds.length ? { spouseIds } : {}),
      ...(hadMetadata || partnerRelationships.length ? { partnerRelationships } : {}),
    };
  });
}

function normalizedRelationshipRecord(people, personId, otherPersonId) {
  const key = partnerRelationshipKey(personId, otherPersonId);
  if (!key) return null;

  const normalizedPeople = normalizePartnerRelationships(people);
  const peopleById = new Map(normalizedPeople.map((person) => [person.id, person]));
  const person = peopleById.get(text(personId));
  const otherPerson = peopleById.get(text(otherPersonId));
  if (!person || !otherPerson || !(person.spouseIds || []).includes(otherPerson.id)) return null;

  const [ownerId, partnerId] = key.split("::");
  const metadata = (peopleById.get(ownerId)?.partnerRelationships || []).find(
    (entry) => entry.personId === partnerId,
  );
  const startDate = metadata?.startDate || "";
  const endDate = metadata?.endDate || "";

  return {
    key,
    personIds: [ownerId, partnerId],
    type: metadata?.type || PARTNER_RELATIONSHIP_TYPES.MARRIAGE,
    startDate,
    startYear: startDate.slice(0, 4) || metadata?.startYear || "",
    ...(endDate ? { endDate } : {}),
    ...(metadata?.endReason ? { endReason: metadata.endReason } : {}),
    inferredFromLegacySpouseIds: !metadata,
  };
}

/**
 * Looks up relationship metadata from either Person. A legacy spouseIds link
 * with no metadata is intentionally treated as a marriage.
 */
export function findPartnerRelationship(people, personId, otherPersonId) {
  return normalizedRelationshipRecord(people, personId, otherPersonId);
}

export function partnerIdsForPerson(people, personId) {
  const requestedPersonId = text(personId);
  const normalizedPerson = normalizePartnerRelationships(people).find(
    (person) => person.id === requestedPersonId,
  );
  return normalizedPerson?.spouseIds || [];
}

export function partnerRelationshipStatusAt(relationship, atDate = "") {
  if (
    !relationship ||
    normalizePartnerRelationshipType(relationship.type) !== PARTNER_RELATIONSHIP_TYPES.MARRIAGE
  ) {
    return "not-married";
  }
  if (relationship.endReason && !relationship.endDate) {
    return "end-date-missing";
  }
  if (atDate && relationship.endDate && relationship.endDate <= atDate) {
    return "ended";
  }
  if (!atDate && (relationship.endDate || relationship.endReason)) {
    return "ended";
  }
  return "active";
}

/**
 * Returns only legally married partners. This is the compatibility boundary
 * succession code can use instead of treating every topology link as a spouse.
 */
export function legalSpouseIdsForPerson(people, personId, atDate = "") {
  return partnerIdsForPerson(people, personId).filter(
    (otherPersonId) =>
      partnerRelationshipStatusAt(
        findPartnerRelationship(people, personId, otherPersonId),
        atDate,
      ) === "active",
  );
}

/**
 * Adds or edits a relationship symmetrically. spouseIds remains the topology
 * link, while one canonical metadata record carries its legal/display details.
 */
export function upsertPartnerRelationship(people, personId, otherPersonId, patch = {}) {
  const key = partnerRelationshipKey(personId, otherPersonId);
  if (!key || !Array.isArray(people)) return people;

  const validPersonIds = new Set(people.map((person) => text(person?.id)).filter(Boolean));
  const [ownerId, partnerId] = key.split("::");
  if (!validPersonIds.has(ownerId) || !validPersonIds.has(partnerId)) return people;

  const normalizedPeople = normalizePartnerRelationships(people);
  const existing = findPartnerRelationship(normalizedPeople, ownerId, partnerId);
  const type = Object.prototype.hasOwnProperty.call(patch, "type")
    ? normalizePartnerRelationshipType(patch.type)
    : existing?.type || PARTNER_RELATIONSHIP_TYPES.MARRIAGE;
  const startDateWasPatched = Object.prototype.hasOwnProperty.call(patch, "startDate");
  const requestedStartDate = startDateWasPatched ? patch.startDate : existing?.startDate;
  const startDate = isValidIsoDate(requestedStartDate) ? requestedStartDate : "";
  const requestedStartYear = Object.prototype.hasOwnProperty.call(patch, "startYear")
    ? patch.startYear
    : startDateWasPatched
      ? ""
      : existing?.startYear;
  const startYear = startDate.slice(0, 4) || validStartYear(requestedStartYear);
  const requestedEndDate = Object.prototype.hasOwnProperty.call(patch, "endDate")
    ? patch.endDate
    : existing?.endDate;
  const endDate = isValidIsoDate(requestedEndDate) ? requestedEndDate : "";
  const endReason = Object.prototype.hasOwnProperty.call(patch, "endReason")
    ? normalizeEndReason(patch.endReason)
    : existing?.endReason || "";

  return normalizePartnerRelationships(
    normalizedPeople.map((person) => {
      if (person.id !== ownerId) return person;
      const otherRelationships = (person.partnerRelationships || []).filter(
        (relationship) => relationship.personId !== partnerId,
      );
      return {
        ...person,
        partnerRelationships: [
          ...otherRelationships,
          {
            personId: partnerId,
            type,
            ...(startDate ? { startDate } : {}),
            ...(!startDate && startYear ? { startYear } : {}),
            ...(endDate ? { endDate } : {}),
            ...(endReason ? { endReason } : {}),
          },
        ],
      };
    }),
  );
}

/**
 * Creates a partner link only when it satisfies the product eligibility rules.
 * Editing an already recorded relationship remains possible so imported data
 * can be corrected without the application silently deleting it.
 */
export function linkPartnerRelationship(people, personId, otherPersonId, patch = {}) {
  if (findPartnerRelationship(people, personId, otherPersonId)) {
    return upsertPartnerRelationship(people, personId, otherPersonId, patch);
  }
  if (!partnerLinkEligibility(people, personId, otherPersonId).allowed) return people;
  return upsertPartnerRelationship(people, personId, otherPersonId, patch);
}

export function removePartnerRelationship(people, personId, otherPersonId) {
  const key = partnerRelationshipKey(personId, otherPersonId);
  if (!key || !Array.isArray(people)) return people;
  const [firstPersonId, secondPersonId] = key.split("::");

  return normalizePartnerRelationships(
    people.map((person) => ({
      ...person,
      spouseIds:
        person.id === firstPersonId
          ? uniqueIds(person.spouseIds).filter((id) => id !== secondPersonId)
          : person.id === secondPersonId
            ? uniqueIds(person.spouseIds).filter((id) => id !== firstPersonId)
            : person.spouseIds,
      partnerRelationships: Array.isArray(person.partnerRelationships)
        ? person.partnerRelationships.filter((entry) => {
            const entryKey = partnerRelationshipKey(person.id, entry.personId);
            return entryKey !== key;
          })
        : person.partnerRelationships,
    })),
  );
}

/**
 * Produces the compact annotation used on relationship lines.
 */
export function partnerRelationshipAnnotation(relationship = {}) {
  const type = normalizePartnerRelationshipType(relationship.type);
  // Marriage dates are deliberately not displayed or used by the product.
  // A recorded/imported date may remain in source metadata, but the marriage
  // link itself is enough to establish the relationship.
  if (type === PARTNER_RELATIONSHIP_TYPES.MARRIAGE) return "";
  const startDate = isValidIsoDate(relationship.startDate) ? relationship.startDate : "";
  const dateOrYear =
    (startDate && isoDateToDisplay(startDate)) || validStartYear(relationship.startYear);
  if (!dateOrYear) return "";
  const startText = startDate.slice(0, 4) || dateOrYear;
  return startDate ? isoDateToDisplay(startDate) : startText;
}
