import { assessArticle5ATransfer, article5ATransferValue } from "./article5A.js";
import { fractionComponentNumber } from "./fractions.js";
import {
  legacyHistoricalLawWarning,
  SUCCESSION_REFORM_START,
  successionRuleset as classifySuccessionRuleset,
} from "./successionRules.js";

const number = (value) => Math.max(0, Number(value) || 0);

export const percentageTotal = (heirs = []) =>
  heirs.reduce((total, heir) => total + number(heir.sharePercent), 0);

export const CURRENT_SUCCESSION_START = SUCCESSION_REFORM_START;

export function successionRuleset(dateOfDeath) {
  return classifySuccessionRuleset(dateOfDeath);
}

const isActive = (heir) => !["renounced", "predeceased", "incapable"].includes(heir.status);
const blocksRepresentation = (heir) => heir?.status === "renounced";
const allowsRepresentation = (heir) => !heir || ["predeceased", "incapable"].includes(heir.status);

function allocateBranches(
  heirs,
  rootRelationship,
  representativeRelationship,
  totalShare,
  warnings = [],
) {
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
  const isViable = (person, trail = new Set()) => {
    if (!person || blocksRepresentation(person) || trail.has(person.id)) return false;
    if (isActive(person)) return true;
    if (!allowsRepresentation(person)) return false;
    const nextTrail = new Set(trail).add(person.id);
    return (childrenByParent.get(person.id) || []).some((child) => isViable(child, nextTrail));
  };
  const allocateLevel = (people, amount, trail = new Set()) => {
    const viable = people.filter((person) => isViable(person, trail));
    if (!viable.length) return;
    const perBranch = amount / viable.length;
    viable.forEach((person) => {
      if (trail.has(person.id)) return;
      if (isActive(person)) shares.set(person.id, (shares.get(person.id) || 0) + perBranch);
      else
        allocateLevel(
          childrenByParent.get(person.id) || [],
          perBranch,
          new Set(trail).add(person.id),
        );
    });
  };
  const orphanRepresentatives = representatives.filter(
    (person) => !person.branchId || !nodeIds.has(person.branchId),
  );
  orphanRepresentatives.forEach((person) => {
    const warning = `${
      person.name || person.id || "Unnamed representative"
    } has no valid parent branch and was provisionally placed at root level. Fix the branch link before relying on these shares.`;
    if (!warnings.includes(warning)) warnings.push(warning);
  });
  allocateLevel([...roots, ...orphanRepresentatives], totalShare);
  return shares;
}

