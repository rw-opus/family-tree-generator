import { declarationAssessmentFactor, declarationCoverage } from "./declarations.js";
import {
  allocateCausaMortisDeclaration,
  isCompletedCausaMortisDeclaration,
  validateCausaMortisDeclaration,
} from "./causaMortisCoverage.js";
import { INHERITANCE_CAUSA_MORTIS_CUTOFF } from "./article5A.js";
import { buildPropertyOwnership, isPersonDeceased } from "./familyOwnership.js";
import { approximateFraction, buildPropertyLedger } from "./ownership.js";
import { allocateMoney, roundMoney, sumMoney } from "./money.js";
import { deedTransferTotals, saleTaxLot, vendorTaxSummary } from "./propertyTax.js";
import {
  addFractions,
  compareFractions,
  divideFractions,
  fractionToNumber,
  multiplyFractions,
  normaliseFraction,
  subtractFractions,
  WHOLE_FRACTION,
  ZERO_FRACTION,
} from "./fractions.js";

export const DONATION_ACQUISITION_VALUE_BASES = Object.freeze([
  "market-at-donation",
  "deed-value",
  "final-assessment",
]);

const optionalMoney = (input) => {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const value = Number(input);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

// Article 5A uses the higher of the recorded consideration and market value. A stored tax row's
// `result.transferValue` already applies that rule, while the raw fields remain useful to
// distinguish a genuinely recorded zero from a row that has no deed value at all.
const recordedArticle5ATransferValue = (row = {}) => {
  const lot = row.effectiveLot || row.lot || {};
  const recordedValues = [lot.consideration, lot.marketValue, lot.transferValue]
    .map(optionalMoney)
    .filter((value) => value !== null);
  if (!recordedValues.length) return null;
  return optionalMoney(row.result?.transferValue) ?? Math.max(...recordedValues);
};

const hasFiniteRecordedNumber = (input) =>
  input !== null &&
  input !== undefined &&
  String(input).trim() !== "" &&
  Number.isFinite(Number(input));

const hasRecordedNonNegativeNumber = (input) =>
  hasFiniteRecordedNumber(input) && Number(input) >= 0;

const sourceRowIsCalculated = (row = {}) =>
  Boolean(row.selectedMethod) &&
  optionalMoney(row.attributedSaleValue) !== null &&
  optionalMoney(row.tax) !== null &&
  hasFiniteRecordedNumber(row.net);

const sourceCalculationSummary = (rows = []) => {
  const calculatedRows = rows.filter(sourceRowIsCalculated);
  const unassessedRows = rows.filter((row) => !sourceRowIsCalculated(row));
  const knownUnassessedValues = unassessedRows.map((row) => optionalMoney(row.attributedSaleValue));
  return {
    completeSourceCount: calculatedRows.length,
    incompleteSourceCount: unassessedRows.length,
    calculatedSaleValueSubtotal: calculatedRows.reduce(
      (total, row) => total + Number(row.attributedSaleValue),
      0,
    ),
    calculatedTaxSubtotal: calculatedRows.reduce((total, row) => total + Number(row.tax), 0),
    calculatedNetSubtotal: calculatedRows.reduce((total, row) => total + Number(row.net), 0),
    unassessedSaleValue: knownUnassessedValues.every((value) => value !== null)
      ? knownUnassessedValues.reduce((total, value) => total + value, 0)
      : null,
  };
};

/**
 * Puts every money figure a user can read onto a whole cent, and makes each
 * total the sum of the rounded parts beneath it.
 *
 * Attributing the selling price by multiplying it by each share leaves parts
 * that do not add back to the whole once they are shown to the cent: three
 * heirs to a third of EUR 1,000,000 each read EUR 333,333.33, and the column
 * totals EUR 999,999.99. Thirds, sixths and sevenths are ordinary in Maltese
 * succession, so the price is instead split across the source rows by largest
 * remainder, and every subtotal is re-derived from those rounded rows.
 */
function reconcileVendorMoney(vendors = [], propertySaleValue = null) {
  const attributableRows = vendors.flatMap((vendor) =>
    vendor.rows.filter((row) => row.attributedSaleValue !== null),
  );
  // The vendors on a deed need not cover the whole property: a deceased owner's
  // share can sit outside this sale. Only the covered portion of the price is
  // shared out, so a partial sale is never inflated to the full selling price.
  const shares = attributableRows.map((row) => Number(row.share) || 0);
  const coveredShare = shares.reduce((total, share) => total + share, 0);
  const allocations =
    propertySaleValue === null
      ? null
      : allocateMoney(roundMoney(propertySaleValue * coveredShare), shares);
  const allocationByRow = new Map();
  if (allocations) {
    attributableRows.forEach((row, index) => allocationByRow.set(row, allocations[index]));
  }

  const roundedMethod = (method) =>
    method
      ? {
          ...method,
          basis: roundMoney(method.basis) ?? method.basis,
          tax: roundMoney(method.tax) ?? method.tax,
        }
      : method;

  return vendors.map((vendor) => {
    const rows = vendor.rows.map((row) => {
      const attributedSaleValue = allocationByRow.has(row)
        ? allocationByRow.get(row)
        : roundMoney(row.attributedSaleValue);
      const tax = row.tax === null || row.tax === undefined ? row.tax : roundMoney(row.tax);
      return {
        ...row,
        attributedSaleValue,
        difference: row.difference === null ? null : roundMoney(row.difference),
        methods: (row.methods || []).map((method) => roundedMethod(method)),
        selectedMethod: roundedMethod(row.selectedMethod),
        tax,
        net:
          tax === null || tax === undefined || attributedSaleValue === null
            ? null
            : sumMoney([attributedSaleValue, -tax]),
      };
    });

    const summary = sourceCalculationSummary(rows);
    const attributedSaleValue = rows.every((row) => row.attributedSaleValue === null)
      ? null
      : sumMoney(rows.map((row) => row.attributedSaleValue));
    const tax = summary.incompleteSourceCount ? null : sumMoney(rows.map((row) => row.tax));
    return {
      ...vendor,
      rows,
      attributedSaleValue,
      tax,
      net:
        tax === null || attributedSaleValue === null ? null : sumMoney([attributedSaleValue, -tax]),
      ...summary,
      incompleteRowCount: summary.incompleteSourceCount,
    };
  });
}

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
        hasDeclaredValue: allocation.hasDeclaredValue,
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
        declaredValue: row.hasDeclaredValue ? row.declaredValue * assessment.value : "",
        hasDeclaredValue: row.hasDeclaredValue,
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
  matchedTranches = [],
  ledger,
  peopleById,
  inheritanceSourcesByOwner,
  fallbackShare = 0,
  deedTransferValue = 0,
  declarationRequiredFraction = null,
  shareFractionOverride = null,
  coverageWarning = "",
  acquisitionDateOverride,
}) => {
  const storedShare = Number(row.result?.share) || 0;
  const hasShareOverride = Boolean(shareFractionOverride && !shareFractionOverride.error);
  const lotShare = hasShareOverride
    ? fractionToNumber(shareFractionOverride)
    : storedShare > 0
      ? storedShare
      : Number(fallbackShare) || 0;
  const propertySaleValue = optionalMoney(property.saleValue);
  const storedTransferValue =
    optionalMoney(row.effectiveLot?.consideration) ??
    optionalMoney(row.effectiveLot?.transferValue);
  const attributedSaleValue =
    propertySaleValue === null ? storedTransferValue : propertySaleValue * lotShare;
  const matchedInheritanceTranches = matchedTranches.filter(
    (tranche) => tranche.cause === "inheritance",
  );
  const matchedInheritanceIds = [
    ...new Set(
      matchedInheritanceTranches
        .map((tranche) =>
          String(tranche.trancheId || "").startsWith("inheritance-")
            ? String(tranche.trancheId).slice("inheritance-".length)
            : "",
        )
        .filter(Boolean),
    ),
  ];
  const matchedInheritanceSource =
    !source &&
    matchedInheritanceTranches.length === matchedTranches.length &&
    matchedInheritanceIds.length === 1
      ? (inheritanceSourcesByOwner.get(row.lot.ownerId) || []).find(
          (candidate) => candidate.deceasedId === matchedInheritanceIds[0],
        ) || null
      : null;
  const inheritanceSource = source || matchedInheritanceSource;
  const matchedInheritanceFraction = matchedInheritanceTranches.reduce(
    (total, tranche) => addFractions(total, tranche.fraction),
    ZERO_FRACTION,
  );
  const declarations = inheritanceSource
    ? declarationRowsForSource(
        inheritanceSource,
        property,
        peopleById,
        inheritanceSourcesByOwner,
        declarationRequiredFraction ||
          (positiveFraction(matchedInheritanceFraction) ? matchedInheritanceFraction : null),
      )
    : [];
  const declarationsHaveCompleteValues =
    declarations.length > 0 && declarations.every((declaration) => declaration.hasDeclaredValue);
  const declaredValueFromCards = declarationsHaveCompleteValues
    ? declarations.reduce((total, declaration) => total + declaration.declaredValue, 0)
    : "";
  const hasModernDeclarationsForSource = sourceHasCompletedPersonDeclarations(
    inheritanceSource,
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
    inheritanceSource &&
    hasModernDeclarationsForSource &&
    !declarations.length &&
    !hasUsableLegacyDeclaration &&
    storedBasisIsCausaMortis,
  );
  const hasStoredAcquisitionValue =
    row.effectiveLot?.acquisitionValue !== "" &&
    row.effectiveLot?.acquisitionValue !== null &&
    row.effectiveLot?.acquisitionValue !== undefined &&
    Number.isFinite(Number(row.effectiveLot.acquisitionValue)) &&
    Number(row.effectiveLot.acquisitionValue) >= 0;
  const acquisitionValue = declarations.length
    ? declaredValueFromCards
    : suppressNonDeclarantStoredValue
      ? ""
      : hasStoredAcquisitionValue
        ? Number(row.effectiveLot.acquisitionValue)
        : "";
  const normalisedLotFraction = hasShareOverride
    ? shareFractionOverride
    : lotShare !== storedShare
      ? approximateFraction(lotShare)
      : null;
  const matchedInitialTranche = matchedTranches.find((tranche) => tranche.cause === "initial");
  const matchedPurchaseTranches = matchedTranches.filter((tranche) => tranche.cause === "purchase");
  const matchedPurchaseTranche = matchedPurchaseTranches[0];
  const matchedDonationTranches = matchedTranches.filter((tranche) => tranche.cause === "donation");
  const matchedDonationTranche = matchedDonationTranches[0];
  const matchedDonationIsSingleSource = Boolean(
    matchedDonationTranche &&
    matchedDonationTranches.length === matchedTranches.length &&
    new Set(
      matchedDonationTranches.map(
        (tranche) =>
          tranche.sourceTransferId || transferRootId(tranche.trancheId).slice("transfer-".length),
      ),
    ).size === 1,
  );
  const donationSource =
    row.selectedDonationSource ||
    (matchedDonationIsSingleSource
      ? {
          transferId:
            matchedDonationTranche.sourceTransferId ||
            transferRootId(matchedDonationTranche.trancheId).slice("transfer-".length),
          donorId: matchedDonationTranche.previousOwnerId || "",
          donorName: matchedDonationTranche.previousOwnerName || "another owner",
          donationDate: matchedDonationTranche.acquiredOn || "",
          donorAcquisitionDate: matchedDonationTranche.previousAcquiredOn || "",
        }
      : null);
  const isInitialSource = Boolean(
    !inheritanceSource &&
    !donationSource &&
    matchedInitialTranche &&
    matchedTranches.every((tranche) => tranche.cause === "initial"),
  );
  const isPurchaseSource = Boolean(
    !inheritanceSource &&
    !donationSource &&
    matchedPurchaseTranche &&
    matchedTranches.every((tranche) => tranche.cause === "purchase"),
  );
  const hasCanonicalDonationSource = Boolean(donationSource && matchedDonationTranches.length);
  const matchedDonorAcquisitionDates = [
    ...new Set(
      matchedDonationTranches.map((tranche) => tranche.previousAcquiredOn).filter(Boolean),
    ),
  ];
  const donorAcquisitionDate =
    matchedDonorAcquisitionDates.length === 1
      ? matchedDonorAcquisitionDates[0]
      : donationSource?.donorAcquisitionDate || "";
  const matchedDonationAllocations = matchedDonationTranches.map((tranche) => {
    if (!hasRecordedNonNegativeNumber(tranche.acquisitionValue)) return null;
    const originalTransferredFraction = tranche.originalTransferredFraction || tranche.fraction;
    const allocation = divideFractions(tranche.fraction, originalTransferredFraction);
    if (allocation.error) return null;
    return Number(tranche.acquisitionValue) * fractionToNumber(allocation);
  });
  const matchedDonationValue =
    matchedDonationAllocations.length &&
    matchedDonationAllocations.every((allocation) => allocation !== null)
      ? matchedDonationAllocations.reduce((total, allocation) => total + allocation, 0)
      : null;
  const effectiveAcquisitionValue = hasCanonicalDonationSource
    ? (matchedDonationValue ?? "")
    : acquisitionValue;
  const effectiveLot = {
    ...row.effectiveLot,
    ...(normalisedLotFraction
      ? {
          shareNumerator: normalisedLotFraction.numerator,
          shareDenominator: normalisedLotFraction.denominator,
        }
      : {}),
    ...(acquisitionDateOverride !== undefined ? { acquisitionDate: acquisitionDateOverride } : {}),
    ...(donationSource
      ? {
          acquisitionType: "donation",
          previousAcquisitionDate: donorAcquisitionDate,
        }
      : {}),
    ...(inheritanceSource
      ? {
          acquisitionType: "inheritance",
          inheritanceDate: inheritanceSource.inheritanceDate || "",
        }
      : {}),
    ...(isInitialSource || isPurchaseSource
      ? {
          acquisitionType: "purchase",
          inheritanceDate: "",
        }
      : {}),
    transferValue: attributedSaleValue ?? "",
    consideration: attributedSaleValue ?? "",
    acquisitionValue: effectiveAcquisitionValue !== "" ? effectiveAcquisitionValue : "",
    acquisitionValueBasis: declarationsHaveCompleteValues
      ? "cm-declared"
      : suppressNonDeclarantStoredValue
        ? ""
        : effectiveAcquisitionValue !== ""
          ? donationSource
            ? hasCanonicalDonationSource
              ? matchedDonationTranche?.acquisitionValueBasis || ""
              : row.effectiveLot?.acquisitionValueBasis || ""
            : row.effectiveLot?.acquisitionValueBasis || "cm-declared"
          : hasCanonicalDonationSource
            ? ""
            : row.effectiveLot?.acquisitionValueBasis || "",
    cmValueEligibilityConfirmed:
      declarationsHaveCompleteValues ||
      (!suppressNonDeclarantStoredValue && Boolean(row.effectiveLot?.cmValueEligibilityConfirmed)),
  };
  const result = saleTaxLot(effectiveLot, { deedTransferValue });
  const calculatedMethod = result.methods.find((method) => method.key === result.selected) || null;
  const selectedMethod = coverageWarning ? null : calculatedMethod;
  const tax = selectedMethod ? selectedMethod.tax : null;
  const donationWarning = coverageWarning || result.warning || "";
  return {
    id: row.lot.id,
    share: lotShare,
    shareFraction: normaliseFraction(effectiveLot.shareNumerator, effectiveLot.shareDenominator),
    provenance: isInitialSource
      ? "Initial ownership"
      : donationSource
        ? `Donated by ${donationSource.donorName}`
        : isPurchaseSource
          ? matchedPurchaseTranche.provenance || "Purchased share"
          : provenanceLabel(inheritanceSource, row.lot, ledger),
    provenancePersonId:
      inheritanceSource?.deceasedId ||
      donationSource?.donorId ||
      matchedPurchaseTranche?.previousOwnerId ||
      "",
    provenancePersonName:
      inheritanceSource?.deceasedName ||
      donationSource?.donorName ||
      matchedPurchaseTranche?.previousOwnerName ||
      "",
    provenancePersonDeceased: Boolean(
      (donationSource?.donorId && isPersonDeceased(peopleById.get(donationSource.donorId))) ||
      (isPurchaseSource && matchedPurchaseTranche?.previousOwnerDeceased),
    ),
    sourceKind: inheritanceSource
      ? "inheritance"
      : donationSource
        ? "donation"
        : isInitialSource
          ? "initial"
          : isPurchaseSource
            ? "purchase"
            : "direct",
    sourceTransferId:
      donationSource?.transferId ||
      (isPurchaseSource
        ? matchedPurchaseTranche.sourceTransferId ||
          transferRootId(matchedPurchaseTranche.trancheId).slice(9)
        : ""),
    originalOwnerId: isInitialSource ? row.lot.ownerId : "",
    originalOwnerRecordId: isInitialSource
      ? matchedInitialTranche.ownerRecordId || ""
      : donationSource
        ? matchedDonationTranche?.previousOwnerRecordId || ""
        : "",
    acquisitionDate: result.acquisitionDate || "",
    inheritanceDate: inheritanceSource?.inheritanceDate || "",
    donorAcquisitionDate,
    donorAcquisitionDateDerived: Boolean(row.donationDatesDerived),
    declarations,
    declaredValue: effectiveAcquisitionValue,
    attributedSaleValue,
    difference:
      attributedSaleValue === null || effectiveAcquisitionValue === ""
        ? null
        : attributedSaleValue - effectiveAcquisitionValue,
    methods: result.methods || [],
    selectedMethod,
    tax,
    net: tax === null || attributedSaleValue === null ? null : attributedSaleValue - tax,
    warning: donationWarning,
    requiresOriginalAcquisitionDate:
      isInitialSource && Boolean(result.sourceRequirements?.acquisitionDate),
    requiresDonationAcquisitionValue:
      Boolean(donationSource) && Boolean(result.sourceRequirements?.donationAcquisitionValue),
    requiresDonationDateCorrection:
      Boolean(donationSource) && Boolean(result.sourceRequirements?.acquisitionDate),
    requiresDonorAcquisitionDate:
      Boolean(donationSource) && Boolean(result.sourceRequirements?.donorAcquisitionDate),
    requiresCausaMortisAcquisitionValue:
      !declarationsHaveCompleteValues &&
      Boolean(result.sourceRequirements?.causaMortisAcquisitionValue),
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
    (total, declaration) => total + (declaration.hasDeclaredValue ? declaration.declaredValue : 0),
    0,
  );
  const declarationsHaveCompleteValues =
    declarations.length > 0 && declarations.every((declaration) => declaration.hasDeclaredValue);
  const propertySaleValue = optionalMoney(property.saleValue);
  const attributedSaleValue = propertySaleValue === null ? null : propertySaleValue * source.share;
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
      acquisitionValue: declarationsHaveCompleteValues ? declaredValue : "",
      acquisitionValueBasis: declarationsHaveCompleteValues ? "cm-declared" : "",
      cmValueEligibilityConfirmed: declarationsHaveCompleteValues,
      transferValue: attributedSaleValue ?? "",
      consideration: attributedSaleValue ?? "",
    },
    { deedTransferValue },
  );
  const selectedMethod = result.methods.find((method) => method.key === result.selected) || null;
  const tax = selectedMethod?.tax ?? null;
  return {
    id: `${vendor.id}-${source.deceasedId}-${index}`,
    share: source.share,
    shareFraction: source.shareFraction,
    provenance: `Inherited from ${source.deceasedName}`,
    provenancePersonId: source.deceasedId,
    provenancePersonName: source.deceasedName,
    sourceKind: "inheritance",
    acquisitionType: "inheritance",
    inheritanceDate: source.inheritanceDate,
    declarations,
    declaredValue: declarationsHaveCompleteValues ? declaredValue : "",
    attributedSaleValue,
    difference:
      attributedSaleValue === null || !declarationsHaveCompleteValues
        ? null
        : attributedSaleValue - declaredValue,
    methods: result.methods || [],
    selectedMethod,
    tax,
    net: tax === null || attributedSaleValue === null ? null : attributedSaleValue - tax,
    warning: result.warning || "",
    requiresCausaMortisAcquisitionValue:
      !declarationsHaveCompleteValues &&
      Boolean(result.sourceRequirements?.causaMortisAcquisitionValue),
  };
};

