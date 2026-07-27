const number = (value) => Math.max(0, Number(value) || 0);

export const percentageTotal = (heirs = []) =>
  heirs.reduce((total, heir) => total + number(heir.sharePercent), 0);

export const CURRENT_SUCCESSION_START = "2005-03-01";

export function successionRuleset(dateOfDeath) {
  if (!dateOfDeath) return { key: "undated", label: "Enter the date of death", supported: false };
  if (dateOfDeath < CURRENT_SUCCESSION_START) return { key: "pre2005", label: "Historical law before 1 March 2005", supported: false };
  return { key: "current", label: "Current rules (from 1 March 2005)", supported: true };
}

const isActive = (heir) => !["renounced", "predeceased", "incapable"].includes(heir.status);
const blocksRepresentation = (heir) => heir?.status === "renounced";
const allowsRepresentation = (heir) => !heir || ["predeceased", "incapable"].includes(heir.status);

function allocateBranches(heirs, rootRelationship, representativeRelationship, totalShare) {
  const roots = heirs.filter((heir) => heir.relationship === rootRelationship);
  const representatives = heirs.filter((heir) => heir.relationship === representativeRelationship);
  const allNodes = [...roots, ...representatives];
  const nodeIds = new Set(allNodes.map((heir) => heir.id));
  const childrenByParent = new Map();
  representatives.forEach((person) => {
    if (!childrenByParent.has(person.branchId)) childrenByParent.set(person.branchId, []);
    childrenByParent.get(person.branchId).push(person);
  });
  const shares = new Map();
  const viableMemo = new Map();
  const isViable = (person, trail = new Set()) => {
    if (!person || blocksRepresentation(person) || trail.has(person.id)) return false;
    if (isActive(person)) return true;
    if (!allowsRepresentation(person)) return false;
    if (viableMemo.has(person.id)) return viableMemo.get(person.id);
    const nextTrail = new Set(trail).add(person.id);
    const viable = (childrenByParent.get(person.id) || []).some((child) => isViable(child, nextTrail));
    viableMemo.set(person.id, viable);
    return viable;
  };
  const allocateLevel = (people, amount, trail = new Set()) => {
    const viable = people.filter((person) => isViable(person, trail));
    if (!viable.length) return;
    const perBranch = amount / viable.length;
    viable.forEach((person) => {
      if (trail.has(person.id)) return;
      if (isActive(person)) shares.set(person.id, (shares.get(person.id) || 0) + perBranch);
      else allocateLevel(childrenByParent.get(person.id) || [], perBranch, new Set(trail).add(person.id));
    });
  };
  const orphanRepresentatives = representatives.filter((person) => !person.branchId || !nodeIds.has(person.branchId));
  allocateLevel([...roots, ...orphanRepresentatives], totalShare);
  return shares;
}