export function allocateCurrentIntestacy(heirs = []) {
  const shares = new Map(heirs.map((heir) => [heir.id, 0]));
  const warnings = [];
  const spouse = heirs.find((heir) => heir.relationship === "Surviving spouse" && isActive(heir));
  const descendantProbe = allocateBranches(heirs, "Child", "Descendant", 100, warnings);
  const hasDescendants = [...descendantProbe.values()].some((share) => share > 0);
  if (hasDescendants) {
    const descendantShares = allocateBranches(
      heirs,
      "Child",
      "Descendant",
      spouse ? 50 : 100,
      warnings,
    );
    descendantShares.forEach((share, id) => shares.set(id, share));
    if (spouse) shares.set(spouse.id, 50);
    return { shares, warnings, destination: "descendants-and-spouse" };
  }
  if (spouse) {
    shares.set(spouse.id, 100);
    return { shares, warnings, destination: "spouse" };
  }

  const activeAscendants = heirs.filter(
    (heir) => ["Parent", "Ascendant"].includes(heir.relationship) && isActive(heir),
  );
  const nearestDegree = Math.min(
    ...activeAscendants.map(
      (heir) => number(heir.degree) || (heir.relationship === "Parent" ? 1 : 2),
    ),
  );
  const nearestAscendants = activeAscendants.filter(
    (heir) => (number(heir.degree) || (heir.relationship === "Parent" ? 1 : 2)) === nearestDegree,
  );
  const collateralProbe = allocateBranches(heirs, "Sibling", "Sibling descendant", 100, warnings);
  const hasDirectCollaterals = [...collateralProbe.values()].some((share) => share > 0);
  if (nearestAscendants.length || hasDirectCollaterals) {
    const ascendantTotal = nearestAscendants.length ? (hasDirectCollaterals ? 50 : 100) : 0;
    nearestAscendants.forEach((heir) =>
      shares.set(heir.id, ascendantTotal / nearestAscendants.length),
    );
    const collateralShares = allocateBranches(
      heirs,
      "Sibling",
      "Sibling descendant",
      nearestAscendants.length ? 50 : 100,
      warnings,
    );
    collateralShares.forEach((share, id) => shares.set(id, share));
    return {
      shares,
      warnings,
      destination:
        nearestAscendants.length && hasDirectCollaterals
          ? "ascendants-and-direct-collaterals"
          : nearestAscendants.length
            ? "ascendants"
            : "direct-collaterals",
    };
  }

  const otherCollaterals = heirs.filter(
    (heir) =>
      heir.relationship === "Other collateral" && isActive(heir) && number(heir.degree) <= 12,
  );
  const nearestCollateralDegree = Math.min(...otherCollaterals.map((heir) => number(heir.degree)));
  const nearestCollaterals = otherCollaterals.filter(
    (heir) => number(heir.degree) === nearestCollateralDegree,
  );
  if (nearestCollaterals.length) {
    nearestCollaterals.forEach((heir) => shares.set(heir.id, 100 / nearestCollaterals.length));
    return { shares, warnings, destination: "other-collaterals" };
  }
  warnings.push(
    "No eligible relative was found within the supported classes; the succession may devolve on the Government of Malta.",
  );
  return { shares, warnings, destination: "government" };
}

function viableLegacyBranchRoots(heirs, rootRelationship, representativeRelationship) {
  const roots = heirs.filter((heir) => heir.relationship === rootRelationship);
  const representatives = heirs.filter((heir) => heir.relationship === representativeRelationship);
  const childrenByParent = new Map();
  representatives.forEach((person) => {
    if (!childrenByParent.has(person.branchId)) childrenByParent.set(person.branchId, []);
    childrenByParent.get(person.branchId).push(person);
  });
  const viable = (person, trail = new Set()) => {
    if (!person || blocksRepresentation(person) || trail.has(person.id)) return false;
    if (isActive(person)) return true;
    if (!allowsRepresentation(person)) return false;
    const nextTrail = new Set(trail).add(person.id);
    return (childrenByParent.get(person.id) || []).some((child) => viable(child, nextTrail));
  };
  return roots.filter((root) => viable(root));
}

function addLegacyDateWarning(warnings, dateOfDeath, articles) {
  const warning = legacyHistoricalLawWarning(dateOfDeath, articles);
  if (warning && !warnings.includes(warning)) warnings.push(warning);
}

