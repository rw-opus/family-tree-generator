import { buildPropertyOwnership } from "./familyOwnership.js";

const CUTOFF_DATE = "1992-11-25";
export const CAUSA_MORTIS_EPSILON = 1e-10;

export const causaMortisDeclaredShare = (declaration = {}) => {
  const numerator = Number(declaration.declaredShareNumerator);
  const denominator = Number(declaration.declaredShareDenominator);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return Math.max(0, numerator / denominator);
};

export const isCompletedCausaMortisDeclaration = (declaration = {}) =>
  declaration.status === "complete";

export function validateCausaMortisDeclaration(
  declaration = {},
  { valueRequired = true, availableShare = Number.POSITIVE_INFINITY } = {},
) {
  if (!declaration.propertyId) return "Select the property.";

  const share = causaMortisDeclaredShare(declaration);
  if (share <= 0) return "Enter a positive fraction declared causa mortis.";
  if (share - availableShare > CAUSA_MORTIS_EPSILON) {
    return "The declared fraction is greater than the deceased's remaining share.";
  }
  if (!declaration.date) return "Enter the date of the Declaration Causa Mortis.";
  if (!String(declaration.notaryName || "").trim()) return "Enter the notary's name.";
  if (!(declaration.declarantPersonIds || []).length) {
    return "Select at least one declarant or heir.";
  }

  const rawValue = String(declaration.immovablePropertyValue ?? "").trim();
  if (valueRequired && !rawValue) return "Enter the immovable-property value declared.";
  if (rawValue && (!Number.isFinite(Number(rawValue)) || Number(rawValue) < 0)) {
    return "Enter a valid immovable-property value.";
  }
  return "";
}

export function buildCausaMortisShareCoverage(people = [], properties = [], outsideParties = []) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const rows = [];

  properties.forEach((property) => {
    const requiredByPerson = new Map();
    buildPropertyOwnership(people, property, outsideParties).transmissions.forEach(
      (transmission) => {
        requiredByPerson.set(
          transmission.deceasedId,
          (requiredByPerson.get(transmission.deceasedId) || 0) + transmission.amount,
        );
      },
    );

    requiredByPerson.forEach((requiredShare, personId) => {
      const person = peopleById.get(personId);
      if (!person) return;
      const deathDateUnknown = !person.dateOfDeath;
      if (!deathDateUnknown && person.dateOfDeath <= CUTOFF_DATE) return;

      const declarations = (person.causaMortisDeclarations || []).filter(
        (declaration) =>
          isCompletedCausaMortisDeclaration(declaration) &&
          (declaration.propertyId === property.id ||
            (!declaration.propertyId && properties.length === 1)),
      );
      const totalDeclaredShare = declarations.reduce(
        (total, declaration) => total + causaMortisDeclaredShare(declaration),
        0,
      );
      const difference = totalDeclaredShare - requiredShare;
      const status = deathDateUnknown
        ? "date-unknown"
        : Math.abs(difference) <= CAUSA_MORTIS_EPSILON
          ? "complete"
          : difference < 0
            ? "under"
            : "over";

      rows.push({
        personId,
        propertyId: property.id,
        propertyAddress: property.address || property.description || "Unnamed property",
        requiredShare,
        declaredShare: totalDeclaredShare,
        difference,
        status,
        deathDateText: deathDateUnknown
          ? String(person.gedcomDeathDate || "").trim()
          : person.dateOfDeath,
      });
    });
  });

  const byPerson = {};
  rows.forEach((row) => {
    if (!byPerson[row.personId]) byPerson[row.personId] = [];
    byPerson[row.personId].push(row);
  });
  return { rows, byPerson };
}
