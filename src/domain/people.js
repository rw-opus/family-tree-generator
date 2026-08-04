import { isoDateToDisplay } from "./dateFormat.js";

export const DESIGNATIONS = [
  "Deceased",
  "Spouse",
  "Surviving Spouse",
  "Child",
  "Grandchild",
  "Great-Grandchild",
  "Parent",
  "Grandparent",
  "Sibling",
  "Nephew or Niece",
  "Uncle or Aunt",
  "Cousin",
];

export function personDesignations(person = {}) {
  const values = Array.isArray(person.designations) ? person.designations : [person.designation];
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

export function hasDesignation(person, designation) {
  return personDesignations(person).some(
    (value) => value.toLowerCase() === designation.toLowerCase(),
  );
}

export function hasAnyDesignation(person, designations) {
  return designations.some((designation) => hasDesignation(person, designation));
}

export function surnameFromFullName(value = "") {
  const parts = String(value).trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts.at(-1) : "";
}

export function givenNamesFromFullName(value = "") {
  const parts = String(value).trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || "";
  return parts.slice(0, -1).join(" ");
}

export function composeFullName(givenNames = "", surname = "") {
  return `${String(givenNames).trim()} ${String(surname).trim()}`.trim();
}

const LOWERCASE_NAME_PARTICLES = new Set([
  "da",
  "de",
  "dei",
  "del",
  "della",
  "di",
  "du",
  "la",
  "le",
  "of",
  "van",
  "von",
]);

function capitaliseNameSegment(segment = "") {
  if (!segment) return "";
  const lower = segment.toLocaleLowerCase();
  if (/^mc\p{L}/u.test(lower)) {
    return `Mc${lower.charAt(2).toLocaleUpperCase()}${lower.slice(3)}`;
  }
  return `${lower.charAt(0).toLocaleUpperCase()}${lower.slice(1)}`;
}

/**
 * Normalises names entered in lower or upper case without damaging an existing
 * mixed-case spelling such as McPherson. Common surname particles remain lower
 * case within a name, while apostrophised and hyphenated parts are capitalised.
 */
export function capitalisePersonName(value = "") {
  const words = String(value).trim().split(/\s+/).filter(Boolean);
  return words
    .map((word, wordIndex) => {
      // Preserve any deliberate mixed-case spelling (for example d'Avila,
      // McPherson, DeNoto or iPhone). All-lowercase and all-uppercase entries
      // are still normalised on save.
      if (/\p{Lu}/u.test(word) && /\p{Ll}/u.test(word)) {
        return word;
      }

      const lower = word.toLocaleLowerCase();
      if (wordIndex > 0 && LOWERCASE_NAME_PARTICLES.has(lower)) return lower;

      return word
        .split(/([-'])/u)
        .map((segment) => (/^[-']$/u.test(segment) ? segment : capitaliseNameSegment(segment)))
        .join("");
    })
    .join(" ");
}

export function normalisePersonNameFields(person = {}) {
  const nextPerson = { ...person };
  const hasGivenNames = Object.prototype.hasOwnProperty.call(person, "givenNames");
  const hasSurname = Object.prototype.hasOwnProperty.call(person, "surname");

  if (hasGivenNames) nextPerson.givenNames = capitalisePersonName(person.givenNames);
  if (hasSurname) nextPerson.surname = capitalisePersonName(person.surname);
  if (Object.prototype.hasOwnProperty.call(person, "surnameAtBirth")) {
    nextPerson.surnameAtBirth = capitalisePersonName(person.surnameAtBirth);
  }

  nextPerson.fullName =
    hasGivenNames || hasSurname
      ? composeFullName(nextPerson.givenNames, nextPerson.surname)
      : capitalisePersonName(person.fullName);

  return nextPerson;
}

export function personGivenNames(person = {}) {
  return Object.prototype.hasOwnProperty.call(person, "givenNames")
    ? String(person.givenNames || "")
    : givenNamesFromFullName(person.fullName);
}

export function personSurname(person = {}) {
  return Object.prototype.hasOwnProperty.call(person, "surname")
    ? String(person.surname || "")
    : surnameFromFullName(person.fullName);
}

export function fatherSurnameDefaultPatch(person = {}, father = {}) {
  const inheritedSurname = personSurname(father).trim();
  if (!inheritedSurname) return {};

  const currentSurname = personSurname(person).trim();
  const givenNames = personGivenNames(person).trim();
  const patch = {};

  if (!currentSurname) {
    patch.surname = inheritedSurname;
    if (givenNames) patch.fullName = composeFullName(givenNames, inheritedSurname);
  }
  if (!String(person.surnameAtBirth || "").trim()) {
    patch.surnameAtBirth = inheritedSurname;
  }

  return patch;
}

export function personIdentityIssues(person = {}) {
  const issues = [];
  if (!personGivenNames(person).trim()) issues.push("Names");
  if (!personSurname(person).trim()) issues.push("Surname");
  if (!String(person.sex || "").trim()) issues.push("Sex");
  if (
    String(person.sex || "").toLowerCase() === "female" &&
    !String(person.surnameAtBirth || "").trim()
  ) {
    issues.push("Surname at birth");
  }
  return issues;
}

export function personDisplayName(person = {}, people = []) {
  const ownName = String(person.fullName || "").trim();
  if (ownName) return ownName;
  if (!person.id) return "New person";

  const peopleById = new Map(
    people.filter((candidate) => candidate?.id).map((candidate) => [candidate.id, candidate]),
  );
  const named = (candidate) => {
    const name = String(candidate?.fullName || "").trim();
    return name || "";
  };
  const children = people.filter(
    (candidate) =>
      candidate?.id !== person.id &&
      (candidate.fatherId === person.id || candidate.motherId === person.id),
  );
  const namedChild = children.find((candidate) => named(candidate));
  if (namedChild) {
    const relationship =
      namedChild.fatherId === person.id
        ? "Father"
        : namedChild.motherId === person.id
          ? "Mother"
          : "Parent";
    return `${relationship} of ${named(namedChild)}`;
  }

  const namedParents = [peopleById.get(person.fatherId), peopleById.get(person.motherId)]
    .map((candidate) => named(candidate))
    .filter(Boolean);
  if (namedParents.length) {
    const relationship =
      person.sex === "Male" ? "Son" : person.sex === "Female" ? "Daughter" : "Child";
    return `${relationship} of ${namedParents.join(" and ")}`;
  }

  const spouseIds = new Set(person.spouseIds || []);
  people.forEach((candidate) => {
    if ((candidate.spouseIds || []).includes(person.id)) {
      spouseIds.add(candidate.id);
    }
  });
  const namedPartner = [...spouseIds]
    .map((id) => peopleById.get(id))
    .find((candidate) => named(candidate));
  if (namedPartner) {
    return `Partner of ${named(namedPartner)}`;
  }

  const siblingIds = new Set(person.siblingIds || []);
  people.forEach((candidate) => {
    if (!candidate?.id || candidate.id === person.id) return;
    const linked = (candidate.siblingIds || []).includes(person.id);
    const sharedFather = person.fatherId && candidate.fatherId === person.fatherId;
    const sharedMother = person.motherId && candidate.motherId === person.motherId;
    if (linked || sharedFather || sharedMother) siblingIds.add(candidate.id);
  });
  const namedSibling = [...siblingIds]
    .map((id) => peopleById.get(id))
    .find((candidate) => named(candidate));
  if (namedSibling) {
    const relationship =
      person.sex === "Male" ? "Brother" : person.sex === "Female" ? "Sister" : "Brother / sister";
    return `${relationship} of ${named(namedSibling)}`;
  }

  const relationship = personDesignations(person).find((designation) => designation !== "Deceased");
  return relationship ? `Unnamed ${relationship.toLowerCase()}` : "New person";
}

export function parentageDescription(person = {}, people = []) {
  const peopleById = new Map(
    people.filter((candidate) => candidate?.id).map((candidate) => [candidate.id, candidate]),
  );
  const father = peopleById.get(person.fatherId);
  const mother = peopleById.get(person.motherId);
  if (!father && !mother) return "";

  const parentName = (parent, includeBirthSurname = false) => {
    const name = capitalisePersonName(personDisplayName(parent, people));
    if (!includeBirthSurname) return name;

    const birthSurname = capitalisePersonName(parent.surnameAtBirth);
    const currentSurname = capitalisePersonName(personSurname(parent));
    return birthSurname &&
      birthSurname.localeCompare(currentSurname, "en-MT", { sensitivity: "base" }) !== 0
      ? `${name} nee ${birthSurname}`
      : name;
  };
  const relationship =
    String(person.sex || "").toLowerCase() === "male"
      ? "son"
      : String(person.sex || "").toLowerCase() === "female"
        ? "daughter"
        : "child";
  const parents = [father && parentName(father), mother && parentName(mother, true)].filter(
    Boolean,
  );

  return `${relationship} of ${parents.join(" & ")}`;
}

export function createPerson(designation = "") {
  return {
    id: crypto.randomUUID(),
    givenNames: "",
    surname: "",
    fullName: "",
    surnameAtBirth: "",
    designations: designation ? [designation] : [],
    sex: "",
    fatherId: "",
    motherId: "",
    spouseIds: [],
    siblingIds: [],
    dateOfBirth: "",
    dateOfDeath: "",
    unmarriedOrWidowedAtDeath: false,
    wills: [],
    notes: "",
  };
}

export function personRelationshipCounts(people = [], person = {}) {
  if (!person.id) return { father: 0, mother: 0, spouse: 0, child: 0, sibling: 0 };

  const spouseIds = new Set(person.spouseIds || []);
  const siblingIds = new Set(person.siblingIds || []);
  let child = 0;

  people.forEach((candidate) => {
    if (!candidate?.id || candidate.id === person.id) return;
    if ((candidate.spouseIds || []).includes(person.id)) spouseIds.add(candidate.id);
    if ((candidate.siblingIds || []).includes(person.id)) siblingIds.add(candidate.id);
    if (candidate.fatherId === person.id || candidate.motherId === person.id) child += 1;

    const sharesFather =
      person.fatherId && candidate.fatherId && person.fatherId === candidate.fatherId;
    const sharesMother =
      person.motherId && candidate.motherId && person.motherId === candidate.motherId;
    if (sharesFather || sharesMother) siblingIds.add(candidate.id);
  });

  spouseIds.delete(person.id);
  siblingIds.delete(person.id);
  return {
    father: person.fatherId ? 1 : 0,
    mother: person.motherId ? 1 : 0,
    spouse: spouseIds.size,
    child,
    sibling: siblingIds.size,
  };
}

export function personDescendants(people = [], personId) {
  if (!personId) return [];
  const descendants = [];
  const visited = new Set([personId]);
  let generation = people.filter(
    (person) => person.fatherId === personId || person.motherId === personId,
  );
  while (generation.length) {
    const nextGeneration = [];
    generation.forEach((person) => {
      if (!person?.id || visited.has(person.id)) return;
      visited.add(person.id);
      descendants.push(person);
      nextGeneration.push(
        ...people.filter(
          (candidate) => candidate.fatherId === person.id || candidate.motherId === person.id,
        ),
      );
    });
    generation = nextGeneration;
  }
  return descendants;
}

export function personAncestors(people = [], personId) {
  if (!personId) return [];
  const peopleById = new Map(
    people.filter((person) => person?.id).map((person) => [person.id, person]),
  );
  const ancestors = [];
  const visited = new Set([personId]);
  const queue = [peopleById.get(personId)?.fatherId, peopleById.get(personId)?.motherId].filter(
    Boolean,
  );

  while (queue.length) {
    const ancestorId = queue.shift();
    if (!ancestorId || visited.has(ancestorId)) continue;
    visited.add(ancestorId);
    const ancestor = peopleById.get(ancestorId);
    if (!ancestor) continue;
    ancestors.push(ancestor);
    queue.push(ancestor.fatherId, ancestor.motherId);
  }

  return ancestors;
}

export function formattedDate(value) {
  return isoDateToDisplay(value);
}

/**
 * Whether removing this person would sever anybody else from the rest of the
 * family — that is, whether they are a cut vertex of the relationship graph.
 *
 * Somebody at the very top of a tree is not automatically undeletable. A spouse
 * with nothing hanging off them can go; the person their partner reaches the
 * rest of the family through cannot, because taking them out would leave the
 * partner floating with no way back to the tree.
 */
export function removalWouldSeverFamily(people = [], personId = "") {
  const target = String(personId || "");
  const remaining = people.filter((person) => person?.id && person.id !== target);
  if (remaining.length < 2) return false;

  const present = new Set(remaining.map((person) => person.id));
  const neighbours = new Map(remaining.map((person) => [person.id, []]));
  const link = (first, second) => {
    if (!present.has(first) || !present.has(second) || first === second) return;
    neighbours.get(first).push(second);
    neighbours.get(second).push(first);
  };

  remaining.forEach((person) => {
    [person.fatherId, person.motherId].forEach((parentId) =>
      link(person.id, String(parentId || "")),
    );
    (person.spouseIds || []).forEach((spouseId) => link(person.id, String(spouseId || "")));
    (person.siblingIds || []).forEach((siblingId) => link(person.id, String(siblingId || "")));
  });

  const componentCount = (ids) => {
    const seen = new Set();
    let count = 0;
    ids.forEach((id) => {
      if (seen.has(id)) return;
      count += 1;
      const queue = [id];
      while (queue.length) {
        const current = queue.pop();
        if (seen.has(current)) continue;
        seen.add(current);
        (neighbours.get(current) || []).forEach((next) => {
          if (!seen.has(next)) queue.push(next);
        });
      }
    });
    return count;
  };

  const ids = [...present];
  const withTarget = new Map(neighbours);
  // Count the components the remaining people fall into once the person is out.
  const after = componentCount(ids);

  // Now count them as they stand, with the person still joining things up.
  const targetPerson = people.find((person) => person?.id === target);
  if (!targetPerson) return false;
  const attached = new Set();
  remaining.forEach((person) => {
    if ([person.fatherId, person.motherId].map(String).includes(target)) attached.add(person.id);
    if ((person.spouseIds || []).map(String).includes(target)) attached.add(person.id);
    if ((person.siblingIds || []).map(String).includes(target)) attached.add(person.id);
  });
  [
    targetPerson.fatherId,
    targetPerson.motherId,
    ...(targetPerson.spouseIds || []),
    ...(targetPerson.siblingIds || []),
  ]
    .map(String)
    .filter((id) => present.has(id))
    .forEach((id) => attached.add(id));

  if (attached.size < 2) return false;

  const attachedComponents = new Set();
  const componentOf = new Map();
  let marker = 0;
  ids.forEach((id) => {
    if (componentOf.has(id)) return;
    marker += 1;
    const queue = [id];
    while (queue.length) {
      const current = queue.pop();
      if (componentOf.has(current)) continue;
      componentOf.set(current, marker);
      (withTarget.get(current) || []).forEach((next) => {
        if (!componentOf.has(next)) queue.push(next);
      });
    }
  });
  attached.forEach((id) => attachedComponents.add(componentOf.get(id)));

  // If the people who were attached to them now sit in more than one piece,
  // this person was the only thing holding those pieces together.
  return attachedComponents.size > 1 && after >= attachedComponents.size;
}
