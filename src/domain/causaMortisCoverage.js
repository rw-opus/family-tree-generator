import { buildPropertyOwnership } from "./familyOwnership.js";
import { INHERITANCE_CAUSA_MORTIS_CUTOFF } from "./article5A.js";
import {
  addFractions,
  compareFractions,
  fractionComponentNumber,
  fractionToNumber,
  normaliseFraction,
  subtractFractions,
  ZERO_FRACTION,
} from "./fractions.js";
import { approximateFraction } from "./ownership.js";
import { validateCausaMortisDateChronology } from "./chronology.js";

export const causaMortisDeclaredShare = (declaration = {}) => {
  const numerator = fractionComponentNumber(declaration.declaredShareNumerator);
  const denominator = fractionComponentNumber(declaration.declaredShareDenominator, {
    allowZero: false,
  });
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    return 0;
  }
  return Math.max(0, numerator / denominator);
};

const causaMortisDeclaredFraction = (declaration = {}) => {
  const exact = normaliseFraction(
    declaration.declaredShareNumerator,
    declaration.declaredShareDenominator,
  );
  return exact.error ? ZERO_FRACTION : exact;
};

export const isCompletedCausaMortisDeclaration = (declaration = {}) =>
  declaration.status === "complete";

export function validateCausaMortisDeclaration(
  declaration = {},
  {
    valueRequired = true,
    availableShare = Number.POSITIVE_INFINITY,
    availableShareFraction = null,
    dateOfDeath = "",
  } = {},
) {
  if (!declaration.propertyId) return "Select the property.";

  const share = causaMortisDeclaredShare(declaration);
  if (share <= 0) return "Enter a positive fraction declared causa mortis.";
  const exactAvailableShare = availableShareFraction?.denominator
    ? availableShareFraction
    : Number.isFinite(availableShare)
      ? approximateFraction(availableShare)
      : null;
  if (
    exactAvailableShare &&
    compareFractions(causaMortisDeclaredFraction(declaration), exactAvailableShare) > 0
  ) {
    return "The declared fraction is greater than the deceased's remaining share.";
  }
  if (!declaration.date) return "Enter the date of the Declaration Causa Mortis.";
  const chronologyError = validateCausaMortisDateChronology(declaration.date, dateOfDeath);
  if (chronologyError) return chronologyError;
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
          addFractions(
            requiredByPerson.get(transmission.deceasedId) || ZERO_FRACTION,
            transmission.amountFraction || approximateFraction(transmission.amount),
          ),
        );
      },
    );

    requiredByPerson.forEach((requiredFraction, personId) => {
      const person = peopleById.get(personId);
      if (!person) return;
      const deathDateUnknown = !person.dateOfDeath;
      if (!deathDateUnknown && person.dateOfDeath < INHERITANCE_CAUSA_MORTIS_CUTOFF) return;

      const declarations = (person.causaMortisDeclarations || []).filter(
        (declaration) =>
          isCompletedCausaMortisDeclaration(declaration) &&
          validateCausaMortisDateChronology(declaration.date, person.dateOfDeath) === "" &&
          (declaration.propertyId === property.id ||
            (!declaration.propertyId && properties.length === 1)),
      );
      const totalDeclaredFraction = declarations.reduce(
        (total, declaration) => addFractions(total, causaMortisDeclaredFraction(declaration)),
        ZERO_FRACTION,
      );
      const differenceFraction = subtractFractions(totalDeclaredFraction, requiredFraction);
      const remainingFraction = subtractFractions(requiredFraction, totalDeclaredFraction);
      const comparison = compareFractions(totalDeclaredFraction, requiredFraction);
      const requiredShare = fractionToNumber(requiredFraction);
      const totalDeclaredShare = fractionToNumber(totalDeclaredFraction);
      const difference = fractionToNumber(differenceFraction);
      const status = deathDateUnknown
        ? "date-unknown"
        : comparison === 0
          ? "complete"
          : comparison < 0
            ? "under"
            : "over";

      rows.push({
        personId,
        propertyId: property.id,
        propertyAddress: property.address || property.description || "Unnamed property",
        requiredShare,
        requiredFraction,
        declaredShare: totalDeclaredShare,
        declaredFraction: totalDeclaredFraction,
        difference,
        differenceFraction,
        remainingFraction,
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
