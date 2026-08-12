import { isValidIsoDate } from "./dateFormat.js";
import { isMarkedDeceased } from "./deceasedStatus.js";

export const POTENTIAL_PARENT_SURVIVAL_CONFIRMATIONS = Object.freeze({
  ALIVE: "alive",
  DEATH_DATE_RECORDED: "death-date-recorded",
});

/**
 * A valid death date or an explicit living confirmation is conclusive even if an older saved
 * record still carries the former `survivalStatusRequired` flag.
 */
export function isPotentialParentSurvivalUnresolved(person = {}) {
  if (isValidIsoDate(person.dateOfDeath)) return false;
  if (
    String(person.survivalStatusConfirmed || "") ===
      POTENTIAL_PARENT_SURVIVAL_CONFIRMATIONS.ALIVE &&
    !isMarkedDeceased(person)
  ) {
    return false;
  }

  // A potential parent who is marked deceased but has no death date remains
  // unresolved even if an older record accidentally cleared the former flag.
  if (person.isPotentialIntestateParent === true && isMarkedDeceased(person)) return true;
  return person.survivalStatusRequired === true;
}

/**
 * Repairs the stored confirmation fields whenever the recorded facts establish whether a
 * provisional parent survived. This is applied both while editing and while restoring a tree.
 */
export function synchronisePotentialParentSurvival(person = {}) {
  if (person.isPotentialIntestateParent !== true) return person;

  if (isValidIsoDate(person.dateOfDeath)) {
    if (
      person.survivalStatusRequired === false &&
      person.survivalStatusConfirmed === POTENTIAL_PARENT_SURVIVAL_CONFIRMATIONS.DEATH_DATE_RECORDED
    ) {
      return person;
    }
    return {
      ...person,
      survivalStatusRequired: false,
      survivalStatusConfirmed: POTENTIAL_PARENT_SURVIVAL_CONFIRMATIONS.DEATH_DATE_RECORDED,
    };
  }

  if (isMarkedDeceased(person)) {
    if (person.survivalStatusRequired === true && !person.survivalStatusConfirmed) return person;
    return {
      ...person,
      survivalStatusRequired: true,
      survivalStatusConfirmed: "",
    };
  }

  if (person.survivalStatusConfirmed === POTENTIAL_PARENT_SURVIVAL_CONFIRMATIONS.ALIVE) {
    if (person.survivalStatusRequired === false) return person;
    return { ...person, survivalStatusRequired: false };
  }

  return person;
}
