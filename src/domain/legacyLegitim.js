import { isValidIsoDate } from "./dateFormat.js";

export const LEGACY_SUCCESSION_CUTOFF = "2005-03-01";

/**
 * Calculates the descendants' old-law collective and personal fractions under
 * former Civil Code article 616, with the estate-base inputs described by
 * article 620(2)-(3). Article 619 ascendant rights are handled separately
 * below. This module does not yet decide article 620(4) imputation or the
 * distinct pre-2005 intestacy rules in former articles 808-830. For a complete
 * will, applyLegacyProtectedPortionsToWill protects the supported personal
 * minimums and leaves the disposable portion to the named heirs.
 */

const EPSILON = 1e-10;
const REPRESENTED_PARTICIPATION = new Set(["predeceased", "represented"]);

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

function personName(person = {}) {
  return (
    String(person.fullName || "").trim() ||
    [person.givenNames, person.surname].filter(Boolean).join(" ").trim() ||
    "Unnamed child"
  );
}

function personIsDeceased(person = {}) {
  return (
    person.isDeceased === true ||
    Boolean(person.dateOfDeath) ||
    (person.designations || []).some(
      (designation) => String(designation).toLowerCase() === "deceased",
    )
  );
}

function storedStatusMap(deceased = {}) {
  return new Map(
    (Array.isArray(deceased.legacyArticle616Statuses) ? deceased.legacyArticle616Statuses : [])
      .filter((row) => row?.personId)
      .map((row) => [row.personId, row]),
  );
}

function childrenOf(people, parentId) {
  return people.filter((person) => person.fatherId === parentId || person.motherId === parentId);
}

function inferredParticipation(person, deceased) {
  if (!personIsDeceased(person)) return "participating";
  if (!isValidIsoDate(person.dateOfDeath) || !isValidIsoDate(deceased.dateOfDeath)) {
    return "unconfirmed";
  }
  return person.dateOfDeath <= deceased.dateOfDeath ? "predeceased" : "participating";
}

function buildChildBranch(person, deceased, people, statuses, trail = new Set()) {
  if (!person || trail.has(person.id)) return null;
  const stored = statuses.get(person.id) || {};
  const participation =
    stored.participation && stored.participation !== "unconfirmed"
      ? stored.participation
      : inferredParticipation(person, deceased);
  const nextTrail = new Set(trail).add(person.id);
  const children = REPRESENTED_PARTICIPATION.has(participation)
    ? childrenOf(people, person.id)
        .map((child) => buildChildBranch(child, deceased, people, statuses, nextTrail))
        .filter(Boolean)
    : undefined;
  return {
    id: person.id,
    name: personName(person),
    article616Eligibility:
      stored.article616Eligibility && stored.article616Eligibility !== "unconfirmed"
        ? stored.article616Eligibility
        : "qualifying",
    participation,
    ...(children === undefined ? {} : { children }),
  };
}

export function buildLegacyArticle616ChildBranches(people = [], deceased = {}) {
  const statuses = storedStatusMap(deceased);
  return childrenOf(people, deceased.id)
    .map((child) => buildChildBranch(child, deceased, people, statuses))
    .filter(Boolean);
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

function allocationMap(records = []) {
  const shares = new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    const beneficiaryId = String(record?.beneficiaryId || record?.personId || "");
    if (!beneficiaryId) return;
    shares.set(beneficiaryId, (shares.get(beneficiaryId) || 0) + actualAllocationShare(record));
  });
  return shares;
}

