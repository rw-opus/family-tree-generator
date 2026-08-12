import { isLegacyHistoricalLawWarning } from "./successionRules.js";
import { addFractions, ZERO_FRACTION } from "./fractions.js";
import { approximateFraction } from "./ownership.js";

export const DEFAULT_PERSON_CARD_FIELDS = Object.freeze({
  ownershipFraction: true,
  ownershipPercentage: true,
  ownershipValue: true,
  dateOfDeath: false,
  successionBasis: false,
  willDetails: false,
  causaMortisDetails: false,
  stackLegalDetails: true,
});

export function normalisePersonCardFields(settings = {}) {
  const savedFields =
    settings.personCardFields && typeof settings.personCardFields === "object"
      ? settings.personCardFields
      : null;

  if (savedFields) {
    return Object.fromEntries(
      Object.entries(DEFAULT_PERSON_CARD_FIELDS).map(([key, defaultValue]) => [
        key,
        typeof savedFields[key] === "boolean" ? savedFields[key] : defaultValue,
      ]),
    );
  }

  const showShares = settings.showOwnershipOnTree !== false;
  const shareDisplay = settings.shareDisplay || "both";
  return {
    ...DEFAULT_PERSON_CARD_FIELDS,
    ownershipFraction: showShares && shareDisplay !== "percentage",
    ownershipPercentage: showShares && shareDisplay !== "fraction",
  };
}

/**
 * Current owners come from the post-transfer ledger. A deceased person is no
 * longer a current owner, but their transmission records preserve the share
 * held immediately before it passed to their successors. Show that historical
 * share on the deceased person's card without adding it to today's totals.
 */
export function buildTreeCardOwnershipByPerson(currentOwners = [], transmissions = []) {
  const ownershipByPerson = {};
  currentOwners.forEach((owner) => {
    const personId = String(owner?.personId || "");
    const share = Number(owner?.share);
    if (personId && Number.isFinite(share) && share > 0) ownershipByPerson[personId] = share;
  });

  const historicalShares = new Map();
  transmissions.forEach((transmission) => {
    const deceasedId = String(transmission?.deceasedId || "");
    const shareAtDeath = Number(transmission?.amount);
    if (!deceasedId || !Number.isFinite(shareAtDeath) || shareAtDeath <= 0) return;
    historicalShares.set(deceasedId, (historicalShares.get(deceasedId) || 0) + shareAtDeath);
  });
  historicalShares.forEach((share, deceasedId) => {
    ownershipByPerson[deceasedId] = share;
  });

  return ownershipByPerson;
}

export function buildTreeCardOwnershipFractionsByPerson(currentOwners = [], transmissions = []) {
  const currentFractions = new Map();
  const invalidCurrentIds = new Set();
  currentOwners.forEach((owner) => {
    const personId = String(owner?.personId || "");
    const share = Number(owner?.share);
    if (!personId || !Number.isFinite(share) || share <= 0 || invalidCurrentIds.has(personId))
      return;
    const fraction = owner.shareFraction?.denominator
      ? owner.shareFraction
      : approximateFraction(share);
    const combined = addFractions(currentFractions.get(personId) || ZERO_FRACTION, fraction);
    if (combined.error) {
      currentFractions.delete(personId);
      invalidCurrentIds.add(personId);
      return;
    }
    currentFractions.set(personId, combined);
  });

  const historicalFractions = new Map();
  const invalidHistoricalIds = new Set();
  transmissions.forEach((transmission) => {
    const deceasedId = String(transmission?.deceasedId || "");
    const amount = Number(transmission?.amount);
    if (
      !deceasedId ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      invalidHistoricalIds.has(deceasedId)
    ) {
      return;
    }
    const fraction = transmission.amountFraction?.denominator
      ? transmission.amountFraction
      : approximateFraction(amount);
    const combined = addFractions(historicalFractions.get(deceasedId) || ZERO_FRACTION, fraction);
    if (combined.error) {
      historicalFractions.delete(deceasedId);
      invalidHistoricalIds.add(deceasedId);
      return;
    }
    historicalFractions.set(deceasedId, combined);
  });

  // A completed succession's historical holding is the fraction the deceased
  // owned immediately before it passed on. It intentionally supersedes any
  // unresolved current-ledger balance for the same person, matching the numeric
  // card map above.
  return Object.fromEntries([...currentFractions, ...historicalFractions]);
}

/**
 * A red historical-law marker belongs to the property succession that actually
 * ran through the calculator, not merely to an old date of death. Keeping this
 * map transmission-based makes the tree, history and tax views use the same
 * section-specific decision.
 */
export function buildTreeCardHistoricalWarningsByPerson(transmissions = []) {
  const warningsByPerson = {};
  transmissions.forEach((transmission) => {
    const deceasedId = String(transmission?.deceasedId || "");
    if (!deceasedId) return;
    const historicalWarnings = (transmission.warnings || []).filter(isLegacyHistoricalLawWarning);
    if (!historicalWarnings.length) return;
    warningsByPerson[deceasedId] = [
      ...new Set([...(warningsByPerson[deceasedId] || []), ...historicalWarnings]),
    ];
  });
  return warningsByPerson;
}