export function allocateLegacyIntestacy(heirs = [], dateOfDeath = "") {
  const shares = new Map(heirs.map((heir) => [heir.id, 0]));
  const warnings = [];
  const spouse = heirs.find((heir) => heir.relationship === "Surviving spouse" && isActive(heir));
  const descendantShares = allocateBranches(heirs, "Child", "Descendant", 100, warnings);
  const hasDescendants = [...descendantShares.values()].some((share) => share > 0);
  if (hasDescendants) {
    descendantShares.forEach((share, id) => shares.set(id, share));
    if (spouse) addLegacyDateWarning(warnings, dateOfDeath, ["825"]);
    return { shares, warnings, destination: "legacy-descendants" };
  }

  const activeAscendants = heirs.filter(
    (heir) => ["Parent", "Ascendant"].includes(heir.relationship) && isActive(heir),
  );
  const nearestDegree = Math.min(
    ...activeAscendants.map(
      (heir) => number(heir.degree) || (heir.relationship === "Parent" ? 1 : 2),
    ),
  );
  const nearestAscendants = activeAscendants.filter(
    (heir) => (number(heir.degree) || (heir.relationship === "Parent" ? 1 : 2)) === nearestDegree,
  );
  const siblingRoots = viableLegacyBranchRoots(heirs, "Sibling", "Sibling descendant");
  const hasNearerRelatives = nearestAscendants.length || siblingRoots.length;

  if (spouse && !hasNearerRelatives) {
    shares.set(spouse.id, 100);
    return { shares, warnings, destination: "legacy-spouse" };
  }

  const relativeTotal = spouse ? 50 : 100;
  if (spouse) shares.set(spouse.id, 50);

  if (nearestAscendants.length && siblingRoots.length) {
    const headCount = nearestAscendants.length + siblingRoots.length;
    const perHead = relativeTotal / headCount;
    nearestAscendants.forEach((heir) => shares.set(heir.id, perHead));
    const siblingShares = allocateBranches(
      heirs,
      "Sibling",
      "Sibling descendant",
      perHead * siblingRoots.length,
      warnings,
    );
    siblingShares.forEach((share, id) => shares.set(id, share));
    if (spouse) addLegacyDateWarning(warnings, dateOfDeath, ["826"]);
    return { shares, warnings, destination: "legacy-ascendants-and-sibling-branches" };
  }

  if (nearestAscendants.length) {
    const byLine = new Map();
    nearestAscendants.forEach((heir) => {
      const line = String(heir.line || "");
      if (!line || nearestDegree === 1) return;
      if (!byLine.has(line)) byLine.set(line, []);
      byLine.get(line).push(heir);
    });
    const lineMappedCount = [...byLine.values()].reduce((total, group) => total + group.length, 0);
    if (byLine.size > 1 && lineMappedCount === nearestAscendants.length) {
      byLine.forEach((lineAscendants) =>
        lineAscendants.forEach((heir) =>
          shares.set(heir.id, relativeTotal / byLine.size / lineAscendants.length),
        ),
      );
    } else {
      nearestAscendants.forEach((heir) =>
        shares.set(heir.id, relativeTotal / nearestAscendants.length),
      );
    }
    if (spouse) addLegacyDateWarning(warnings, dateOfDeath, ["826"]);
    warnings.push(
      "Former Civil Code article 812 contains a property-specific return rule for certain assets previously given by an ascendant; that rule must be checked if relevant.",
    );
    return { shares, warnings, destination: "legacy-ascendants" };
  }

  if (siblingRoots.length) {
    const siblingShares = allocateBranches(
      heirs,
      "Sibling",
      "Sibling descendant",
      relativeTotal,
      warnings,
    );
    siblingShares.forEach((share, id) => shares.set(id, share));
    if (spouse) addLegacyDateWarning(warnings, dateOfDeath, ["826"]);
    return { shares, warnings, destination: "legacy-sibling-branches" };
  }

  const otherCollaterals = heirs.filter(
    (heir) =>
      heir.relationship === "Other collateral" && isActive(heir) && number(heir.degree) <= 12,
  );
  const collateralDegree = Math.min(...otherCollaterals.map((heir) => number(heir.degree)));
  const nearestCollaterals = otherCollaterals.filter(
    (heir) => number(heir.degree) === collateralDegree,
  );
  if (nearestCollaterals.length) {
    nearestCollaterals.forEach((heir) => shares.set(heir.id, 100 / nearestCollaterals.length));
    return { shares, warnings, destination: "legacy-other-collaterals" };
  }

  warnings.push(
    "No eligible relative was found; the succession may devolve on the Government of Malta.",
  );
  return { shares, warnings, destination: "government" };
}

export function allocateLegacyDescendantIntestacy(heirs = [], dateOfDeath = "") {
  return allocateLegacyIntestacy(heirs, dateOfDeath);
}