function applyLegitimFloors({
  testamentaryShares,
  calculation,
  incompleteMessage,
  appliedMessage,
}) {
  if (calculation.unresolved) {
    return {
      applies: true,
      adjusted: false,
      resolved: false,
      shares: testamentaryShares,
      calculation,
      warnings: calculation.diagnostics,
    };
  }

  const testamentaryTotal = [...testamentaryShares.values()].reduce(
    (total, share) => total + share,
    0,
  );
  if (Math.abs(testamentaryTotal - 1) > EPSILON) {
    return {
      applies: true,
      adjusted: false,
      resolved: false,
      shares: testamentaryShares,
      calculation,
      warnings: [incompleteMessage],
    };
  }

  const floors = new Map(
    calculation.beneficiaryFloors.map((floor) => [floor.beneficiaryId, floor.fraction.decimal]),
  );
  const shortfalls = new Map();
  floors.forEach((minimum, beneficiaryId) => {
    const shortfall = Math.max(0, minimum - (testamentaryShares.get(beneficiaryId) || 0));
    if (shortfall > EPSILON) shortfalls.set(beneficiaryId, shortfall);
  });
  const totalShortfall = [...shortfalls.values()].reduce((total, share) => total + share, 0);
  if (totalShortfall <= EPSILON) {
    return {
      applies: true,
      adjusted: false,
      resolved: true,
      shares: testamentaryShares,
      calculation,
      warnings: [],
    };
  }

  const surplusByBeneficiary = new Map();
  testamentaryShares.forEach((share, beneficiaryId) => {
    const surplus = Math.max(0, share - (floors.get(beneficiaryId) || 0));
    if (surplus > EPSILON) surplusByBeneficiary.set(beneficiaryId, surplus);
  });
  const totalSurplus = [...surplusByBeneficiary.values()].reduce(
    (total, share) => total + share,
    0,
  );
  if (totalSurplus + EPSILON < totalShortfall) {
    return {
      applies: true,
      adjusted: false,
      resolved: false,
      shares: testamentaryShares,
      calculation,
      warnings: [
        "The recorded will does not contain enough disposable surplus to satisfy the legitim.",
      ],
    };
  }

  const effectiveShares = new Map(testamentaryShares);
  surplusByBeneficiary.forEach((surplus, beneficiaryId) => {
    const reduction = totalShortfall * (surplus / totalSurplus);
    effectiveShares.set(beneficiaryId, Math.max(0, effectiveShares.get(beneficiaryId) - reduction));
  });
  shortfalls.forEach((shortfall, beneficiaryId) => {
    effectiveShares.set(beneficiaryId, (effectiveShares.get(beneficiaryId) || 0) + shortfall);
  });
  [...effectiveShares.entries()].forEach(([beneficiaryId, share]) => {
    if (share <= EPSILON) effectiveShares.delete(beneficiaryId);
  });

  return {
    applies: true,
    adjusted: true,
    resolved: true,
    shares: effectiveShares,
    calculation,
    warnings: [appliedMessage],
  };
}

/**
 * Applies the former article 616 personal minimums to a complete testamentary
 * allocation. Existing gifts to a protected descendant absorb the minimum;
 * only a shortfall is topped up. The top-up is taken proportionally from the
 * disposable surplus left to the named beneficiaries.
 */
export function applyLegacyArticle616ToWill({ people = [], deceased = {}, willHeirs } = {}) {
  const testamentaryShares = allocationMap(willHeirs ?? deceased.willHeirs);
  const regime = classifyLegacyArticle616Date(deceased.dateOfDeath).regime;
  const childBranches = buildLegacyArticle616ChildBranches(people, deceased);
  const applies = regime === "legacy" && childBranches.length > 0;
  if (!applies) {
    return {
      applies: false,
      adjusted: false,
      resolved: true,
      shares: testamentaryShares,
      calculation: null,
      warnings: [],
    };
  }

  const calculation = calculateLegacyArticle616Legitim({
    childBranches,
    estate: deceased.legacyArticle616Estate || {},
  });
  return applyLegitimFloors({
    testamentaryShares,
    calculation,
    incompleteMessage:
      "Complete the will beneficiary allocation to 100% before applying the old-law child legitim.",
    appliedMessage:
      "Old-law child legitim was applied automatically; the named will beneficiaries receive the disposable portion.",
  });
}

function nearestLegacyAscendants(people, deceased) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  let generation = [
    { id: deceased.fatherId, line: "paternal" },
    { id: deceased.motherId, line: "maternal" },
  ].filter(({ id }) => id);
  const visited = new Set([deceased.id]);
  let degree = 1;

  while (generation.length) {
    const candidates = generation
      .filter(({ id }) => !visited.has(id))
      .map((entry) => ({ ...entry, person: peopleById.get(entry.id) }))
      .filter(({ person }) => person);
    candidates.forEach(({ id }) => visited.add(id));

    const missing = candidates.filter(
      ({ person }) => personIsDeceased(person) && !isValidIsoDate(person.dateOfDeath),
    );
    if (missing.length) return { degree, living: [], missing: missing.map(({ person }) => person) };

    const living = candidates.filter(({ person }) => {
      if (!personIsDeceased(person)) return true;
      return person.dateOfDeath > deceased.dateOfDeath;
    });
    if (living.length) return { degree, living, missing: [] };

    generation = candidates.flatMap(({ person, line }) =>
      [person.fatherId, person.motherId].filter(Boolean).map((id) => ({ id, line })),
    );
    degree += 1;
  }

  return { degree: 0, living: [], missing: [] };
}

