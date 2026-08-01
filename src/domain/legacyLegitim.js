import { isValidIsoDate } from "./dateFormat.js";

export const LEGACY_SUCCESSION_CUTOFF = "2005-03-01";

/**
 * Calculates the descendants' old-law collective and personal fractions under
 * former Civil Code article 616, with the estate-base inputs described by
 * article 620(2)-(3). It does not decide article 619 ascendant rights, article
 * 620(4) imputation, or the distinct pre-2005 intestacy rules in former
 * articles 808-830. The comparison helper is advisory: it never adds the
 * minimum to an inheritance or changes ownership.
 */

const EPSILON = 1e-10;

const finiteNonNegative = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const gcd = (left, right) => {
  let a = Math.abs(Math.trunc(left));
  let b = Math.abs(Math.trunc(right));
  while (b) [a, b] = [b, a % b];
  return a || 1;
};

const fraction = (numerator = 0, denominator = 1) => {
  const safeDenominator = Math.max(1, Math.abs(Math.trunc(denominator) || 1));
  const safeNumerator = Math.max(0, Math.trunc(numerator) || 0);
  const divisor = gcd(safeNumerator, safeDenominator);
  const normalized = {
    numerator: safeNumerator / divisor,
    denominator: safeDenominator / divisor,
  };
  return {
    ...normalized,
    decimal: normalized.numerator / normalized.denominator,
    percentage: (normalized.numerator / normalized.denominator) * 100,
  };
};

const multiplyFractions = (left, right) =>
  fraction(left.numerator * right.numerator, left.denominator * right.denominator);

const addFractions = (left, right) =>
  fraction(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );

const divideFraction = (value, divisor) =>
  fraction(value.numerator, value.denominator * Math.max(1, divisor));

function nodeEligibility(node = {}) {
  return String(node.article616Eligibility || "unconfirmed");
}

function nodeParticipation(node = {}) {
  return String(node.participation || "unconfirmed");
}

function resolveBranchRecipients(node, diagnostics, trail = new Set()) {
  const id = String(node?.id || "");
  if (!id) {
    diagnostics.push("A child or descendant record is missing its identifier.");
    return { recipients: [], unresolved: true };
  }
  if (trail.has(id)) {
    diagnostics.push(`A circular descendant branch was found at ${node.name || id}.`);
    return { recipients: [], unresolved: true };
  }

  const eligibility = nodeEligibility(node);
  if (eligibility === "unconfirmed") {
    diagnostics.push(`Confirm whether ${node.name || id} qualifies under old article 616.`);
    return { recipients: [], unresolved: true };
  }
  if (["separate-old-law", "non-qualifying"].includes(eligibility)) {
    diagnostics.push(
      `${node.name || id} requires the separate old-law rules for children outside article 616.`,
    );
    return { recipients: [], unresolved: true };
  }
  if (eligibility === "excluded") return { recipients: [], unresolved: false };
  if (eligibility !== "qualifying") {
    diagnostics.push(`The old-law status recorded for ${node.name || id} is not recognised.`);
    return { recipients: [], unresolved: true };
  }

  const participation = nodeParticipation(node);
  if (participation === "participating") {
    return { recipients: [{ beneficiaryId: id, weight: fraction(1, 1) }], unresolved: false };
  }
  if (participation === "renounced") return { recipients: [], unresolved: false };
  if (participation === "unconfirmed") {
    diagnostics.push(`Confirm how ${node.name || id} participates in the old-law legitim.`);
    return { recipients: [], unresolved: true };
  }
  if (["incapable", "unworthy", "disinherited"].includes(participation)) {
    diagnostics.push(
      `The effect of ${participation} status for ${node.name || id} must be confirmed under old articles 608 and 626; no automatic descendant routing has been applied.`,
    );
    return { recipients: [], unresolved: true };
  }
  if (!["predeceased", "represented"].includes(participation)) {
    diagnostics.push(`The participation recorded for ${node.name || id} is not recognised.`);
    return { recipients: [], unresolved: true };
  }
  if (!Array.isArray(node.children)) {
    diagnostics.push(
      `Confirm the descendants, if any, who replace ${node.name || id} before calculating the legitim.`,
    );
    return { recipients: [], unresolved: true };
  }
  if (!node.children.length) return { recipients: [], unresolved: false };

  const nextTrail = new Set(trail).add(id);
  const childResults = node.children.map((child) =>
    resolveBranchRecipients(child, diagnostics, nextTrail),
  );
  if (childResults.some((result) => result.unresolved)) {
    return { recipients: [], unresolved: true };
  }
  const takingChildren = childResults.filter((result) => result.recipients.length);
  if (!takingChildren.length) return { recipients: [], unresolved: false };

  const recipients = takingChildren.flatMap((result) =>
    result.recipients.map((recipient) => ({
      ...recipient,
      weight: divideFraction(recipient.weight, takingChildren.length),
    })),
  );
  return { recipients, unresolved: false };
}

