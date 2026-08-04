export const MAX_FRACTION_DIGITS = 12;
export const MAX_FRACTION_INTEGER = 999_999_999_999;

const MAX_FRACTION_BIGINT = BigInt(MAX_FRACTION_INTEGER);
const WHOLE_NUMBER_PATTERN = /^[+-]?\d+$/;

function parseLimitedInteger(value) {
  let parsed;

  if (typeof value === "bigint") parsed = value;
  else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return { error: "invalid" };
    parsed = BigInt(value);
  } else {
    const input = String(value ?? "").trim();
    if (!WHOLE_NUMBER_PATTERN.test(input)) return { error: "invalid" };
    parsed = BigInt(input);
  }

  if (parsed < -MAX_FRACTION_BIGINT || parsed > MAX_FRACTION_BIGINT) {
    return { error: "limit" };
  }
  return { value: parsed };
}

export function fractionComponentNumber(value, { allowNegative = false, allowZero = true } = {}) {
  const result = parseLimitedInteger(value);
  if (result.error) return Number.NaN;
  if (!allowNegative && result.value < 0n) return Number.NaN;
  if (!allowZero && result.value === 0n) return Number.NaN;
  return Number(result.value);
}

function divisor(a, b) {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;
  while (right) [left, right] = [right, left % right];
  return left || 1n;
}

function boundedFraction(numerator, denominator) {
  if (denominator === 0n) return { error: "A denominator cannot be zero." };
  let nextNumerator = numerator;
  let nextDenominator = denominator;
  if (nextDenominator < 0n) {
    nextNumerator = -nextNumerator;
    nextDenominator = -nextDenominator;
  }
  const gcd = divisor(nextNumerator, nextDenominator);
  nextNumerator /= gcd;
  nextDenominator /= gcd;
  if (
    nextNumerator < -MAX_FRACTION_BIGINT ||
    nextNumerator > MAX_FRACTION_BIGINT ||
    nextDenominator > MAX_FRACTION_BIGINT
  ) {
    return { error: `The reduced result exceeds the ${MAX_FRACTION_DIGITS}-digit limit.` };
  }
  return {
    numerator: Number(nextNumerator),
    denominator: Number(nextDenominator),
  };
}

function fractionBigInts(fraction = {}) {
  const numerator = parseLimitedInteger(fraction.numerator);
  const denominator = parseLimitedInteger(fraction.denominator);
  if (numerator.error || denominator.error || denominator.value === 0n) return null;
  return { numerator: numerator.value, denominator: denominator.value };
}

export function normaliseFraction(numerator, denominator, { allowNegative = false } = {}) {
  const parsedNumerator = parseLimitedInteger(numerator);
  const parsedDenominator = parseLimitedInteger(denominator);
  if (parsedNumerator.error || parsedDenominator.error || parsedDenominator.value === 0n) {
    return { error: `Enter a valid fraction using no more than ${MAX_FRACTION_DIGITS} digits.` };
  }
  if (!allowNegative && parsedNumerator.value < 0n) {
    return { error: "A share cannot be negative." };
  }
  return boundedFraction(parsedNumerator.value, parsedDenominator.value);
}

export function addFractions(left, right) {
  const first = fractionBigInts(left);
  const second = fractionBigInts(right);
  if (!first || !second) return { error: "Cannot add an invalid fraction." };
  return boundedFraction(
    first.numerator * second.denominator + second.numerator * first.denominator,
    first.denominator * second.denominator,
  );
}

export function subtractFractions(left, right) {
  const first = fractionBigInts(left);
  const second = fractionBigInts(right);
  if (!first || !second) return { error: "Cannot subtract an invalid fraction." };
  return boundedFraction(
    first.numerator * second.denominator - second.numerator * first.denominator,
    first.denominator * second.denominator,
  );
}

export function multiplyFractions(left, right) {
  const first = fractionBigInts(left);
  const second = fractionBigInts(right);
  if (!first || !second) return { error: "Cannot multiply an invalid fraction." };
  return boundedFraction(
    first.numerator * second.numerator,
    first.denominator * second.denominator,
  );
}

export function divideFractions(left, right) {
  const first = fractionBigInts(left);
  const second = fractionBigInts(right);
  if (!first || !second || second.numerator === 0n) {
    return { error: "Cannot divide by an invalid or zero fraction." };
  }
  return boundedFraction(
    first.numerator * second.denominator,
    first.denominator * second.numerator,
  );
}

export function compareFractions(left, right) {
  const first = fractionBigInts(left);
  const second = fractionBigInts(right);
  if (!first || !second) return Number.NaN;
  const difference = first.numerator * second.denominator - second.numerator * first.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function fractionToNumber(fraction = {}) {
  const parsed = fractionBigInts(fraction);
  return parsed ? Number(parsed.numerator) / Number(parsed.denominator) : Number.NaN;
}

export const ZERO_FRACTION = Object.freeze({ numerator: 0, denominator: 1 });
export const WHOLE_FRACTION = Object.freeze({ numerator: 1, denominator: 1 });

export function calculateFraction(left, right, operation) {
  const parsed = [
    parseLimitedInteger(left.numerator),
    parseLimitedInteger(left.denominator),
    parseLimitedInteger(right.numerator),
    parseLimitedInteger(right.denominator),
  ];
  if (parsed.some((item) => item.error === "invalid")) {
    return { error: "Enter four whole numbers." };
  }
  if (parsed.some((item) => item.error === "limit")) {
    return { error: `Use no more than ${MAX_FRACTION_DIGITS} digits for each number.` };
  }

  const [a, b, c, d] = parsed.map((item) => item.value);
  if (b === 0n || d === 0n) return { error: "A denominator cannot be zero." };

  let numerator;
  let denominator;
  if (operation === "add") [numerator, denominator] = [a * d + c * b, b * d];
  else if (operation === "subtract") [numerator, denominator] = [a * d - c * b, b * d];
  else if (operation === "multiply") [numerator, denominator] = [a * c, b * d];
  else {
    if (c === 0n) return { error: "Cannot divide by zero." };
    [numerator, denominator] = [a * d, b * c];
  }

  const reduced = boundedFraction(numerator, denominator);
  if (reduced.error) return reduced;
  const numericNumerator = reduced.numerator;
  const numericDenominator = reduced.denominator;
  return {
    numerator: numericNumerator,
    denominator: numericDenominator,
    decimal: numericNumerator / numericDenominator,
    percentage: (numericNumerator / numericDenominator) * 100,
  };
}
