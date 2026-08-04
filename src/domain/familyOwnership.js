import { approximateFraction, buildStarterOwnership } from "./ownership.js";
import {
  addFractions,
  compareFractions,
  fractionToNumber,
  multiplyFractions,
  normaliseFraction,
  subtractFractions,
  WHOLE_FRACTION,
  ZERO_FRACTION,
} from "./fractions.js";
import {
  findPartnerRelationship,
  legalSpouseIdsForPerson,
  partnerIdsForPerson,
  partnerRelationshipStatusAt,
} from "./partnerRelationships.js";
import { applyLegacyProtectedPortionsToWill } from "./legacyLegitim.js";
import {
  article815ReviewWarning,
  LEGACY_INTESTACY_SOURCE_GAPS,
  legacySourceGapWarning,
  successionRuleset,
} from "./successionRules.js";

const number = (input) => Math.max(0, Number(input) || 0);
export const INTESTACY_SHARE_EPSILON = 1e-8;
const SURVIVAL_UNRESOLVED_DESTINATIONS = new Set([
  "spouse-survival-unresolved",
  "spouse-status-unresolved",
  "death-date-unresolved",
  "survival-date-unresolved",
]);
const LAW_UNRESOLVED_DESTINATIONS = new Set([
  "legacy-spouse-law-unresolved",
  "legacy-relative-law-unresolved",
]);

export function isPersonDeceased(person = {}) {
  return (
    Boolean(person.isDeceased) ||
    (person.designations || []).some(
      (designation) => String(designation).toLowerCase() === "deceased",
    )
  );
}

function wasAliveAt(person, date) {
  if (person.survivalStatusRequired === true) return false;
  if (date && person.dateOfBirth && person.dateOfBirth > date) return false;
  if (!isPersonDeceased(person)) return true;
  if (!date || !person.dateOfDeath) return false;
  return person.dateOfDeath > date;
}

function personName(person = {}) {
  return String(person.fullName || "").trim() || "Unnamed person";
}

function addShare(shares, personId, amount) {
  shares.set(personId, (shares.get(personId) || 0) + amount);
}

function exactShareFromRecord(record = {}) {
  const stored = normaliseFraction(record.shareNumerator, record.shareDenominator);
  if (!stored.error) return stored;
  return approximateFraction(number(record.sharePercent) / 100);
}

function exactShareMap(shares = new Map()) {
  return new Map(
    [...shares.entries()].map(([personId, share]) => [
      personId,
      approximateFraction(number(share)),
    ]),
  );
}

function exactShareMapFromRecords(records = []) {
  const shares = new Map();
  records.forEach((record) => {
    if (!record?.personId) return;
    addExactShare(shares, record.personId, exactShareFromRecord(record));
  });
  return shares;
}

function numericShareMap(shares = new Map()) {
  return new Map(
    [...shares.entries()].map(([personId, share]) => [personId, fractionToNumber(share)]),
  );
}

function addExactShare(shares, personId, amount) {
  const current = shares.get(personId) || ZERO_FRACTION;
  const total = addFractions(current, amount);
  if (!total.error) shares.set(personId, total);
  return total;
}

function sumExactShares(shares = new Map()) {
  let total = ZERO_FRACTION;
  for (const share of shares.values()) {
    total = addFractions(total, share);
    if (total.error) return total;
  }
  return total;
}

function familyIndex(people) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const childrenByParent = new Map();
  people.forEach((person) => {
    [person.fatherId, person.motherId].filter(Boolean).forEach((parentId) => {
      if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
      childrenByParent.get(parentId).push(person);
    });
  });
  return { peopleById, childrenByParent };
}

function branchIsViable(person, atDate, index, trail = new Set()) {
  if (!person || trail.has(person.id)) return false;
  if (wasAliveAt(person, atDate)) return true;
  const nextTrail = new Set(trail).add(person.id);
  return (index.childrenByParent.get(person.id) || []).some((child) =>
    branchIsViable(child, atDate, index, nextTrail),
  );
}

function allocateBranch(person, atDate, amount, shares, index, trail = new Set()) {
  if (!person || trail.has(person.id) || amount <= 0) return;
  if (wasAliveAt(person, atDate)) {
    addShare(shares, person.id, amount);
    return;
  }
  const nextTrail = new Set(trail).add(person.id);
  const viableChildren = (index.childrenByParent.get(person.id) || []).filter((child) =>
    branchIsViable(child, atDate, index, nextTrail),
  );
  if (!viableChildren.length) return;
  const perBranch = amount / viableChildren.length;
  viableChildren.forEach((child) =>
    allocateBranch(child, atDate, perBranch, shares, index, nextTrail),
  );
}

function allocateBranches(roots, atDate, amount, index) {
  const shares = new Map();
  const viableRoots = roots.filter((person) => branchIsViable(person, atDate, index));
  if (!viableRoots.length) return shares;
  const perBranch = amount / viableRoots.length;
  viableRoots.forEach((person) => allocateBranch(person, atDate, perBranch, shares, index));
  return shares;
}

