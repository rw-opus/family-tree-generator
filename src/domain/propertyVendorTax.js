import { declarationAssessmentFactor, declarationCoverage } from "./declarations.js";
import {
  allocateCausaMortisDeclaration,
  isCompletedCausaMortisDeclaration,
  validateCausaMortisDeclaration,
} from "./causaMortisCoverage.js";
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

  const consolidated = new Map();
  sources.forEach((rows, ownerId) => {
    const byDeceased = new Map();
    rows.forEach((row) => {
      const existing = byDeceased.get(row.deceasedId);
      if (!existing) {
        byDeceased.set(row.deceasedId, row);
        return;
      }
      const shareFraction = addFractions(existing.shareFraction, row.shareFraction);
      if (shareFraction.error) return;
      const deceasedEstateShare = existing.deceasedEstateShare + row.deceasedEstateShare;
      const share = fractionToNumber(shareFraction);
      byDeceased.set(row.deceasedId, {
        ...existing,
        share,
        shareFraction,
        deceasedEstateShare,
        allocationShare: deceasedEstateShare > 0 ? share / deceasedEstateShare : 0,
        immediateDescendant: existing.immediateDescendant || row.immediateDescendant,
      });
    });
    consolidated.set(ownerId, [...byDeceased.values()]);
  });
  return consolidated;
}

/**
 * Where a share arrived by donation, Article 5A looks through to the date the donor had
 * acquired it. Both facts are already recorded — the donation is a transfer in the ledger and
 * the donor's own acquisition is either a transmission or an earlier transfer — so the date is
 * derived rather than keyed. Only one level is followed, matching the statutory look-through;
 * a donor who was himself donated the share inside five years still needs manual review.
 */
function donorAcquisitionDate(
  donorId,
  inheritanceSourcesByOwner,
  ledger,
  beforeDate = "",
  designatedDates = [],
) {
  const exactDesignatedDates = [...new Set(designatedDates.filter(Boolean))];
  if (exactDesignatedDates.length) {
    return exactDesignatedDates.length === 1 ? exactDesignatedDates[0] : "";
  }
  const inherited = (inheritanceSourcesByOwner.get(donorId) || [])
    .map((source) => source.inheritanceDate)
    .filter(Boolean);
  const uniqueInherited = [...new Set(inherited)];
  const acquired = (ledger.entries || [])
    .filter(
      (entry) =>
        !entry.error &&
        entry.buyerId === donorId &&
        /^\d{4}-\d{2}-\d{2}$/.test(String(entry.date || "")) &&
        (!beforeDate || entry.date <= beforeDate),
    )
    .map((entry) => entry.date);
  const candidates = [...new Set([...uniqueInherited, ...acquired])];
  // A single unambiguous acquisition can be relied upon; anything else is left for the notary.
  return candidates.length === 1 ? candidates[0] : "";
}

/** Donations received by each owner, with the donor's preceding acquisition date resolved. */
export function buildDonationSourcesByOwner(
  ledger = {},
  peopleById = new Map(),
  outsidePartiesById = new Map(),
  inheritanceSourcesByOwner = new Map(),
) {
  const sources = new Map();
  (ledger.entries || []).forEach((entry) => {
    if (entry.error || entry.kind !== "donation" || !entry.buyerId) return;
    const donor = peopleById.get(entry.sellerId) || outsidePartiesById.get(entry.sellerId);
    const rows = sources.get(entry.buyerId) || [];
    const designatedSources = (entry.provenance || [])
      .map((portion) => ({
        sourceTrancheId: portion.trancheId || "",
        acquiredOn: portion.acquiredOn || "",
        shareFraction: normaliseFraction(portion.numerator, portion.denominator),
      }))
      .filter(
        (portion) =>
          !portion.shareFraction.error &&
          compareFractions(portion.shareFraction, ZERO_FRACTION) > 0,
      );
    const sourceParts = designatedSources.length
      ? designatedSources
      : [
          {
            sourceTrancheId: "",
            acquiredOn: "",
            shareFraction: entry.amountFraction || approximateFraction(entry.amount),
          },
        ];
    sourceParts.forEach((sourcePart) => {
      rows.push({
        transferId: entry.id,
        sourceTrancheId: sourcePart.sourceTrancheId,
        donorId: entry.sellerId,
        donorName: donor?.fullName || donor?.name || "another owner",
        donationDate: entry.date || "",
        shareFraction: sourcePart.shareFraction,
        share: fractionToNumber(sourcePart.shareFraction),
        donorAcquisitionDate: donorAcquisitionDate(
          entry.sellerId,
          inheritanceSourcesByOwner,
          ledger,
          entry.date || "",
          sourcePart.acquiredOn ? [sourcePart.acquiredOn] : [],
        ),
      });
    });
    sources.set(entry.buyerId, rows);
  });
  return sources;
}

