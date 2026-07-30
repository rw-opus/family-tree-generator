/**
 * Parent links the app can infer but must not apply on its own.
 *
 * When a child has one parent recorded and that parent has exactly one partner,
 * the other parent is probably that partner, but not always. This module reports
 * the inference for confirmation and never mutates anyone.
 */

function partnerIdsByPerson(people) {
  const peopleById = new Map(
    people.filter((person) => person?.id).map((person) => [person.id, person]),
  );
  const partnersById = new Map();

  peopleById.forEach((person) => {
    const partnerIds = new Set(person.spouseIds || []);
    peopleById.forEach((candidate) => {
      if ((candidate.spouseIds || []).includes(person.id)) {
        partnerIds.add(candidate.id);
      }
    });
    partnerIds.delete(person.id);
    partnersById.set(
      person.id,
      [...partnerIds].filter((id) => peopleById.has(id)),
    );
  });

  return partnersById;
}

export function solePartnerParentSuggestions(people = []) {
  const partnersById = partnerIdsByPerson(people);
  const suggestions = [];

  people.forEach((person) => {
    if (!person?.id) return;

    if (person.fatherId && !person.motherId && !person.motherExplicitlyUnassigned) {
      const partners = partnersById.get(person.fatherId) || [];
      if (partners.length === 1) {
        suggestions.push({
          personId: person.id,
          field: "motherId",
          suggestedPersonId: partners[0],
          viaParentId: person.fatherId,
        });
      }
    }

    if (person.motherId && !person.fatherId && !person.fatherExplicitlyUnassigned) {
      const partners = partnersById.get(person.motherId) || [];
      if (partners.length === 1) {
        suggestions.push({
          personId: person.id,
          field: "fatherId",
          suggestedPersonId: partners[0],
          viaParentId: person.motherId,
        });
      }
    }
  });

  return suggestions;
}

export function applyParentSuggestions(people = [], acceptedSuggestions = []) {
  if (!acceptedSuggestions.length) return people;

  const patchesByPerson = new Map();
  acceptedSuggestions.forEach((suggestion) => {
    if (!suggestion?.personId || !suggestion.suggestedPersonId) return;
    if (suggestion.field !== "fatherId" && suggestion.field !== "motherId") return;
    const patch = patchesByPerson.get(suggestion.personId) || {};
    patch[suggestion.field] = suggestion.suggestedPersonId;
    patchesByPerson.set(suggestion.personId, patch);
  });

  return people.map((person) => {
    const patch = patchesByPerson.get(person?.id);
    return patch ? { ...person, ...patch } : person;
  });
}
