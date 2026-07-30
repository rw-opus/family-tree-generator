import { declarationCoverage } from "./declarations.js";
import { buildPropertyOwnership, isPersonDeceased } from "./familyOwnership.js";
import {
  approximateFraction,
  buildPropertyLedger,
  startingOwnershipIsUnset,
  startingOwnershipTotalPercent,
} from "./ownership.js";
import { saleTaxLot, vendorTaxSummary } from "./propertyTax.js";

const OWNERSHIP_EPSILON = 0.001;

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
  const startingOwnership = propertyStartingOwnershipStatus(property);
  const ownership = buildPropertyOwnership(people, property);
  const declarationOwners = Object.entries(ownership.ownershipByPerson).map(
    ([personId, share]) => ({
      id: personId,
      name: peopleById.get(personId)?.fullName || "Unnamed person",
      share,
    }),
  );
  const ledger = buildPropertyLedger(
    people,
    outsideParties,
    property.transfers || [],
    ownership.ownershipByPerson,
  );
  const coverage = declarationCoverage(declarationOwners, property.declarations || []);
  const saleRows = (property.saleLots || []).map((storedLot) => {
    const ownerIsCompany =
      ledger.parties.find((party) => party.id === storedLot.ownerId)?.type === "company";
    const lot = ownerIsCompany
      ? { ...storedLot, taxTreatment: "manual", selectedTaxMethod: "manual" }
      : storedLot;
    const declaredCoverage = coverage.find((item) => item.heirId === lot.ownerId);
    const usePublishedValues =
      lot.useDeclaredValues !== false && Boolean(declaredCoverage?.publishedCount);
    const declaredFraction = approximateFraction(declaredCoverage?.publishedFraction || 0);
    const effectiveLot = usePublishedValues
      ? {
          ...lot,
          acquisitionValue: declaredCoverage.publishedValue,
          shareNumerator: declaredFraction.numerator,
          shareDenominator: declaredFraction.denominator,
        }
      : lot;
    return {
      lot,
      effectiveLot,
      declaredCoverage,
      usePublishedValues,
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
    declarationOwners,
    ledger,
    coverage,
    saleRows,
    deceasedVendorIds,
    livingVendors,
    taxSummary,
  };
}