export function classifyLegacyArticle616Date(deathDate) {
  if (!deathDate || !isValidIsoDate(deathDate)) {
    return { regime: "unresolved", cutoff: LEGACY_SUCCESSION_CUTOFF };
  }
  return {
    regime: deathDate < LEGACY_SUCCESSION_CUTOFF ? "legacy" : "modern",
    cutoff: LEGACY_SUCCESSION_CUTOFF,
  };
}

export function legacyArticle616EstateBase(estate = {}) {
  const grossEstate = finiteNonNegative(estate.grossEstate);
  const debts = finiteNonNegative(estate.debts);
  const funeralExpenses = finiteNonNegative(estate.funeralExpenses);
  const gratuitousDispositions = finiteNonNegative(estate.gratuitousDispositions);
  const amountProvided = String(estate.grossEstate ?? "").trim() !== "";
  const deductionsExceedAssets = debts + funeralExpenses > grossEstate + gratuitousDispositions;

  return {
    grossEstate,
    debts,
    funeralExpenses,
    gratuitousDispositions,
    amountProvided,
    deductionsExceedAssets,
    adjustedEstate: Math.max(0, grossEstate - debts - funeralExpenses + gratuitousDispositions),
  };
}

export function calculateLegacyArticle616Legitim({ childBranches = [], estate = {} } = {}) {
  const diagnostics = [];
  const estateBase = legacyArticle616EstateBase(estate);
  const roots = Array.isArray(childBranches) ? childBranches : [];
  let unresolved = false;
  const qualifyingBranches = [];

  roots.forEach((branch) => {
    const eligibility = nodeEligibility(branch);
    if (eligibility === "unconfirmed") {
      diagnostics.push(
        `Confirm whether ${branch?.name || branch?.id || "this child branch"} qualifies under old article 616.`,
      );
      unresolved = true;
      return;
    }
    if (["separate-old-law", "non-qualifying"].includes(eligibility)) {
      diagnostics.push(
        `${branch?.name || branch?.id || "This child branch"} must be assessed under the separate old-law provisions.`,
      );
      unresolved = true;
      return;
    }
    if (eligibility === "excluded") return;
    if (eligibility !== "qualifying") {
      diagnostics.push(
        `The old-law status recorded for ${branch?.name || branch?.id || "a child branch"} is not recognised.`,
      );
      unresolved = true;
      return;
    }
    const result = resolveBranchRecipients(branch, diagnostics);
    if (result.unresolved) unresolved = true;
    const participation = nodeParticipation(branch);
    const endedWithoutRepresentatives =
      ["predeceased", "represented"].includes(participation) &&
      !result.unresolved &&
      !result.recipients.length;
    if (endedWithoutRepresentatives) return;
    qualifyingBranches.push({ branch, recipients: result.recipients });
  });

  const countedBranchCount = qualifyingBranches.length;
  const takingBranches = qualifyingBranches.filter(({ recipients }) => recipients.length);
  const takingBranchCount = takingBranches.length;
  const collectiveFraction =
    countedBranchCount === 0
      ? fraction(0, 1)
      : countedBranchCount <= 4
        ? fraction(1, 3)
        : fraction(1, 2);
  const normalPerCountedBranchFraction = countedBranchCount
    ? divideFraction(collectiveFraction, countedBranchCount)
    : fraction(0, 1);
  const perTakingBranchFraction = takingBranchCount
    ? divideFraction(collectiveFraction, takingBranchCount)
    : fraction(0, 1);

  if (countedBranchCount > 0 && !takingBranchCount && !unresolved) {
    diagnostics.push(
      "No qualifying child or represented descendant is recorded as taking the legitim.",
    );
    unresolved = true;
  }

  const branchFloors = qualifyingBranches.map(({ branch, recipients }) => {
    const floor = recipients.length ? perTakingBranchFraction : fraction(0, 1);
    return {
      branchId: branch.id,
      name: branch.name || branch.id,
      fraction: floor,
      amount: estateBase.amountProvided ? floor.decimal * estateBase.adjustedEstate : null,
      recipientIds: recipients.map((recipient) => recipient.beneficiaryId),
      taking: recipients.length > 0,
    };
  });

  const beneficiaryFloorsById = new Map();
  takingBranches.forEach(({ recipients }) => {
    recipients.forEach((recipient) => {
      const floor = multiplyFractions(perTakingBranchFraction, recipient.weight);
      const current = beneficiaryFloorsById.get(recipient.beneficiaryId) || fraction(0, 1);
      beneficiaryFloorsById.set(recipient.beneficiaryId, addFractions(current, floor));
    });
  });
  const beneficiaryFloors = [...beneficiaryFloorsById.entries()].map(
    ([beneficiaryId, beneficiaryFraction]) => ({
      beneficiaryId,
      fraction: beneficiaryFraction,
      amount: estateBase.amountProvided
        ? beneficiaryFraction.decimal * estateBase.adjustedEstate
        : null,
    }),
  );

  return {
    status: unresolved ? "unresolved" : "calculated",
    countedBranchCount,
    takingBranchCount,
    collectiveFraction,
    normalPerCountedBranchFraction,
    perTakingBranchFraction,
    branchFloors,
    beneficiaryFloors,
    estateBase,
    diagnostics,
    warnings: diagnostics,
    unresolved,
  };
}

