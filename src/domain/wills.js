import { isValidIsoDate, isoDateToDisplay } from "./dateFormat.js";

const text = (value) => (typeof value === "string" ? value.trim() : "");

const deterministicWillId = (personId, index, legacy = false) =>
  `${text(personId) || "person"}:${legacy ? "legacy-will" : `will:${index + 1}`}`;

function normaliseWillRecord(will, personId, index) {
  const source = will && typeof will === "object" && !Array.isArray(will) ? will : {};
  return {
    ...source,
    id: text(source.id) || deterministicWillId(personId, index),
    date: text(source.date || source.willDate),
    notaryName: text(source.notaryName || source.willNotaryName),
    description: text(source.description || source.jurisdiction || source.willDescription),
  };
}

export function displayWillDate(value) {
  return isoDateToDisplay(value);
}

/**
 * Returns every recorded will for a person. An explicit wills array is
 * authoritative, including an empty array after the user deletes all wills.
 * Older one-will records are exposed as one deterministic legacy entry.
 */
export function personWills(person = {}) {
  if (Array.isArray(person.wills)) {
    return person.wills.map((will, index) => normaliseWillRecord(will, person.id, index));
  }

  const legacyDate = text(person.willDate);
  const legacyNotaryName = text(person.willNotaryName);
  const legacyDescription = text(person.willDescription);
  if (!legacyDate && !legacyNotaryName && !legacyDescription) return [];

  return [
    {
      id: deterministicWillId(person.id, 0, true),
      date: legacyDate,
      notaryName: legacyNotaryName,
      description: legacyDescription,
    },
  ];
}

/**
 * The latest valid dated will governs. If no record has a valid date, the
 * last-added record is returned so undated information remains editable.
 */
export function operativeWillFromRecords(wills = []) {
  const records = Array.isArray(wills) ? wills : [];
  const dated = records.filter((will) => isValidIsoDate(will?.date));
  if (!dated.length) return records.at(-1) || null;

  return dated.reduce((latest, will) => (will.date >= latest.date ? will : latest));
}

export function operativeWill(person = {}) {
  return operativeWillFromRecords(personWills(person));
}

/**
 * Writes the multi-will model while mirroring the operative will into the two
 * legacy fields used by older saved trees and app versions.
 */
export function personWithWills(person = {}, wills) {
  const hasExplicitWills = Array.isArray(person.wills);
  const hasLegacyWill = Boolean(
    text(person.willDate) || text(person.willNotaryName) || text(person.willDescription),
  );
  const willsWereProvided = arguments.length > 1;
  if (!willsWereProvided && !hasExplicitWills && !hasLegacyWill) return { ...person };

  const sourceWills = willsWereProvided ? wills : personWills(person);
  const normalisedWills = (Array.isArray(sourceWills) ? sourceWills : []).map((will, index) =>
    normaliseWillRecord(will, person.id, index),
  );
  const latest = operativeWillFromRecords(normalisedWills);

  return {
    ...person,
    wills: normalisedWills,
    willDate: latest?.date || "",
    willNotaryName: latest?.notaryName || "",
    willDescription: latest?.description || "",
  };
}