export function calculateLegacyArticle619Legitim({ people = [], deceased = {} } = {}) {
  const diagnostics = [];
  const nearest = nearestLegacyAscendants(people, deceased);
  if (nearest.missing.length) {
    diagnostics.push(
      `Enter the date of death for ${nearest.missing.map(personName).join(", ")} before calculating the old-law ascendant legitim.`,
    );
  }

  const beneficiaryFractions = new Map();
  if (!diagnostics.length && nearest.living.length) {
    const byLine = new Map();
    nearest.living.forEach((entry) => {
      if (!byLine.has(entry.line)) byLine.set(entry.line, []);
      byLine.get(entry.line).push(entry.person);
    });
    const lineShare = fraction(1, 3 * byLine.size);
    byLine.forEach((ascendants) => {
      const personalShare = divideFraction(lineShare, ascendants.length);
      ascendants.forEach((ascendant) => beneficiaryFractions.set(ascendant.id, personalShare));
    });
  }

  return {
    article: "619",
    status: diagnostics.length ? "unresolved" : "calculated",
    collectiveFraction: nearest.living.length ? fraction(1, 3) : fraction(0, 1),
    beneficiaryFloors: [...beneficiaryFractions.entries()].map(
      ([beneficiaryId, beneficiaryFraction]) => ({
        beneficiaryId,
        fraction: beneficiaryFraction,
        amount: null,
      }),
    ),
    nearestDegree: nearest.degree,
    diagnostics,
    warnings: diagnostics,
    unresolved: diagnostics.length > 0,
  };
}

export function applyLegacyProtectedPortionsToWill({
  people = [],
  deceased = {},
  willHeirs,
  hasSurvivingSpouse,
  spouseSurvivalUnresolved = false,
} = {}) {
  const childResult = applyLegacyArticle616ToWill({ people, deceased, willHeirs });
  if (
    childResult.applies &&
    (childResult.calculation?.countedBranchCount > 0 || childResult.calculation?.unresolved)
  ) {
    return childResult;
  }

  const testamentaryShares = allocationMap(willHeirs ?? deceased.willHeirs);
  const regime = classifyLegacyArticle616Date(deceased.dateOfDeath).regime;
  if (regime === "legacy" && spouseSurvivalUnresolved) {
    return {
      applies: true,
      adjusted: false,
      resolved: false,
      shares: testamentaryShares,
      calculation: null,
      warnings: [
        "Enter the linked spouse's date of death before deciding whether old article 619 ascendant legitim applies.",
      ],
    };
  }
  const spouseRecorded =
    hasSurvivingSpouse === undefined
      ? (Array.isArray(deceased.spouseIds) && deceased.spouseIds.length > 0) ||
        (Array.isArray(deceased.partnerRelationships) && deceased.partnerRelationships.length > 0)
      : hasSurvivingSpouse;
  if (regime !== "legacy" || spouseRecorded) {
    return {
      applies: false,
      adjusted: false,
      resolved: true,
      shares: testamentaryShares,
      calculation: null,
      warnings: [],
    };
  }

  const calculation = calculateLegacyArticle619Legitim({ people, deceased });
  if (!calculation.beneficiaryFloors.length && !calculation.unresolved) {
    return {
      applies: false,
      adjusted: false,
      resolved: true,
      shares: testamentaryShares,
      calculation,
      warnings: [],
    };
  }
  return applyLegitimFloors({
    testamentaryShares,
    calculation,
    incompleteMessage:
      "Complete the will beneficiary allocation to 100% before applying the old-law ascendant legitim.",
    appliedMessage:
      "Old-law ascendant legitim was applied automatically; the named will beneficiaries receive the disposable portion.",
  });
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
