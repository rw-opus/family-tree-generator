import { approximateFraction } from "./ownership.js";
import { fractionComponentNumber } from "./fractions.js";

const finiteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Normalise a percentage typed by a user to the two decimal places shown by
 * percentage controls. Empty or temporarily unusable input is left alone so a
 * controlled field can still be cleared and retyped naturally.
 */
export function normalisePercentageInput(value) {
  const input = String(value ?? "");
  if (!input.trim()) return input;

  const percentage = Number(input);
  if (!Number.isFinite(percentage)) return input;

  const adjusted = percentage + Number.EPSILON * Math.sign(percentage) * Math.abs(percentage);
  const rounded = Math.round(adjusted * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

export function shareFromPercentage(percentage) {
  const sharePercent = Math.max(0, finiteNumber(percentage));
  const fraction = approximateFraction(sharePercent / 100);
  return {
    sharePercent,
    shareNumerator: fraction.numerator,
    shareDenominator: fraction.denominator,
  };
}

export function shareFromFraction(numerator, denominator) {
  const parsedNumerator = fractionComponentNumber(numerator);
  const parsedDenominator = fractionComponentNumber(denominator, { allowZero: false });
  const shareNumerator = Number.isFinite(parsedNumerator) ? parsedNumerator : 0;
  const shareDenominator = Number.isFinite(parsedDenominator) ? parsedDenominator : 0;
  return {
    shareNumerator,
    shareDenominator,
    sharePercent: shareDenominator > 0 ? (shareNumerator * 100) / shareDenominator : 0,
  };
}

export function shareFromFractionInput(share = {}, patch = {}) {
  const current = fractionForShare(share);
  const shareNumerator = patch.numerator ?? share.shareNumerator ?? current.numerator;
  const shareDenominator = patch.denominator ?? share.shareDenominator ?? current.denominator;
  return {
    ...shareFromFraction(shareNumerator, shareDenominator),
    shareNumerator,
    shareDenominator,
    sharePercentInput: undefined,
  };
}

export function shareFromPercentageInput(percentage) {
  return {
    ...shareFromPercentage(percentage),
    sharePercentInput: String(percentage ?? ""),
  };
}

export function fractionForShare(share = {}) {
  const numerator = fractionComponentNumber(share.shareNumerator);
  const denominator = fractionComponentNumber(share.shareDenominator, { allowZero: false });
  if (Number.isFinite(numerator) && Number.isFinite(denominator)) {
    return { numerator, denominator };
  }
  const fraction = approximateFraction(finiteNumber(share.sharePercent) / 100);
  return { numerator: fraction.numerator, denominator: fraction.denominator };
}
