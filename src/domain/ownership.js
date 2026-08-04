import {
  addFractions,
  compareFractions,
  fractionToNumber,
  MAX_FRACTION_INTEGER,
  multiplyFractions,
  normaliseFraction,
  subtractFractions,
  ZERO_FRACTION,
} from "./fractions.js";

const value = (input) => Math.max(0, Number(input) || 0);

export function approximateFraction(decimal) {
  if (!Number.isFinite(decimal) || decimal === 0) return { numerator: 0, denominator: 1 };
  const sign = decimal < 0 ? -1 : 1;
  const target = Math.abs(decimal);
  const tolerance = Number.EPSILON * Math.max(1, target) * 8;

  let best = { numerator: Math.round(target), denominator: 1 };
  let bestError = Math.abs(best.numerator - target);

  const consider = (numerator, denominator) => {
    if (
      !Number.isSafeInteger(numerator) ||
      Math.abs(numerator) > MAX_FRACTION_INTEGER ||
      denominator < 1 ||
      denominator > MAX_FRACTION_INTEGER
    ) {
      return;
    }
    const error = Math.abs(numerator / denominator - target);
    if (error < bestError) {
      best = { numerator, denominator };
      bestError = error;
    }
  };

  // Continued-fraction convergents give the best rational approximation within
  // the configured 12-digit fraction boundary without scanning every possible
  // denominator.
  let previousNumerator = 0;
  let previousDenominator = 1;
  let currentNumerator = 1;
  let currentDenominator = 0;
  let remainder = target;

  for (let step = 0; step < 64; step += 1) {
    const whole = Math.floor(remainder);
    const nextNumerator = whole * currentNumerator + previousNumerator;
    const nextDenominator = whole * currentDenominator + previousDenominator;

    if (
      !Number.isSafeInteger(nextNumerator) ||
      !Number.isSafeInteger(nextDenominator) ||
      Math.abs(nextNumerator) > MAX_FRACTION_INTEGER ||
      nextDenominator > MAX_FRACTION_INTEGER
    ) {
      // The convergent has crossed the configured boundary; the best remaining
      // candidate is the largest permitted semiconvergent.
      if (currentDenominator > 0) {
        const denominatorRoom = Math.floor(
          (MAX_FRACTION_INTEGER - previousDenominator) / currentDenominator,
        );
        const numeratorRoom =
          currentNumerator === 0
            ? denominatorRoom
            : Math.floor(
                (MAX_FRACTION_INTEGER - Math.abs(previousNumerator)) / Math.abs(currentNumerator),
              );
        const room = Math.min(denominatorRoom, numeratorRoom);
        if (room >= 1) {
          consider(
            room * currentNumerator + previousNumerator,
            room * currentDenominator + previousDenominator,
          );
        }
      }
      break;
    }

    consider(nextNumerator, nextDenominator);
    if (bestError <= tolerance) break;

    previousNumerator = currentNumerator;
    previousDenominator = currentDenominator;
    currentNumerator = nextNumerator;
    currentDenominator = nextDenominator;

    const fractionalPart = remainder - whole;
    if (fractionalPart < 1e-15) break;
    remainder = 1 / fractionalPart;
  }
  return { numerator: best.numerator * sign, denominator: best.denominator };
}

const hasManualShare = (person) =>
  person?.ownershipSharePercent !== undefined &&
  person?.ownershipSharePercent !== null &&
  person?.ownershipSharePercent !== "";

/**
 * Starting ownership is only ever what someone has explicitly entered.
 *
 * This previously spread ownership across everyone who was anyone's parent, at
 * every generation, producing plausible-looking numbers nobody had chosen.
 */
export function buildStarterOwnership(people = []) {
  if (!people.length) return {};

  return Object.fromEntries(
    people
      .filter((person) => person?.id && hasManualShare(person))
      .map((person) => [person.id, value(person.ownershipSharePercent) / 100]),
  );
}

/**
 * True when nobody has been given a starting share yet.
 */
export function startingOwnershipIsUnset(people = []) {
  return !people.some((person) => person?.id && hasManualShare(person));
}

/**
 * Total of the explicitly entered starting shares, as a percentage.
 */
export function startingOwnershipTotalPercent(people = []) {
  return people
    .filter((person) => person?.id && hasManualShare(person))
    .reduce((total, person) => total + value(person.ownershipSharePercent), 0);
}

