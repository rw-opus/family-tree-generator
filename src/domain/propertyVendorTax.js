import { declarationCoverage } from "./declarations.js";
import { INHERITANCE_CAUSA_MORTIS_CUTOFF } from "./article5A.js";
import { buildPropertyOwnership, isPersonDeceased } from "./familyOwnership.js";
import {
  approximateFraction,
  buildPropertyLedger,
  startingOwnershipIsUnset,
  startingOwnershipTotalPercent,
} from "./ownership.js";
import { saleTaxLot, vendorTaxSummary } from "./propertyTax.js";

const OWNERSHIP_EPSILON = 0.001;

const allocationEntries = (allocations) =>
  allocations instanceof Map ? [...allocations.entries()] : Object.entries(allocations || {});

/** Direct causa-mortis acquisitions that can supply a vendor tax lot's date. */
export function buildInheritanceSourcesByOwner(ownership = {}, people = [], outsideParties = []) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const outsidePartiesById = new Map(outsideParties.map((party) => [party.id, party]));
  const sources = new Map();

  (ownership.transmissions || []).forEach((transmission) => {
    const deceased = peopleById.get(transmission.deceasedId);
    const inheritanceDate = String(deceased?.dateOfDeath || "");
    allocationEntries(transmission.allocations).forEach(([ownerId, allocatedShare]) => {
      const share = (Number(transmission.amount) || 0) * (Number(allocatedShare) || 0);
      if (!(share > 0)) return;
      const owner = peopleById.get(ownerId) || outsidePartiesById.get(ownerId);
      const rows = sources.get(ownerId) || [];
      rows.push({
        deceasedId: transmission.deceasedId,
        deceasedName: deceased?.fullName || "Unnamed deceased owner",
        ownerId,
        ownerName: owner?.fullName || owner?.name || "Unnamed heir",
        inheritanceDate,
        share,
        immediateDescendant:
          owner?.fatherId === transmission.deceasedId ||
          owner?.motherId === transmission.deceasedId,
        preCausaMortisCutoff:
          Boolean(inheritanceDate) && inheritanceDate < INHERITANCE_CAUSA_MORTIS_CUTOFF,
      });
      sources.set(ownerId, rows);
    });
  });

  return sources;
}

export function propertyStartingOwnershipStatus(property = {}) {
  const entries = (property.owners || [])
    .filter((owner) => owner?.personId)
    .map((owner) => ({
      id: owner.personId,
      ownershipSharePercent: owner.sharePercent,
    }));
  const isUnset = startingOwnershipIsUnset(entries);
  const totalPercent = startingOwnershipTotalPercent(entries);
  return {
    isUnset,
    totalPercent,
    isComplete: !isUnset && Math.abs(totalPercent - 100) < OWNERSHIP_EPSILON,
  };
}

export function buildPropertyVendorTaxReport(property = {}, people = [], outsideParties = []) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const outsidePartiesById = new Map(outsideParties.map((party) => [party.id, party]));
  const startingOwnership = propertyStartingOwnershipStatus(property);
  const ownership = buildPropertyOwnership(people, property, outsideParties);
  const inheritanceSourcesByOwner = buildInheritanceSourcesByOwner(
    ownership,
    people,
    outsideParties,
  );
  const declarationOwners = Object.entries(ownership.ownershipByPerson).map(
    ([personId, share]) => ({
      id: personId,
      name:
        peopleById.get(personId)?.fullName ||
        outsidePartiesById.get(personId)?.name ||
        "Unnamed party",
      share,
    }),
  );
  const ledger = buildPropertyLedger(
    people,
    outsideParties,
    property.transfers || [],
    ownership.ownershipByPerson,
  );
  const causaMortisDeclarationOwners = declarationOwners.filter((owner) => {
    const sources = inheritanceSourcesByOwner.get(owner.id) || [];
    // Preserve declarations entered directly against a current owner when no
    // family-tree transmission is available. Once a transmission is known,
    // however, a wholly pre-cutoff acquisition cannot have a CM declaration.
    return (
      sources.length === 0 ||
      sources.some(
        (source) =>
          !source.inheritanceDate || source.inheritanceDate >= INHERITANCE_CAUSA_MORTIS_CUTOFF,
      )
    );
  });
  const coverage = declarationCoverage(causaMortisDeclarationOwners, property.declarations || []);
  const saleRows = (property.saleLots || []).map((storedLot) => {
    const lot = storedLot;
    const inheritanceSources = inheritanceSourcesByOwner.get(lot.ownerId) || [];
    const selectedInheritanceSource = lot.inheritanceSourceDeceasedId
      ? inheritanceSources.find((source) => source.deceasedId === lot.inheritanceSourceDeceasedId)
      : inheritanceSources.length === 1
        ? inheritanceSources[0]
        : null;
    const sourceDate = selectedInheritanceSource?.inheritanceDate || "";
    const sourcedLot =
      (lot.acquisitionType || "inheritance") === "inheritance" && sourceDate
        ? { ...lot, inheritanceDate: sourceDate }
        : lot;
    const preCausaMortisCutoff =
      (sourcedLot.acquisitionType || "inheritance") === "inheritance" &&
      Boolean(sourcedLot.inheritanceDate) &&
      sourcedLot.inheritanceDate < INHERITANCE_CAUSA_MORTIS_CUTOFF;
    const declaredCoverage = coverage.find((item) => item.heirId === lot.ownerId);
    const usePublishedValues =
      !preCausaMortisCutoff &&
      lot.useDeclaredValues !== false &&
      Boolean(declaredCoverage?.hasUsablePublishedValues);
    const declaredFraction = approximateFraction(declaredCoverage?.publishedFraction || 0);
    const effectiveLot = usePublishedValues
      ? {
          ...sourcedLot,
          acquisitionValue: declaredCoverage.publishedValue,
          acquisitionValueBasis: lot.acquisitionValueBasis || "cm-declared",
          shareNumerator: declaredFraction.numerator,
          shareDenominator: declaredFraction.denominator,
        }
      : preCausaMortisCutoff
        ? {
            ...sourcedLot,
            acquisitionValue: "",
            acquisitionValueBasis: "",
            cmValueEligibilityConfirmed: false,
            useDeclaredValues: false,
          }
        : sourcedLot;
    return {
      lot,
      effectiveLot,
      declaredCoverage,
      usePublishedValues,
      inheritanceSources,
      selectedInheritanceSource,
      inheritanceDateInferred: Boolean(sourceDate),
      preCausaMortisCutoff,
      result: saleTaxLot(effectiveLot),
    };
  });
  const deceasedVendorIds = new Set(
    ledger.parties
      .filter((party) => {
        const person = peopleById.get(party.personId);
        return (person && isPersonDeceased(person)) || party.isDeceased;
      })
      .map((party) => party.id),
  );
  const livingVendors = ledger.owners.filter((owner) => !deceasedVendorIds.has(owner.id));
  const taxSummary = vendorTaxSummary(ledger.owners, saleRows, [...deceasedVendorIds]);
  return {
    startingOwnership,
    ownership,
    inheritanceSourcesByOwner,
    declarationOwners,
    causaMortisDeclarationOwners,
    ledger,
    coverage,
    saleRows,
    deceasedVendorIds,
    livingVendors,
    taxSummary,
  };
}
