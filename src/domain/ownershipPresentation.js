import { fractionToNumber } from "./fractions.js";
import { allocateMoney, roundMoney, sumMoney } from "./money.js";
import { approximateFraction } from "./ownership.js";

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
  const rows = owners.map((owner) => {
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