function collectBranchHeirs(person, atDate, index, depth = 1, trail = new Set()) {
  if (!person || trail.has(person.id)) return [];
  if (wasAliveAt(person, atDate)) return [{ person, depth }];
  const nextTrail = new Set(trail).add(person.id);
  return (index.childrenByParent.get(person.id) || []).flatMap((child) =>
    collectBranchHeirs(child, atDate, index, depth + 1, nextTrail),
  );
}

function allocateSiblingBranches(siblings, atDate, amount, index) {
  const heirs = siblings.flatMap((sibling) => collectBranchHeirs(sibling, atDate, index));
  const allSiblingsPredeceased = siblings.every((sibling) => !wasAliveAt(sibling, atDate));
  const equalDegree = heirs.length > 0 && heirs.every(({ depth }) => depth === heirs[0].depth);
  if (allSiblingsPredeceased && equalDegree) {
    const shares = new Map();
    heirs.forEach(({ person }) => addShare(shares, person.id, amount / heirs.length));
    return shares;
  }
  return allocateBranches(siblings, atDate, amount, index);
}

function linkedSpouses(person, people, peopleById) {
  const spouseIds = new Set(person.spouseIds || []);
  people.forEach((candidate) => {
    if ((candidate.spouseIds || []).includes(person.id)) spouseIds.add(candidate.id);
  });
  spouseIds.delete(person.id);
  return [...spouseIds].map((id) => peopleById.get(id)).filter(Boolean);
}

export function linkedSpousesFor(people = [], personId) {
  const index = familyIndex(people);
  const person = index.peopleById.get(personId);
  return person ? linkedSpouses(person, people, index.peopleById) : [];
}

export function linkedLegalSpousesFor(people = [], personId, atDate = "") {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  if (peopleById.get(personId)?.unmarriedOrWidowedAtDeath === true) return [];
  return legalSpouseIdsForPerson(people, personId, atDate)
    .map((spouseId) => peopleById.get(spouseId))
    .filter(Boolean);
}

export function linkedSpousesMissingDeathDates(people = [], deceasedId, atDate = "") {
  return linkedLegalSpousesFor(people, deceasedId, atDate).filter(
    (person) => isPersonDeceased(person) && !person.dateOfDeath,
  );
}

export function linkedMarriagesMissingEndDates(people = [], personId, atDate = "") {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  if (peopleById.get(personId)?.unmarriedOrWidowedAtDeath === true) return [];
  return partnerIdsForPerson(people, personId)
    .map((partnerId) => ({
      partner: peopleById.get(partnerId),
      relationship: findPartnerRelationship(people, personId, partnerId),
    }))
    .filter(
      ({ relationship }) =>
        partnerRelationshipStatusAt(relationship, atDate) === "end-date-missing",
    )
    .map(({ partner }) => partner)
    .filter(Boolean);
}

function branchesMissingSurvivalDates(roots, atDate, index) {
  const missing = [];
  const visited = new Set();
  const inspect = (person) => {
    if (!person || visited.has(person.id)) return;
    visited.add(person.id);
    if (!isPersonDeceased(person)) return;
    if (!person.dateOfDeath) {
      missing.push(person);
      return;
    }
    if (person.dateOfDeath > atDate) return;
    (index.childrenByParent.get(person.id) || []).forEach(inspect);
  };
  roots.forEach(inspect);
  return missing;
}

export function descendantsMissingDeathDates(people = [], deceasedId) {
  const index = familyIndex(people);
  const deceased = index.peopleById.get(deceasedId);
  if (!deceased?.dateOfDeath) return [];
  return branchesMissingSurvivalDates(
    index.childrenByParent.get(deceasedId) || [],
    deceased.dateOfDeath,
    index,
  );
}

function linkedSiblings(person, people, peopleById) {
  const siblingIds = new Set(person.siblingIds || []);
  people.forEach((candidate) => {
    if (candidate.id === person.id) return;
    const sharesFather = person.fatherId && candidate.fatherId === person.fatherId;
    const sharesMother = person.motherId && candidate.motherId === person.motherId;
    if (sharesFather || sharesMother || (candidate.siblingIds || []).includes(person.id)) {
      siblingIds.add(candidate.id);
    }
  });
  return [...siblingIds].map((id) => peopleById.get(id)).filter(Boolean);
}

function nearestAscendantStatus(person, atDate, peopleById) {
  let current = [person.fatherId, person.motherId].map((id) => peopleById.get(id)).filter(Boolean);
  const visited = new Set([person.id]);
  while (current.length) {
    const unique = current.filter((candidate) => {
      if (visited.has(candidate.id)) return false;
      visited.add(candidate.id);
      return true;
    });
    const provisional = unique.filter(
      (candidate) =>
        candidate.isPotentialIntestateParent === true && candidate.survivalStatusRequired === true,
    );
    const missing = unique.filter(
      (candidate) =>
        !provisional.includes(candidate) &&
        (candidate.survivalStatusRequired === true ||
          (isPersonDeceased(candidate) && !candidate.dateOfDeath)),
    );
    if (missing.length) return { living: [], missing };
    const living = unique.filter(
      (candidate) => provisional.includes(candidate) || wasAliveAt(candidate, atDate),
    );
    if (living.length) return { living, missing: [], provisional };
    current = unique.flatMap((candidate) =>
      [candidate.fatherId, candidate.motherId].map((id) => peopleById.get(id)).filter(Boolean),
    );
  }
  return { living: [], missing: [], provisional: [] };
}

