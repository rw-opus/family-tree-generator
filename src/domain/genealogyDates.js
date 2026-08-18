import { isValidIsoDate, isoDateToDisplay } from "./dateFormat.js";

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

/**
 * Returns the date wording used by the pure genealogy workspace. It is kept
 * separate from the exact ISO date used by succession and tax chronology, so
 * a year, an approximate date, or source wording can be recorded safely.
 */
export function genealogyDeathDateText(person = {}) {
  const recordedText = hasOwn(person, "deathDateText")
    ? String(person.deathDateText || "").trim()
    : "";
  if (recordedText) return recordedText;
  const importedText = String(person.gedcomDeathDate || "").trim();
  if (importedText) return importedText;
  if (isValidIsoDate(person.dateOfDeath)) return isoDateToDisplay(person.dateOfDeath);
  return String(person.dateOfDeath || "");
}

export const genealogyDeathDateLabel = (person = {}) => genealogyDeathDateText(person).trim();
