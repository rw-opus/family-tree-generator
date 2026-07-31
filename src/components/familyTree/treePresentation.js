import {
  hasDesignation,
  personDisplayName,
  personGivenNames,
  personSurname,
} from "../../domain/people.js";

export const PARTNER_LINK_WIDTH = 40;

/**
 * Above this many people the person cards stack their legal details rather than
 * setting them side by side, which keeps a large tree legible in print.
 */
export const DENSE_TREE_PERSON_THRESHOLD = 80;

export function shouldUseDenseChildrenLayout(personCount) {
  return personCount >= DENSE_TREE_PERSON_THRESHOLD;
}

export function capitalisedName(value = "") {
  return String(value).replace(/(^|[\s'-])\p{L}/gu, (match) => match.toLocaleUpperCase("en-MT"));
}

export function compactNodeWidth(value = "") {
  const estimatedWidth = Math.ceil(String(value).trim().length * 7 + 28);
  const evenWidth = estimatedWidth % 2 === 0 ? estimatedWidth : estimatedWidth + 1;
  return Math.min(210, Math.max(96, evenWidth));
}

export function isDeceasedPerson(person, variant = "") {
  return Boolean(person.isDeceased) || hasDesignation(person, "Deceased") || variant === "deceased";
}

export function personCardName(person, people, peopleById, displayNamesById) {
  const displayName = displayNamesById?.get(person?.id) || personDisplayName(person, people);
  if (person.isPlaceholder) return person.fullName;
  if (!String(person.fullName || "").trim()) return displayName;

  const surname = personSurname(person).trim();
  const parentSurnames = [person.fatherId, person.motherId]
    .map((parentId) => peopleById.get(parentId))
    .filter(Boolean)
    .map((parent) => personSurname(parent).trim())
    .filter(Boolean);
  const sharesParentSurname =
    surname &&
    parentSurnames.some(
      (parentSurname) =>
        parentSurname.localeCompare(surname, "en-MT", {
          sensitivity: "base",
        }) === 0,
    );
  const givenNames = personGivenNames(person).trim();

  return capitalisedName(sharesParentSurname && givenNames ? givenNames : displayName);
}