const declarationAppliesToOwner = (declaration, ownerId) => {
  const declarantIds = [...new Set((declaration.declarantPersonIds || []).filter(Boolean))];
  return Boolean(ownerId) && declarantIds.includes(ownerId);
};

const completedPersonDeclarations = (person, propertyId) =>
  (person?.causaMortisDeclarations || []).filter(
    (declaration) =>
      isCompletedCausaMortisDeclaration(declaration) &&
      (!propertyId || !declaration.propertyId || declaration.propertyId === propertyId) &&
      validateCausaMortisDeclaration(declaration, {
        valueRequired: true,
        dateOfDeath: person?.dateOfDeath || "",
      }) === "",
  );

const matchingPersonDeclarations = (person, propertyId, ownerId) =>
  completedPersonDeclarations(person, propertyId).filter((declaration) =>
    declarationAppliesToOwner(declaration, ownerId),
  );

const declarationAllocationForSource = (declaration, source, inheritanceSourcesByOwner) => {
  const declarantIds = [...new Set((declaration.declarantPersonIds || []).filter(Boolean))];
  const requiredFractionsByDeclarant = new Map();
  declarantIds.forEach((ownerId) => {
    const inheritedFraction = (inheritanceSourcesByOwner.get(ownerId) || [])
      .filter((candidate) => candidate.deceasedId === source.deceasedId)
      .reduce(
        (total, candidate) =>
          addFractions(
            total,
            candidate.shareFraction || approximateFraction(Number(candidate.share) || 0),
          ),
        ZERO_FRACTION,
      );
    if (!inheritedFraction.error && compareFractions(inheritedFraction, ZERO_FRACTION) > 0) {
      requiredFractionsByDeclarant.set(ownerId, inheritedFraction);
    }
  });
  const allocation = allocateCausaMortisDeclaration(
    declaration,
    requiredFractionsByDeclarant,
  ).allocations.find((item) => item.personId === source.ownerId);
  if (!allocation || compareFractions(allocation.declaredFraction, ZERO_FRACTION) <= 0) {
    return null;
  }
  return allocation;
};

const declarationRowsForSource = (
  source,
  property,
  peopleById,
  inheritanceSourcesByOwner,
  requiredShareFraction = null,
) => {
  const deceased = peopleById.get(source.deceasedId);
  const recordedRows = matchingPersonDeclarations(deceased, property.id, source.ownerId)
    .map((declaration) => {
      const allocation = declarationAllocationForSource(
        declaration,
        source,
        inheritanceSourcesByOwner,
      );
      if (!allocation) return null;
      return {
        id: declaration.id,
        date: declaration.date || "",
        notaryName: declaration.notaryName || "",
        declaredShare: allocation.declaredShare,
        declaredShareFraction: allocation.declaredFraction,
        declaredValue: allocation.declaredValue,
      };
    })
    .filter(Boolean);
  const recordedFraction = recordedRows.reduce(
    (total, row) => addFractions(total, row.declaredShareFraction),
    ZERO_FRACTION,
  );
  const requiredFraction =
    requiredShareFraction?.denominator !== undefined
      ? requiredShareFraction
      : source.shareFraction || approximateFraction(Number(source.share) || 0);
  const assessment = declarationAssessmentFactor(recordedFraction, requiredFraction);

  return recordedRows
    .map((row) => {
      const assessedFraction = multiplyFractions(row.declaredShareFraction, assessment.fraction);
      const usableAssessedFraction = assessedFraction.error
        ? approximateFraction(row.declaredShare * assessment.value)
        : assessedFraction;
      return {
        ...row,
        recordedDeclaredShare: row.declaredShare,
        recordedDeclaredShareFraction: row.declaredShareFraction,
        recordedDeclaredValue: row.declaredValue,
        declaredShare: fractionToNumber(usableAssessedFraction),
        declaredShareFraction: usableAssessedFraction,
        declaredValue: row.declaredValue * assessment.value,
        assessmentFactor: assessment.value,
      };
    })
    .filter(
      (row) =>
        !row.declaredShareFraction.error &&
        compareFractions(row.declaredShareFraction, ZERO_FRACTION) > 0,
    );
};

