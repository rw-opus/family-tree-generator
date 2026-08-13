const RESOLVED_STATUSES = new Set(["complete", "over"]);

const coverageStatus = (coverage) => (typeof coverage === "string" ? coverage : coverage?.status);

/**
 * True when CM coverage needs information or a declaration from the user.
 * An excess declaration remains stored for provenance and tax calculations,
 * but is not an outstanding action.
 */
export function isCausaMortisCoverageActionRequired(coverage) {
  if (coverage == null) return false;
  const status = coverageStatus(coverage);
  return !RESOLVED_STATUSES.has(status);
}

/**
 * Coverage rows shown to the user. Excess-only rows are deliberately omitted;
 * mixed rows stay visible because they still contain a missing allocation.
 */
export const visibleCausaMortisCoverage = (coverage = []) =>
  coverage.filter((row) => coverageStatus(row) !== "over");

/**
 * An over-declaration is retained as a recorded deed fact, but it is not an
 * outstanding action. The person card may explain the proportional tax
 * treatment without exposing an excess amount or turning the card red.
 */
export const advisoryCausaMortisCoverage = (coverage = []) =>
  coverage.filter((row) => ["over", "mixed"].includes(coverageStatus(row)));
