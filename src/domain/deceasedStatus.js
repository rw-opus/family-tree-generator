import { isValidIsoDate } from "./dateFormat.js";

export const isMarkedDeceased = (person = {}) =>
  person.isDeceased === true ||
  (person.designations || []).some(
    (designation) => String(designation).trim().toLowerCase() === "deceased",
  );

export const isRecordedDeceased = (person = {}) =>
  isMarkedDeceased(person) || isValidIsoDate(person.dateOfDeath);

/**
 * A recorded death date and the two historical deceased markers all describe
 * the same fact. Canonicalising them on restore prevents a saved date from
 * reopening as an alive-coloured card or being ignored by succession.
 */
export function synchroniseDeceasedStatus(person = {}) {
  if (!isRecordedDeceased(person)) return person;
  const otherDesignations = (person.designations || []).filter(
    (designation) => String(designation).trim().toLowerCase() !== "deceased",
  );
  const alreadyCanonical =
    person.isDeceased === true &&
    person.designations?.[0] === "Deceased" &&
    otherDesignations.length === person.designations.length - 1;
  if (alreadyCanonical) return person;
  return {
    ...person,
    isDeceased: true,
    designations: ["Deceased", ...otherDesignations],
  };
}