/**
 * Identifies unrecorded parents whose survival is legally material to a
 * post-reform intestacy. A created parent record must remain unresolved until
 * the user establishes whether that parent survived the deceased.
 */
export function missingPotentialIntestateParents(people = [], deceasedId) {
  const index = familyIndex(people);
  const deceased = index.peopleById.get(deceasedId);
  const ruleset = successionRuleset(deceased?.dateOfDeath);
  if (
    !deceased ||
    !isPersonDeceased(deceased) ||
    deceased.inheritanceBasis === "will" ||
    !["post2005-article815", "current"].includes(ruleset.key)
  ) {
    return [];
  }

  const atDate = deceased.dateOfDeath;
  const children = index.childrenByParent.get(deceased.id) || [];
  if (descendantsMissingDeathDates(people, deceased.id).length) return [];
  if (allocateBranches(children, atDate, 1, index).size) return [];

  if (linkedMarriagesMissingEndDates(people, deceased.id, atDate).length) return [];
  const spouses = linkedLegalSpousesFor(people, deceased.id, atDate);
  if (spouses.some((spouse) => spouse.survivalStatusRequired === true)) return [];
  if (linkedSpousesMissingDeathDates(people, deceased.id, atDate).length) return [];
  if (spouses.some((spouse) => wasAliveAt(spouse, atDate))) return [];

  return [!deceased.fatherId ? "father" : "", !deceased.motherId ? "mother" : ""].filter(Boolean);
}

function collateralDegree(deceasedId, candidateId, index, maxDegree = 12) {
  const queue = [{ id: deceasedId, degree: 0 }];
  const visited = new Set([deceasedId]);
  while (queue.length) {
    const current = queue.shift();
    if (current.degree >= maxDegree) continue;
    const person = index.peopleById.get(current.id);
    if (!person) continue;
    const relativeIds = new Set([
      person.fatherId,
      person.motherId,
      ...(index.childrenByParent.get(person.id) || []).map((child) => child.id),
    ]);
    for (const relativeId of relativeIds) {
      if (!relativeId || visited.has(relativeId)) continue;
      const degree = current.degree + 1;
      if (relativeId === candidateId) return degree;
      visited.add(relativeId);
      queue.push({ id: relativeId, degree });
    }
  }
  return Infinity;
}

