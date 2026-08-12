// Tranche-level ownership.
//
// A person's holding in a property is not a single fraction but a list of tranches, one per
// acquisition. Article 5A assesses parts acquired under different acquisitions as separate
// transfers, so the acquisition date has to survive every later transfer rather than being
// merged away into a running total.
//
// This module is additive: it produces the same aggregate fractions the existing engines do,
// while keeping the provenance the tax layer needs.

import {
  ZERO_FRACTION,
  addFractions,
  compareFractions,
  divideFractions,
  multiplyFractions,
  normaliseFraction,
  subtractFractions,
} from "./fractions.js";

export const SELECTION_STRATEGIES = ["cheapest-first", "pro-rata", "designated"];

const isError = (fraction) => Boolean(fraction && fraction.error);

function firstError(...fractions) {
  const found = fractions.find(isError);
  return found ? found.error : "";
}

// Tranches are compared on acquisition date, then id, so equal-rate ties resolve the same way
// on every run. A stable order matters: the notary has to be able to reproduce a figure.
function stableOrder(left, right) {
  const leftDate = String(left.acquiredOn || "");
  const rightDate = String(right.acquiredOn || "");
  if (leftDate !== rightDate) return leftDate < rightDate ? -1 : 1;
  return String(left.trancheId) < String(right.trancheId) ? -1 : 1;
}

export function createTranche({
  trancheId,
  personId,
  fraction,
  acquiredOn = "",
  cause = "",
  provenance = "",
  baseCost = null,
} = {}) {
  const share = normaliseFraction(fraction?.numerator, fraction?.denominator);
  if (isError(share)) return { error: share.error };
  return { trancheId, personId, fraction: share, acquiredOn, cause, provenance, baseCost };
}

export function totalHolding(tranches = []) {
  return tranches.reduce((running, tranche) => {
    if (isError(running)) return running;
    return addFractions(running, tranche.fraction);
  }, ZERO_FRACTION);
}

// Splits `amount` across the given tranches. Every strategy returns portions that sum exactly
// to `amount`; the strategies differ only in which tranche gives up what.
export function selectTranchePortions(
  tranches = [],
  amount = ZERO_FRACTION,
  { strategy = "cheapest-first", rateFor = null, designation = null } = {},
) {
  const held = totalHolding(tranches);
  if (isError(held)) return { error: held.error };
  if (compareFractions(amount, ZERO_FRACTION) <= 0) {
    return { error: "The transferred fraction must be greater than zero." };
  }
  if (compareFractions(amount, held) > 0) {
    return {
      error:
        "The seller is marked as having attempted to sell or donate a larger share than the calculator shows they owned on that date.",
    };
  }

  // Selling the whole holding is not a choice at all: every tranche goes, each carrying its own
  // acquisition date into the tax computation.
  if (compareFractions(amount, held) === 0) {
    return {
      wholeHolding: true,
      strategy: "whole-holding",
      portions: tranches
        .slice()
        .sort(stableOrder)
        .map((tranche) => ({ tranche, fraction: tranche.fraction })),
    };
  }

  if (strategy === "designated") return designatedPortions(tranches, amount, designation);
  if (strategy === "pro-rata") return proRataPortions(tranches, amount, held);
  return cheapestFirstPortions(tranches, amount, rateFor);
}

function proRataPortions(tranches, amount, held) {
  const portions = [];
  for (const tranche of tranches.slice().sort(stableOrder)) {
    const weight = divideFractions(tranche.fraction, held);
    const portion = multiplyFractions(amount, weight);
    const error = firstError(weight, portion);
    if (error) return { error };
    if (compareFractions(portion, ZERO_FRACTION) > 0) portions.push({ tranche, fraction: portion });
  }
  return { wholeHolding: false, strategy: "pro-rata", portions };
}

