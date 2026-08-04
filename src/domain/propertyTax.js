import { assessArticle5ATransfer, article5ATransferValue } from "./article5A.js";
import { fractionComponentNumber } from "./fractions.js";
import {
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

export function allocateLegacyDescendantIntestacy(heirs = []) {
  const shares = new Map(heirs.map((heir) => [heir.id, 0]));
  const warnings = [];
  const descendantShares = allocateBranches(heirs, "Child", "Descendant", 100, warnings);
  const hasDescendants = [...descendantShares.values()].some((share) => share > 0);
  if (!hasDescendants) {
    warnings.push(
      "The complete former Civil Code articles 810 to 830 are needed before this pre-1 March 2005 succession can be suggested automatically.",
    );
    return { shares, warnings, destination: "legacy-law-unresolved" };
  }
  descendantShares.forEach((share, id) => shares.set(id, share));
  return { shares, warnings, destination: "legacy-descendants" };
}

export function suggestedIntestacyShares(heirs = [], dateOfDeath = "") {
  const ruleset = successionRuleset(dateOfDeath);
  if (!ruleset.supported) return heirs;
  const allocation =
    ruleset.key === "pre2005"
      ? allocateLegacyDescendantIntestacy(heirs)
      : allocateCurrentIntestacy(heirs);
  if (allocation.destination === "legacy-law-unresolved") return heirs;
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