const syntheticInitialOwnerRow = ({ property, vendor, tranche, index, deedTransferValue = 0 }) => {
  const shareFraction = tranche.fraction || ZERO_FRACTION;
  const share = fractionToNumber(shareFraction);
  const propertySaleValue = optionalMoney(property.saleValue);
  const attributedSaleValue = propertySaleValue === null ? null : propertySaleValue * share;
  const acquisitionDate = String(tranche.acquiredOn || "");
  const result = saleTaxLot(
    {
      id: `${vendor.id}-initial-${index}`,
      ownerId: vendor.id,
      acquisitionType: "purchase",
      acquisitionDate,
      transferDate: property.saleDate || new Date().toISOString().slice(0, 10),
      shareNumerator: shareFraction.numerator,
      shareDenominator: shareFraction.denominator,
      transferValue: attributedSaleValue ?? "",
      consideration: attributedSaleValue ?? "",
    },
    { deedTransferValue },
  );
  const selectedMethod = result.methods.find((method) => method.key === result.selected) || null;
  const tax = selectedMethod?.tax ?? null;
  return {
    id: `${vendor.id}-initial-${index}`,
    share,
    shareFraction,
    provenance: "Initial ownership",
    provenancePersonId: "",
    sourceKind: "initial",
    acquisitionType: "purchase",
    acquisitionDate,
    originalOwnerId: vendor.id,
    originalOwnerRecordId: tranche.ownerRecordId || "",
    requiresOriginalAcquisitionDate: Boolean(result.sourceRequirements?.acquisitionDate),
    inheritanceDate: "",
    declarations: [],
    declaredValue: "",
    attributedSaleValue,
    difference: null,
    methods: result.methods || [],
    selectedMethod,
    tax,
    net: tax === null || attributedSaleValue === null ? null : attributedSaleValue - tax,
    warning: result.warning || "",
  };
};

