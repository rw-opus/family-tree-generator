import { approximateFraction } from "./ownership.js";

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
  const numerator = Number(owner.shareNumerator);
  const denominator = Number(owner.shareDenominator);
  if (
    Number.isFinite(numerator) &&
    numerator >= 0 &&
    Number.isFinite(denominator) &&
    denominator > 0
  ) {
    return numerator / denominator;
  }
  return Math.max(0, Number(owner.sharePercent) || 0) / 100;
};

const allocationEntries = (allocations) =>
  allocations instanceof Map ? [...allocations.entries()] : Object.entries(allocations || {});

const eventDateSort = (event) => event.date || "9999-12-30";

const ownershipSnapshot = (holdings) =>
  Object.fromEntries([...holdings.entries()].filter(([, share]) => Number(share) > 1e-10));

const addHolding = (holdings, ownerId, share) => {
  if (!ownerId || !(Number(share) > 0)) return;
  holdings.set(ownerId, (holdings.get(ownerId) || 0) + Number(share));
};

const applySuccession = (holdings, change) => {
  const allocations = allocationEntries(change.allocations).filter(
    ([recipientId, share]) => recipientId && Number(share) > 0,
  );
  const allocatedRatio = Math.min(
    1,
    allocations.reduce((total, [, share]) => total + Number(share), 0),
  );
  if (!(allocatedRatio > 0)) return;

  const estateShare = Math.max(0, Number(change.amount) || 0);
  const allocatedEstateShare = estateShare * allocatedRatio;
  holdings.set(
    change.deceasedId,
    Math.max(0, (holdings.get(change.deceasedId) || 0) - allocatedEstateShare),
  );
  allocations.forEach(([recipientId, share]) =>
    addHolding(holdings, recipientId, estateShare * Number(share)),
  );
};

const applyTransfer = (holdings, change) => {
  const transferredShare = Math.max(0, Number(change.amount) || 0);
  if (!(transferredShare > 0)) return;
  holdings.set(
    change.sellerId,
    Math.max(0, (holdings.get(change.sellerId) || 0) - transferredShare),
  );
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
    addHolding(initialHoldings, owner.personId, initialOwnerShare(owner)),
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
          allocations: transmission.allocations,
        },
        date: deceased?.dateOfDeath || "",
        title: `Succession of ${partyName(transmission.deceasedId)}`,
        description: `${partyName(transmission.deceasedId)} held ${shareLabel(
          estateShare,
        )}. On death, that holding passes ${basis}${
          recipients.length ? `: ${recipients.join("; ")}` : ", but the recipients are unresolved"
        }.`,
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
