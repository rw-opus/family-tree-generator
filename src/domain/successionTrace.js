import { approximateFraction } from "./ownership.js";
import {
  buildCurrentOwnerPresentations,
  formatOwnershipFraction,
  formatOwnershipPercentage,
  ownerPresentationsById,
  reconcileFractionPercentageDisplay,
  recordedNonNegativeMoney,
} from "./ownershipPresentation.js";
import {
  addFractions,
  compareFractions,
  fractionComponentNumber,
  fractionToNumber,
  multiplyFractions,
  normaliseFraction,
  subtractFractions,
  ZERO_FRACTION,
} from "./fractions.js";

const money = new Intl.NumberFormat("en-MT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

const shareLabel = (share, exactFraction = null, displayPercentageLabel = "") =>
  `${formatOwnershipFraction(share, exactFraction)} (${
    displayPercentageLabel || formatOwnershipPercentage(share, exactFraction)
  })`;

const initialOwnerShare = (owner) => {
  const numerator = fractionComponentNumber(owner.shareNumerator);
  const denominator = fractionComponentNumber(owner.shareDenominator, { allowZero: false });
  if (Number.isFinite(numerator) && Number.isFinite(denominator)) {
    return numerator / denominator;
  }
  return Math.max(0, Number(owner.sharePercent) || 0) / 100;
};

const initialOwnerFraction = (owner) => {
  const exact = normaliseFraction(owner.shareNumerator, owner.shareDenominator);
  return exact.error ? approximateFraction(initialOwnerShare(owner)) : exact;
};

const allocationEntries = (allocations) =>
  allocations instanceof Map ? [...allocations.entries()] : Object.entries(allocations || {});

const eventDateSort = (event) => event.date || "9999-12-30";

const ownershipSnapshot = (holdings) =>
  Object.fromEntries(
    [...holdings.entries()]
      .filter(([, share]) => compareFractions(share, ZERO_FRACTION) > 0)
      .map(([ownerId, share]) => [ownerId, fractionToNumber(share)]),
  );

const ownershipFractionSnapshot = (holdings) =>
  Object.fromEntries(
    [...holdings.entries()]
      .filter(([, share]) => compareFractions(share, ZERO_FRACTION) > 0)
      .map(([ownerId, share]) => [ownerId, share]),
  );

const addHolding = (holdings, ownerId, share) => {
  if (!ownerId || share?.error || compareFractions(share, ZERO_FRACTION) <= 0) return;
  const next = addFractions(holdings.get(ownerId) || ZERO_FRACTION, share);
  if (!next.error) holdings.set(ownerId, next);
};

const applySuccession = (holdings, change) => {
  const exactAllocations = change.exactAllocations || new Map();
  const allocations = allocationEntries(change.allocations)
    .map(([recipientId, share]) => [
      recipientId,
      exactAllocations.get?.(recipientId) || approximateFraction(Number(share) || 0),
    ])
    .filter(([recipientId, share]) =>
      Boolean(recipientId && !share.error && compareFractions(share, ZERO_FRACTION) > 0),
    );
  const estateShare = change.amountFraction || approximateFraction(Number(change.amount) || 0);
  if (estateShare.error) return;
  let allocatedEstateShare = ZERO_FRACTION;
  allocations.forEach(([recipientId, allocation]) => {
    const inherited = multiplyFractions(estateShare, allocation);
    if (inherited.error) return;
    addHolding(holdings, recipientId, inherited);
    allocatedEstateShare = addFractions(allocatedEstateShare, inherited);
  });
  const deceasedHolding = holdings.get(change.deceasedId) || ZERO_FRACTION;
  const remaining = subtractFractions(deceasedHolding, allocatedEstateShare);
  if (!remaining.error) holdings.set(change.deceasedId, remaining);
};

const applyTransfer = (holdings, change) => {
  const transferredShare = change.amountFraction || approximateFraction(Number(change.amount) || 0);
  if (transferredShare.error || compareFractions(transferredShare, ZERO_FRACTION) <= 0) return;
  const sellerAfter = subtractFractions(
    holdings.get(change.sellerId) || ZERO_FRACTION,
    transferredShare,
  );
  if (!sellerAfter.error) holdings.set(change.sellerId, sellerAfter);
  addHolding(holdings, change.buyerId, transferredShare);
};

export function buildSuccessionTrace({
  property = {},
  people = [],
  outsideParties = [],
  propertyReport = {},
  currentOwnerPresentationsById = null,
} = {}) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const outsidePartiesById = new Map(outsideParties.map((party) => [party.id, party]));
  const partiesById = new Map([
    ...people.map((person) => [person.id, person.fullName || "Unnamed person"]),
    ...outsideParties.map((party) => [party.id, party.name || "Unnamed party"]),
  ]);
  const partyName = (id) => partiesById.get(id) || "Unknown party";
  const participant = (id, role) => ({
    id: id || "",
    name: partyName(id),
    role,
    source: peopleById.has(id) ? "person" : outsidePartiesById.has(id) ? "outside" : "unknown",
  });
  const propertyName = property.address || "the property";
  const recordedSaleValue = recordedNonNegativeMoney(property.saleValue);
  const saleValue = recordedSaleValue ?? 0;
  const initialHoldings = new Map();
  (property.owners || []).forEach((owner) =>
    addHolding(initialHoldings, owner.personId, initialOwnerFraction(owner)),
  );
  const initialOwnershipSnapshot = ownershipSnapshot(initialHoldings);
  const initialOwnershipFractionSnapshot = ownershipFractionSnapshot(initialHoldings);

  const eligibleInitialOwners = (property.owners || []).filter(
    (owner) => owner.personId && initialOwnerShare(owner) > 0,
  );
  const initialPercentageDisplay = reconcileFractionPercentageDisplay(
    eligibleInitialOwners.map(initialOwnerFraction),
    { keys: eligibleInitialOwners.map((owner) => owner.personId || owner.id) },
  ).rows;
  const initialEvents = eligibleInitialOwners.map((owner, index) => {
    const share = initialOwnerShare(owner);
    const shareFraction = initialOwnerFraction(owner);
    return {
      id: `initial-${owner.id || index}`,
      type: "initial",
      personId: owner.personId,
      ownershipSnapshot: initialOwnershipSnapshot,
      ownershipFractionSnapshot: initialOwnershipFractionSnapshot,
      date: "",
      title: "Initial ownership",
      description: `${partyName(owner.personId)} starts with ${shareLabel(
        share,
        shareFraction,
        initialPercentageDisplay[index]?.displayPercentageLabel,
      )} of ${propertyName}.`,
    };
  });

  const successionEvents = (propertyReport.ownership?.transmissions || []).map(
    (transmission, index) => {
      const deceased = peopleById.get(transmission.deceasedId);
      const estateShare = Math.max(0, Number(transmission.amount) || 0);
      const estateFraction =
        transmission.amountFraction || approximateFraction(Math.max(0, estateShare));
      const recipientRows = allocationEntries(transmission.allocations)
        .filter(([, allocatedShare]) => Number(allocatedShare) > 0)
        .map(([recipientId, allocatedShare]) => {
          const resultingShare = estateShare * Number(allocatedShare);
          const allocationFraction =
            transmission.exactAllocations?.get?.(recipientId) ||
            approximateFraction(Number(allocatedShare) || 0);
          const resultingFraction = multiplyFractions(estateFraction, allocationFraction);
          return { recipientId, resultingShare, resultingFraction };
        });
      const recipientPercentageDisplay = reconcileFractionPercentageDisplay(
        recipientRows.map(({ resultingFraction }) => resultingFraction),
        { keys: recipientRows.map(({ recipientId }) => recipientId) },
      ).rows;
      const recipients = recipientRows.map(
        ({ recipientId, resultingShare, resultingFraction }, recipientIndex) =>
          `${partyName(recipientId)} receives ${shareLabel(
            resultingShare,
            resultingFraction.error ? null : resultingFraction,
            recipientPercentageDisplay[recipientIndex]?.displayPercentageLabel,
          )}`,
      );
      const basis = transmission.basis === "will" ? "under the will" : "by intestacy";
      return {
        id: `succession-${transmission.deceasedId}-${index}`,
        type: "succession",
        chronologyOrder: transmission.chronologyOrder,
        personId: transmission.deceasedId,
        change: {
          kind: "succession",
          deceasedId: transmission.deceasedId,
          amount: estateShare,
          amountFraction: transmission.amountFraction,
          allocations: transmission.allocations,
          exactAllocations: transmission.exactAllocations,
        },
        date: transmission.dateOfDeath || deceased?.dateOfDeath || "",
        title: `Succession of ${partyName(transmission.deceasedId)}`,
        description: `${partyName(transmission.deceasedId)} held ${shareLabel(
          estateShare,
          estateFraction.error ? null : estateFraction,
        )}. On death, that holding passes ${basis}${
          recipients.length ? `: ${recipients.join("; ")}` : ", but the recipients are unresolved"
        }.`,
        warnings: [...new Set(transmission.warnings || [])],
      };
    },
  );

  const transferEvents = (propertyReport.ledger?.entries || []).map((entry, index) => {
    const transferKind = entry.kind === "donation" ? "donation" : "sale";
    const action = transferKind === "donation" ? "donates" : "sells";
    const sellerRole = transferKind === "donation" ? "Donor" : "Seller";
    const buyerRole = transferKind === "donation" ? "Donee" : "Buyer";
    const exactAmountIsPositive =
      entry.amountFraction?.denominator &&
      compareFractions(entry.amountFraction, ZERO_FRACTION) > 0;
    const applied = !entry.error && (exactAmountIsPositive || Number(entry.amount) > 0);
    const invalidReason =
      entry.error || "The recorded transferred share could not be applied to the title.";
    const description = applied
      ? `${partyName(entry.sellerId)} ${action} ${shareLabel(
          entry.amount,
          entry.amountFraction,
        )} of ${propertyName} to ${partyName(entry.buyerId)}${
          transferKind === "sale" && Number(entry.consideration) > 0
            ? ` for ${money.format(Number(entry.consideration))}`
            : ""
        }.`
      : `${partyName(entry.sellerId)} has a recorded ${transferKind} to ${partyName(
          entry.buyerId,
        )}, but it was not applied to the title.`;

    return {
      id: `transfer-${entry.id || index}`,
      type: "sale",
      transferKind,
      invalid: !applied,
      chronologyOrder: entry.chronologyOrder,
      personId: "",
      ...(applied
        ? {
            change: {
              kind: "transfer",
              sellerId: entry.sellerId,
              buyerId: entry.buyerId,
              amount: entry.amount,
              amountFraction: entry.amountFraction,
            },
          }
        : {}),
      participants: [
        participant(entry.sellerId, sellerRole),
        participant(entry.buyerId, buyerRole),
      ],
      date: entry.date || "",
      title: `Property share ${transferKind}`,
      description,
      warnings: applied ? [] : [`Recorded ${transferKind} needs attention: ${invalidReason}`],
    };
  });

  const byDate = (first, second) => {
    const dateComparison = eventDateSort(first).localeCompare(eventDateSort(second));
    if (dateComparison) return dateComparison;
    return first.type.localeCompare(second.type);
  };
  const legalEvents = [...successionEvents, ...transferEvents];
  const hasCompleteChronology = legalEvents.every(
    (event) => typeof event.chronologyOrder === "number" && Number.isFinite(event.chronologyOrder),
  );
  legalEvents.sort(
    hasCompleteChronology
      ? (first, second) => first.chronologyOrder - second.chronologyOrder
      : byDate,
  );
  const runningHoldings = new Map(initialHoldings);
  const tracedLegalEvents = legalEvents.map((event) => {
    const snapshotBeforeEvent = ownershipSnapshot(runningHoldings);
    const fractionSnapshotBeforeEvent = ownershipFractionSnapshot(runningHoldings);
    if (event.change?.kind === "succession") applySuccession(runningHoldings, event.change);
    if (event.change?.kind === "transfer") applyTransfer(runningHoldings, event.change);
    const snapshotForCards =
      event.change?.kind === "succession"
        ? snapshotBeforeEvent
        : ownershipSnapshot(runningHoldings);
    const fractionSnapshotForCards =
      event.change?.kind === "succession"
        ? fractionSnapshotBeforeEvent
        : ownershipFractionSnapshot(runningHoldings);
    const publicEvent = { ...event };
    delete publicEvent.change;
    delete publicEvent.chronologyOrder;
    return {
      ...publicEvent,
      ownershipSnapshot: snapshotForCards,
      ownershipFractionSnapshot: fractionSnapshotForCards,
    };
  });

  const currentOwners = (propertyReport.ledger?.owners || []).filter(
    (owner) => Number(owner.share) > 0,
  );
  const generatedCurrentOwnerPresentationsById = ownerPresentationsById(
    buildCurrentOwnerPresentations(currentOwners, property.saleValue),
  );
  const resolvedCurrentOwnerPresentationsById =
    currentOwnerPresentationsById || generatedCurrentOwnerPresentationsById;
  const proposedSaleEvent =
    recordedSaleValue !== null
      ? [
          {
            id: "proposed-sale",
            type: "sale",
            personId: "",
            ownershipSnapshot: Object.fromEntries(
              currentOwners.map((owner) => [owner.id, Number(owner.share) || 0]),
            ),
            ownershipFractionSnapshot: Object.fromEntries(
              currentOwners
                .filter((owner) => owner.shareFraction?.denominator)
                .map((owner) => [owner.id, owner.shareFraction]),
            ),
            date: property.saleDate || "",
            title: "Proposed property sale",
            description: `${propertyName} is being sold for ${money.format(saleValue)}${
              currentOwners.length
                ? `. Current allocation: ${currentOwners
                    .map((owner) => {
                      const generatedPresentation =
                        generatedCurrentOwnerPresentationsById[owner.id];
                      const suppliedPresentation = resolvedCurrentOwnerPresentationsById[owner.id];
                      const presentation = suppliedPresentation
                        ? { ...generatedPresentation, ...suppliedPresentation }
                        : generatedPresentation;
                      const suppliedValue = recordedNonNegativeMoney(presentation.value);
                      const value =
                        suppliedValue === null ? generatedPresentation.value : suppliedValue;
                      return `${owner.name || partyName(owner.id)} ${shareLabel(
                        presentation.share,
                        presentation.shareFraction,
                        presentation.displayPercentageLabel,
                      )}, worth ${money.format(value)}`;
                    })
                    .join("; ")}`
                : ""
            }.`,
          },
        ]
      : [];

  return [...initialEvents, ...tracedLegalEvents, ...proposedSaleEvent];
}
