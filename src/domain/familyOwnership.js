import { approximateFraction, buildStarterOwnership } from "./ownership.js";
import { CURRENT_SUCCESSION_START } from "./propertyTax.js";

const number = (input) => Math.max(0, Number(input) || 0);

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
    if (candidate.fatherId === person.id && candidate.motherId) {
      spouseIds.add(candidate.motherId);
    }
    if (candidate.motherId === person.id && candidate.fatherId) {
      spouseIds.add(candidate.fatherId);
    }
  });
  spouseIds.delete(person.id);
  return [...spouseIds].map((id) => peopleById.get(id)).filter(Boolean);
}

export function linkedSpousesFor(people = [], personId) {
  const index = familyIndex(people);
  const person = index.peopleById.get(personId);
  return person ? linkedSpouses(person, people, index.peopleById) : [];
}

export function linkedSpousesMissingDeathDates(people = [], deceasedId) {
  return linkedSpousesFor(people, deceasedId).filter(
    (person) => isPersonDeceased(person) && !person.dateOfDeath,
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

function nearestLivingAscendants(person, atDate, peopleById) {
  let current = [person.fatherId, person.motherId].map((id) => peopleById.get(id)).filter(Boolean);
  const visited = new Set([person.id]);
  while (current.length) {
    const unique = current.filter((candidate) => {
      if (visited.has(candidate.id)) return false;
      visited.add(candidate.id);
      return true;
    });
    const living = unique.filter((candidate) => wasAliveAt(candidate, atDate));
    if (living.length) return living;
    current = unique.flatMap((candidate) =>
      [candidate.fatherId, candidate.motherId].map((id) => peopleById.get(id)).filter(Boolean),
    );
  }
  return [];
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
  if (deceased.dateOfDeath && deceased.dateOfDeath < CURRENT_SUCCESSION_START) {
    warnings.push("Historical intestacy rules before 1 March 2005 are not yet automated.");
    return { shares, warnings, destination: "historical-unresolved" };
  }
  const spouses = linkedSpouses(deceased, people, index.peopleById);
  const spousesWithUnknownSurvival = linkedSpousesMissingDeathDates(people, deceased.id);
  if (spousesWithUnknownSurvival.length) {
    const names = spousesWithUnknownSurvival.map((person) => person.fullName || "Unnamed partner");
    warnings.push(
      `Enter the date of death for ${names.join(
        ", ",
      )} before deciding whether the linked spouse survived the deceased.`,
    );
    return { shares, warnings, destination: "spouse-survival-unresolved" };
  }
  if (!deceased.dateOfDeath) {
    warnings.push(
      `Enter the date of death for ${deceased.fullName || "the deceased"} before calculating the intestate succession.`,
    );
    return { shares, warnings, destination: "death-date-unresolved" };
  }

  const atDate = deceased.dateOfDeath;
  const livingSpouses = spouses.filter((person) => wasAliveAt(person, atDate));
  const children = index.childrenByParent.get(deceased.id) || [];
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

  const ascendants = nearestLivingAscendants(deceased, atDate, index.peopleById);
  const siblings = linkedSiblings(deceased, people, index.peopleById);
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

  const otherCollaterals = people
    .filter(
      (candidate) =>
        candidate.id !== deceased.id &&
        wasAliveAt(candidate, atDate) &&
        !livingSpouses.some((spouse) => spouse.id === candidate.id),
    )
    .map((candidate) => ({
      person: candidate,
      degree: collateralDegree(deceased.id, candidate.id, index),
    }))
    .filter(({ degree }) => degree >= 3 && degree <= 12);
  const nearestDegree = Math.min(...otherCollaterals.map(({ degree }) => degree));
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

export function intestacyAllocationSignature(deceased = {}, allocation = {}) {
  const shares = [...(allocation.shares || new Map()).entries()]
    .map(([personId, share]) => `${personId}:${number(share).toFixed(12)}`)
    .sort()
    .join("|");
  return [deceased.dateOfDeath || "", allocation.destination || "", shares].join("::");
}

export function confirmedIntestacyAllocations(
  people = [],
  deceasedId,
  calculatedAllocation = null,
) {
  const deceased = people.find((person) => person.id === deceasedId);
  const shares = new Map();
  const warnings = [];
  if (!deceased) {
    return { valid: false, shares, warnings: ["Deceased person not found."] };
  }

  const calculated = calculatedAllocation || intestateAllocations(people, deceasedId);
  const currentSignature = intestacyAllocationSignature(deceased, calculated);
  const rows = Array.isArray(deceased.intestateHeirs) ? deceased.intestateHeirs : [];
  const selectedIds = rows.map((row) => row.personId).filter(Boolean);
  const uniqueIds = new Set(selectedIds);
  const total = rows.reduce((sum, row) => sum + number(row.sharePercent) / 100, 0);
  const valid =
    deceased.intestateHeirsConfirmed === true &&
    !["spouse-survival-unresolved", "death-date-unresolved"].includes(calculated.destination) &&
    deceased.intestateConfirmationBasis === currentSignature &&
    rows.length > 0 &&
    rows.every((row) => number(row.sharePercent) > 0) &&
    selectedIds.length === rows.length &&
    uniqueIds.size === rows.length &&
    !uniqueIds.has(deceasedId) &&
    selectedIds.every((personId) => people.some((person) => person.id === personId)) &&
    Math.abs(total - 1) < 1e-8;

  if (!valid) {
    if (deceased.intestateHeirsConfirmed) {
      warnings.push(
        "The confirmed intestate heirs need review because the family details or statutory calculation changed.",
      );
    } else {
      warnings.push("The intestate heirs and their shares have not yet been confirmed.");
    }
    return { valid: false, shares, warnings, currentSignature };
  }

  rows.forEach((row) => addShare(shares, row.personId, number(row.sharePercent) / 100));
  return { valid: true, shares, warnings, currentSignature };
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
function buildFamilyOwnershipCore(people = [], startingOwnership = {}) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const ownership = new Map();
  const contributions = [];
  const transmissions = [];
  const unresolved = [];

  const record = (personId, amount, via) => {
    addShare(ownership, personId, amount);
    contributions.push({ ownerId: personId, amount, via });
  };

  const distribute = (personId, amount, via, trail = new Set()) => {
    if (!personId || amount <= 1e-12 || trail.has(personId)) return;
    const person = peopleById.get(personId);
    if (!person) return;
    if (!isPersonDeceased(person)) {
      record(personId, amount, via);
      return;
    }

    const basis = person.inheritanceBasis || "intestacy";
    let result;
    if (basis === "will") {
      result = { shares: willAllocations(person), warnings: [], destination: "will" };
    } else {
      const calculated = intestateAllocations(people, personId);
      const confirmed = confirmedIntestacyAllocations(people, personId, calculated);
      result = confirmed.valid
        ? {
            shares: confirmed.shares,
            warnings: calculated.warnings,
            destination: "confirmed-intestacy",
          }
        : {
            ...calculated,
            warnings: [...calculated.warnings, ...confirmed.warnings],
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

export function buildAutomaticFamilyOwnership(people = []) {
  const startingOwnership = buildStarterOwnership(people);
  if (!Object.keys(startingOwnership).length && people.length === 1) {
    startingOwnership[people[0].id] = 1;
  }
  const { ownershipByPerson, transmissions, unresolved } = buildFamilyOwnershipCore(
    people,
    startingOwnership,
  );
  return { ownershipByPerson, transmissions, unresolved };
}

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
export function buildPropertyOwnership(people = [], property = {}) {
  const startingOwnership = propertyStartingOwnership(property);
  const core = buildFamilyOwnershipCore(people, startingOwnership);
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
    breakdown,
    transmissions: core.transmissions,
    unresolved: core.unresolved,
  };
}

// Runs buildPropertyOwnership across every property, for views that need the whole picture.
export function buildFamilyPropertyOwnership(people = [], properties = []) {
  const byProperty = {};
  const breakdown = [];
  properties.forEach((property) => {
    const result = buildPropertyOwnership(people, property);
    byProperty[property.id] = result;
    breakdown.push(...result.breakdown);
  });
  return { byProperty, breakdown };
}
