/**
 * Money handling for the tax and settlement figures.
 *
 * Every euro amount a user reads is a whole number of cents, and a column of
 * such amounts must add up to the total printed beneath it. Binary floating
 * point cannot promise that: a third of EUR 1,000,000 is 333333.3333..., three
 * of them shown to the cent read EUR 333,333.33 and sum to EUR 999,999.99
 * against a EUR 1,000,000.00 total. Thirds, sixths and sevenths are routine in
 * Maltese succession, so this is the normal case rather than an edge case.
 *
 * The rule applied here: split an amount into whole cents using the largest
 * remainder method, so the parts always sum exactly to the whole, and let every
 * total be the sum of already-rounded parts rather than a separate calculation.
 */

const CENTS = 100;

export function toCents(value) {
  // Number("") and Number(null) are both 0, which would turn "not recorded"
  // into a real zero amount. Absent values stay absent.
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  // Scaling before rounding keeps values such as 8.045 from drifting to 8.04.
  return Math.round((amount + Number.EPSILON * Math.sign(amount) * Math.abs(amount)) * CENTS);
}

export function fromCents(cents) {
  const amount = Number(cents);
  return Number.isFinite(amount) ? amount / CENTS : null;
}

/** Rounds a euro amount to the nearest whole cent. */
export function roundMoney(value) {
  const cents = toCents(value);
  return cents === null ? null : fromCents(cents);
}

/**
 * Splits `totalCents` into one whole-cent portion per weight, so that the
 * portions sum exactly to `totalCents`.
 *
 * Portions are first floored, then the cents left over by flooring are handed
 * out one at a time to the largest fractional remainders — the largest
 * remainder (Hamilton) method. Ties break towards the earlier weight, so the
 * result is deterministic and a re-render never reshuffles the pennies.
 */
export function allocateCents(totalCents, weights = []) {
  const total = Math.round(Number(totalCents) || 0);
  const safeWeights = weights.map((weight) => {
    const value = Number(weight);
    return Number.isFinite(value) && value > 0 ? value : 0;
  });
  const weightSum = safeWeights.reduce((sum, weight) => sum + weight, 0);
  if (!safeWeights.length) return [];
  if (weightSum <= 0) {
    // Nothing to weigh by: give the whole amount to the first portion so the
    // sum still reconciles instead of silently losing the total.
    return safeWeights.map((_, index) => (index === 0 ? total : 0));
  }

  const exact = safeWeights.map((weight) => (total * weight) / weightSum);
  const floors = exact.map((value) => Math.floor(value));
  const distributed = floors.reduce((sum, value) => sum + value, 0);
  let remaining = total - distributed;

  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);

  const portions = [...floors];
  // A negative total (a credit) hands cents back in the same deterministic order.
  const step = remaining >= 0 ? 1 : -1;
  for (let position = 0; remaining !== 0 && order.length; position += 1) {
    portions[order[position % order.length].index] += step;
    remaining -= step;
  }
  return portions;
}

/**
 * Splits a euro amount into whole-cent euro portions summing exactly to it.
 * Returns null when the amount is not a usable number, so callers can keep
 * distinguishing "not calculated" from zero.
 */
export function allocateMoney(total, weights = []) {
  const totalCents = toCents(total);
  if (totalCents === null) return null;
  return allocateCents(totalCents, weights).map(fromCents);
}

/** Sums euro amounts through cents, so the result is itself cent-exact. */
export function sumMoney(values = []) {
  const cents = values.reduce((sum, value) => {
    const part = toCents(value);
    return part === null ? sum : sum + part;
  }, 0);
  return fromCents(cents);
}
