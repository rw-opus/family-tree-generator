import { hasDesignation, personDisplayName } from "../../domain/people.js";

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

export function personCardName(person, people, displayNamesById) {
  const displayName = displayNamesById?.get(person?.id) || personDisplayName(person, people);
  if (person.isPlaceholder) return person.fullName;

  // A repeated surname still identifies the person. Omitting it made dense
  // imported trees ambiguous and gave the same person different labels in the
  // index and on the chart.
  return capitalisedName(displayName);
}
