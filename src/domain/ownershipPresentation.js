import { fractionToNumber, normaliseFraction } from "./fractions.js";
import { allocateMoney, roundMoney, sumMoney } from "./money.js";
import { approximateFraction } from "./ownership.js";

export const WHOLE_PERCENTAGE_HUNDREDTHS = 10_000;

const WHOLE_PERCENTAGE_HUNDREDTHS_BIGINT = BigInt(WHOLE_PERCENTAGE_HUNDREDTHS);

function bigintDivisor(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}

function addPositiveRationals(left, right) {
  const sharedDivisor = bigintDivisor(left.denominator, right.denominator);
  const leftMultiplier = right.denominator / sharedDivisor;
  const rightMultiplier = left.denominator / sharedDivisor;
  const numerator = left.numerator * leftMultiplier + right.numerator * rightMultiplier;
  const denominator = left.denominator * leftMultiplier;
  const resultDivisor = bigintDivisor(numerator, denominator);
  return {
    numerator: numerator / resultDivisor,
    denominator: denominator / resultDivisor,
  };
}

function displayFraction(fraction) {
  const normalised = normaliseFraction(fraction?.numerator, fraction?.denominator);
  if (normalised.error) return { error: normalised.error };
  if (normalised.numerator < 0) return { error: "A percentage share cannot be negative." };
  return {
    numerator: BigInt(normalised.numerator),
    denominator: BigInt(normalised.denominator),
  };
}