function calculateIntestateAllocations(people = [], deceasedId) {
  const index = familyIndex(people);
  const deceased = index.peopleById.get(deceasedId);
  const shares = new Map();
  const warnings = [];
  if (!deceased)
    return { shares, warnings: ["Deceased person not found."], destination: "unresolved" };
  if (!deceased.dateOfDeath) {
    warnings.push(
      `Enter the date of death for ${deceased.fullName || "the deceased"} before calculating the intestate succession.`,
    );
    return { shares, warnings, destination: "death-date-unresolved" };
  }
  const ruleset = successionRuleset(deceased.dateOfDeath);
  if (ruleset.key === "invalid-date") {
    warnings.push(
      `Enter a valid date of death for ${deceased.fullName || "the deceased"} before calculating the intestate succession.`,
    );
    return { shares, warnings, destination: "death-date-unresolved" };
  }

  const atDate = deceased.dateOfDeath;
  const marriagesNotStarted = deceased.unmarriedOrWidowedAtDeath
    ? []
    : partnerIdsForPerson(people, deceased.id)
        .map((partnerId) => ({
          partner: index.peopleById.get(partnerId),
          relationship: findPartnerRelationship(people, deceased.id, partnerId),
        }))
        .filter(
          ({ relationship }) => partnerRelationshipStatusAt(relationship, atDate) === "not-started",
        )
        .map(({ partner }) => partner)
        .filter(Boolean);
  if (marriagesNotStarted.length) {
    warnings.push(
      `The recorded marriage to ${marriagesNotStarted
        .map(personName)
        .join(", ")} starts after the date of death and was excluded.`,
    );
  }
  const marriagesMissingEndDates = linkedMarriagesMissingEndDates(people, deceased.id, atDate);
  if (marriagesMissingEndDates.length) {
    warnings.push(
      `Enter the date on which the marriage to ${marriagesMissingEndDates
        .map(personName)
        .join(", ")} ended before calculating the intestate succession.`,
    );
    return { shares, warnings, destination: "spouse-status-unresolved" };
  }

  const spouses = linkedLegalSpousesFor(people, deceased.id, atDate);
  const spousesWithUnknownSurvival = linkedSpousesMissingDeathDates(people, deceased.id, atDate);
  if (spousesWithUnknownSurvival.length) {
    const names = spousesWithUnknownSurvival.map((person) => person.fullName || "Unnamed partner");
    warnings.push(
      `Enter the date of death for ${names.join(
        ", ",
      )} before deciding whether the linked spouse survived the deceased.`,
    );
    return { shares, warnings, destination: "spouse-survival-unresolved" };
  }
  const livingSpouses = spouses.filter((person) => wasAliveAt(person, atDate));
  if (livingSpouses.length > 1) {
    warnings.push(
      `More than one marriage appears active on ${atDate}. Record the end date of every former marriage before calculating the intestate succession.`,
    );
    return { shares, warnings, destination: "spouse-status-unresolved" };
  }
  const children = index.childrenByParent.get(deceased.id) || [];
  const descendantsWithUnknownSurvival = descendantsMissingDeathDates(people, deceased.id);
  if (descendantsWithUnknownSurvival.length) {
    warnings.push(
      `Enter the date of death for ${descendantsWithUnknownSurvival
        .map(personName)
        .join(", ")} before deciding which descendant branches survived the deceased.`,
    );
    return { shares, warnings, destination: "survival-date-unresolved" };
  }
  const descendantProbe = allocateBranches(children, atDate, 1, index);
  if (descendantProbe.size) {
    const isLegacy = ruleset.key === "pre2005";
    const spouseTotal = !isLegacy && livingSpouses.length ? 0.5 : 0;
    const descendantShares = allocateBranches(children, atDate, 1 - spouseTotal, index);
    descendantShares.forEach((share, id) => addShare(shares, id, share));
    if (spouseTotal > 0) {
      livingSpouses.forEach((spouse) =>
        addShare(shares, spouse.id, spouseTotal / livingSpouses.length),
      );
    }
    if (ruleset.article815ReviewRequired) warnings.push(article815ReviewWarning());
    return {
      shares,
      warnings,
      destination: isLegacy
        ? "legacy-descendants"
        : livingSpouses.length
          ? "spouse-and-descendants"
          : "descendants",
    };
  }

  if (ruleset.key === "pre2005") {
    if (livingSpouses.length) {
      warnings.push(
        legacySourceGapWarning(
          LEGACY_INTESTACY_SOURCE_GAPS.survivingSpouse,
          "a childless surviving spouse and the deceased's relatives",
        ),
      );
      return { shares, warnings, destination: "legacy-spouse-law-unresolved" };
    }
    warnings.push(
      legacySourceGapWarning(
        [
          ...LEGACY_INTESTACY_SOURCE_GAPS.ascendants,
          ...LEGACY_INTESTACY_SOURCE_GAPS.collaterals,
          ...LEGACY_INTESTACY_SOURCE_GAPS.childrenOutsideMarriage,
          ...LEGACY_INTESTACY_SOURCE_GAPS.government,
        ],
        "a pre-2005 estate without a surviving spouse or descendant",
      ),
    );
    return { shares, warnings, destination: "legacy-relative-law-unresolved" };
  }

  if (livingSpouses.length) {
    livingSpouses.forEach((spouse) => addShare(shares, spouse.id, 1 / livingSpouses.length));
    return { shares, warnings, destination: "spouse" };
  }

  const ascendantStatus = nearestAscendantStatus(deceased, atDate, index.peopleById);
  if (ascendantStatus.missing.length) {
    warnings.push(
      `Enter the date of death for ${ascendantStatus.missing
        .map(personName)
        .join(", ")} before deciding which ascendants survived the deceased.`,
    );
    return { shares, warnings, destination: "survival-date-unresolved" };
  }
  const ascendants = ascendantStatus.living;
  if (ascendantStatus.provisional?.length) {
    const provisionalNames = ascendantStatus.provisional.map(personName).join(", ");
    const singular = ascendantStatus.provisional.length === 1;
    warnings.push(
      `${provisionalNames} ${singular ? "has" : "have"} been provisionally treated as surviving and allocated an ownership share. Confirm whether ${singular ? "that parent was" : "those parents were"} alive when the succession opened.`,
    );
  }
  const siblings = linkedSiblings(deceased, people, index.peopleById);
  const siblingBranchesWithUnknownSurvival = branchesMissingSurvivalDates(siblings, atDate, index);
  if (siblingBranchesWithUnknownSurvival.length) {
    warnings.push(
      `Enter the date of death for ${siblingBranchesWithUnknownSurvival
        .map(personName)
        .join(", ")} before deciding which sibling branches survived the deceased.`,
    );
    return { shares, warnings, destination: "survival-date-unresolved" };
  }
  const siblingProbe = allocateSiblingBranches(siblings, atDate, 1, index);
  if (ascendants.length || siblingProbe.size) {
    const ascendantTotal = ascendants.length ? (siblingProbe.size ? 0.5 : 1) : 0;
    ascendants.forEach((ascendant) =>
      addShare(shares, ascendant.id, ascendantTotal / ascendants.length),
    );
    const siblingShares = allocateSiblingBranches(
      siblings,
      atDate,
      ascendants.length ? 0.5 : 1,
      index,
    );
    siblingShares.forEach((share, id) => addShare(shares, id, share));
    return {
      shares,
      warnings,
      destination:
        ascendants.length && siblingProbe.size
          ? "ascendants-and-sibling-branches"
          : ascendants.length
            ? "ascendants"
            : "sibling-branches",
    };
  }

  const collateralCandidates = people
    .filter(
      (candidate) =>
        candidate.id !== deceased.id && !livingSpouses.some((spouse) => spouse.id === candidate.id),
    )
    .map((candidate) => ({
      person: candidate,
      degree: collateralDegree(deceased.id, candidate.id, index),
    }))
    .filter(({ degree }) => degree >= 3 && degree <= 12);
  const otherCollaterals = collateralCandidates.filter(({ person }) => wasAliveAt(person, atDate));
  const nearestDegree = Math.min(...otherCollaterals.map(({ degree }) => degree));
  const collateralsWithUnknownSurvival = collateralCandidates.filter(
    ({ person, degree }) =>
      isPersonDeceased(person) &&
      !person.dateOfDeath &&
      (!Number.isFinite(nearestDegree) || degree <= nearestDegree),
  );
  if (collateralsWithUnknownSurvival.length) {
    warnings.push(
      `Enter the date of death for ${collateralsWithUnknownSurvival
        .map(({ person }) => personName(person))
        .join(", ")} before deciding which collateral relatives survived the deceased.`,
    );
    return { shares, warnings, destination: "survival-date-unresolved" };
  }
  const nearestCollaterals = otherCollaterals.filter(({ degree }) => degree === nearestDegree);
  if (nearestCollaterals.length) {
    nearestCollaterals.forEach(({ person }) =>
      addShare(shares, person.id, 1 / nearestCollaterals.length),
    );
    return { shares, warnings, destination: "other-collaterals" };
  }

  warnings.push(
    "No relative was found within twelve degrees; the succession may devolve on the Government of Malta.",
  );
  return { shares, warnings, destination: "government" };
}

