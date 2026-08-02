import { approximateFraction, buildStarterOwnership } from "./ownership.js";
import {
  findPartnerRelationship,
  legalSpouseIdsForPerson,
  partnerIdsForPerson,
  partnerRelationshipStatusAt,
} from "./partnerRelationships.js";
import { successionRuleset } from "./propertyTax.js";
import { applyLegacyArticle616ToWill } from "./legacyLegitim.js";

const number = (input) => Math.max(0, Number(input) || 0);
export const INTESTACY_SHARE_EPSILON = 1e-8;
const SURVIVAL_UNRESOLVED_DESTINATIONS = new Set([
  "spouse-survival-unresolved",
  "spouse-status-unresolved",
  "death-date-unresolved",
  "survival-date-unresolved",
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
    const missing = unique.filter(
      (candidate) => isPersonDeceased(candidate) && !candidate.dateOfDeath,
    );
    if (missing.length) return { living: [], missing };
    const living = unique.filter((candidate) => wasAliveAt(candidate, atDate));
    if (living.length) return { living, missing: [] };
    current = unique.flatMap((candidate) =>
      [candidate.fatherId, candidate.motherId].map((id) => peopleById.get(id)).filter(Boolean),
    );
  }
  return { living: [], missing: [] };
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

export function intestateAllocations(people = [], deceasedId) {
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
  const marriagesNotStarted = partnerIdsForPerson(people, deceased.id)
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
    const spouseTotal = livingSpouses.length ? 0.5 : 0;
    const descendantShares = allocateBranches(children, atDate, 1 - spouseTotal, index);
    descendantShares.forEach((share, id) => addShare(shares, id, share));
    livingSpouses.forEach((spouse) =>
      addShare(shares, spouse.id, spouseTotal / livingSpouses.length),
    );
    return {
      shares,
      warnings,
      destination: livingSpouses.length ? "spouse-and-descendants" : "descendants",
    };
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

export const INTESTACY_CONFIRMATION_SIGNATURE_VERSION = "v2";

function calculatedIntestacySharesSignature(allocation = {}) {
  return [...(allocation.shares || new Map()).entries()]
    .map(([personId, share]) => `${personId}:${number(share).toFixed(12)}`)
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
    .map((row) => `${String(row?.personId || "")}:${number(row?.sharePercent).toFixed(12)}`)
    .sort()
    .join("|");
  return [
    INTESTACY_CONFIRMATION_SIGNATURE_VERSION,
    deceased.dateOfDeath || "",
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
  const totalPercent = rows.reduce((sum, row) => sum + number(row.sharePercent), 0);
  const totalComplete = intestacyShareTotalIsComplete(totalPercent);
  const issues = [];

  if (!rows.length) issues.push("Add at least one heir.");
  if (rows.some((row) => !row.personId)) issues.push("Choose a person for every heir row.");
  if (rows.some((row) => number(row.sharePercent) <= 0)) {
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

  rows.forEach((row) => addShare(shares, row.personId, number(row.sharePercent) / 100));
  return { valid: true, shares, warnings, currentSignature };
}

export const confirmedIntestacyAllocations = editedIntestacyAllocations;

export const WILL_SHARE_PERCENT_EPSILON = 1e-8;

export function willAllocationReadiness(person = {}, validBeneficiaryIds = null) {
  const rows = Array.isArray(person.willHeirs) ? person.willHeirs : [];
  const selectedIds = rows.map((row) => String(row?.personId || "")).filter(Boolean);
  const validIds =
    validBeneficiaryIds instanceof Set
      ? validBeneficiaryIds
      : Array.isArray(validBeneficiaryIds)
        ? new Set(validBeneficiaryIds.map(String))
        : null;
  const totalPercent = rows.reduce((sum, row) => sum + number(row?.sharePercent), 0);
  const totalComplete = Math.abs(totalPercent - 100) <= WILL_SHARE_PERCENT_EPSILON;
  const issues = [];

  if (!rows.length) issues.push("Add at least one beneficiary.");
  if (selectedIds.length !== rows.length) {
    issues.push("Choose a person or company for every beneficiary row.");
  }
  if (rows.some((row) => number(row?.sharePercent) <= 0)) {
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
  (person.willHeirs || []).forEach((heir) => {
    if (!heir.personId) return;
    addShare(shares, heir.personId, number(heir.sharePercent) / 100);
  });
  return shares;
}

// Runs the intestacy/will cascade against an arbitrary starting-ownership map, so the
// same family logic can be shared between the legacy single-property view and the
// per-property engine below. startingOwnership is { personId: fraction (0..1) }.
function buildFamilyOwnershipCore(people = [], startingOwnership = {}, outsideParties = []) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const outsidePartyIds = new Set(outsideParties.map((party) => party.id).filter(Boolean));
  const ownership = new Map();
  const contributions = [];
  const transmissions = [];
  const unresolved = [];

  const record = (personId, amount, via) => {
    addShare(ownership, personId, amount);
    contributions.push({ ownerId: personId, amount, via });
  };

  const distribute = (personId, amount, via, trail = new Set()) => {
    if (!personId || amount <= 1e-12) return;
    if (trail.has(personId)) {
      const path = [...trail];
      const loopStart = Math.max(0, path.indexOf(personId));
      const loopIds = [...path.slice(loopStart), personId];
      const loopNames = loopIds.map((id) => personName(peopleById.get(id)));
      const warning = `Circular inheritance path ${loopNames.join(
        " → ",
      )}; this share could not be allocated.`;
      record(personId, amount, "unresolved");
      unresolved.push({ personId, amount, warnings: [warning] });
      return;
    }
    const person = peopleById.get(personId);
    if (!person) {
      if (outsidePartyIds.has(personId)) {
        record(personId, amount, via);
        return;
      }
      const warning = `The heir or owner identified by ${personId} is no longer in this case.`;
      record(personId, amount, "unresolved");
      unresolved.push({ personId, amount, warnings: [warning] });
      return;
    }
    if (!isPersonDeceased(person)) {
      record(personId, amount, via);
      return;
    }

    const basis = person.inheritanceBasis || "intestacy";
    let result;
    if (basis === "will") {
      const protectedWill = applyLegacyArticle616ToWill({ people, deceased: person });
      result = {
        shares: protectedWill.resolved ? protectedWill.shares : new Map(),
        warnings: protectedWill.warnings,
        destination: protectedWill.applies ? "will-with-legacy-legitim" : "will",
      };
    } else {
      const calculated = intestateAllocations(people, personId);
      const edited = editedIntestacyAllocations(people, personId, calculated, outsideParties);
      result = edited.valid
        ? {
            shares: edited.shares,
            warnings: calculated.warnings,
            destination: "edited-intestacy",
          }
        : {
            ...calculated,
            warnings: [...calculated.warnings, ...edited.warnings],
          };
    }
    let allocated = [...result.shares.values()].reduce((sum, share) => sum + share, 0);
    if (basis === "will" && Math.abs(allocated - 1) > 1e-10) {
      result.warnings.push(
        `Will beneficiary shares total ${(allocated * 100).toLocaleString("en-MT", {
          maximumFractionDigits: 4,
        })}%, not 100%.`,
      );
    }
    if (allocated > 1 + 1e-10) {
      result.shares.forEach((share, heirId) => {
        result.shares.set(heirId, share / allocated);
      });
      allocated = 1;
    }
    transmissions.push({
      deceasedId: personId,
      basis,
      amount,
      allocations: result.shares,
      warnings: result.warnings,
      destination: result.destination,
    });
    if (!result.shares.size || allocated <= 1e-12) {
      record(personId, amount, "unresolved");
      unresolved.push({ personId, amount, warnings: result.warnings });
      return;
    }

    const nextTrail = new Set(trail).add(personId);
    result.shares.forEach((share, heirId) => distribute(heirId, amount * share, basis, nextTrail));
    if (allocated < 1 - 1e-10) {
      const remainder = amount * (1 - allocated);
      record(personId, remainder, "unresolved");
      unresolved.push({
        personId,
        amount: remainder,
        warnings: ["Part of the estate has not been allocated."],
      });
    }
  };

  Object.entries(startingOwnership).forEach(([personId, share]) =>
    distribute(personId, share, "starting"),
  );
  return {
    ownershipByPerson: Object.fromEntries(ownership),
    contributions,
    transmissions,
    unresolved,
  };
}

export function buildFamilyOwnershipFromExplicitShares(people = []) {
  const startingOwnership = buildStarterOwnership(people);
  const { ownershipByPerson, transmissions, unresolved } = buildFamilyOwnershipCore(
    people,
    startingOwnership,
  );
  return { ownershipByPerson, transmissions, unresolved };
}

// Kept as a compatibility alias for saved imports. New code should use the name
// that makes the explicit-starting-share requirement clear.
export const buildAutomaticFamilyOwnership = buildFamilyOwnershipFromExplicitShares;

// Converts a property's explicit owners list into a { personId: fraction } starting map.
function propertyStartingOwnership(property = {}) {
  const startingOwnership = {};
  (property.owners || []).forEach((owner) => {
    if (!owner.personId) return;
    startingOwnership[owner.personId] =
      (startingOwnership[owner.personId] || 0) + number(owner.sharePercent) / 100;
  });
  return startingOwnership;
}

// Runs the same automatic cascade for a single property's explicit starting owners, and
// returns a flat per-owner breakdown suitable for future tax integration.
export function buildPropertyOwnership(people = [], property = {}, outsideParties = []) {
  const startingOwnership = propertyStartingOwnership(property);
  const core = buildFamilyOwnershipCore(people, startingOwnership, outsideParties);
  const breakdown = core.contributions
    .filter((contribution) => contribution.amount > 1e-12)
    .map((contribution) => {
      const fraction = approximateFraction(contribution.amount);
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