// Applies a sequence of transfers on top of starting holdings, shared by both the legacy
// heir-list ledger and the per-property ledger below.
function resolveTransfers(parties, startingHoldings, transfers) {
  const exactValue = (input) => {
    if (input && typeof input === "object" && "numerator" in input) {
      return normaliseFraction(input.numerator, input.denominator);
    }
    return approximateFraction(value(input));
  };
  const holdings = new Map(
    parties.map((party) => [party.id, exactValue(startingHoldings.get(party.id) || 0)]),
  );
  const entries = transfers.map((transfer) => {
    const cleanTransfer = { ...transfer };
    delete cleanTransfer.error;
    const sellerHolding = holdings.get(transfer.sellerId) || ZERO_FRACTION;
    const transferFraction = normaliseFraction(transfer.numerator, transfer.denominator);
    if (!transfer.sellerId || !transfer.buyerId)
      return { ...cleanTransfer, error: "Select a seller and buyer.", amount: 0 };
    if (transfer.sellerId === transfer.buyerId)
      return { ...cleanTransfer, error: "Seller and buyer must be different.", amount: 0 };
    if (transferFraction.error) {
      return {
        ...cleanTransfer,
        error: transferFraction.error,
        amount: 0,
      };
    }
    const amountFraction =
      transfer.amountType === "whole-property"
        ? transferFraction
        : multiplyFractions(sellerHolding, transferFraction);
    if (compareFractions(transferFraction, ZERO_FRACTION) <= 0)
      return {
        ...cleanTransfer,
        error: "The transferred fraction must be greater than zero.",
        amount: 0,
      };
    if (amountFraction.error) return { ...cleanTransfer, error: amountFraction.error, amount: 0 };
    if (compareFractions(amountFraction, sellerHolding) > 0)
      return {
        ...cleanTransfer,
        error: "The seller does not own enough to complete this transfer.",
        amount: 0,
      };
    const sellerAfter = subtractFractions(sellerHolding, amountFraction);
    const buyerAfter = addFractions(
      holdings.get(transfer.buyerId) || ZERO_FRACTION,
      amountFraction,
    );
    if (sellerAfter.error || buyerAfter.error) {
      return {
        ...cleanTransfer,
        error: sellerAfter.error || buyerAfter.error,
        amount: 0,
      };
    }
    holdings.set(transfer.sellerId, sellerAfter);
    holdings.set(transfer.buyerId, buyerAfter);
    return {
      ...cleanTransfer,
      amount: fractionToNumber(amountFraction),
      amountFraction,
      sellerBefore: fractionToNumber(sellerHolding),
      sellerBeforeFraction: sellerHolding,
      sellerAfter: fractionToNumber(sellerAfter),
      sellerAfterFraction: sellerAfter,
    };
  });
  return { holdings, entries };
}

// Transfers carrying a date are applied in date order; the array position breaks same-day
// ties. Undated transfers keep their array position relative to each other and sort after
// dated ones, so trees saved before dates existed resolve exactly as they always did.
export function chronologicalTransfers(transfers = []) {
  const indexed = transfers.map((transfer, index) => ({ transfer, index }));
  const hasDate = (entry) => /^\d{4}-\d{2}-\d{2}$/.test(String(entry.transfer.date || ""));
  if (!indexed.some(hasDate)) return transfers;
  return indexed
    .sort((left, right) => {
      const leftDated = hasDate(left);
      const rightDated = hasDate(right);
      if (leftDated !== rightDated) return leftDated ? -1 : 1;
      if (leftDated && left.transfer.date !== right.transfer.date) {
        return left.transfer.date < right.transfer.date ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.transfer);
}

function ledgerFromParties(parties, startingHoldings, transfers) {
  const { holdings, entries } = resolveTransfers(
    parties,
    startingHoldings,
    chronologicalTransfers(transfers),
  );
  const owners = parties
    .map((party) => {
      const shareFraction = holdings.get(party.id) || ZERO_FRACTION;
      return { ...party, share: fractionToNumber(shareFraction), shareFraction };
    })
    .filter((party) => compareFractions(party.shareFraction, ZERO_FRACTION) > 0)
    .sort((a, b) => b.share - a.share);
  const totalFraction = owners.reduce(
    (sum, owner) => addFractions(sum, owner.shareFraction),
    ZERO_FRACTION,
  );
  return {
    parties,
    owners,
    entries,
    total: fractionToNumber(totalFraction),
    totalFraction,
  };
}

function uniqueParties(parties = []) {
  const byId = new Map();
  parties.forEach((party) => {
    if (!party?.id) return;
    byId.set(party.id, { ...(byId.get(party.id) || {}), ...party });
  });
  return [...byId.values()];
}

export function buildOwnershipLedger(
  heirs = [],
  outsideParties = [],
  transfers = [],
  familyPeople = [],
) {
  const linkedPersonIds = new Set(heirs.map((heir) => heir.personId).filter(Boolean));
  const parties = uniqueParties([
    ...heirs.map((heir) => ({
      id: heir.id,
      personId: heir.personId || "",
      name: heir.name || "Unnamed family member",
      type: "individual",
      source: "family",
    })),
    ...familyPeople
      .filter((person) => !linkedPersonIds.has(person.id))
      .map((person) => ({
        id: person.id,
        personId: person.id,
        name: person.fullName || "Unnamed family member",
        type: "individual",
        source: "family-tree",
      })),
    ...outsideParties.map((party) => ({
      ...party,
      name: party.name || (party.type === "company" ? "Unnamed company" : "Unnamed individual"),
      source: "outside",
    })),
  ]);
  const startingHoldings = new Map(
    heirs.map((heir) => {
      const exact = normaliseFraction(heir.shareNumerator, heir.shareDenominator);
      return [heir.id, exact.error ? approximateFraction(value(heir.sharePercent) / 100) : exact];
    }),
  );
  return ledgerFromParties(parties, startingHoldings, transfers);
}

// Same ledger mechanics as buildOwnershipLedger, but starting from a property's automatic
// per-person ownership (buildPropertyOwnership's ownershipByPerson) instead of a manual
// heir list, so a property's title can be transferred onward without System A's heir records.
export function buildPropertyLedger(
  people = [],
  outsideParties = [],
  transfers = [],
  startingOwnership = {},
) {
  const parties = uniqueParties([
    ...people.map((person) => ({
      id: person.id,
      personId: person.id,
      name: person.fullName || "Unnamed family member",
      type: "individual",
      source: "family-tree",
    })),
    ...outsideParties.map((party) => ({
      ...party,
      name: party.name || (party.type === "company" ? "Unnamed company" : "Unnamed individual"),
      source: "outside",
    })),
  ]);
  const startingHoldings = new Map(Object.entries(startingOwnership));
  return ledgerFromParties(parties, startingHoldings, transfers);
}