export function intestateAllocations(people = [], deceasedId) {
  const result = calculateIntestateAllocations(people, deceasedId);
  return {
    ...result,
    exactShares: result.exactShares || exactShareMap(result.shares),
  };
}

export const INTESTACY_CONFIRMATION_SIGNATURE_VERSION = "v2";

function calculatedIntestacySharesSignature(allocation = {}) {
  const shares = allocation.exactShares || exactShareMap(allocation.shares || new Map());
  return [...shares.entries()]
    .map(([personId, share]) => `${personId}:${share.numerator}/${share.denominator}`)
    .sort()
    .join("|");
}

export function legacyIntestacyAllocationSignature(deceased = {}, allocation = {}) {
  return [
    deceased.dateOfDeath || "",
    allocation.destination || "",
    calculatedIntestacySharesSignature(allocation),
  ].join("::");
}

export function intestacyAllocationSignature(deceased = {}, allocation = {}) {
  const shares = calculatedIntestacySharesSignature(allocation);
  const confirmedRows = (Array.isArray(deceased.intestateHeirs) ? deceased.intestateHeirs : [])
    .map((row) => {
      const share = exactShareFromRecord(row);
      return `${String(row?.personId || "")}:${share.numerator}/${share.denominator}`;
    })
    .sort()
    .join("|");
  return [
    INTESTACY_CONFIRMATION_SIGNATURE_VERSION,
    deceased.dateOfDeath || "",
    deceased.unmarriedOrWidowedAtDeath === true ? "no-spouse-at-death" : "spouse-status-derived",
    allocation.destination || "",
    shares,
    allocation.contextSignature || "",
    confirmedRows,
  ].join("::");
}

export function intestacyShareTotalIsComplete(totalPercent) {
  return Math.abs(number(totalPercent) / 100 - 1) <= INTESTACY_SHARE_EPSILON;
}

