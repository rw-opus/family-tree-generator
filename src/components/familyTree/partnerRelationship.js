function relationshipEntry(person, partnerId) {
  return (person?.partnerRelationships || []).find(
    (relationship) =>
      String(relationship?.personId || relationship?.partnerId || "") === String(partnerId),
  );
}

function relationshipType(value) {
  const normalised = String(value || "")
    .trim()
    .toLowerCase();
  return normalised === "partnership" || normalised === "cohabitation" ? "partnership" : "marriage";
}

export function partnerRelationship(firstPerson, secondPerson, fallbackType = "marriage") {
  const firstEntry = relationshipEntry(firstPerson, secondPerson?.id);
  const secondEntry = relationshipEntry(secondPerson, firstPerson?.id);
  const entry = firstEntry || secondEntry;

  return {
    type: entry ? relationshipType(entry.type) : relationshipType(fallbackType),
    startDate: String(entry?.startDate || "").trim(),
    startYear: String(entry?.startYear || "").trim(),
    endDate: String(entry?.endDate || "").trim(),
  };
}

export function partnerRelationshipAnnotation(relationship) {
  const startDate = String(relationship?.startDate || "").trim();
  const startYear =
    startDate.match(/^(\d{4})-\d{2}-\d{2}$/)?.[1] ||
    String(relationship?.startYear || "").match(/^(?:1|2)\d{3}$/)?.[0] ||
    "";
  if (!startYear) return "";
  const endYear = String(relationship?.endDate || "").match(/^(\d{4})-\d{2}-\d{2}$/)?.[1] || "";
  const range = endYear ? `${startYear}\u2013${endYear}` : startYear;

  if (relationship?.type !== "partnership") return `m. ${range}`;
  const displayDate = startDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return displayDate ? `${displayDate[3]}-${displayDate[2]}-${displayDate[1]}` : startYear;
}

export function partnerRelationshipClass(relationship) {
  return relationship?.type === "partnership" ? "partnership" : "marriage";
}