function actualAllocationShare(record = {}) {
  if (record.fraction && Number(record.fraction.denominator) > 0) {
    return (
      finiteNonNegative(record.fraction.numerator) / finiteNonNegative(record.fraction.denominator)
    );
  }
  if (record.sharePercent !== undefined) return finiteNonNegative(record.sharePercent) / 100;
  return finiteNonNegative(record.share);
}

export function compareLegacyArticle616LegitimFloors(calculation, actualAllocations = []) {
  if (!calculation || calculation.unresolved) {
    return {
      status: "unresolved",
      rows: [],
      totalShortfall: 0,
      warnings: calculation?.diagnostics || ["The old-law legitim has not been calculated."],
    };
  }
  const actualById = new Map();
  (Array.isArray(actualAllocations) ? actualAllocations : []).forEach((record) => {
    const beneficiaryId = String(record?.beneficiaryId || record?.personId || "");
    if (!beneficiaryId) return;
    actualById.set(
      beneficiaryId,
      (actualById.get(beneficiaryId) || 0) + actualAllocationShare(record),
    );
  });

  const rows = calculation.beneficiaryFloors.map((floor) => {
    const requiredShare = floor.fraction.decimal;
    const actualShare = actualById.get(floor.beneficiaryId) || 0;
    const shortfall = Math.max(0, requiredShare - actualShare);
    return {
      beneficiaryId: floor.beneficiaryId,
      requiredShare,
      actualShare,
      shortfall,
      absorbed: actualShare > requiredShare + EPSILON,
      status: shortfall > EPSILON ? "shortfall" : "satisfied",
    };
  });
  const totalShortfall = rows.reduce((sum, row) => sum + row.shortfall, 0);
  return {
    status: totalShortfall > EPSILON ? "shortfall" : "compliant",
    rows,
    totalShortfall,
    warnings: [],
  };
}
