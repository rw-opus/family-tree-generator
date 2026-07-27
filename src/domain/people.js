export const DESIGNATIONS = [
  "Deceased", "Surviving Spouse", "Child", "Grandchild", "Great-Grandchild",
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

export function createPerson(designation = "Child") {
  return { id: crypto.randomUUID(), fullName: "", designations: [designation], sex: "", fatherId: "", motherId: "", spouseIds: [], dateOfBirth: "", dateOfDeath: "", notes: "" };
}

export function formattedDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}
