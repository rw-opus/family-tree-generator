import { approximateFraction } from "./ownership.js";

const finiteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function shareFromPercentage(percentage, maxDenominator = 10000) {
  const sharePercent = Math.max(0, finiteNumber(percentage));
  const fraction = approximateFraction(sharePercent / 100, maxDenominator);
  return {
    sharePercent,
    shareNumerator: fraction.numerator,
    shareDenominator: fraction.denominator,
  };
}

export function shareFromFraction(numerator, denominator) {
  const shareNumerator = Math.max(0, finiteNumber(numerator));
  const shareDenominator = Math.max(0, finiteNumber(denominator));
  return {
    shareNumerator,
    shareDenominator,
    sharePercent: shareDenominator > 0 ? (shareNumerator * 100) / shareDenominator : 0,
  };
}

export function fractionForShare(share = {}) {
  const numerator = Number(share.shareNumerator);
  const denominator = Number(share.shareDenominator);
  if (
    Number.isFinite(numerator) &&
    numerator >= 0 &&
    Number.isFinite(denominator) &&
    denominator > 0
  ) {
    return { numerator, denominator };
  }
  const fraction = approximateFraction(finiteNumber(share.sharePercent) / 100);
  return { numerator: fraction.numerator, denominator: fraction.denominator };
}
