import { partnerRelationship, partnerRelationshipAnnotation } from "./partnerRelationship.js";

function text(value) {
  return String(value || "").trim();
}

function pairKey(firstId, secondId) {
  return [text(firstId), text(secondId)].filter(Boolean).sort().join("::");
}

function validIds(values, peopleById, ownerId = "") {
  return [...new Set((values || []).map(text))].filter(
    (id) => id && id !== ownerId && peopleById.has(id),
  );
}

function personGender(person) {
  return text(person?.sex).toLowerCase() === "female" ? "F" : "M";
}

function descendantCount(rootId, childrenByParent) {
  const visited = new Set();
  const queue = [rootId];

  while (queue.length) {
    const personId = queue.shift();
    if (!personId || visited.has(personId)) continue;
    visited.add(personId);
    (childrenByParent.get(personId) || []).forEach((childId) => queue.push(childId));
  }

  return visited.size;
}

/**
 * Picks the oldest useful starting point for a descendant chart. A genealogy
 * renderer needs one main person, so the root covering the most descendants is
 * preferable to whichever person happened to be created first.
 */
export function selectFamilyChartRoot(people, childrenByParent) {
  const peopleById = new Map(people.map((person) => [text(person.id), person]));
  const roots = people.filter(
    (person) =>
      ![person.fatherId, person.motherId].map(text).some((parentId) => peopleById.has(parentId)),
  );
  const candidates = roots.length ? roots : people;

  return [...candidates]
    .sort((first, second) => {
      const coverageDifference =
        descendantCount(text(second.id), childrenByParent) -
        descendantCount(text(first.id), childrenByParent);
      if (coverageDifference) return coverageDifference;
      return text(first.fullName).localeCompare(text(second.fullName), "en-MT");
    })
    .at(0)?.id;
}

/**
 * Adapts the application's person records to family-chart's bidirectional
 * relationship format. Shared parenthood is represented as a union even when
 * the pair is not married; relationship metadata remains available separately
 * so the renderer can use a dashed partnership line.
 */
export function buildFamilyChartData(people = []) {
  const cleanPeople = people.filter((person) => text(person?.id));
  const peopleById = new Map(cleanPeople.map((person) => [text(person.id), person]));
  const childrenByParent = new Map(cleanPeople.map((person) => [text(person.id), []]));
  const partnersByPerson = new Map(cleanPeople.map((person) => [text(person.id), new Set()]));
  const relationshipByPair = new Map();

  cleanPeople.forEach((child) => {
    validIds([child.fatherId, child.motherId], peopleById, text(child.id)).forEach((parentId) => {
      childrenByParent.get(parentId).push(text(child.id));
    });

    const parents = validIds([child.fatherId, child.motherId], peopleById, text(child.id));
    if (parents.length === 2) {
      partnersByPerson.get(parents[0]).add(parents[1]);
      partnersByPerson.get(parents[1]).add(parents[0]);
    }
  });

  cleanPeople.forEach((person) => {
    validIds(person.spouseIds, peopleById, text(person.id)).forEach((partnerId) => {
      partnersByPerson.get(text(person.id)).add(partnerId);
      partnersByPerson.get(partnerId).add(text(person.id));
    });
  });

  partnersByPerson.forEach((partnerIds, personId) => {
    partnerIds.forEach((partnerId) => {
      const key = pairKey(personId, partnerId);
      if (relationshipByPair.has(key)) return;

      const person = peopleById.get(personId);
      const partner = peopleById.get(partnerId);
      const explicitlyLinked =
        validIds(person?.spouseIds, peopleById, personId).includes(partnerId) ||
        validIds(partner?.spouseIds, peopleById, partnerId).includes(personId);
      const relationship = partnerRelationship(
        person,
        partner,
        explicitlyLinked ? "marriage" : "partnership",
      );
      relationshipByPair.set(key, {
        ...relationship,
        annotation: partnerRelationshipAnnotation(relationship),
      });
    });
  });

  const rootId = text(selectFamilyChartRoot(cleanPeople, childrenByParent));
  const sortedPeople = [...cleanPeople].sort((first, second) => {
    if (text(first.id) === rootId) return -1;
    if (text(second.id) === rootId) return 1;
    return text(first.fullName).localeCompare(text(second.fullName), "en-MT");
  });
  const data = sortedPeople.map((person) => {
    const personId = text(person.id);
    return {
      id: personId,
      data: {
        gender: personGender(person),
        person,
        sortName: text(person.fullName),
      },
      rels: {
        parents: validIds([person.fatherId, person.motherId], peopleById, personId),
        spouses: [...partnersByPerson.get(personId)],
        children: [...childrenByParent.get(personId)],
      },
    };
  });
  const structureKey = data
    .map(
      (person) =>
        `${person.id}:${person.rels.parents.join(",")}:${person.rels.spouses.join(",")}:${person.rels.children.join(",")}`,
    )
    .join("|");

  return { data, relationshipByPair, rootId, structureKey };
}

export function familyChartRelationship(relationshipByPair, firstId, secondId) {
  return (
    relationshipByPair.get(pairKey(firstId, secondId)) || {
      type: "marriage",
      annotation: "",
    }
  );
}
