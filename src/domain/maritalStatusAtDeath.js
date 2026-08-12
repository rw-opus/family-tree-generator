import { isValidIsoDate } from "./dateFormat.js";
import { isMarkedDeceased, isRecordedDeceased } from "./deceasedStatus.js";
import { isPotentialParentSurvivalUnresolved } from "./potentialParentSurvival.js";
import {
  findPartnerRelationship,
  PARTNER_RELATIONSHIP_TYPES,
  partnerIdsForPerson,
} from "./partnerRelationships.js";

export const MARITAL_STATUS_AT_DEATH_SOURCES = Object.freeze({
  AUTOMATIC: "automatic",
  MANUAL: "manual",
});

/**
 * Derives whether no legal spouse survived a person. `null` means the recorded
 * dates cannot yet establish the answer, so a manual answer remains available.
 */
export function deriveNoSurvivingSpouseAtDeath(people = [], personId) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const person = peopleById.get(personId);
  if (!person || !isMarkedDeceased(person)) return null;

  const deathDate = isValidIsoDate(person.dateOfDeath) ? person.dateOfDeath : "";
  let hasMarriage = false;
  let survivalUnresolved = false;

  for (const spouseId of partnerIdsForPerson(people, personId)) {
    const spouse = peopleById.get(spouseId);
    const relationship = findPartnerRelationship(people, personId, spouseId);
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
    if (!deathDate || !isValidIsoDate(spouse.dateOfDeath)) {
      survivalUnresolved = true;
      continue;
    }
    if (spouse.dateOfDeath > deathDate) return false;
  }

  if (!hasMarriage) return true;
  return survivalUnresolved ? null : true;
}

/**
 * Keeps automatically-derived values synchronized as relationship and death
 * dates change. An explicit answer is retained only while the facts are still
 * unresolved; conclusive recorded facts always govern the checkbox.
 */
export function synchroniseMaritalStatusAtDeath(people = []) {
  return people.map((person) => {
    const derived = deriveNoSurvivingSpouseAtDeath(people, person.id);

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