export function allocateCurrentIntestacy(heirs = []) {
  const shares = new Map(heirs.map((heir) => [heir.id, 0]));
  const warnings = [];
  const spouse = heirs.find((heir) => heir.relationship === "Surviving spouse" && isActive(heir));
  const descendantProbe = allocateBranches(heirs, "Child", "Descendant", 100);
  const hasDescendants = [...descendantProbe.values()].some((share) => share > 0);
  if (hasDescendants) {
    const descendantShares = allocateBranches(heirs, "Child", "Descendant", spouse ? 50 : 100);
    descendantShares.forEach((share, id) => shares.set(id, share));
    if (spouse) shares.set(spouse.id, 50);
    return { shares, warnings, destination: "descendants-and-spouse" };
  }
  if (spouse) {
    shares.set(spouse.id, 100);
    return { shares, warnings, destination: "spouse" };
  }

  const activeAscendants = heirs.filter((heir) => ["Parent", "Ascendant"].includes(heir.relationship) && isActive(heir));
  const nearestDegree = Math.min(...activeAscendants.map((heir) => number(heir.degree) || (heir.relationship === "Parent" ? 1 : 2)));
  const nearestAscendants = activeAscendants.filter((heir) => (number(heir.degree) || (heir.relationship === "Parent" ? 1 : 2)) === nearestDegree);
  const collateralProbe = allocateBranches(heirs, "Sibling", "Sibling descendant", 100);
  const hasDirectCollaterals = [...collateralProbe.values()].some((share) => share > 0);
  if (nearestAscendants.length || hasDirectCollaterals) {
    const ascendantTotal = nearestAscendants.length ? (hasDirectCollaterals ? 50 : 100) : 0;
    nearestAscendants.forEach((heir) => shares.set(heir.id, ascendantTotal / nearestAscendants.length));
    const collateralShares = allocateBranches(heirs, "Sibling", "Sibling descendant", nearestAscendants.length ? 50 : 100);
    collateralShares.forEach((share, id) => shares.set(id, share));
    return { shares, warnings, destination: nearestAscendants.length && hasDirectCollaterals ? "ascendants-and-direct-collaterals" : nearestAscendants.length ? "ascendants" : "direct-collaterals" };
  }

  const otherCollaterals = heirs.filter((heir) => heir.relationship === "Other collateral" && isActive(heir) && number(heir.degree) <= 12);
  const nearestCollateralDegree = Math.min(...otherCollaterals.map((heir) => number(heir.degree)));
  const nearestCollaterals = otherCollaterals.filter((heir) => number(heir.degree) === nearestCollateralDegree);
  if (nearestCollaterals.length) {
    nearestCollaterals.forEach((heir) => shares.set(heir.id, 100 / nearestCollaterals.length));
    return { shares, warnings, destination: "other-collaterals" };
  }
  warnings.push("No eligible relative was found within the supported classes; the succession may devolve on the Government of Malta.");
  return { shares, warnings, destination: "government" };
}

export function suggestedIntestacyShares(heirs = [], dateOfDeath = CURRENT_SUCCESSION_START) {
  const ruleset = successionRuleset(dateOfDeath);
  if (!ruleset.supported) return heirs;
  const allocation = allocateCurrentIntestacy(heirs);
  return heirs.map((heir) => ({ ...heir, sharePercent: allocation.shares.get(heir.id) || 0 }));
}

export function inheritedValue(property, heir) {
  return number(property.marketValueAtDeath) * (number(property.deceasedOwnershipPercent) / 100) * (number(property.rightPercent) / 100) * (number(heir.sharePercent) / 100);
}

export function inheritanceDuty(property, heir, options = {}) {
  const value = inheritedValue(property, heir);
  if (heir.exemption === "full") return { inheritedValue: value, duty: 0, rebate: 0 };
  const reducedBand = heir.soleResidence ? Math.min(value, 200000) : 0;
  let duty = reducedBand * 0.035 + (value - reducedBand) * 0.05;
  const rebate = options.deedWithinSixMonths && duty > 0 && duty <= 2300 ? Math.min(250, duty) : 0;
  duty -= rebate;
  return { inheritedValue: value, duty, rebate };
}

export function saleTaxLot(lot) {
  const transferValue = Math.max(0, number(lot.transferValue) - number(lot.brokerageFees));
  const inherited = String(lot.inheritanceDate || "");
  if (inherited && inherited < "1992-11-25") return { methods: [{ key: "pre1992", label: "7% of transfer value", tax: transferValue * 0.07 }], recommended: "pre1992" };
  const methods = [{ key: "increase", label: "12% of increase", tax: Math.max(0, transferValue - number(lot.acquisitionValue)) * 0.12 }];
  const rate = inherited && inherited < "2004-01-01" ? 0.10 : 0.08;
  methods.push({ key: "whole", label: `${rate * 100}% of transfer value`, tax: transferValue * rate });
  if (lot.qualifiesFivePercent) methods.push({ key: "five", label: "5% qualifying rate", tax: transferValue * 0.05 });
  if (lot.ownResidenceExempt) methods.push({ key: "residence", label: "Own-residence exemption", tax: 0 });
  return { methods, recommended: methods.reduce((lowest, item) => item.tax < lowest.tax ? item : lowest).key };
}