export function intestacyConfirmationReadiness(
  people = [],
  deceasedId,
  calculatedAllocation = null,
  outsideParties = [],
) {
  const deceased = people.find((person) => person.id === deceasedId);
  if (!deceased) {
    return {
      valid: false,
      rowsValid: false,
      totalComplete: false,
      totalPercent: 0,
      currentSignature: "",
      issues: ["Deceased person not found."],
    };
  }

  const calculated = calculatedAllocation || intestateAllocations(people, deceasedId);
  const rows = Array.isArray(deceased.intestateHeirs) ? deceased.intestateHeirs : [];
  const selectedIds = rows.map((row) => row.personId).filter(Boolean);
  const uniqueIds = new Set(selectedIds);
  const validPersonIds = new Set([
    ...people.map((person) => person.id),
    ...outsideParties.map((party) => party.id),
  ]);
  const totalPercent = rows.reduce(
    (sum, row) => sum + fractionToNumber(exactShareFromRecord(row)) * 100,
    0,
  );
  const exactTotal = rows.reduce(
    (total, row) => addFractions(total, exactShareFromRecord(row)),
    ZERO_FRACTION,
  );
  const totalComplete = !exactTotal.error && compareFractions(exactTotal, WHOLE_FRACTION) === 0;
  const issues = [];

  if (!rows.length) issues.push("Add at least one heir.");
  if (rows.some((row) => !row.personId)) issues.push("Choose a person for every heir row.");
  if (rows.some((row) => compareFractions(exactShareFromRecord(row), ZERO_FRACTION) <= 0)) {
    issues.push("Enter a positive share for every heir.");
  }
  if (selectedIds.length !== rows.length || uniqueIds.size !== rows.length) {
    issues.push("Each heir must be selected once.");
  }
  if (uniqueIds.has(deceasedId)) issues.push("The deceased cannot be selected as their own heir.");
  if (selectedIds.some((personId) => !validPersonIds.has(personId))) {
    issues.push("Remove or replace heirs who are no longer on the family tree.");
  }
  if (!totalComplete) issues.push("The heir shares must total 100%.");

  const rowsValid = issues.length === 0;
  if (!deceased.dateOfDeath) issues.push("Enter the deceased person's date of death.");
  if (SURVIVAL_UNRESOLVED_DESTINATIONS.has(calculated.destination)) {
    issues.push("Complete the missing survival dates before confirming the heirs.");
  }
  if (LAW_UNRESOLVED_DESTINATIONS.has(calculated.destination) && !rows.length) {
    issues.push("Enter edited heirs totalling 100% for this historical succession.");
  }

  return {
    valid: issues.length === 0,
    rowsValid,
    totalComplete,
    totalPercent,
    currentSignature: intestacyAllocationSignature(deceased, calculated),
    issues,
  };
}

export function editedIntestacyAllocations(
  people = [],
  deceasedId,
  calculatedAllocation = null,
  outsideParties = [],
) {
  const deceased = people.find((person) => person.id === deceasedId);
  const shares = new Map();
  const warnings = [];
  if (!deceased) {
    return { valid: false, shares, warnings: ["Deceased person not found."] };
  }

  const calculated = calculatedAllocation || intestateAllocations(people, deceasedId);
  const readiness = intestacyConfirmationReadiness(people, deceasedId, calculated, outsideParties);
  const currentSignature = readiness.currentSignature;
  const rows = Array.isArray(deceased.intestateHeirs) ? deceased.intestateHeirs : [];
  const hasResolvedDeathDate = calculated.destination !== "death-date-unresolved";
  const valid =
    rows.length > 0 && readiness.rowsValid && readiness.totalComplete && hasResolvedDeathDate;

  if (!valid) {
    if (rows.length) {
      warnings.push(
        "The edited intestate heirs need review before they can override the automatic calculation.",
      );
    }
    return { valid: false, shares, warnings, currentSignature };
  }

  const exactShares = new Map();
  rows.forEach((row) => {
    const exact = exactShareFromRecord(row);
    addExactShare(exactShares, row.personId, exact);
    addShare(shares, row.personId, fractionToNumber(exact));
  });
  return { valid: true, shares, exactShares, warnings, currentSignature };
}

export const confirmedIntestacyAllocations = editedIntestacyAllocations;

export function willAllocationReadiness(person = {}, validBeneficiaryIds = null) {
  const rows = Array.isArray(person.willHeirs) ? person.willHeirs : [];
  const selectedIds = rows.map((row) => String(row?.personId || "")).filter(Boolean);
  const validIds =
    validBeneficiaryIds instanceof Set
      ? validBeneficiaryIds
      : Array.isArray(validBeneficiaryIds)
        ? new Set(validBeneficiaryIds.map(String))
        : null;
  const totalPercent = rows.reduce(
    (sum, row) => sum + fractionToNumber(exactShareFromRecord(row)) * 100,
    0,
  );
  const exactTotal = rows.reduce(
    (total, row) => addFractions(total, exactShareFromRecord(row)),
    ZERO_FRACTION,
  );
  const totalComplete = !exactTotal.error && compareFractions(exactTotal, WHOLE_FRACTION) === 0;
  const issues = [];

  if (!rows.length) issues.push("Add at least one beneficiary.");
  if (selectedIds.length !== rows.length) {
    issues.push("Choose a person or company for every beneficiary row.");
  }
  if (rows.some((row) => compareFractions(exactShareFromRecord(row), ZERO_FRACTION) <= 0)) {
    issues.push("Enter a positive share for every beneficiary.");
  }
  if (selectedIds.includes(String(person.id || ""))) {
    issues.push("The deceased cannot be selected as their own beneficiary.");
  }
  if (validIds && selectedIds.some((personId) => !validIds.has(personId))) {
    issues.push("Remove or replace beneficiaries who are no longer in this case.");
  }
  if (!totalComplete) issues.push("The beneficiary shares must total 100%.");

  return {
    valid: issues.length === 0,
    totalComplete,
    totalPercent,
    issues,
  };
}

export function willAllocations(person = {}) {
  const shares = new Map();
  const exactShares = new Map();
  (person.willHeirs || []).forEach((heir) => {
    if (!heir.personId) return;
    const exact = exactShareFromRecord(heir);
    addExactShare(exactShares, heir.personId, exact);
    addShare(shares, heir.personId, fractionToNumber(exact));
  });
  shares.exactShares = exactShares;
  return shares;
}

