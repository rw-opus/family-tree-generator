import { approximateFraction } from "./ownership.js";
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

const percentage = (share) =>
  `${(Math.max(0, Number(share) || 0) * 100).toLocaleString("en-MT", {
    maximumFractionDigits: 2,
  })}%`;

const fraction = (share) => {
  const result = approximateFraction(Math.max(0, Number(share) || 0));
  return `${result.numerator}/${result.denominator}`;
};

const shareLabel = (share) => `${fraction(share)} (${percentage(share)})`;

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
} = {}) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const partiesById = new Map([
    ...people.map((person) => [person.id, person.fullName || "Unnamed person"]),
    ...outsideParties.map((party) => [party.id, party.name || "Unnamed party"]),
  ]);
  const partyName = (id) => partiesById.get(id) || "Unknown party";
  const propertyName = property.address || "the property";
  const saleValue = Math.max(0, Number(property.saleValue) || 0);
  const initialHoldings = new Map();
  (property.owners || []).forEach((owner) =>
    addHolding(initialHoldings, owner.personId, initialOwnerFraction(owner)),
  );
  const initialOwnershipSnapshot = ownershipSnapshot(initialHoldings);

  const initialEvents = (property.owners || [])
    .filter((owner) => owner.personId && initialOwnerShare(owner) > 0)
    .map((owner, index) => {
      const share = initialOwnerShare(owner);
      return {
        id: `initial-${owner.id || index}`,
        type: "initial",
        personId: owner.personId,
        ownershipSnapshot: initialOwnershipSnapshot,
        date: "",
        title: "Initial ownership",
        description: `${partyName(owner.personId)} starts with ${shareLabel(share)} of ${propertyName}${
          saleValue ? `, currently worth ${money.format(saleValue * share)}` : ""
        }.`,
      };
    });

  const successionEvents = (propertyReport.ownership?.transmissions || []).map(
    (transmission, index) => {
      const deceased = peopleById.get(transmission.deceasedId);
      const estateShare = Math.max(0, Number(transmission.amount) || 0);
      const recipients = allocationEntries(transmission.allocations)
        .filter(([, allocatedShare]) => Number(allocatedShare) > 0)
        .map(([recipientId, allocatedShare]) => {
          const resultingShare = estateShare * Number(allocatedShare);
          return `${partyName(recipientId)} receives ${shareLabel(resultingShare)}`;
        });
      const basis = transmission.basis === "will" ? "under the will" : "by intestacy";
      return {
        id: `succession-${transmission.deceasedId}-${index}`,
        type: "succession",
        personId: transmission.deceasedId,
        change: {
          kind: "succession",
          deceasedId: transmission.deceasedId,
          amount: estateShare,
          amountFraction: transmission.amountFraction,
          allocations: transmission.allocations,
          exactAllocations: transmission.exactAllocations,
        },
        date: deceased?.dateOfDeath || "",
        title: `Succession of ${partyName(transmission.deceasedId)}`,
        description: `${partyName(transmission.deceasedId)} held ${shareLabel(
          estateShare,
        )}. On death, that holding passes ${basis}${
          recipients.length ? `: ${recipients.join("; ")}` : ", but the recipients are unresolved"
        }.`,
        warnings: [...new Set(transmission.warnings || [])],
      };
    },
  );

  const transferEvents = (propertyReport.ledger?.entries || [])
    .filter((entry) => !entry.error && Number(entry.amount) > 0)
    .map((entry, index) => ({
      id: `transfer-${entry.id || index}`,
      type: "sale",
      personId: "",
      change: {
        kind: "transfer",
        sellerId: entry.sellerId,
        buyerId: entry.buyerId,
        amount: entry.amount,
        amountFraction: entry.amountFraction,
      },
      date: entry.date || "",
      title: Number(entry.consideration) > 0 ? "Property share sale" : "Ownership transfer",
      description: `${partyName(entry.sellerId)} transfers ${shareLabel(entry.amount)} of ${
        property.address || "the property"
      } to ${partyName(entry.buyerId)}${
        Number(entry.consideration) > 0 ? ` for ${money.format(Number(entry.consideration))}` : ""
      }.`,
    }));

  const byDate = (first, second) => {
    const dateComparison = eventDateSort(first).localeCompare(eventDateSort(second));
    if (dateComparison) return dateComparison;
    return first.type.localeCompare(second.type);
  };
  const legalEvents = [...successionEvents.sort(byDate), ...transferEvents.sort(byDate)];
  const runningHoldings = new Map(initialHoldings);
  const tracedLegalEvents = legalEvents.map((event) => {
    const snapshotBeforeEvent = ownershipSnapshot(runningHoldings);
    if (event.change.kind === "succession") applySuccession(runningHoldings, event.change);
    if (event.change.kind === "transfer") applyTransfer(runningHoldings, event.change);
    const snapshotForCards =
      event.change.kind === "succession" ? snapshotBeforeEvent : ownershipSnapshot(runningHoldings);
    const publicEvent = { ...event };
    delete publicEvent.change;
    return { ...publicEvent, ownershipSnapshot: snapshotForCards };
  });

  const currentOwners = (propertyReport.ledger?.owners || []).filter(
    (owner) => Number(owner.share) > 0,
  );
  const proposedSaleEvent = saleValue
    ? [
        {
          id: "proposed-sale",
          type: "sale",
          personId: "",
          ownershipSnapshot: Object.fromEntries(
            currentOwners.map((owner) => [owner.id, Number(owner.share) || 0]),
          ),
          date: property.saleDate || "",
          title: "Proposed property sale",
          description: `${propertyName} is being sold for ${money.format(saleValue)}${
            currentOwners.length
              ? `. Current allocation: ${currentOwners
                  .map(
                    (owner) =>
                      `${owner.name || partyName(owner.id)} ${shareLabel(owner.share)}, worth ${money.format(
                        saleValue * owner.share,
                      )}`,
                  )
                  .join("; ")}`
              : ""
          }.`,
        },
      ]
    : [];

  return [...initialEvents, ...tracedLegalEvents, ...proposedSaleEvent];
}
