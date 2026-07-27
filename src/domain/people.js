export const DESIGNATIONS = [
  "Deceased", "Spouse", "Surviving Spouse", "Child", "Grandchild", "Great-Grandchild",
  "Parent", "Grandparent", "Sibling", "Nephew or Niece", "Uncle or Aunt", "Cousin",
];

export function personDesignations(person = {}) {
  const values = Array.isArray(person.designations) ? person.designations : [person.designation];
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

export function hasDesignation(person, designation) {
  return personDesignations(person).some((value) => value.toLowerCase() === designation.toLowerCase());
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

export function createPerson(designation = "") {
  return { id: crypto.randomUUID(), givenNames: "", surname: "", fullName: "", surnameAtBirth: "", designations: designation ? [designation] : [], sex: "", fatherId: "", motherId: "", spouseIds: [], siblingIds: [], dateOfBirth: "", dateOfDeath: "", notes: "" };
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

export function formattedDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}
