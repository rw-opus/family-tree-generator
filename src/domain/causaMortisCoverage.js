import { buildPropertyOwnership } from "./familyOwnership.js";
import { INHERITANCE_CAUSA_MORTIS_CUTOFF } from "./article5A.js";
import {
  addFractions,
  compareFractions,
  divideFractions,
  fractionComponentNumber,
  fractionToNumber,
  multiplyFractions,
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

export const causaMortisDeclaredFraction = (declaration = {}) => {
  const exact = normaliseFraction(
    declaration.declaredShareNumerator,
    declaration.declaredShareDenominator,
  );
  return exact.error ? ZERO_FRACTION : exact;
};

const allocationEntries = (allocations) =>
  allocations instanceof Map ? [...allocations.entries()] : Object.entries(allocations || {});

const positiveFraction = (fraction) =>
  !fraction?.error && compareFractions(fraction, ZERO_FRACTION) > 0;

const exactOrApproximate = (fraction, numericFallback = 0) =>
  fraction?.error ? approximateFraction(Math.max(0, Number(numericFallback) || 0)) : fraction;

const addToFractionMap = (fractions, personId, fraction) => {
  const total = addFractions(fractions.get(personId) || ZERO_FRACTION, fraction);
  if (!total.error) fractions.set(personId, total);
};

/**
 * Split one aggregate CM declaration only among the people named as declarants. The weighting is
 * each named declarant's inherited fraction divided by the named declarants' combined inherited
 * fraction. This makes both the declared share and its value follow the same proportions, while
 * leaving non-declarants entirely outside the declaration (including any excess).
 */
export function allocateCausaMortisDeclaration(
  declaration = {},
  requiredFractionsByDeclarant = new Map(),
) {
  const requiredFractions =
    requiredFractionsByDeclarant instanceof Map
      ? requiredFractionsByDeclarant
      : new Map(Object.entries(requiredFractionsByDeclarant || {}));
  const declarantIds = [...new Set((declaration.declarantPersonIds || []).filter(Boolean))];
  const unresolvedDeclarantIds = declarantIds.filter(
    (personId) => !positiveFraction(requiredFractions.get(personId)),
  );
  const declaredFraction = causaMortisDeclaredFraction(declaration);
  const declaredValue = Math.max(0, Number(declaration.immovablePropertyValue) || 0);

  // Fail closed when one of the selected people has no resolvable entitlement. Otherwise their
  // unknown portion would be silently redistributed among the remaining selected declarants.
  if (
    !declarantIds.length ||
    unresolvedDeclarantIds.length ||
    !positiveFraction(declaredFraction)
  ) {
    return {
      allocations: [],
      declaredFraction,
      declaredValue,
      declarantIds,
      unresolvedDeclarantIds,
    };
  }

  const selectedRequiredFraction = declarantIds.reduce(
    (total, personId) => addFractions(total, requiredFractions.get(personId)),
    ZERO_FRACTION,
  );
  if (!positiveFraction(selectedRequiredFraction)) {
    return {
      allocations: [],
      declaredFraction,
      declaredValue,
      declarantIds,
      unresolvedDeclarantIds: declarantIds,
    };
  }

  const allocations = declarantIds.map((personId) => {
    const requiredFraction = requiredFractions.get(personId);
    const numericWeight =
      fractionToNumber(requiredFraction) / fractionToNumber(selectedRequiredFraction);
    const weightFraction = exactOrApproximate(
      divideFractions(requiredFraction, selectedRequiredFraction),
      numericWeight,
    );
    const allocatedDeclaredFraction = exactOrApproximate(
      multiplyFractions(declaredFraction, weightFraction),
      fractionToNumber(declaredFraction) * numericWeight,
    );
    return {
      personId,
      requiredFraction,
      weightFraction,
      declaredFraction: allocatedDeclaredFraction,
      declaredShare: fractionToNumber(allocatedDeclaredFraction),
      declaredValue: declaredValue * fractionToNumber(weightFraction),
    };
  });

  return {
    allocations,
    declaredFraction,
    declaredValue,
    declarantIds,
    unresolvedDeclarantIds: [],
  };
}

export const isCompletedCausaMortisDeclaration = (declaration = {}) =>
  declaration.status === "complete";

export function validateCausaMortisDeclaration(
  declaration = {},
  { valueRequired = true, dateOfDeath = "" } = {},
) {
  if (!declaration.propertyId) return "Select the property.";

  const share = causaMortisDeclaredShare(declaration);
  if (share <= 0) return "Enter a positive fraction declared causa mortis.";
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
  const outsidePartiesById = new Map(outsideParties.map((party) => [party.id, party]));
  const rows = [];

  properties.forEach((property) => {
    const requiredByPerson = new Map();
    buildPropertyOwnership(people, property, outsideParties).transmissions.forEach(
      (transmission) => {
        const amountFraction =
          transmission.amountFraction || approximateFraction(transmission.amount);
        const requirement = requiredByPerson.get(transmission.deceasedId) || {
          requiredFraction: ZERO_FRACTION,
          requiredFractionsByDeclarant: new Map(),
        };
        requirement.requiredFraction = addFractions(requirement.requiredFraction, amountFraction);
        const exactAllocations = transmission.exactAllocations;
        const allocations =
          exactAllocations instanceof Map && exactAllocations.size
            ? exactAllocations
            : transmission.allocations;
        allocationEntries(allocations).forEach(([personId, allocation]) => {
          const allocationFraction =
            allocation?.denominator !== undefined
              ? allocation
              : approximateFraction(Number(allocation) || 0);
          const numericRequired =
            fractionToNumber(amountFraction) * fractionToNumber(allocationFraction);
          const requiredForDeclarant = exactOrApproximate(
            multiplyFractions(amountFraction, allocationFraction),
            numericRequired,
          );
          if (positiveFraction(requiredForDeclarant)) {
            addToFractionMap(
              requirement.requiredFractionsByDeclarant,
              personId,
              requiredForDeclarant,
            );
          }
        });
        requiredByPerson.set(transmission.deceasedId, requirement);
      },
    );

    requiredByPerson.forEach((requirement, personId) => {
      const { requiredFraction, requiredFractionsByDeclarant } = requirement;
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
      const declaredFractionsByDeclarant = new Map();
      const declaredValuesByDeclarant = new Map();
      const unresolvedDeclarantIds = new Set();
      declarations.forEach((declaration) => {
        const allocation = allocateCausaMortisDeclaration(
          declaration,
          requiredFractionsByDeclarant,
        );
        allocation.unresolvedDeclarantIds.forEach((personId) =>
          unresolvedDeclarantIds.add(personId),
        );
        allocation.allocations.forEach((item) => {
          addToFractionMap(declaredFractionsByDeclarant, item.personId, item.declaredFraction);
          declaredValuesByDeclarant.set(
            item.personId,
            (declaredValuesByDeclarant.get(item.personId) || 0) + item.declaredValue,
          );
        });
      });

      const recipientCoverage = [...requiredFractionsByDeclarant.entries()]
        .filter(([, fraction]) => positiveFraction(fraction))
        .map(([recipientId, recipientRequiredFraction]) => {
          const declaredFraction = declaredFractionsByDeclarant.get(recipientId) || ZERO_FRACTION;
          const comparison = compareFractions(declaredFraction, recipientRequiredFraction);
          const missingFraction =
            comparison < 0
              ? subtractFractions(recipientRequiredFraction, declaredFraction)
              : ZERO_FRACTION;
          const excessFraction =
            comparison > 0
              ? subtractFractions(declaredFraction, recipientRequiredFraction)
              : ZERO_FRACTION;
          const party = peopleById.get(recipientId) || outsidePartiesById.get(recipientId);
          return {
            personId: recipientId,
            name: party?.fullName || party?.name || "Unnamed heir",
            requiredFraction: recipientRequiredFraction,
            requiredShare: fractionToNumber(recipientRequiredFraction),
            declaredFraction,
            declaredShare: fractionToNumber(declaredFraction),
            declaredValue: declaredValuesByDeclarant.get(recipientId) || 0,
            missingFraction,
            excessFraction,
            status: comparison === 0 ? "complete" : comparison < 0 ? "under" : "over",
          };
        });
      const missingFraction = recipientCoverage.length
        ? recipientCoverage.reduce(
            (total, recipient) => addFractions(total, recipient.missingFraction),
            ZERO_FRACTION,
          )
        : requiredFraction;
      const excessFraction = recipientCoverage.reduce(
        (total, recipient) => addFractions(total, recipient.excessFraction),
        ZERO_FRACTION,
      );
      const hasMissingRecipients = recipientCoverage.some(
        (recipient) => recipient.status === "under",
      );
      const hasExcessRecipients = recipientCoverage.some(
        (recipient) => recipient.status === "over",
      );
      const differenceFraction = subtractFractions(excessFraction, missingFraction);
      const remainingFraction = missingFraction;
      const requiredShare = fractionToNumber(requiredFraction);
      const totalDeclaredShare = fractionToNumber(totalDeclaredFraction);
      const difference = fractionToNumber(differenceFraction);
      const status = deathDateUnknown
        ? "date-unknown"
        : hasMissingRecipients && hasExcessRecipients
          ? "mixed"
          : hasMissingRecipients ||
              (!recipientCoverage.length && positiveFraction(requiredFraction))
            ? "under"
            : hasExcessRecipients
              ? "over"
              : unresolvedDeclarantIds.size
                ? "allocation-unresolved"
                : "complete";

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
        missingFraction,
        excessFraction,
        recipientCoverage,
        underDeclaredRecipientIds: recipientCoverage
          .filter((recipient) => recipient.status === "under")
          .map((recipient) => recipient.personId),
        overDeclaredRecipientIds: recipientCoverage
          .filter((recipient) => recipient.status === "over")
          .map((recipient) => recipient.personId),
        unresolvedDeclarantIds: [...unresolvedDeclarantIds],
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