function safeNumber(value) {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

/**
 * Formats an integer count of hundredths of one percentage point.
 *
 * Keeping this integer until the last step makes the displayed invariant exact:
 * labels such as 33.34%, 33.33% and 33.33% add to precisely 100%, without
 * relying on binary floating-point addition.
 */
export function formatPercentageHundredths(value) {
  let hundredths;
  if (typeof value === "bigint") hundredths = value;
  else if (Number.isSafeInteger(value)) hundredths = BigInt(value);
  else return "";
  if (hundredths < 0n) return "";

  const whole = hundredths / 100n;
  const remainder = hundredths % 100n;
  if (remainder === 0n) return `${whole}%`;
  if (remainder % 10n === 0n) return `${whole}.${remainder / 10n}%`;
  return `${whole}.${String(remainder).padStart(2, "0")}%`;
}

/**
 * Reconciles a coherent, aligned set of exact fractions for display.
 *
 * Each output row corresponds to the fraction at the same input index. The
 * largest-remainder (Hamilton) method distributes hundredths of a percentage
 * point, so a complete set is shown as exactly 100% while the exact fractions
 * and unrounded percentages remain untouched. Incomplete and overfull sets are
 * reconciled to their own exact rounded total; they are never disguised as a
 * complete set.
 */
export function reconcileFractionPercentageDisplay(fractions = [], { keys = [] } = {}) {
  const rows = fractions.map((fraction, index) => {
    const parsed = displayFraction(fraction);
    if (parsed.error) {
      return {
        index,
        valid: false,
        error: parsed.error,
        displayPercentageHundredths: null,
        displayPercentage: null,
        displayPercentageLabel: "",
      };
    }

    const scaledNumerator = parsed.numerator * WHOLE_PERCENTAGE_HUNDREDTHS_BIGINT;
    const floor = scaledNumerator / parsed.denominator;
    return {
      index,
      valid: true,
      error: "",
      floor,
      remainder: {
        numerator: scaledNumerator % parsed.denominator,
        denominator: parsed.denominator,
      },
    };
  });
  const validRows = rows.filter((row) => row.valid);
  const floorTotal = validRows.reduce((total, row) => total + row.floor, 0n);
  const remainderTotal = validRows.reduce(
    (total, row) => addPositiveRationals(total, row.remainder),
    { numerator: 0n, denominator: 1n },
  );
  const remainderFloor = remainderTotal.numerator / remainderTotal.denominator;
  const remainderAfterFloor = remainderTotal.numerator % remainderTotal.denominator;
  const roundedRemainder =
    remainderFloor + (remainderAfterFloor * 2n >= remainderTotal.denominator ? 1n : 0n);
  const exactScaledTotalNumerator =
    floorTotal * remainderTotal.denominator + remainderTotal.numerator;
  const exactWholeNumerator = WHOLE_PERCENTAGE_HUNDREDTHS_BIGINT * remainderTotal.denominator;
  const isExactlyWhole = exactScaledTotalNumerator === exactWholeNumerator;
  const ordinarilyRoundedTotal = floorTotal + roundedRemainder;
  const targetTotal =
    ordinarilyRoundedTotal === WHOLE_PERCENTAGE_HUNDREDTHS_BIGINT && !isExactlyWhole
      ? exactScaledTotalNumerator < exactWholeNumerator
        ? WHOLE_PERCENTAGE_HUNDREDTHS_BIGINT - 1n
        : WHOLE_PERCENTAGE_HUNDREDTHS_BIGINT + 1n
      : ordinarilyRoundedTotal;
  const unitsToDistribute = targetTotal - floorTotal;
  const rankedRows = [...validRows].sort((left, right) => {
    const leftRemainder = left.remainder.numerator * right.remainder.denominator;
    const rightRemainder = right.remainder.numerator * left.remainder.denominator;
    if (leftRemainder === rightRemainder) {
      const leftKey = keys[left.index];
      const rightKey = keys[right.index];
      if (leftKey !== undefined && rightKey !== undefined && String(leftKey) !== String(rightKey)) {
        return String(leftKey) < String(rightKey) ? -1 : 1;
      }
      return left.index - right.index;
    }
    return leftRemainder > rightRemainder ? -1 : 1;
  });
  const adjustedIndexes = new Set(
    rankedRows.slice(0, Number(unitsToDistribute)).map((row) => row.index),
  );
  const publicRows = rows.map((row) => {
    if (!row.valid) return row;
    const hundredths = row.floor + (adjustedIndexes.has(row.index) ? 1n : 0n);
    const displayPercentageHundredths = safeNumber(hundredths);
    return {
      index: row.index,
      valid: displayPercentageHundredths !== null,
      error:
        displayPercentageHundredths === null
          ? "The percentage is too large to display safely."
          : "",
      displayPercentageHundredths,
      displayPercentage:
        displayPercentageHundredths === null ? null : displayPercentageHundredths / 100,
      displayPercentageLabel:
        displayPercentageHundredths === null ? "" : formatPercentageHundredths(hundredths),
    };
  });
  const rowValuesAreValid = publicRows.every((row) => row.valid);
  const totalHundredths = targetTotal;
  const totalDisplayPercentageHundredths = rowValuesAreValid ? safeNumber(totalHundredths) : null;
  const valid = rowValuesAreValid && totalDisplayPercentageHundredths !== null;
  const isWhole = valid && isExactlyWhole;

  return {
    rows: publicRows,
    valid,
    isWhole,
    totalDisplayPercentageHundredths,
    totalDisplayPercentage:
      totalDisplayPercentageHundredths === null ? null : totalDisplayPercentageHundredths / 100,
    totalDisplayPercentageLabel:
      totalDisplayPercentageHundredths === null
        ? ""
        : formatPercentageHundredths(totalDisplayPercentageHundredths),
  };
}

export function recordedNonNegativeMoney(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function ownershipFraction(share = 0, exactFraction = null) {
  return exactFraction?.denominator ? exactFraction : approximateFraction(Number(share) || 0);
}

export function ownershipShare(share = 0, exactFraction = null) {
  const fraction = ownershipFraction(share, exactFraction);
  const exactShare = fractionToNumber(fraction);
  return Number.isFinite(exactShare) ? exactShare : Math.max(0, Number(share) || 0);
}

export function ownershipPercentage(share = 0, exactFraction = null) {
  return ownershipShare(share, exactFraction) * 100;
}

export function formatOwnershipFraction(share = 0, exactFraction = null) {
  const fraction = ownershipFraction(share, exactFraction);
  return `${fraction.numerator}/${fraction.denominator}`;
}

export function formatOwnershipPercentage(share = 0, exactFraction = null) {
  return `${ownershipPercentage(share, exactFraction).toLocaleString("en-MT", {
    maximumFractionDigits: 2,
  })}%`;
}

/**
 * One presentation record for every current owner.
 *
 * Exact fractions are the source for both the numeric share and percentage.
 * Where the tax calculation has already allocated the selling price across
 * acquisition-source rows, its cent-exact owner totals are authoritative. Any
 * current owners excluded from that report (for example an unresolved deceased
 * owner) share only the remaining covered cents.
 */
export function buildCurrentOwnerPresentations(
  owners = [],
  saleValueInput = null,
  taxCalculationReport = null,
) {
  const exactRows = owners.map((owner) => {
    const shareFraction = ownershipFraction(owner.share, owner.shareFraction);
    const share = ownershipShare(owner.share, shareFraction);
    return {
      ...owner,
      share,
      shareFraction,
      percentage: share * 100,
      value: null,
    };
  });
  const percentageDisplay = reconcileFractionPercentageDisplay(
    exactRows.map((owner) => owner.shareFraction),
    { keys: exactRows.map((owner) => owner.id) },
  );
  const rows = exactRows.map((owner, index) => {
    const display = percentageDisplay.rows[index];
    return {
      ...owner,
      displayPercentageHundredths: display.displayPercentageHundredths,
      displayPercentage: display.displayPercentage,
      displayPercentageLabel: display.displayPercentageLabel,
    };
  });
  const saleValue = recordedNonNegativeMoney(saleValueInput);
  if (saleValue === null || !rows.length) return rows;

  const shares = rows.map((owner) => Math.max(0, owner.share));
  const coveredShare = shares.reduce((total, share) => total + share, 0);
  const coveredValue = roundMoney(saleValue * coveredShare);
  const reportedValues = new Map(
    (taxCalculationReport?.vendors || [])
      .map((vendor) => [vendor.id, recordedNonNegativeMoney(vendor.attributedSaleValue)])
      .filter(([, value]) => value !== null),
  );
  reportedValues.forEach((value, id) => reportedValues.set(id, roundMoney(value)));

  if (!reportedValues.size) {
    const allocatedValues = allocateMoney(coveredValue, shares);
    return rows.map((owner, index) => ({ ...owner, value: allocatedValues[index] }));
  }

  const unresolvedOwners = rows
    .map((owner, index) => ({ owner, index }))
    .filter(({ owner }) => !reportedValues.has(owner.id));
  const reportedTotal = sumMoney(
    rows
      .filter((owner) => reportedValues.has(owner.id))
      .map((owner) => reportedValues.get(owner.id)),
  );
  const unresolvedValues = allocateMoney(
    roundMoney(coveredValue - reportedTotal),
    unresolvedOwners.map(({ index }) => shares[index]),
  );
  const unresolvedById = new Map(
    unresolvedOwners.map(({ owner }, index) => [owner.id, unresolvedValues[index]]),
  );

  return rows.map((owner) => ({
    ...owner,
    value: reportedValues.get(owner.id) ?? unresolvedById.get(owner.id) ?? null,
  }));
}

export function ownerPresentationsById(presentations = []) {
  return Object.fromEntries(presentations.map((presentation) => [presentation.id, presentation]));
}