const sourceHasCompletedPersonDeclarations = (source, property, peopleById) => {
  if (!source) return false;
  const deceased = peopleById.get(source.deceasedId);
  return completedPersonDeclarations(deceased, property.id).length > 0;
};

const transferSourceForLot = (ledger, lot) =>
  [...(ledger.entries || [])]
    .reverse()
    .find((entry) => !entry.error && entry.buyerId === lot.ownerId);

export const provenanceLabel = (source, lot, ledger) => {
  if (source) return `Inherited from ${source.deceasedName}`;
  const transfer = transferSourceForLot(ledger, lot);
  if (transfer) {
    const seller = ledger.parties.find((party) => party.id === transfer.sellerId);
    const sellerName = seller?.name || "another owner";
    return transfer.kind === "donation"
      ? `Donated by ${sellerName}`
      : `Acquired from ${sellerName}`;
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
  declarationRequiredFraction = null,
}) => {
  const storedShare = Number(row.result?.share) || 0;
  const lotShare = storedShare > 0 ? storedShare : Number(fallbackShare) || 0;
  const propertySaleValue = Math.max(0, Number(property.saleValue) || 0);
  const attributedSaleValue =
    propertySaleValue && lotShare
      ? propertySaleValue * lotShare
      : Number(row.result?.transferValue) || 0;
  const declarations = source
    ? declarationRowsForSource(
        source,
        property,
        peopleById,
        inheritanceSourcesByOwner,
        declarationRequiredFraction,
      )
    : [];
  const declaredValueFromCards = declarations.reduce(
    (total, declaration) => total + declaration.declaredValue,
    0,
  );
  const hasModernDeclarationsForSource = sourceHasCompletedPersonDeclarations(
    source,
    property,
    peopleById,
  );
  const hasUsableLegacyDeclaration = Boolean(
    row.useDeclarationValues && row.declaredCoverage?.hasUsableDeclaredValues,
  );
  const storedBasisIsCausaMortis =
    row.effectiveLot?.acquisitionValueBasis === "cm-declared" ||
    row.lot?.acquisitionValueBasis === "cm-declared";
  const suppressNonDeclarantStoredValue = Boolean(
    source &&
    hasModernDeclarationsForSource &&
    !declarations.length &&
    !hasUsableLegacyDeclaration &&
    storedBasisIsCausaMortis,
  );
  const hasStoredAcquisitionValue =
    row.effectiveLot?.acquisitionValue !== "" &&
    row.effectiveLot?.acquisitionValue !== null &&
    row.effectiveLot?.acquisitionValue !== undefined &&
    Number.isFinite(Number(row.effectiveLot.acquisitionValue));
  const acquisitionValue = declarations.length
    ? declaredValueFromCards
    : suppressNonDeclarantStoredValue
      ? ""
      : hasStoredAcquisitionValue
        ? Math.max(0, Number(row.effectiveLot.acquisitionValue))
        : "";
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
    acquisitionValue: acquisitionValue !== "" ? acquisitionValue : "",
    acquisitionValueBasis: declarations.length
      ? "cm-declared"
      : suppressNonDeclarantStoredValue
        ? ""
        : acquisitionValue !== ""
          ? row.effectiveLot?.acquisitionValueBasis || "cm-declared"
          : row.effectiveLot?.acquisitionValueBasis || "",
    cmValueEligibilityConfirmed:
      declarations.length > 0 ||
      (!suppressNonDeclarantStoredValue && Boolean(row.effectiveLot?.cmValueEligibilityConfirmed)),
  };
  const result = saleTaxLot(effectiveLot, { deedTransferValue });
  const selectedMethod = result.methods.find((method) => method.key === result.selected) || null;
  const tax = selectedMethod?.tax || 0;
  return {
    id: row.lot.id,
    share: lotShare,
    shareFraction: normaliseFraction(effectiveLot.shareNumerator, effectiveLot.shareDenominator),
    provenance: row.selectedDonationSource
      ? `Donated by ${row.selectedDonationSource.donorName}`
      : provenanceLabel(source, row.lot, ledger),
    provenancePersonId: source?.deceasedId || row.selectedDonationSource?.donorId || "",
    inheritanceDate: source?.inheritanceDate || result.acquisitionDate || "",
    donorAcquisitionDate: row.selectedDonationSource?.donorAcquisitionDate || "",
    donorAcquisitionDateDerived: Boolean(row.donationDatesDerived),
    declarations,
    declaredValue: acquisitionValue === "" ? 0 : acquisitionValue,
    attributedSaleValue,
    difference: attributedSaleValue - (acquisitionValue === "" ? 0 : acquisitionValue),
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

const saleRowShareFraction = (row, fallbackShare = 0) => {
  const recordedFraction = exactShareFromRecord(row.lot);
  if (!recordedFraction.error && compareFractions(recordedFraction, ZERO_FRACTION) > 0) {
    return recordedFraction;
  }
  return approximateFraction(Number(row.result?.share) || Number(fallbackShare) || 0);
};

const smallestFraction = (...fractions) => {
  if (
    !fractions.length ||
    fractions.some((fraction) => !Number.isFinite(compareFractions(fraction, ZERO_FRACTION)))
  ) {
    return ZERO_FRACTION;
  }
  return fractions.reduce((smallest, fraction) =>
    compareFractions(fraction, smallest) < 0 ? fraction : smallest,
  );
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
    const resolvedStoredRows = storedRows.map((row) => {
      const source =
        row.selectedInheritanceSource ||
        inheritanceSources.find(
          (candidate) => candidate.deceasedId === row.lot.inheritanceSourceDeceasedId,
        ) ||
        (inheritanceSources.length === 1 ? inheritanceSources[0] : null);
      const fallbackShare = storedRows.length === 1 ? vendor.share : 0;
      return {
        row,
        source,
        fallbackShare,
        shareFraction: saleRowShareFraction(row, fallbackShare),
      };
    });
    const storedRowsBySource = new Map();
    resolvedStoredRows.forEach((item) => {
      if (!item.source) return;
      const sourceKey = item.source.deceasedId || item.source;
      const sourceRows = storedRowsBySource.get(sourceKey) || [];
      sourceRows.push(item);
      storedRowsBySource.set(sourceKey, sourceRows);
    });
    // A CM deed does not identify which later tax lot consumed each part of its fraction. Allocate
    // the usable CM fraction pro rata across rows sharing the same inheritance source. The pool is
    // capped by the recorded deed, the inherited source and the rows actually being assessed, so
    // split rows can neither duplicate an under-declaration nor revive an over-declaration.
    const declarationShareByRow = new Map();
    storedRowsBySource.forEach((sourceRows) => {
      const source = sourceRows[0].source;
      const requestedFraction = sourceRows.reduce(
        (total, item) => addFractions(total, item.shareFraction),
        ZERO_FRACTION,
      );
      const recordedDeclarations = declarationRowsForSource(
        source,
        property,
        peopleById,
        report.inheritanceSourcesByOwner,
      );
      const recordedFraction = recordedDeclarations.reduce(
        (total, declaration) =>
          addFractions(
            total,
            declaration.recordedDeclaredShareFraction || declaration.declaredShareFraction,
          ),
        ZERO_FRACTION,
      );
      const sourceFraction = source.shareFraction || approximateFraction(Number(source.share) || 0);
      const assessableFraction = smallestFraction(
        requestedFraction,
        recordedFraction,
        sourceFraction,
      );
      const assessment = declarationAssessmentFactor(requestedFraction, assessableFraction);
      sourceRows.forEach((item) => {
        const assessedFraction = multiplyFractions(item.shareFraction, assessment.fraction);
        declarationShareByRow.set(
          item.row,
          assessedFraction.error ? ZERO_FRACTION : assessedFraction,
        );
      });
    });
    const rows = storedRows.length
      ? resolvedStoredRows.map(({ row, source, fallbackShare }) => {
          return displayRowFromLot({
            property,
            row,
            source,
            ledger: report.ledger,
            peopleById,
            inheritanceSourcesByOwner: report.inheritanceSourcesByOwner,
            fallbackShare,
            deedTransferValue,
            declarationRequiredFraction: source
              ? declarationShareByRow.get(row) || ZERO_FRACTION
              : null,
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

/**
 * Lists one owner's acquisitions of the property — initial ownership, each inheritance and
 * each incoming transfer — as tranches. When a partial transfer is recorded while more than
 * one of these exists, the deed must designate which provenance is being sold; the tranche
 * list is what that designation chooses from.
 */
export function ownerProvenanceTranches(report = {}, property = {}, ownerId = "") {
  if (!ownerId) return [];
  const calculatedTranches = report.ownership?.tranchesByOwner?.get?.(ownerId) || [];
  if (calculatedTranches.length) {
    return calculatedTranches.map((tranche) => ({
      trancheId: tranche.trancheId,
      personId: ownerId,
      fraction: tranche.fraction,
      acquiredOn: tranche.acquiredOn || "",
      previousAcquiredOn: tranche.previousAcquiredOn || "",
      upstreamTrancheId: tranche.upstreamTrancheId || "",
      cause: tranche.cause || "",
      provenance: tranche.provenance || "",
    }));
  }
  const tranches = [];
  (property.owners || []).forEach((owner) => {
    if (owner?.personId !== ownerId) return;
    const share = exactShareFromRecord(owner);
    if (share.error || compareFractions(share, ZERO_FRACTION) <= 0) return;
    tranches.push({
      trancheId: `initial-${owner.id || ownerId}`,
      personId: ownerId,
      fraction: share,
      acquiredOn: "",
      cause: "initial",
      provenance: "Initial ownership",
    });
  });
  (report.inheritanceSourcesByOwner?.get?.(ownerId) || []).forEach((source) => {
    if (!source.shareFraction || source.shareFraction.error) return;
    tranches.push({
      trancheId: `inheritance-${source.deceasedId}`,
      personId: ownerId,
      fraction: source.shareFraction,
      acquiredOn: source.inheritanceDate || "",
      cause: "inheritance",
      provenance: `Inherited from ${source.deceasedName}`,
    });
  });
  (report.ledger?.entries || []).forEach((entry) => {
    if (entry.error || entry.buyerId !== ownerId || !entry.amountFraction) return;
    const seller = (report.ledger.parties || []).find((party) => party.id === entry.sellerId);
    const sellerName = seller?.name || "another owner";
    tranches.push({
      trancheId: `transfer-${entry.id}`,
      personId: ownerId,
      fraction: entry.amountFraction,
      acquiredOn: entry.date || "",
      cause: entry.kind === "donation" ? "donation" : "purchase",
      provenance:
        entry.kind === "donation" ? `Donated by ${sellerName}` : `Acquired from ${sellerName}`,
    });
  });

  // The ownership trace can surface the same acquisition row twice. Suppress only an exact
  // duplicate: separate provenance fractions must remain separate and their values must never
  // be added merely because the view received the same row more than once.
  const seenTranches = new Set();
  const uniqueTranches = [];
  tranches.forEach((tranche) => {
    const fingerprint = JSON.stringify([
      tranche.trancheId,
      tranche.fraction.numerator,
      tranche.fraction.denominator,
      tranche.acquiredOn,
      tranche.cause,
      tranche.provenance,
    ]);
    if (seenTranches.has(fingerprint)) return;
    seenTranches.add(fingerprint);
    uniqueTranches.push(tranche);
  });

  // Earlier outgoing transfers that recorded their provenance consume it here, so once a
  // first sale exhausts an acquisition, a later transfer no longer offers it — and with one
  // acquisition left the provenance question answers itself. Legacy transfers recorded
  // without provenance leave the list untouched.
  const consumed = new Map();
  (property.transfers || []).forEach((transfer) => {
    if (transfer.sellerId !== ownerId) return;
    (transfer.provenance || []).forEach((portion) => {
      const fraction = normaliseFraction(portion.numerator, portion.denominator);
      if (fraction.error) return;
      const running = addFractions(consumed.get(portion.trancheId) || ZERO_FRACTION, fraction);
      if (!running.error) consumed.set(portion.trancheId, running);
    });
  });
  return uniqueTranches
    .map((tranche) => {
      const taken = consumed.get(tranche.trancheId);
      if (!taken) return tranche;
      const left = subtractFractions(tranche.fraction, taken);
      if (left.error || compareFractions(left, ZERO_FRACTION) <= 0) return null;
      return { ...tranche, fraction: left };
    })
    .filter(Boolean);
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
  const ledger =
    ownership.ledger ||
    buildPropertyLedger(
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
  const donationSourcesByOwner = buildDonationSourcesByOwner(
    ledger,
    peopleById,
    outsidePartiesById,
    inheritanceSourcesByOwner,
  );
  const expandedSaleLots = (property.saleLots || []).flatMap((storedLot) => {
    const inheritanceSources = inheritanceSourcesByOwner.get(storedLot.ownerId) || [];
    const donationSources = donationSourcesByOwner.get(storedLot.ownerId) || [];
    if (
      donationSources.length < 2 ||
      inheritanceSources.length ||
      (storedLot.acquisitionType && storedLot.acquisitionType !== "donation")
    ) {
      return [storedLot];
    }
    const lotFraction = exactShareFromRecord(storedLot);
    const sourceTotal = donationSources.reduce(
      (total, source) => addFractions(total, source.shareFraction),
      ZERO_FRACTION,
    );
    if (
      lotFraction.error ||
      sourceTotal.error ||
      compareFractions(lotFraction, sourceTotal) !== 0
    ) {
      return [storedLot];
    }
    const lotShare = fractionToNumber(lotFraction);
    return donationSources.map((source, index) => {
      const weight = lotShare > 0 ? source.share / lotShare : 0;
      return {
        ...storedLot,
        id: `${storedLot.id}:donation:${source.transferId}:${source.sourceTrancheId || index}`,
        shareNumerator: source.shareFraction.numerator,
        shareDenominator: source.shareFraction.denominator,
        transferValue: (Number(storedLot.transferValue) || 0) * weight,
        acquisitionValue: (Number(storedLot.acquisitionValue) || 0) * weight,
        donationSourceKey: `${source.transferId}:${source.sourceTrancheId}`,
      };
    });
  });
  const saleRowsWithoutTax = expandedSaleLots.map((storedLot) => {
    const lot = storedLot;
    const inheritanceSources = inheritanceSourcesByOwner.get(lot.ownerId) || [];
    const donationSources = donationSourcesByOwner.get(lot.ownerId) || [];
    const selectedInheritanceSource = lot.inheritanceSourceDeceasedId
      ? inheritanceSources.find((source) => source.deceasedId === lot.inheritanceSourceDeceasedId)
      : inheritanceSources.length === 1
        ? inheritanceSources[0]
        : null;
    const sourceDate = selectedInheritanceSource?.inheritanceDate || "";
    // A lot is treated as donated when it says so, or when the only way this owner holds the
    // property is a single recorded donation. Anything more mixed is left to the notary.
    const selectedDonationSource = lot.donationSourceKey
      ? donationSources.find(
          (source) => `${source.transferId}:${source.sourceTrancheId}` === lot.donationSourceKey,
        ) || null
      : donationSources.length === 1 &&
          ((lot.acquisitionType === "donation" && !inheritanceSources.length) ||
            (!lot.acquisitionType && !inheritanceSources.length))
        ? donationSources[0]
        : null;
    const donationPatch = selectedDonationSource
      ? {
          acquisitionType: "donation",
          acquisitionDate: lot.acquisitionDate || selectedDonationSource.donationDate,
          previousAcquisitionDate:
            lot.previousAcquisitionDate || selectedDonationSource.donorAcquisitionDate,
        }
      : {};
    const donationDatesDerived = Boolean(
      selectedDonationSource &&
      !lot.previousAcquisitionDate &&
      selectedDonationSource.donorAcquisitionDate,
    );
    const sourcedLot =
      (lot.acquisitionType || "inheritance") === "inheritance" && sourceDate
        ? { ...lot, inheritanceDate: sourceDate }
        : { ...lot, ...donationPatch };
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
    const declaredFraction =
      declaredCoverage?.exactDeclaredFraction ||
      approximateFraction(
        declaredCoverage?.declaredFraction ?? declaredCoverage?.publishedFraction ?? 0,
      );
    const requiredDeclaredFraction =
      declaredCoverage?.exactRequiredFraction || exactShareFromRecord(sourcedLot);
    const declarationAssessment = declarationAssessmentFactor(
      declaredFraction,
      requiredDeclaredFraction,
    );
    const assessedDeclaredFraction = multiplyFractions(
      declaredFraction,
      declarationAssessment.fraction,
    );
    const recordedDeclaredValue =
      declaredCoverage?.declaredValue ?? declaredCoverage?.publishedValue ?? 0;
    const assessedDeclaredValue = recordedDeclaredValue * declarationAssessment.value;
    const effectiveLot = useDeclarationValues
      ? {
          ...sourcedLot,
          acquisitionValue: assessedDeclaredValue,
          acquisitionValueBasis: lot.acquisitionValueBasis || "cm-declared",
          shareNumerator: assessedDeclaredFraction.numerator,
          shareDenominator: assessedDeclaredFraction.denominator,
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
      assessedDeclaredFraction,
      assessedDeclaredValue,
      declarationAssessmentFactor: declarationAssessment.value,
      useDeclarationValues,
      // Compatibility alias for callers saved before DCM status was removed.
      usePublishedValues: useDeclarationValues,
      inheritanceSources,
      selectedInheritanceSource,
      inheritanceDateInferred: Boolean(sourceDate),
      donationSources,
      selectedDonationSource,
      donationDatesDerived,
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
    donationSourcesByOwner,
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
