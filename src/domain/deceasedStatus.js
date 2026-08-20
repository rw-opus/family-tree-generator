import { isValidIsoDate } from "./dateFormat.js";

export const isMarkedDeceased = (person = {}) =>
  person.isDeceased === true ||
  (person.designations || []).some(
    (designation) => String(designation).trim().toLowerCase() === "deceased",
  );

export const isRecordedDeceased = (person = {}) =>
  isMarkedDeceased(person) ||
  person.dateOfDeathUnknown === true ||
  isValidIsoDate(person.dateOfDeath);

function childrenByParent(people = []) {
  const children = new Map();
  people.forEach((person) => {
    [person?.fatherId, person?.motherId].filter(Boolean).forEach((parentId) => {
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(person);
    });
  });
  return children;
}

/**
 * Records the product rule that a person with a grandchild (or a later
 * descendant) is presumed deceased when no death date has been recorded.
 * The presumption is explicit and reversible: it never invents a historical
 * date, and the UI displays it as "Date of death unknown".
 */
export function applyOlderGenerationDeathAssumptions(people = []) {
  const children = childrenByParent(people);
  const olderGenerationIds = new Set();
  people.forEach((person) => {
    const hasGrandchild = (children.get(person.id) || []).some(
      (child) => (children.get(child.id) || []).length > 0,
    );
    if (hasGrandchild) olderGenerationIds.add(person.id);
  });

  return people.map((person) => {
    if (
      !olderGenerationIds.has(person.id) ||
      isValidIsoDate(person.dateOfDeath) ||
      person.dateOfDeathUnknown === true
    ) {
      return person;
    }
    return synchroniseDeceasedStatus({
      ...person,
      dateOfDeathUnknown: true,
    });
  });
}

/**
 * Supplies calculation-only dates for people whose death date is expressly
 * unknown. Where one linked spouse has a recorded exact date, both spouses are
 * treated as dying on that day. The inferred date is never persisted as the
 * person's own date of death.
 */
export function peopleWithEffectiveDeathDates(people = []) {
  const assumedPeople = applyOlderGenerationDeathAssumptions(people);
  const peopleById = new Map(assumedPeople.map((person) => [person.id, person]));
  return assumedPeople.map((person) => {
    if (isValidIsoDate(person.dateOfDeath) || person.dateOfDeathUnknown !== true) return person;
    const spouseDates = [
      ...new Set(
        (person.spouseIds || [])
          .map((spouseId) => peopleById.get(spouseId)?.dateOfDeath)
          .filter(isValidIsoDate),
      ),
    ];
    if (spouseDates.length !== 1) return person;
    return {
      ...person,
      dateOfDeath: spouseDates[0],
      effectiveDateOfDeathAssumedFromSpouse: true,
    };
  });
}

export function effectiveDateOfDeath(people = [], personId = "") {
  return (
    peopleWithEffectiveDeathDates(people).find((person) => person.id === personId)?.dateOfDeath ||
    ""
  );
}

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
