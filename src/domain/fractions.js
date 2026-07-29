const integer = (value) => Number.parseInt(value, 10);

function divisor(a, b) {
  let left = Math.abs(a);
  let right = Math.abs(b);
  while (right) [left, right] = [right, left % right];
  return left || 1;
}

export function calculateFraction(left, right, operation) {
  const a = integer(left.numerator);
  const b = integer(left.denominator);
  const c = integer(right.numerator);
  const d = integer(right.denominator);
  if (![a, b, c, d].every(Number.isFinite)) return { error: "Enter four whole numbers." };
  if (b === 0 || d === 0) return { error: "A denominator cannot be zero." };
  let numerator;
  let denominator;
  if (operation === "add") [numerator, denominator] = [a * d + c * b, b * d];
  else if (operation === "subtract") [numerator, denominator] = [a * d - c * b, b * d];
  else if (operation === "multiply") [numerator, denominator] = [a * c, b * d];
  else {
    if (c === 0) return { error: "Cannot divide by zero." };
    [numerator, denominator] = [a * d, b * c];
  }
  if (denominator < 0) [numerator, denominator] = [-numerator, -denominator];
  const gcd = divisor(numerator, denominator);
  numerator /= gcd;
  denominator /= gcd;
  return {
    numerator,
    denominator,
    decimal: numerator / denominator,
    percentage: (numerator / denominator) * 100,
  };
}
