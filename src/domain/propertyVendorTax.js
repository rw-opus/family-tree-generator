import { declarationCoverage } from "./declarations.js";
import { buildPropertyOwnership, isPersonDeceased } from "./familyOwnership.js";
import { approximateFraction, buildPropertyLedger } from "./ownership.js";
import { saleTaxLot, vendorTaxSummary } from "./propertyTax.js";

export function buildPropertyVendorTaxReport(property = {}, people = [], outsideParties = []) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
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