const syntheticTransferredRow = ({ property, vendor, tranche, index, deedTransferValue = 0 }) => {
  const shareFraction = tranche.fraction || ZERO_FRACTION;
  const share = fractionToNumber(shareFraction);
  const propertySaleValue = optionalMoney(property.saleValue);
  const attributedSaleValue = propertySaleValue === null ? null : propertySaleValue * share;
  const isDonation = tranche.cause === "donation";
  const acquisitionDate = String(tranche.acquiredOn || "");
  const donorAcquisitionDate = isDonation ? String(tranche.previousAcquiredOn || "") : "";
  const originalTransferredFraction = tranche.originalTransferredFraction || shareFraction;
  const valueAllocation = divideFractions(shareFraction, originalTransferredFraction);
  const donationAcquisitionValue =
    isDonation && hasRecordedNonNegativeNumber(tranche.acquisitionValue) && !valueAllocation.error
      ? Number(tranche.acquisitionValue) * fractionToNumber(valueAllocation)
      : "";
  const result = saleTaxLot(
    {
      id: `${vendor.id}-transfer-${index}`,
      ownerId: vendor.id,
      acquisitionType: isDonation ? "donation" : "purchase",
      acquisitionDate,
      previousAcquisitionDate: donorAcquisitionDate,
      acquisitionValue: donationAcquisitionValue,
      acquisitionValueBasis: isDonation ? tranche.acquisitionValueBasis || "" : "",
      transferDate: property.saleDate || new Date().toISOString().slice(0, 10),
      shareNumerator: shareFraction.numerator,
      shareDenominator: shareFraction.denominator,
      transferValue: attributedSaleValue ?? "",
      consideration: attributedSaleValue ?? "",
    },
    { deedTransferValue },
  );
  const selectedMethod = result.methods.find((method) => method.key === result.selected) || null;
  const tax = selectedMethod?.tax ?? null;
  return {
    id: `${vendor.id}-transfer-${index}`,
    share,
    shareFraction,
    provenance: tranche.provenance || (isDonation ? "Donated share" : "Purchased share"),
    provenancePersonId: tranche.previousOwnerId || "",
    provenancePersonName: tranche.previousOwnerName || "",
    provenancePersonDeceased: Boolean(tranche.previousOwnerDeceased),
    sourceKind: isDonation ? "donation" : "purchase",
    sourceTransferId: tranche.sourceTransferId || transferRootId(tranche.trancheId).slice(9),
    originalOwnerRecordId: isDonation ? tranche.previousOwnerRecordId || "" : "",
    acquisitionType: isDonation ? "donation" : "purchase",
    acquisitionDate,
    donorAcquisitionDate,
    donorAcquisitionDateDerived: Boolean(donorAcquisitionDate),
    inheritanceDate: "",
    declarations: [],
    declaredValue: donationAcquisitionValue,
    attributedSaleValue,
    difference:
      attributedSaleValue === null || donationAcquisitionValue === ""
        ? null
        : attributedSaleValue - donationAcquisitionValue,
    methods: result.methods || [],
    selectedMethod,
    tax,
    net: tax === null || attributedSaleValue === null ? null : attributedSaleValue - tax,
    warning: result.warning || "",
    requiresDonationAcquisitionValue:
      isDonation && Boolean(result.sourceRequirements?.donationAcquisitionValue),
    requiresDonationDateCorrection:
      isDonation && Boolean(result.sourceRequirements?.acquisitionDate),
    requiresDonorAcquisitionDate:
      isDonation && Boolean(result.sourceRequirements?.donorAcquisitionDate),
  };
};