export function suggestedIntestacyShares(heirs = [], dateOfDeath = "") {
  const ruleset = successionRuleset(dateOfDeath);
  if (!ruleset.supported) return heirs;
  const allocation =
    ruleset.key === "pre2005"
      ? allocateLegacyIntestacy(heirs, dateOfDeath)
      : allocateCurrentIntestacy(heirs);
  return heirs.map((heir) => ({ ...heir, sharePercent: allocation.shares.get(heir.id) || 0 }));
}

// Stamp duty (duty on documents) is deliberately outside this generator's scope: only
// Article 5A transfer taxes are computed. The former inheritedValue/inheritanceDuty
// helpers were removed with that decision so a duty figure cannot creep back in.

export function saleTaxLot(lot, context = {}) {
  // Values in a lot already relate to that lot's fraction. Multiplying by the
  // fraction again would understate both the taxable basis and the tax.
  const { transferValue } = article5ATransferValue(lot);
  const declaredValue = number(lot.acquisitionValue);
  const numerator = fractionComponentNumber(lot.shareNumerator);
  const denominator = fractionComponentNumber(lot.shareDenominator, { allowZero: false });
  const share = denominator > 0 ? numerator / denominator : 0;
  if (lot.taxTreatment === "manual") {
    const tax = number(lot.manualTaxAmount);
    return {
      methods: [
        {
          key: "manual",
          label: "Manually assessed tax",
          rate: null,
          basis: transferValue,
          tax,
        },
      ],
      recommended: "manual",
      selected: "manual",
      transferValue,
      declaredValue,
      share,
      status: "manual",
      warnings: [],
    };
  }
  return assessArticle5ATransfer(lot, context);
}

// Article 5A is assessed on the transferor, so a value-banded relief belongs to that vendor's
// transfer as a whole rather than to each separately assessed acquisition. Totals are keyed by
// owner: co-vendors on the same deed are separate transferors with separate assessments.
export function deedTransferTotals(lots = []) {
  const totals = new Map();
  lots.forEach((lot) => {
    const { transferValue } = article5ATransferValue(lot);
    totals.set(lot.ownerId, (totals.get(lot.ownerId) || 0) + transferValue);
  });
  return totals;
}

export function selectedSaleTax(result = {}) {
  return (result.methods || []).find((method) => method.key === result.selected)?.tax || 0;
}

export function saleTaxLotsTotal(lots = []) {
  const deedTotals = deedTransferTotals(lots);
  return lots.reduce(
    (total, lot) =>
      total +
      selectedSaleTax(saleTaxLot(lot, { deedTransferValue: deedTotals.get(lot.ownerId) || 0 })),
    0,
  );
}

export function vendorTaxSummary(vendors = [], saleRows = [], excludedVendorIds = []) {
  const excluded = new Set(excludedVendorIds);
  const summaries = vendors
    .filter((vendor) => !excluded.has(vendor.id))
    .map((vendor) => {
      const rows = saleRows.filter((row) => row.lot?.ownerId === vendor.id);
      return {
        id: vendor.id,
        name: vendor.name,
        type: vendor.type,
        share: Number(vendor.share) || 0,
        lotCount: rows.length,
        pendingLotCount: rows.filter(
          (row) =>
            !(row.result?.methods || []).some((method) => method.key === row.result?.selected),
        ).length,
        manualReviewLotCount: rows.filter((row) => row.result?.requiresManualReview).length,
        saleValue: rows.reduce((total, row) => total + (Number(row.result?.transferValue) || 0), 0),
        tax: rows.reduce((total, row) => total + selectedSaleTax(row.result), 0),
        rows,
      };
    });
  return {
    vendors: summaries,
    total: summaries.reduce((total, vendor) => total + vendor.tax, 0),
    excludedLotCount: saleRows.filter((row) => excluded.has(row.lot?.ownerId)).length,
  };
}
