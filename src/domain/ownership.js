const value = (input) => Math.max(0, Number(input) || 0);

export function approximateFraction(decimal, maxDenominator = 10000) {
  if (!Number.isFinite(decimal) || decimal === 0) return { numerator: 0, denominator: 1 };
  const sign = decimal < 0 ? -1 : 1;
  const target = Math.abs(decimal);

  let best = { numerator: Math.round(target), denominator: 1 };
  let bestError = Math.abs(best.numerator - target);

  const consider = (numerator, denominator) => {
    if (denominator < 1 || denominator > maxDenominator) return;
    const error = Math.abs(numerator / denominator - target);
    if (error < bestError) {
      best = { numerator, denominator };
      bestError = error;
    }
  };

  // Continued-fraction convergents give the best rational approximation for a
  // bounded denominator in a handful of steps, instead of scanning every
  // denominator up to maxDenominator.
  let previousNumerator = 0;
  let previousDenominator = 1;
  let currentNumerator = 1;
  let currentDenominator = 0;
  let remainder = target;

  for (let step = 0; step < 64; step += 1) {
    const whole = Math.floor(remainder);
    const nextNumerator = whole * currentNumerator + previousNumerator;
    const nextDenominator = whole * currentDenominator + previousDenominator;

    if (nextDenominator > maxDenominator) {
      // The convergent overshoots the budget; the best remaining candidate is
      // the largest semiconvergent that still fits.
      if (currentDenominator > 0) {
        const room = Math.floor((maxDenominator - previousDenominator) / currentDenominator);
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
  const holdings = new Map(parties.map((party) => [party.id, startingHoldings.get(party.id) || 0]));
  const entries = transfers.map((transfer) => {
    const cleanTransfer = { ...transfer };
    delete cleanTransfer.error;
    const sellerHolding = holdings.get(transfer.sellerId) || 0;
    const numerator = value(transfer.numerator);
    const denominator = value(transfer.denominator);
    if (!transfer.sellerId || !transfer.buyerId)
      return { ...cleanTransfer, error: "Select a seller and buyer.", amount: 0 };
    if (transfer.sellerId === transfer.buyerId)
      return { ...cleanTransfer, error: "Seller and buyer must be different.", amount: 0 };
    if (!denominator)
      return { ...cleanTransfer, error: "The denominator must be greater than zero.", amount: 0 };
    const fraction = numerator / denominator;
    const amount = transfer.amountType === "whole-property" ? fraction : sellerHolding * fraction;
    if (fraction <= 0)
      return {
        ...cleanTransfer,
        error: "The transferred fraction must be greater than zero.",
        amount: 0,
      };
    if (amount > sellerHolding + 1e-10)
      return {
        ...cleanTransfer,
        error: "The seller does not own enough to complete this transfer.",
        amount: 0,
      };
    holdings.set(transfer.sellerId, Math.max(0, sellerHolding - amount));
    holdings.set(transfer.buyerId, (holdings.get(transfer.buyerId) || 0) + amount);
    return {
      ...cleanTransfer,
      amount,
      sellerBefore: sellerHolding,
      sellerAfter: sellerHolding - amount,
    };
  });
  return { holdings, entries };
}

function ledgerFromParties(parties, startingHoldings, transfers) {
  const { holdings, entries } = resolveTransfers(parties, startingHoldings, transfers);
  const owners = parties
    .map((party) => ({ ...party, share: holdings.get(party.id) || 0 }))
    .filter((party) => party.share > 1e-10)
    .sort((a, b) => b.share - a.share);
  return { parties, owners, entries, total: owners.reduce((sum, owner) => sum + owner.share, 0) };
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
  const startingHoldings = new Map(heirs.map((heir) => [heir.id, value(heir.sharePercent) / 100]));
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
