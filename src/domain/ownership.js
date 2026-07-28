const value = (input) => Math.max(0, Number(input) || 0);

export function approximateFraction(decimal, maxDenominator = 10000) {
  if (!Number.isFinite(decimal) || decimal === 0) return { numerator: 0, denominator: 1 };
  const sign = decimal < 0 ? -1 : 1;
  const target = Math.abs(decimal);
  let best = { numerator: Math.round(target), denominator: 1, error: Math.abs(Math.round(target) - target) };
  for (let denominator = 1; denominator <= maxDenominator; denominator += 1) {
    const numerator = Math.round(target * denominator);
    const error = Math.abs(numerator / denominator - target);
    if (error < best.error) best = { numerator, denominator, error };
    if (error < 1e-10) break;
  }
  return { numerator: best.numerator * sign, denominator: best.denominator };
}

export function buildStarterOwnership(people = []) {
  if (!people.length) return {};

  const hasManualShare = (person) =>
    person.ownershipSharePercent !== undefined &&
    person.ownershipSharePercent !== null &&
    person.ownershipSharePercent !== "";
  const manualPeople = people.filter(hasManualShare);
  if (people.length === 1 && !manualPeople.length) return {};

  const parentIds = new Set();
  people.forEach((person) => {
    if (person.fatherId) parentIds.add(person.fatherId);
    if (person.motherId) parentIds.add(person.motherId);
  });

  const candidateIds = new Set(
    parentIds.size ? [...parentIds] : [people[0].id],
  );
  manualPeople.forEach((person) => candidateIds.add(person.id));
  const candidates = people.filter((person) => candidateIds.has(person.id));
  const manualTotal = candidates
    .filter(hasManualShare)
    .reduce((total, person) => total + value(person.ownershipSharePercent), 0);
  const automaticPeople = candidates.filter((person) => !hasManualShare(person));
  const automaticPercent = automaticPeople.length
    ? Math.max(0, 100 - manualTotal) / automaticPeople.length
    : 0;

  return Object.fromEntries(
    candidates.map((person) => [
      person.id,
      (hasManualShare(person)
        ? value(person.ownershipSharePercent)
        : automaticPercent) / 100,
    ]),
  );
}

// Applies a sequence of transfers on top of starting holdings, shared by both the legacy
// heir-list ledger and the per-property ledger below.
function resolveTransfers(parties, startingHoldings, transfers) {
  const holdings = new Map(parties.map((party) => [party.id, startingHoldings.get(party.id) || 0]));
  const entries = transfers.map((transfer) => {
    const sellerHolding = holdings.get(transfer.sellerId) || 0;
    const numerator = value(transfer.numerator);
    const denominator = value(transfer.denominator);
    if (!transfer.sellerId || !transfer.buyerId) return { ...transfer, error: "Select a seller and buyer.", amount: 0 };
    if (transfer.sellerId === transfer.buyerId) return { ...transfer, error: "Seller and buyer must be different.", amount: 0 };
    if (!denominator) return { ...transfer, error: "The denominator must be greater than zero.", amount: 0 };
    const fraction = numerator / denominator;
    const amount = transfer.amountType === "whole-property" ? fraction : sellerHolding * fraction;
    if (fraction <= 0) return { ...transfer, error: "The transferred fraction must be greater than zero.", amount: 0 };
    if (amount > sellerHolding + 1e-10) return { ...transfer, error: "The seller does not own enough to complete this transfer.", amount: 0 };
    holdings.set(transfer.sellerId, Math.max(0, sellerHolding - amount));
    holdings.set(transfer.buyerId, (holdings.get(transfer.buyerId) || 0) + amount);
    return { ...transfer, amount, sellerBefore: sellerHolding, sellerAfter: sellerHolding - amount };
  });
  return { holdings, entries };
}

function ledgerFromParties(parties, startingHoldings, transfers) {
  const { holdings, entries } = resolveTransfers(parties, startingHoldings, transfers);
  const owners = parties.map((party) => ({ ...party, share: holdings.get(party.id) || 0 })).filter((party) => party.share > 1e-10).sort((a, b) => b.share - a.share);
  return { parties, owners, entries, total: owners.reduce((sum, owner) => sum + owner.share, 0) };
}

export function buildOwnershipLedger(heirs = [], outsideParties = [], transfers = [], familyPeople = []) {
  const linkedPersonIds = new Set(heirs.map((heir) => heir.personId).filter(Boolean));
  const parties = [
    ...heirs.map((heir) => ({ id: heir.id, personId: heir.personId || "", name: heir.name || "Unnamed family member", type: "individual", source: "family" })),
    ...familyPeople.filter((person) => !linkedPersonIds.has(person.id)).map((person) => ({ id: person.id, personId: person.id, name: person.fullName || "Unnamed family member", type: "individual", source: "family-tree" })),
    ...outsideParties.map((party) => ({ ...party, name: party.name || (party.type === "company" ? "Unnamed company" : "Unnamed individual"), source: "outside" })),
  ];
  const startingHoldings = new Map(heirs.map((heir) => [heir.id, value(heir.sharePercent) / 100]));
  return ledgerFromParties(parties, startingHoldings, transfers);
}

// Same ledger mechanics as buildOwnershipLedger, but starting from a property's automatic
// per-person ownership (buildPropertyOwnership's ownershipByPerson) instead of a manual
// heir list, so a property's title can be transferred onward without System A's heir records.
export function buildPropertyLedger(people = [], outsideParties = [], transfers = [], startingOwnership = {}) {
  const parties = [
    ...people.map((person) => ({ id: person.id, personId: person.id, name: person.fullName || "Unnamed family member", type: "individual", source: "family-tree" })),
    ...outsideParties.map((party) => ({ ...party, name: party.name || (party.type === "company" ? "Unnamed company" : "Unnamed individual"), source: "outside" })),
  ];
  const startingHoldings = new Map(Object.entries(startingOwnership));
  return ledgerFromParties(parties, startingHoldings, transfers);
}
