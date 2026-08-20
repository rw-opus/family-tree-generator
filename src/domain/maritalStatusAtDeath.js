import { isValidIsoDate } from "./dateFormat.js";
import {
  isMarkedDeceased,
  isRecordedDeceased,
  peopleWithEffectiveDeathDates,
} from "./deceasedStatus.js";
import { isPotentialParentSurvivalUnresolved } from "./potentialParentSurvival.js";
import {
  normalizePartnerRelationships,
  PARTNER_RELATIONSHIP_TYPES,
  partnerRelationshipKey,
} from "./partnerRelationships.js";

export const MARITAL_STATUS_AT_DEATH_SOURCES = Object.freeze({
  AUTOMATIC: "automatic",
  MANUAL: "manual",
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstPeopleById(people = []) {
  const peopleById = new Map();
  people.forEach((person) => {
    if (!peopleById.has(person.id)) peopleById.set(person.id, person);
  });
  return peopleById;
}

/**
 * Builds all whole-family indexes needed by marital-status derivation once.
 *
 * `synchroniseMaritalStatusAtDeath` visits every person, so rebuilding the
 * effective-death list and canonical partner topology inside each visit made
 * the pass quadratic (and relationship lookup could normalize it again for
 * every spouse). Keeping these indexes local to one pass also guarantees that
 * every person is derived from the same snapshot of the family.
 */
function createMaritalStatusAtDeathContext(people) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const effectivePeopleById = firstPeopleById(peopleWithEffectiveDeathDates(people));
  const normalizedPeople = normalizePartnerRelationships(people);

  // partnerIdsForPerson historically selected the first normalized record
  // whose (untrimmed) ID matched the requested trimmed ID. Retain that detail
  // while replacing its repeated whole-family normalization with an index.
  const partnerIdsByPersonId = new Map();
  normalizedPeople.forEach((person) => {
    if (!partnerIdsByPersonId.has(person.id)) {
      partnerIdsByPersonId.set(person.id, person.spouseIds || []);
    }
  });

  // findPartnerRelationship historically used the last record for a duplicate
  // ID. Normal family data has unique IDs, but preserving that lookup behavior
  // here keeps this optimization semantically neutral for restored data too.
  const normalizedPeopleById = new Map(normalizedPeople.map((person) => [person.id, person]));
  const relationshipMetadataByKey = new Map();
  normalizedPeopleById.forEach((person, ownerId) => {
    (person.partnerRelationships || []).forEach((relationship) => {
      const key = partnerRelationshipKey(ownerId, relationship.personId);
      if (key && !relationshipMetadataByKey.has(key)) {
        relationshipMetadataByKey.set(key, relationship);
      }
    });
  });

  const relationshipsByPersonId = new Map();
  normalizedPeopleById.forEach((person, personId) => {
    const relationshipsByPartnerId = new Map();
    (person.spouseIds || []).forEach((otherPersonId) => {
      const key = partnerRelationshipKey(personId, otherPersonId);
      if (!key) return;

      const otherPerson = normalizedPeopleById.get(otherPersonId);
      if (!otherPerson || !(person.spouseIds || []).includes(otherPerson.id)) return;

      const metadata = relationshipMetadataByKey.get(key);
      relationshipsByPartnerId.set(otherPersonId, {
        type: metadata?.type || PARTNER_RELATIONSHIP_TYPES.MARRIAGE,
        endDate: metadata?.endDate || "",
        endReason: metadata?.endReason || "",
      });
    });
    relationshipsByPersonId.set(personId, relationshipsByPartnerId);
  });

  return {
    peopleById,
    effectivePeopleById,
    partnerIdsByPersonId,
    relationshipsByPersonId,
  };
}

function deriveNoSurvivingSpouseAtDeathFromContext(context, personId) {
  const person = context.peopleById.get(personId);
  if (!person || !isMarkedDeceased(person)) return null;

  const deathDate = context.effectivePeopleById.get(personId)?.dateOfDeath || "";
  let hasMarriage = false;
  let survivalUnresolved = false;

  const spouseIds = context.partnerIdsByPersonId.get(text(personId)) || [];
  for (const spouseId of spouseIds) {
    const spouse = context.peopleById.get(spouseId);
    const relationship = context.relationshipsByPersonId.get(text(personId))?.get(text(spouseId));
    if (!spouse || relationship?.type !== PARTNER_RELATIONSHIP_TYPES.MARRIAGE) continue;
    hasMarriage = true;

    const relationshipEndDate = isValidIsoDate(relationship.endDate) ? relationship.endDate : "";
    if (relationship.endReason && !relationshipEndDate) {
      survivalUnresolved = true;
      continue;
    }
    if (relationshipEndDate) {
      if (!deathDate) {
        survivalUnresolved = true;
        continue;
      }
      if (relationshipEndDate <= deathDate) continue;
    }

    if (isPotentialParentSurvivalUnresolved(spouse)) {
      survivalUnresolved = true;
      continue;
    }
    if (!isRecordedDeceased(spouse)) return false;
    const spouseDeathDate = context.effectivePeopleById.get(spouse.id)?.dateOfDeath || "";
    if (!deathDate || !isValidIsoDate(spouseDeathDate)) {
      survivalUnresolved = true;
      continue;
    }
    if (spouseDeathDate > deathDate) return false;
  }

  if (!hasMarriage) return true;
  return survivalUnresolved ? null : true;
}

/**
 * Derives whether no legal spouse survived a person. `null` means the recorded
 * dates cannot yet establish the answer, so a manual answer remains available.
 */
export function deriveNoSurvivingSpouseAtDeath(people = [], personId) {
  return deriveNoSurvivingSpouseAtDeathFromContext(
    createMaritalStatusAtDeathContext(people),
    personId,
  );
}

/**
 * Keeps automatically-derived values synchronized as relationship and death
 * dates change. An explicit answer is retained only while the facts are still
 * unresolved; conclusive recorded facts always govern the checkbox.
 */
export function synchroniseMaritalStatusAtDeath(people = []) {
  const context = createMaritalStatusAtDeathContext(people);
  return people.map((person) => {
    const derived = deriveNoSurvivingSpouseAtDeathFromContext(context, person.id);

    // A manual answer is useful only while the evidence is incomplete. Once
    // the recorded relationships and death dates establish the answer, those
    // facts must replace even an earlier manual choice; otherwise a surviving
    // spouse can remain silently excluded from the succession.
    if (derived !== null) {
      if (
        person.unmarriedOrWidowedAtDeath === derived &&
        person.unmarriedOrWidowedAtDeathSource === MARITAL_STATUS_AT_DEATH_SOURCES.AUTOMATIC
      ) {
        return person;
      }
      return {
        ...person,
        unmarriedOrWidowedAtDeath: derived,
        unmarriedOrWidowedAtDeathSource: MARITAL_STATUS_AT_DEATH_SOURCES.AUTOMATIC,
      };
    }

    if (person.unmarriedOrWidowedAtDeathSource === MARITAL_STATUS_AT_DEATH_SOURCES.MANUAL) {
      return person;
    }
    // Before automatic derivation existed, a stored `true` could only have
    // come from the user. Preserve that explicit historical answer.
    if (person.unmarriedOrWidowedAtDeath === true && !person.unmarriedOrWidowedAtDeathSource) {
      return {
        ...person,
        unmarriedOrWidowedAtDeathSource: MARITAL_STATUS_AT_DEATH_SOURCES.MANUAL,
      };
    }

    if (person.unmarriedOrWidowedAtDeathSource !== MARITAL_STATUS_AT_DEATH_SOURCES.AUTOMATIC) {
      return person;
    }
    if (person.unmarriedOrWidowedAtDeath === false) return person;
    return { ...person, unmarriedOrWidowedAtDeath: false };
  });
}