// Runs the intestacy/will cascade against an arbitrary starting-ownership map, so the
// same family logic can be shared between the legacy single-property view and the
// per-property engine below. startingOwnership is { personId: fraction (0..1) }.
function buildFamilyOwnershipCore(people = [], startingOwnership = {}, outsideParties = []) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const outsidePartyIds = new Set(outsideParties.map((party) => party.id).filter(Boolean));
  const ownershipFractions = new Map();
  const contributions = [];
  const transmissions = [];
  const unresolved = [];

  const record = (personId, amountFraction, via) => {
    const amount = fractionToNumber(amountFraction);
    const total = addExactShare(ownershipFractions, personId, amountFraction);
    contributions.push({ ownerId: personId, amount, fraction: amountFraction, via });
    if (total.error) {
      unresolved.push({
        personId,
        amount,
        fraction: amountFraction,
        warnings: [total.error],
      });
      return false;
    }
    return true;
  };

  const distribute = (personId, amountFraction, via, trail = new Set()) => {
    const amount = fractionToNumber(amountFraction);
    if (
      !personId ||
      amountFraction?.error ||
      compareFractions(amountFraction, ZERO_FRACTION) <= 0
    ) {
      if (personId && amountFraction?.error) {
        unresolved.push({
          personId,
          amount: 0,
          fraction: amountFraction,
          warnings: [amountFraction.error],
        });
      }
      return;
    }
    if (trail.has(personId)) {
      const path = [...trail];
      const loopStart = Math.max(0, path.indexOf(personId));
      const loopIds = [...path.slice(loopStart), personId];
      const loopNames = loopIds.map((id) => personName(peopleById.get(id)));
      const warning = `Circular inheritance path ${loopNames.join(
        " → ",
      )}; this share could not be allocated.`;
      record(personId, amountFraction, "unresolved");
      unresolved.push({ personId, amount, fraction: amountFraction, warnings: [warning] });
      return;
    }
    const person = peopleById.get(personId);
    if (!person) {
      if (outsidePartyIds.has(personId)) {
        record(personId, amountFraction, via);
        return;
      }
      const warning = `The heir or owner identified by ${personId} is no longer in this case.`;
      record(personId, amountFraction, "unresolved");
      unresolved.push({ personId, amount, fraction: amountFraction, warnings: [warning] });
      return;
    }
    if (!isPersonDeceased(person)) {
      record(personId, amountFraction, via);
      return;
    }

    const basis = person.inheritanceBasis || "intestacy";
    let result;
    if (basis === "will") {
      const legalSpouses = linkedLegalSpousesFor(people, person.id, person.dateOfDeath);
      const spouseSurvivalUnresolved = legalSpouses.some(
        (spouse) => isPersonDeceased(spouse) && !spouse.dateOfDeath,
      );
      const survivingSpouses = legalSpouses.filter((spouse) =>
        wasAliveAt(spouse, person.dateOfDeath),
      );
      const protectedWill = applyLegacyProtectedPortionsToWill({
        people,
        deceased: person,
        hasSurvivingSpouse: survivingSpouses.length > 0,
        spouseSurvivalUnresolved,
      });
      result = {
        shares: protectedWill.resolved ? protectedWill.shares : new Map(),
        exactShares: protectedWill.resolved
          ? protectedWill.applies
            ? exactShareMap(protectedWill.shares)
            : exactShareMapFromRecords(person.willHeirs || [])
          : new Map(),
        warnings: protectedWill.warnings,
        destination: protectedWill.applies
          ? protectedWill.calculation?.article === "619"
            ? "will-with-legacy-article-619"
            : "will-with-legacy-legitim"
          : "will",
      };
    } else {
      const calculated = intestateAllocations(people, personId);
      const edited = editedIntestacyAllocations(people, personId, calculated, outsideParties);
      result = edited.valid
        ? {
            shares: edited.shares,
            exactShares: edited.exactShares,
            warnings: calculated.warnings,
            destination: "edited-intestacy",
          }
        : {
            ...calculated,
            warnings: [...calculated.warnings, ...edited.warnings],
          };
    }
    const allocations = result.exactShares || exactShareMap(result.shares);
    const allocatedFraction = sumExactShares(allocations);
    const allocated = fractionToNumber(allocatedFraction);
    if (
      basis === "will" &&
      !allocatedFraction.error &&
      compareFractions(allocatedFraction, WHOLE_FRACTION) !== 0
    ) {
      result.warnings.push(
        `Will beneficiary shares total ${(allocated * 100).toLocaleString("en-MT", {
          maximumFractionDigits: 2,
        })}%, not 100%.`,
      );
    }
    if (allocatedFraction.error || compareFractions(allocatedFraction, WHOLE_FRACTION) > 0) {
      const warning = allocatedFraction.error
        ? allocatedFraction.error
        : "The beneficiary shares exceed the whole estate and were not normalised automatically.";
      result.warnings.push(warning);
      transmissions.push({
        deceasedId: personId,
        basis,
        amount,
        amountFraction,
        allocations: numericShareMap(allocations),
        exactAllocations: allocations,
        warnings: result.warnings,
        destination: "unresolved",
      });
      record(personId, amountFraction, "unresolved");
      unresolved.push({ personId, amount, fraction: amountFraction, warnings: result.warnings });
      return;
    }
    transmissions.push({
      deceasedId: personId,
      basis,
      amount,
      amountFraction,
      allocations: numericShareMap(allocations),
      exactAllocations: allocations,
      warnings: result.warnings,
      destination: result.destination,
    });
    if (!allocations.size || compareFractions(allocatedFraction, ZERO_FRACTION) <= 0) {
      record(personId, amountFraction, "unresolved");
      unresolved.push({ personId, amount, fraction: amountFraction, warnings: result.warnings });
      return;
    }

    const nextTrail = new Set(trail).add(personId);
    const distributions = [...allocations.entries()].map(([heirId, share]) => ({
      heirId,
      amount: multiplyFractions(amountFraction, share),
    }));
    const multiplicationError = distributions.find((entry) => entry.amount.error)?.amount.error;
    if (multiplicationError) {
      result.warnings.push(multiplicationError);
      record(personId, amountFraction, "unresolved");
      unresolved.push({ personId, amount, fraction: amountFraction, warnings: result.warnings });
      return;
    }
    distributions.forEach((entry) => distribute(entry.heirId, entry.amount, basis, nextTrail));
    if (compareFractions(allocatedFraction, WHOLE_FRACTION) < 0) {
      const unallocatedRatio = subtractFractions(WHOLE_FRACTION, allocatedFraction);
      const remainderFraction = multiplyFractions(amountFraction, unallocatedRatio);
      const remainder = fractionToNumber(remainderFraction);
      record(personId, remainderFraction, "unresolved");
      unresolved.push({
        personId,
        amount: remainder,
        fraction: remainderFraction,
        warnings: ["Part of the estate has not been allocated."],
      });
    }
  };

  Object.entries(startingOwnership).forEach(([personId, share]) => {
    const fraction =
      share && typeof share === "object" && "numerator" in share
        ? normaliseFraction(share.numerator, share.denominator)
        : approximateFraction(number(share));
    distribute(personId, fraction, "starting");
  });
  const ownershipByPerson = Object.fromEntries(
    [...ownershipFractions.entries()].map(([personId, share]) => [
      personId,
      fractionToNumber(share),
    ]),
  );
  return {
    ownershipByPerson,
    ownershipFractionsByPerson: Object.fromEntries(ownershipFractions),
    contributions,
    transmissions,
    unresolved,
  };
}