const saleRowShareFraction = (row, fallbackShare = 0) => {
  const lot = row.lot || {};
  const hasRecordedFraction =
    String(lot.shareNumerator ?? "").trim() !== "" ||
    String(lot.shareDenominator ?? "").trim() !== "";
  if (hasRecordedFraction) {
    // An explicitly recorded zero, negative or malformed fraction is not a
    // legacy omission. Preserve it so allocation can fail closed instead of
    // silently replacing it with the vendor's whole current share.
    return normaliseFraction(lot.shareNumerator, lot.shareDenominator);
  }
  if (String(lot.sharePercent ?? "").trim() !== "") {
    return approximateFraction(Number(lot.sharePercent) / 100);
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

const positiveFraction = (fraction) =>
  fraction && !fraction.error && compareFractions(fraction, ZERO_FRACTION) > 0;

const transferRootId = (trancheId = "") => String(trancheId).split(":")[0];

const candidateTranchesForStoredRow = (item, tranches) => {
  const { row, source } = item;
  const lot = row.lot || {};
  const acquisitionType = String(lot.acquisitionType || "");
  if (item.invalidExplicitInheritanceSource || item.invalidExplicitDonationSource) return [];
  // Inheritance and donation rows may use deed values and dates that belong to a
  // specific person/transfer. Never consume a current tranche unless that
  // canonical source was resolved first; a date-only match is not enough to
  // justify using stale stored tax inputs.
  if (acquisitionType === "inheritance" && !source) return [];
  if (acquisitionType === "donation" && !row.selectedDonationSource) return [];
  if (source) {
    return tranches.filter(
      (tranche) =>
        tranche.cause === "inheritance" && tranche.trancheId === `inheritance-${source.deceasedId}`,
    );
  }
  if (row.selectedDonationSource) {
    const transferId = `transfer-${row.selectedDonationSource.transferId}`;
    const sourceTrancheId = String(row.selectedDonationSource.sourceTrancheId || "");
    return tranches.filter(
      (tranche) =>
        tranche.cause === "donation" &&
        transferRootId(tranche.trancheId) === transferId &&
        (!sourceTrancheId ||
          tranche.upstreamTrancheId === sourceTrancheId ||
          tranche.trancheId === `${transferId}:${sourceTrancheId}`),
    );
  }

  const acquisitionDate = String(lot.acquisitionDate || lot.inheritanceDate || "");
  if (acquisitionType === "inheritance") {
    return tranches.filter(
      (tranche) =>
        tranche.cause === "inheritance" &&
        (!acquisitionDate || tranche.acquiredOn === acquisitionDate),
    );
  }
  if (acquisitionType === "donation") {
    const donations = tranches.filter((tranche) => tranche.cause === "donation");
    const datedDonations = donations.filter(
      (tranche) => !acquisitionDate || tranche.acquiredOn === acquisitionDate,
    );
    return datedDonations.length ? datedDonations : donations;
  }
  if (acquisitionType && acquisitionType !== "inheritance") {
    const purchaseLike = tranches.filter((tranche) =>
      ["initial", "purchase"].includes(tranche.cause),
    );
    const datedPurchaseLike = purchaseLike.filter(
      (tranche) => !acquisitionDate || tranche.acquiredOn === acquisitionDate,
    );
    return datedPurchaseLike.length ? datedPurchaseLike : purchaseLike;
  }
  const dated = tranches.filter(
    (tranche) => !acquisitionDate || tranche.acquiredOn === acquisitionDate,
  );
  return dated.length ? dated : tranches;
};

const candidatesIdentifyOneSource = (item, candidates) => {
  if (!candidates.length) return false;
  if (item.source || item.row.selectedDonationSource) return true;
  const identities = new Set(
    candidates.map((tranche) => {
      if (tranche.cause === "inheritance") return tranche.trancheId;
      if (["purchase", "donation"].includes(tranche.cause)) {
        return transferRootId(tranche.trancheId);
      }
      return tranche.ownerRecordId || tranche.trancheId;
    }),
  );
  return identities.size === 1;
};

/**
 * Legacy sale lots and calculated ownership tranches can coexist. Consume a stored lot only from
 * a provenance source it identifies unambiguously. When a legacy row cannot identify one source,
 * retain it in storage but ignore it for assessment: the current title tranches are authoritative
 * and can produce actionable, source-specific rows without double-counting the legacy cache.
 */
const fractionText = (fraction) =>
  positiveFraction(fraction) ? `${fraction.numerator}/${fraction.denominator}` : "0/1";

const allocateStoredRowCoverage = (currentTranches, resolvedStoredRows) => {
  if (!currentTranches.length) {
    return { residualTranches: [], storedRows: resolvedStoredRows, ignoredRows: [] };
  }
  const residual = new Map(currentTranches.map((tranche) => [tranche.trancheId, { ...tranche }]));
  const storedRowsWithCoverage = [];
  const ignoredRows = [];

  resolvedStoredRows.forEach((item) => {
    const requested = item.shareFraction;
    if (!positiveFraction(requested)) {
      ignoredRows.push({
        ...item,
        reason:
          "This legacy tax lot is not being used because it does not record a valid positive ownership fraction.",
      });
      return;
    }
    const candidates = candidateTranchesForStoredRow(item, [...residual.values()]).filter(
      (tranche) => positiveFraction(tranche.fraction),
    );
    const sourceIsUnambiguous = candidatesIdentifyOneSource(item, candidates);
    if (!sourceIsUnambiguous) {
      ignoredRows.push({
        ...item,
        reason:
          "This legacy tax lot is not being used because it cannot be matched to one current ownership source.",
      });
      return;
    }
    const matchedDonationUpstreams = new Set(
      candidates
        .filter((tranche) => tranche.cause === "donation")
        .map(
          (tranche) =>
            tranche.upstreamTrancheId ||
            tranche.previousOwnerRecordId ||
            `${tranche.previousOwnerId || ""}:${tranche.previousAcquiredOn || ""}`,
        ),
    );
    if (
      candidates.length > 1 &&
      candidates.every((tranche) => tranche.cause === "donation") &&
      matchedDonationUpstreams.size > 1
    ) {
      ignoredRows.push({
        ...item,
        reason:
          "This legacy tax lot is not being used because it combines donation fractions with different preceding acquisitions. The current ownership sources are assessed separately.",
      });
      return;
    }

    let remaining = requested;
    let assessedFraction = ZERO_FRACTION;
    const consumedTranches = [];
    for (const candidate of candidates) {
      if (!positiveFraction(remaining)) break;
      const consumed =
        compareFractions(candidate.fraction, remaining) <= 0 ? candidate.fraction : remaining;
      assessedFraction = addFractions(assessedFraction, consumed);
      consumedTranches.push({ ...candidate, fraction: consumed });
      const left = subtractFractions(candidate.fraction, consumed);
      remaining = subtractFractions(remaining, consumed);
      if (!positiveFraction(left)) residual.delete(candidate.trancheId);
      else residual.set(candidate.trancheId, { ...candidate, fraction: left });
    }
    const fractionExceedsOwnership = compareFractions(requested, assessedFraction) > 0;
    storedRowsWithCoverage.push({
      ...item,
      matchedTranches: consumedTranches,
      shareFraction: assessedFraction,
      acquisitionDateOverride: (() => {
        const dates = [
          ...new Set(consumedTranches.map((candidate) => candidate.acquiredOn).filter(Boolean)),
        ];
        return dates.length === 1 ? dates[0] : "";
      })(),
      coverageWarning: fractionExceedsOwnership
        ? `This stored tax lot records ${fractionText(requested)}, but only ${fractionText(assessedFraction)} is supported by the current ownership provenance. Correct the stored tax-lot fraction.`
        : "",
    });
  });

  return {
    residualTranches: [...residual.values()].filter((tranche) =>
      positiveFraction(tranche.fraction),
    ),
    storedRows: storedRowsWithCoverage,
    ignoredRows,
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
  const assessedVendors = report.livingVendors.map((vendor) => {
    const storedRows = report.saleRows.filter((row) => row.lot.ownerId === vendor.id);
    const inheritanceSources = report.inheritanceSourcesByOwner.get(vendor.id) || [];
    const currentTranches = report.ownership?.tranchesByOwner?.get?.(vendor.id) || [];
    // The vendor's whole transfer value on this deed. Value-banded reliefs draw on the band in
    // proportion to each row, so every row of one vendor must share this figure.
    const propertySaleValue = optionalMoney(property.saleValue);
    const resolvedStoredRows = storedRows.map((row) => {
      const acquisitionType =
        row.effectiveLot?.acquisitionType || row.lot.acquisitionType || "inheritance";
      const explicitlyInheritanceTyped =
        row.effectiveLot?.acquisitionType === "inheritance" ||
        row.lot.acquisitionType === "inheritance";
      const explicitInheritanceSourceId = String(row.lot.inheritanceSourceDeceasedId || "").trim();
      const source =
        acquisitionType === "inheritance"
          ? row.selectedInheritanceSource ||
            (explicitInheritanceSourceId
              ? inheritanceSources.find(
                  (candidate) => candidate.deceasedId === explicitInheritanceSourceId,
                ) || null
              : explicitlyInheritanceTyped && inheritanceSources.length === 1
                ? inheritanceSources[0]
                : null)
          : null;
      const fallbackShare = storedRows.length === 1 ? vendor.share : 0;
      return {
        row,
        source,
        invalidExplicitInheritanceSource: Boolean(
          acquisitionType === "inheritance" && explicitInheritanceSourceId && !source,
        ),
        invalidExplicitDonationSource: Boolean(
          acquisitionType === "donation" &&
          row.lot.donationSourceKey &&
          !row.selectedDonationSource,
        ),
        fallbackShare,
        shareFraction: saleRowShareFraction(row, fallbackShare),
      };
    });
    const storedCoverage = allocateStoredRowCoverage(currentTranches, resolvedStoredRows);
    const residualTranches = storedCoverage.residualTranches;
    const assessedStoredRows = storedCoverage.storedRows;
    const assessedStoredDeedValues = assessedStoredRows.map(({ row, shareFraction }) => {
      const recordedTransferValue = recordedArticle5ATransferValue(row);
      const attributedPropertyValue =
        propertySaleValue !== null ? propertySaleValue * fractionToNumber(shareFraction) : null;
      if (attributedPropertyValue === null) return recordedTransferValue;
      // With a property selling price, displayRowFromLot uses that allocated amount as the
      // consideration for each fraction and retains only an independently recorded market value
      // as a possible statutory override. A legacy transferValue must not inflate the shared deed
      // band after the row itself has been recalculated from the current selling price.
      const recordedMarketValue = optionalMoney(row.effectiveLot?.marketValue);
      return Math.max(attributedPropertyValue, recordedMarketValue ?? 0);
    });
    const residualDeedValues = residualTranches.map((tranche) =>
      propertySaleValue !== null ? propertySaleValue * fractionToNumber(tranche.fraction) : null,
    );
    const assessedDeedValues = [...assessedStoredDeedValues, ...residualDeedValues];
    const deedTransferValue =
      assessedDeedValues.length && assessedDeedValues.every((value) => value !== null)
        ? assessedDeedValues.reduce((total, value) => total + value, 0)
        : propertySaleValue !== null
          ? propertySaleValue * vendor.share
          : 0;
    const storedRowsBySource = new Map();
    assessedStoredRows.forEach((item) => {
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
    const currentInheritanceFractions = new Map(
      residualTranches
        .filter((tranche) => tranche.cause === "inheritance")
        .map((tranche) => [tranche.trancheId, tranche.fraction]),
    );
    const currentInheritanceSources = inheritanceSources
      .map((source) => {
        const currentFraction = currentInheritanceFractions.get(`inheritance-${source.deceasedId}`);
        if (!currentFraction) return currentTranches.length || storedRows.length ? null : source;
        return {
          ...source,
          shareFraction: currentFraction,
          share: fractionToNumber(currentFraction),
        };
      })
      .filter(Boolean);
    const currentInitialTranches = residualTranches.filter(
      (tranche) => tranche.cause === "initial",
    );
    const currentTransferTranches = residualTranches.filter((tranche) =>
      ["purchase", "donation"].includes(tranche.cause),
    );
    const rows = [
      ...assessedStoredRows.map(
        ({
          row,
          source,
          matchedTranches,
          fallbackShare,
          shareFraction,
          coverageWarning,
          acquisitionDateOverride,
        }) =>
          displayRowFromLot({
            property,
            row,
            source,
            matchedTranches,
            ledger: report.ledger,
            peopleById,
            inheritanceSourcesByOwner: report.inheritanceSourcesByOwner,
            fallbackShare,
            deedTransferValue,
            declarationRequiredFraction: source
              ? declarationShareByRow.get(row) || ZERO_FRACTION
              : null,
            shareFractionOverride: shareFraction,
            coverageWarning,
            acquisitionDateOverride,
          }),
      ),
      ...currentInitialTranches.map((tranche, index) =>
        syntheticInitialOwnerRow({
          property,
          vendor,
          tranche,
          index,
          deedTransferValue,
        }),
      ),
      ...currentInheritanceSources.map((source, index) =>
        syntheticInheritedRow({
          property,
          vendor,
          source,
          index,
          peopleById,
          inheritanceSourcesByOwner: report.inheritanceSourcesByOwner,
          deedTransferValue,
        }),
      ),
      ...currentTransferTranches.map((tranche, index) =>
        syntheticTransferredRow({
          property,
          vendor,
          tranche,
          index,
          deedTransferValue,
        }),
      ),
    ];
    const coveredFraction = rows.reduce(
      (total, row) => addFractions(total, row.shareFraction || approximateFraction(row.share)),
      ZERO_FRACTION,
    );
    const vendorFraction = vendor.shareFraction || approximateFraction(vendor.share);
    const missingFraction = subtractFractions(vendorFraction, coveredFraction);
    if (!missingFraction.error && compareFractions(missingFraction, ZERO_FRACTION) > 0) {
      const share = fractionToNumber(missingFraction);
      const attributedSaleValue = propertySaleValue === null ? null : propertySaleValue * share;
      const hasIncomingTransfer = report.ledger.entries.some(
        (entry) => !entry.error && entry.buyerId === vendor.id,
      );
      rows.push({
        id: `${vendor.id}-unresolved`,
        share,
        shareFraction: missingFraction,
        provenance: hasIncomingTransfer
          ? "Transferred share — acquisition details incomplete"
          : "Initial ownership — acquisition details incomplete",
        sourceKind: hasIncomingTransfer ? "transfer" : "unresolved",
        inheritanceDate: "",
        declarations: [],
        declaredValue: "",
        attributedSaleValue,
        difference: null,
        methods: [],
        selectedMethod: null,
        tax: null,
        net: null,
        warning: "The acquisition date and value are needed before tax can be calculated.",
      });
    }
    const attributedSaleValue =
      propertySaleValue !== null
        ? propertySaleValue * vendor.share
        : rows.length && rows.every((row) => row.attributedSaleValue !== null)
          ? rows.reduce((total, row) => total + row.attributedSaleValue, 0)
          : null;
    const sourceSummary = sourceCalculationSummary(rows);
    const tax = sourceSummary.incompleteSourceCount
      ? null
      : rows.reduce((total, row) => total + Number(row.tax || 0), 0);
    return {
      ...vendor,
      rows,
      ignoredStoredTaxLots: storedCoverage.ignoredRows.map((item) => ({
        id: item.row?.lot?.id || "",
        reason: item.reason,
      })),
      attributedSaleValue,
      tax,
      net: tax === null || attributedSaleValue === null ? null : attributedSaleValue - tax,
      ...sourceSummary,
      // Retained for existing consumers while the UI migrates to source terminology.
      incompleteRowCount: sourceSummary.incompleteSourceCount,
      taxStatus:
        sourceSummary.incompleteSourceCount === 0
          ? "complete"
          : sourceSummary.completeSourceCount > 0
            ? "partial"
            : "pending",
    };
  });
  const vendors = reconcileVendorMoney(assessedVendors, optionalMoney(property.saleValue));
  const totalsComplete =
    vendors.length > 0 &&
    vendors.every(
      (vendor) => vendor.incompleteSourceCount === 0 && vendor.attributedSaleValue !== null,
    );
  const completeSourceCount = vendors.reduce(
    (total, vendor) => total + vendor.completeSourceCount,
    0,
  );
  const incompleteSourceCount = vendors.reduce(
    (total, vendor) => total + vendor.incompleteSourceCount,
    0,
  );
  const unassessedSaleValues = vendors
    .filter((vendor) => vendor.incompleteSourceCount > 0)
    .map((vendor) => vendor.unassessedSaleValue);
  const ignoredStoredTaxLotCount = vendors.reduce(
    (total, vendor) => total + (vendor.ignoredStoredTaxLots?.length || 0),
    0,
  );
  return {
    vendors,
    totalSaleValue:
      vendors.length > 0 && vendors.every((vendor) => vendor.attributedSaleValue !== null)
        ? vendors.reduce((total, vendor) => total + vendor.attributedSaleValue, 0)
        : null,
    totalTax: totalsComplete
      ? vendors.reduce((total, vendor) => total + Number(vendor.tax || 0), 0)
      : null,
    totalNet: totalsComplete
      ? vendors.reduce((total, vendor) => total + Number(vendor.net || 0), 0)
      : null,
    calculatedSaleValueSubtotal: vendors.reduce(
      (total, vendor) => total + vendor.calculatedSaleValueSubtotal,
      0,
    ),
    calculatedTaxSubtotal: vendors.reduce(
      (total, vendor) => total + vendor.calculatedTaxSubtotal,
      0,
    ),
    calculatedNetSubtotal: vendors.reduce(
      (total, vendor) => total + vendor.calculatedNetSubtotal,
      0,
    ),
    unassessedSaleValue: unassessedSaleValues.every((value) => value !== null)
      ? unassessedSaleValues.reduce((total, value) => total + value, 0)
      : null,
    completeSourceCount,
    incompleteSourceCount,
    taxStatus: totalsComplete ? "complete" : completeSourceCount > 0 ? "partial" : "pending",
    totalsComplete,
    excludedLotCount: report.taxSummary.excludedLotCount,
    ignoredStoredTaxLotCount,
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
      previousOwnerRecordId: tranche.previousOwnerRecordId || "",
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
      acquiredOn: owner.acquisitionDate || "",
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
    };
  }
  return {
    shareNumerator: remaining.numerator,
    shareDenominator: remaining.denominator,
    sharePercent: fractionToNumber(remaining) * 100,
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

const validIsoDate = (value) => {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
};

/**
 * Records the date for an original owner's initial-title record.
 * Inherited acquisitions deliberately cannot use this path: their acquisition date is the
 * deceased owner's date of death. The owner need not still hold the title because a later donee
 * can require this date for Article 5A look-through. A deceased original owner is accepted only
 * when the identified lifetime donation made by that person is the reason the date is required.
 */
export function setLivingInitialOwnerAcquisitionDate(
  property = {},
  people = [],
  personId = "",
  acquisitionDate = "",
  outsideParties = [],
  ownerRecordId = "",
  sourceTransferId = "",
) {
  if (!validIsoDate(acquisitionDate)) {
    return { property, error: "Enter a valid original acquisition date." };
  }
  const person = people.find((candidate) => candidate.id === personId);
  const outsideOwner = outsideParties.find((candidate) => candidate.id === personId);
  if (!person && !outsideOwner) {
    return { property, error: "The original owner could not be found." };
  }
  const deceasedPerson = person && isPersonDeceased(person);
  const sourceDonation = deceasedPerson
    ? (property.transfers || []).find(
        (transfer) =>
          transfer.id === sourceTransferId &&
          transfer.kind === "donation" &&
          transfer.sellerId === personId,
      )
    : null;
  if (deceasedPerson && !sourceDonation) {
    return {
      property,
      error:
        "An inherited share uses the deceased owner's date of death; complete the relevant CM details instead.",
    };
  }
  const matchingOwnerRecords = (property.owners || []).filter(
    (owner) =>
      owner.personId === personId && (!ownerRecordId || String(owner.id || "") === ownerRecordId),
  );
  if (!matchingOwnerRecords.length) {
    return {
      property,
      error: "This person is not recorded as an original owner of this property.",
    };
  }
  const effectiveSaleDate = validIsoDate(property.saleDate)
    ? property.saleDate
    : new Date().toISOString().slice(0, 10);
  if (acquisitionDate > effectiveSaleDate) {
    return { property, error: "The acquisition date cannot be after the intended sale date." };
  }
  if (sourceDonation?.date && acquisitionDate > sourceDonation.date) {
    return { property, error: "The acquisition date cannot be after the donation date." };
  }
  if (deceasedPerson && validIsoDate(person.dateOfDeath) && acquisitionDate > person.dateOfDeath) {
    return { property, error: "The acquisition date cannot be after the owner's date of death." };
  }

  return {
    property: {
      ...property,
      owners: (property.owners || []).map((owner) =>
        owner.personId === personId && (!ownerRecordId || owner.id === ownerRecordId)
          ? { ...owner, acquisitionDate }
          : owner,
      ),
    },
    error: "",
  };
}

/** Records the donation-date value used for a particular donee's Article 5A source fraction. */
export function setDonationAcquisitionValue(
  property = {},
  buyerId = "",
  transferId = "",
  acquisitionValue = "",
  acquisitionValueBasis = "",
) {
  const rawValue = String(acquisitionValue ?? "").trim();
  const clearsValue = rawValue === "";
  const numericValue = Number(acquisitionValue);
  if (!clearsValue && (!Number.isFinite(numericValue) || numericValue < 0)) {
    return { property, error: "Enter a valid donation acquisition value." };
  }
  if (!clearsValue && !DONATION_ACQUISITION_VALUE_BASES.includes(acquisitionValueBasis)) {
    return {
      property,
      error: "Choose market value at donation, deed value or final assessment.",
    };
  }
  const transfers = property.transfers || [];
  const targetIndex = transfers.findIndex(
    (transfer) => transfer.id === transferId && transfer.buyerId === buyerId,
  );
  if (targetIndex < 0) {
    return { property, error: "The selected donation transfer could not be found for this donee." };
  }
  if (transfers[targetIndex].kind !== "donation") {
    return { property, error: "Acquisition value can only be recorded against a donation." };
  }
  return {
    property: {
      ...property,
      transfers: transfers.map((transfer, index) =>
        index === targetIndex
          ? {
              ...transfer,
              acquisitionValue: clearsValue ? "" : numericValue,
              acquisitionValueBasis: clearsValue ? "" : acquisitionValueBasis,
            }
          : transfer,
      ),
    },
    error: "",
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
      storedLot.donationSourceKey ||
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
    const storedAcquisitionValue = optionalMoney(storedLot.acquisitionValue);
    const apportionedMoney = (field, weight) => {
      if (!Object.prototype.hasOwnProperty.call(storedLot, field)) return {};
      const recorded = optionalMoney(storedLot[field]);
      return { [field]: recorded === null ? storedLot[field] : recorded * weight };
    };
    return donationSources.map((source, index) => {
      const weight = lotShare > 0 ? source.share / lotShare : 0;
      return {
        ...storedLot,
        id: `${storedLot.id}:donation:${source.transferId}:${source.sourceTrancheId || index}`,
        shareNumerator: source.shareFraction.numerator,
        shareDenominator: source.shareFraction.denominator,
        ...apportionedMoney("transferValue", weight),
        ...apportionedMoney("consideration", weight),
        ...apportionedMoney("marketValue", weight),
        acquisitionValue: storedAcquisitionValue === null ? "" : storedAcquisitionValue * weight,
        donationSourceKey: `${source.transferId}:${source.sourceTrancheId}`,
      };
    });
  });
  const saleRowsWithoutTax = expandedSaleLots.map((storedLot) => {
    const lot = storedLot;
    const inheritanceSources = inheritanceSourcesByOwner.get(lot.ownerId) || [];
    const donationSources = donationSourcesByOwner.get(lot.ownerId) || [];
    const ownerTranches = ownership.tranchesByOwner?.get?.(lot.ownerId) || [];
    const untypedLotCanOnlyBeInheritance =
      !lot.acquisitionType &&
      ownerTranches.length > 0 &&
      ownerTranches.every((tranche) => tranche.cause === "inheritance");
    const selectedInheritanceSource = lot.inheritanceSourceDeceasedId
      ? inheritanceSources.find((source) => source.deceasedId === lot.inheritanceSourceDeceasedId)
      : inheritanceSources.length === 1 &&
          (lot.acquisitionType === "inheritance" || untypedLotCanOnlyBeInheritance)
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
