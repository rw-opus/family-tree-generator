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

export function createPerson(designation = "") {
  return { id: crypto.randomUUID(), fullName: "", surnameAtBirth: "", designations: designation ? [designation] : [], sex: "", fatherId: "", motherId: "", spouseIds: [], dateOfBirth: "", dateOfDeath: "", notes: "" };
}

export function formattedDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}
