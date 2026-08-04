import { declarationCoverage } from "./declarations.js";
import { causaMortisDeclaredShare, validateCausaMortisDeclaration } from "./causaMortisCoverage.js";
import { INHERITANCE_CAUSA_MORTIS_CUTOFF } from "./article5A.js";
import { buildPropertyOwnership, isPersonDeceased } from "./familyOwnership.js";
import { approximateFraction, buildPropertyLedger } from "./ownership.js";
import { deedTransferTotals, saleTaxLot, vendorTaxSummary } from "./propertyTax.js";
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

const exactShareFromRecord = (record = {}) => {
  const exact = normaliseFraction(record.shareNumerator, record.shareDenominator);
  return exact.error ? approximateFraction((Number(record.sharePercent) || 0) / 100) : exact;
};

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
    const exactAllocations = transmission.exactAllocations || new Map();
    allocationEntries(transmission.allocations).forEach(([ownerId, allocatedShare]) => {
      const allocationFraction =
        exactAllocations.get?.(ownerId) || approximateFraction(Number(allocatedShare) || 0);
      const shareFraction = multiplyFractions(
        transmission.amountFraction || approximateFraction(Number(transmission.amount) || 0),
        allocationFraction,
      );
      const share = fractionToNumber(shareFraction);
      if (shareFraction.error || compareFractions(shareFraction, ZERO_FRACTION) <= 0) return;
      const owner = peopleById.get(ownerId) || outsidePartiesById.get(ownerId);
      const rows = sources.get(ownerId) || [];
      rows.push({
        deceasedId: transmission.deceasedId,
        deceasedName: deceased?.fullName || "Unnamed deceased owner",
        ownerId,
        ownerName: owner?.fullName || owner?.name || "Unnamed heir",
        inheritanceDate,
        share,
        shareFraction,
        deceasedEstateShare: Number(transmission.amount) || 0,
        allocationShare: Number(allocatedShare) || 0,
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

const declarationAppliesToOwner = (declaration, ownerId) => {
  const declarantIds = (declaration.declarantPersonIds || []).filter(Boolean);
  return !declarantIds.length || declarantIds.includes(ownerId);
};

const matchingPersonDeclarations = (person, propertyId, ownerId) =>
  (person?.causaMortisDeclarations || []).filter(
    (declaration) =>
      (!propertyId || !declaration.propertyId || declaration.propertyId === propertyId) &&
      declarationAppliesToOwner(declaration, ownerId) &&
      validateCausaMortisDeclaration(declaration, { valueRequired: true }) === "",
  );

const declarationAllocationWeight = (declaration, source, inheritanceSourcesByOwner) => {
  const declarantIds = [...new Set((declaration.declarantPersonIds || []).filter(Boolean))];
  if (!declarantIds.length) return Number(source.allocationShare) || 0;

  const declaredRecipientShare = declarantIds.reduce((total, ownerId) => {
    const matchingSource = (inheritanceSourcesByOwner.get(ownerId) || []).find(
      (candidate) => candidate.deceasedId === source.deceasedId,
    );
    return total + (Number(matchingSource?.share) || 0);
  }, 0);
  if (!(declaredRecipientShare > 0)) return 0;
  return (Number(source.share) || 0) / declaredRecipientShare;
};

const declarationRowsForSource = (source, property, peopleById, inheritanceSourcesByOwner) => {
  const deceased = peopleById.get(source.deceasedId);
  return matchingPersonDeclarations(deceased, property.id, source.ownerId).map((declaration) => {
    const allocationWeight = declarationAllocationWeight(
      declaration,
      source,
      inheritanceSourcesByOwner,
    );
    return {
      id: declaration.id,
      date: declaration.date || "",
      notaryName: declaration.notaryName || "",
      declaredShare: causaMortisDeclaredShare(declaration) * allocationWeight,
      declaredValue:
        Math.max(0, Number(declaration.immovablePropertyValue) || 0) * allocationWeight,
    };
  });
};

const transferSourceForLot = (ledger, lot) =>
  [...(ledger.entries || [])]
    .reverse()
    .find((entry) => !entry.error && entry.buyerId === lot.ownerId);

const provenanceLabel = (source, lot, ledger) => {
  if (source) return `Inherited from ${source.deceasedName}`;
  const transfer = transferSourceForLot(ledger, lot);
  if (transfer) {
    const seller = ledger.parties.find((party) => party.id === transfer.sellerId);
    return `Acquired from ${seller?.name || "another owner"}`;
  }
  if ((lot.acquisitionType || "inheritance") === "inheritance") return "Inherited share";
  if (lot.acquisitionType === "donation") return "Share acquired by donation";
  return "Purchased or transferred share";
};

const displayRowFromLot = ({
  property,
  row,
  source,
  ledger,
  peopleById,
  inheritanceSourcesByOwner,
  fallbackShare = 0,
  deedTransferValue = 0,
}) => {
  const storedShare = Number(row.result?.share) || 0;
  const lotShare = storedShare > 0 ? storedShare : Number(fallbackShare) || 0;
  const propertySaleValue = Math.max(0, Number(property.saleValue) || 0);
  const attributedSaleValue =
    propertySaleValue && lotShare
      ? propertySaleValue * lotShare
      : Number(row.result?.transferValue) || 0;
  const declarations = source
    ? declarationRowsForSource(source, property, peopleById, inheritanceSourcesByOwner)
    : [];
  const declaredValueFromCards = declarations.reduce(
    (total, declaration) => total + declaration.declaredValue,
    0,
  );
  const acquisitionValue = declarations.length
    ? declaredValueFromCards
    : Math.max(0, Number(row.effectiveLot?.acquisitionValue) || 0);
  const normalisedLotFraction = lotShare !== storedShare ? approximateFraction(lotShare) : null;
  const effectiveLot = {
    ...row.effectiveLot,
    ...(normalisedLotFraction
      ? {
          shareNumerator: normalisedLotFraction.numerator,
          shareDenominator: normalisedLotFraction.denominator,
        }
      : {}),
    transferValue: attributedSaleValue,
    consideration: attributedSaleValue,
    acquisitionValue:
      acquisitionValue || row.effectiveLot?.acquisitionValue === 0 ? acquisitionValue : "",
    acquisitionValueBasis:
      acquisitionValue || declarations.length
        ? "cm-declared"
        : row.effectiveLot?.acquisitionValueBasis || "",
    cmValueEligibilityConfirmed:
      declarations.length > 0 || Boolean(row.effectiveLot?.cmValueEligibilityConfirmed),
  };
  const result = saleTaxLot(effectiveLot, { deedTransferValue });
  const selectedMethod = result.methods.find((method) => method.key === result.selected) || null;
  const tax = selectedMethod?.tax || 0;
  return {
    id: row.lot.id,
    share: lotShare,
    shareFraction: normaliseFraction(effectiveLot.shareNumerator, effectiveLot.shareDenominator),
    provenance: provenanceLabel(source, row.lot, ledger),
    provenancePersonId: source?.deceasedId || "",
    inheritanceDate: source?.inheritanceDate || result.acquisitionDate || "",
    declarations,
    declaredValue: acquisitionValue,
    attributedSaleValue,
    difference: attributedSaleValue - acquisitionValue,
    methods: result.methods || [],
    selectedMethod,
    tax,
    net: attributedSaleValue - tax,
    warning: result.warning || "",
  };
};

const syntheticInheritedRow = ({
  property,
  vendor,
  source,
  index,
  peopleById,
  inheritanceSourcesByOwner,
  deedTransferValue = 0,
}) => {
  const declarations = declarationRowsForSource(
    source,
    property,
    peopleById,
    inheritanceSourcesByOwner,
  );
  const declaredValue = declarations.reduce(
    (total, declaration) => total + declaration.declaredValue,
    0,
  );
  const attributedSaleValue = Math.max(0, Number(property.saleValue) || 0) * source.share;
  const fraction = source.shareFraction || approximateFraction(source.share);
  const result = saleTaxLot(
    {
      id: `${vendor.id}-${source.deceasedId}-${index}`,
      ownerId: vendor.id,
      acquisitionType: "inheritance",
      inheritanceDate: source.inheritanceDate,
      transferDate: property.saleDate || new Date().toISOString().slice(0, 10),
      shareNumerator: fraction.numerator,
      shareDenominator: fraction.denominator,
      acquisitionValue: declarations.length ? declaredValue : "",
      acquisitionValueBasis: declarations.length ? "cm-declared" : "",
      cmValueEligibilityConfirmed: declarations.length > 0,
      transferValue: attributedSaleValue,
      consideration: attributedSaleValue,
    },
    { deedTransferValue },
  );
  const selectedMethod = result.methods.find((method) => method.key === result.selected) || null;
  const tax = selectedMethod?.tax || 0;
  return {
    id: `${vendor.id}-${source.deceasedId}-${index}`,
    share: source.share,
    shareFraction: source.shareFraction,
    provenance: `Inherited from ${source.deceasedName}`,
    provenancePersonId: source.deceasedId,
    inheritanceDate: source.inheritanceDate,
    declarations,
    declaredValue,
    attributedSaleValue,
    difference: attributedSaleValue - declaredValue,
    methods: result.methods || [],
    selectedMethod,
    tax,
    net: attributedSaleValue - tax,
    warning: result.warning || "",
  };
};

/** Read-only vendor information used by the Tax Calculation screen and export. */
export function buildTaxCalculationReport(
  property = {},
  people = [],
  outsideParties = [],
  vendorReport,
) {
  const report = vendorReport || buildPropertyVendorTaxReport(property, people, outsideParties);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const vendors = report.livingVendors.map((vendor) => {
    const storedRows = report.saleRows.filter((row) => row.lot.ownerId === vendor.id);
    const inheritanceSources = report.inheritanceSourcesByOwner.get(vendor.id) || [];
    // The vendor's whole transfer value on this deed. Value-banded reliefs draw on the band in
    // proportion to each row, so every row of one vendor must share this figure.
    const deedTransferValue = Math.max(0, Number(property.saleValue) || 0) * vendor.share;
    const rows = storedRows.length
      ? storedRows.map((row) => {
          const source =
            row.selectedInheritanceSource ||
            inheritanceSources.find(
              (candidate) => candidate.deceasedId === row.lot.inheritanceSourceDeceasedId,
            ) ||
            (inheritanceSources.length === 1 ? inheritanceSources[0] : null);
          return displayRowFromLot({
            property,
            row,
            source,
            ledger: report.ledger,
            peopleById,
            inheritanceSourcesByOwner: report.inheritanceSourcesByOwner,
            fallbackShare: storedRows.length === 1 ? vendor.share : 0,
            deedTransferValue,
          });
        })
      : inheritanceSources.map((source, index) =>
          syntheticInheritedRow({
            property,
            vendor,
            source,
            index,
            peopleById,
            inheritanceSourcesByOwner: report.inheritanceSourcesByOwner,
            deedTransferValue,
          }),
        );
    const coveredFraction = rows.reduce(
      (total, row) => addFractions(total, row.shareFraction || approximateFraction(row.share)),
      ZERO_FRACTION,
    );
    const vendorFraction = vendor.shareFraction || approximateFraction(vendor.share);
    const missingFraction = subtractFractions(vendorFraction, coveredFraction);
    if (!missingFraction.error && compareFractions(missingFraction, ZERO_FRACTION) > 0) {
      const share = fractionToNumber(missingFraction);
      const attributedSaleValue = Math.max(0, Number(property.saleValue) || 0) * share;
      rows.push({
        id: `${vendor.id}-unresolved`,
        share,
        shareFraction: missingFraction,
        provenance: report.ledger.entries.some(
          (entry) => !entry.error && entry.buyerId === vendor.id,
        )
          ? "Transferred share — acquisition details incomplete"
          : "Initial ownership — acquisition details incomplete",
        inheritanceDate: "",
        declarations: [],
        declaredValue: 0,
        attributedSaleValue,
        difference: attributedSaleValue,
        methods: [],
        selectedMethod: null,
        tax: null,
        net: null,
        warning: "The acquisition date and value are needed before tax can be calculated.",
      });
    }
    const propertySaleValue = Math.max(0, Number(property.saleValue) || 0);
    const attributedSaleValue = propertySaleValue
      ? propertySaleValue * vendor.share
      : rows.reduce((total, row) => total + row.attributedSaleValue, 0);
    const incompleteRowCount = rows.filter((row) => !row.selectedMethod).length;
    const tax = incompleteRowCount
      ? null
      : rows.reduce((total, row) => total + Number(row.tax || 0), 0);
    return {
      ...vendor,
      rows,
      attributedSaleValue,
      tax,
      net: tax === null ? null : attributedSaleValue - tax,
      incompleteRowCount,
    };
  });
  const totalsComplete = vendors.every((vendor) => vendor.incompleteRowCount === 0);
  return {
    vendors,
    totalSaleValue: vendors.reduce((total, vendor) => total + vendor.attributedSaleValue, 0),
    totalTax: totalsComplete
      ? vendors.reduce((total, vendor) => total + Number(vendor.tax || 0), 0)
      : null,
    totalNet: totalsComplete
      ? vendors.reduce((total, vendor) => total + Number(vendor.net || 0), 0)
      : null,
    totalsComplete,
    excludedLotCount: report.taxSummary.excludedLotCount,
  };
}

export function propertyStartingOwnershipStatus(property = {}) {
  const ownerRows = property.owners || [];
  const owners = ownerRows.filter((owner) => owner?.personId);
  const unassignedOwners = ownerRows.filter((owner) => {
    if (owner?.personId) return false;
    const share = exactShareFromRecord(owner);
    return !share.error && compareFractions(share, ZERO_FRACTION) > 0;
  });
  const isUnset = !owners.some((owner) => {
    const share = exactShareFromRecord(owner);
    return !share.error && compareFractions(share, ZERO_FRACTION) > 0;
  });
  const totalFraction = owners.reduce(
    (total, owner) => addFractions(total, exactShareFromRecord(owner)),
    ZERO_FRACTION,
  );
  const enteredTotalFraction = ownerRows.reduce(
    (total, owner) => addFractions(total, exactShareFromRecord(owner)),
    ZERO_FRACTION,
  );
  const unassignedFraction = unassignedOwners.reduce(
    (total, owner) => addFractions(total, exactShareFromRecord(owner)),
    ZERO_FRACTION,
  );
  const totalPercent = fractionToNumber(totalFraction) * 100;
  return {
    isUnset,
    totalPercent,
    totalFraction,
    enteredTotalPercent: fractionToNumber(enteredTotalFraction) * 100,
    enteredTotalFraction,
    unassignedFraction,
    missingOwnerCount: unassignedOwners.length,
    hasUnassignedOwners: unassignedOwners.length > 0,
    isComplete:
      !isUnset &&
      !unassignedOwners.length &&
      !totalFraction.error &&
      compareFractions(totalFraction, WHOLE_FRACTION) === 0,
  };
}

export function remainingInitialOwnershipShare(owners = [], excludedOwnerId = "") {
  const allocated = owners
    .filter((owner) => owner?.personId && owner.id !== excludedOwnerId)
    .reduce((total, owner) => addFractions(total, exactShareFromRecord(owner)), ZERO_FRACTION);
  const remaining = subtractFractions(WHOLE_FRACTION, allocated);
  if (remaining.error || compareFractions(remaining, ZERO_FRACTION) <= 0) {
    return {
      shareNumerator: 0,
      shareDenominator: 1,
      sharePercent: 0,
      sharePercentInput: undefined,
    };
  }
  return {
    shareNumerator: remaining.numerator,
    shareDenominator: remaining.denominator,
    sharePercent: fractionToNumber(remaining) * 100,
    sharePercentInput: undefined,
  };
}

export function assignInitialOwnerPerson(owners = [], ownerId = "", personId = "") {
  return owners.map((owner) => {
    if (owner.id !== ownerId) return owner;
    if (!personId) return { ...owner, personId };

    const currentShare = exactShareFromRecord(owner);
    const sharePatch =
      !currentShare.error && compareFractions(currentShare, ZERO_FRACTION) > 0
        ? {}
        : remainingInitialOwnershipShare(owners, ownerId);
    return { ...owner, ...sharePatch, personId };
  });
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
      shareFraction: ownership.ownershipFractionsByPerson?.[personId],
    }),
  );
  const ledger = buildPropertyLedger(
    people,
    outsideParties,
    property.transfers || [],
    ownership.ownershipFractionsByPerson || ownership.ownershipByPerson,
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
  const saleRowsWithoutTax = (property.saleLots || []).map((storedLot) => {
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
    const hasUsableDeclaredValues =
      declaredCoverage?.hasUsableDeclaredValues ??
      Boolean(declaredCoverage?.hasUsablePublishedValues);
    const useDeclarationValues =
      !preCausaMortisCutoff && lot.useDeclaredValues !== false && Boolean(hasUsableDeclaredValues);
    const declaredFraction = approximateFraction(
      declaredCoverage?.declaredFraction ?? declaredCoverage?.publishedFraction ?? 0,
    );
    const effectiveLot = useDeclarationValues
      ? {
          ...sourcedLot,
          acquisitionValue: declaredCoverage.declaredValue ?? declaredCoverage.publishedValue,
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
      useDeclarationValues,
      // Compatibility alias for callers saved before DCM status was removed.
      usePublishedValues: useDeclarationValues,
      inheritanceSources,
      selectedInheritanceSource,
      inheritanceDateInferred: Boolean(sourceDate),
      preCausaMortisCutoff,
    };
  });
  // Assessed in a second pass: a value-banded relief needs the vendor's whole transfer value,
  // which is only known once every effective lot has been resolved.
  const deedTotals = deedTransferTotals(
    saleRowsWithoutTax.map((row) => ({
      ...row.effectiveLot,
      ownerId: row.lot.ownerId,
    })),
  );
  const saleRows = saleRowsWithoutTax.map((row) => ({
    ...row,
    result: saleTaxLot(row.effectiveLot, {
      deedTransferValue: deedTotals.get(row.lot.ownerId) || 0,
    }),
  }));
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