// With a flat rate per tranche the total tax is a linear function of the fractions taken, so
// filling from the lowest-rated tranche first is exactly optimal, not merely a good guess.
//
// A banded relief would break that linearity if the band were granted per lot. Applied
// proportionately across the lots of one deed it does not: for a fixed transfer value the
// banded share of every lot is the same constant, so each lot keeps a constant effective rate
// and the objective stays linear. Pass those effective rates as `rateFor` and greedy remains
// exact. See assertFlatRates for the case where a caller cannot supply them.
function cheapestFirstPortions(tranches, amount, rateFor) {
  const rated = tranches
    .slice()
    .sort(stableOrder)
    .map((tranche) => ({ tranche, rate: rateFor ? rateFor(tranche) : 0 }));
  rated.sort((left, right) => (left.rate === right.rate ? 0 : left.rate < right.rate ? -1 : 1));

  const portions = [];
  let remaining = amount;
  for (const { tranche } of rated) {
    if (compareFractions(remaining, ZERO_FRACTION) <= 0) break;
    const take = compareFractions(tranche.fraction, remaining) <= 0 ? tranche.fraction : remaining;
    const nextRemaining = subtractFractions(remaining, take);
    if (isError(nextRemaining)) return { error: nextRemaining.error };
    portions.push({ tranche, fraction: take });
    remaining = nextRemaining;
  }
  return { wholeHolding: false, strategy: "cheapest-first", portions };
}

// The seller may designate which provenance he is selling from. That is the exceptional path:
// the deed says it explicitly, so the app records it rather than deriving it.
function designatedPortions(tranches, amount, designation) {
  if (!Array.isArray(designation) || designation.length === 0) {
    return { error: "Designated transfers need at least one tranche and fraction." };
  }
  const byId = new Map(tranches.map((tranche) => [tranche.trancheId, tranche]));
  const portions = [];
  let assigned = ZERO_FRACTION;

  for (const entry of designation) {
    const tranche = byId.get(entry.trancheId);
    if (!tranche) return { error: "A designated tranche does not belong to this seller." };
    const fraction = normaliseFraction(entry.fraction?.numerator, entry.fraction?.denominator);
    if (isError(fraction)) return { error: fraction.error };
    if (compareFractions(fraction, tranche.fraction) > 0) {
      return { error: "A designated fraction exceeds what that tranche holds." };
    }
    const running = addFractions(assigned, fraction);
    if (isError(running)) return { error: running.error };
    assigned = running;
    portions.push({ tranche, fraction });
  }

  if (compareFractions(assigned, amount) !== 0) {
    return { error: "Designated fractions must add up to the transferred share." };
  }
  return { wholeHolding: false, strategy: "designated", portions };
}

// Applies selected portions to a holding, returning what the seller keeps and what moves.
// Retained tranches keep their identity and acquisition date; only the fraction shrinks.
export function applyPortions(tranches = [], portions = []) {
  const takenById = new Map();
  for (const portion of portions) {
    const running = addFractions(
      takenById.get(portion.tranche.trancheId) || ZERO_FRACTION,
      portion.fraction,
    );
    if (isError(running)) return { error: running.error };
    takenById.set(portion.tranche.trancheId, running);
  }

  const retained = [];
  for (const tranche of tranches) {
    const taken = takenById.get(tranche.trancheId);
    if (!taken) {
      retained.push(tranche);
      continue;
    }
    const left = subtractFractions(tranche.fraction, taken);
    if (isError(left)) return { error: left.error };
    if (compareFractions(left, ZERO_FRACTION) > 0) retained.push({ ...tranche, fraction: left });
  }
  return { retained };
}

// Each portion becomes its own tax lot, because each carries a different acquisition date.
export function buildTaxLots(portions = [], { propertyValue = 0, transferDate = "" } = {}) {
  return portions.map((portion) => ({
    trancheId: portion.tranche.trancheId,
    acquisitionDate: portion.tranche.acquiredOn,
    provenance: portion.tranche.provenance,
    cause: portion.tranche.cause,
    fraction: portion.fraction,
    transferDate,
    transferValue: propertyValue * fractionValue(portion.fraction),
  }));
}

function fractionValue(fraction) {
  return Number(fraction.numerator) / Number(fraction.denominator);
}

// Guard for the one non-linear case in article5A: a banded relief makes cheapest-first unsafe,
// so callers should fall back to enumerating allocations rather than trusting the greedy result.
export function assertFlatRates(tranches = [], methodFor = null) {
  if (!methodFor) return { flat: true, banded: [] };
  const banded = tranches.filter((tranche) => {
    const method = methodFor(tranche);
    return Boolean(method) && (method.rate === null || method.rate === undefined);
  });
  return { flat: banded.length === 0, banded };
}
