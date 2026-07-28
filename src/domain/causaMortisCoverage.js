import { buildPropertyOwnership } from "./familyOwnership.js";

const CUTOFF_DATE = "1992-11-25";
const EPSILON = 1e-10;

const declaredShare = (declaration = {}) => {
  const numerator = Number(declaration.declaredShareNumerator);
  const denominator = Number(declaration.declaredShareDenominator);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return Math.max(0, numerator / denominator);
};

export function buildCausaMortisShareCoverage(people = [], properties = []) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const rows = [];

  properties.forEach((property) => {
    const requiredByPerson = new Map();
    buildPropertyOwnership(people, property).transmissions.forEach(
      (transmission) => {
        requiredByPerson.set(
          transmission.deceasedId,
          (requiredByPerson.get(transmission.deceasedId) || 0) +
            transmission.amount,
        );
      },
    );

    requiredByPerson.forEach((requiredShare, personId) => {
      const person = peopleById.get(personId);
      if (!person?.dateOfDeath || person.dateOfDeath <= CUTOFF_DATE) return;

      const declarations = (person.causaMortisDeclarations || []).filter(
        (declaration) =>
          declaration.propertyId === property.id ||
          (!declaration.propertyId && properties.length === 1),
      );
      const totalDeclaredShare = declarations.reduce(
        (total, declaration) => total + declaredShare(declaration),
        0,
      );
      const difference = totalDeclaredShare - requiredShare;
      const status =
        Math.abs(difference) <= EPSILON
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