export function buildFamilyOwnershipFromExplicitShares(people = []) {
  const startingOwnership = buildStarterOwnership(people);
  return buildFamilyOwnershipCore(people, startingOwnership);
}

// Kept as a compatibility alias for saved imports. New code should use the name
// that makes the explicit-starting-share requirement clear.
export const buildAutomaticFamilyOwnership = buildFamilyOwnershipFromExplicitShares;

// Converts a property's explicit owners list into a { personId: fraction } starting map.
function propertyStartingOwnership(property = {}) {
  const startingOwnership = {};
  (property.owners || []).forEach((owner) => {
    if (!owner.personId) return;
    const share = exactShareFromRecord(owner);
    startingOwnership[owner.personId] = addFractions(
      startingOwnership[owner.personId] || ZERO_FRACTION,
      share,
    );
  });
  return startingOwnership;
}

// Runs the same automatic cascade for a single property's explicit starting owners, and
// returns a flat per-owner breakdown suitable for future tax integration.
export function buildPropertyOwnership(people = [], property = {}, outsideParties = []) {
  const startingOwnership = propertyStartingOwnership(property);
  const core = buildFamilyOwnershipCore(people, startingOwnership, outsideParties);
  const breakdown = core.contributions
    .filter((contribution) => compareFractions(contribution.fraction, ZERO_FRACTION) > 0)
    .map((contribution) => {
      const fraction = contribution.fraction;
      return {
        propertyId: property.id,
        ownerId: contribution.ownerId,
        numerator: fraction.numerator,
        denominator: fraction.denominator,
        sharePercent: contribution.amount * 100,
        via: contribution.via,
      };
    });
  return {
    propertyId: property.id,
    ownershipByPerson: core.ownershipByPerson,
    ownershipFractionsByPerson: core.ownershipFractionsByPerson,
    ownershipByParty: core.ownershipByPerson,
    breakdown,
    transmissions: core.transmissions,
    unresolved: core.unresolved,
  };
}

// Runs buildPropertyOwnership across every property, for views that need the whole picture.
export function buildFamilyPropertyOwnership(people = [], properties = [], outsideParties = []) {
  const byProperty = {};
  const breakdown = [];
  properties.forEach((property) => {
    const result = buildPropertyOwnership(people, property, outsideParties);
    byProperty[property.id] = result;
    breakdown.push(...result.breakdown);
  });
  return { byProperty, breakdown };
}
