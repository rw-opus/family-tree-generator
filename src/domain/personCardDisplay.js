export const DEFAULT_PERSON_CARD_FIELDS = Object.freeze({
  ownershipFraction: true,
  ownershipPercentage: true,
  ownershipValue: true,
  dateOfDeath: false,
  successionBasis: false,
  willDetails: false,
  causaMortisDetails: false,
});

export function normalisePersonCardFields(settings = {}) {
  const savedFields =
    settings.personCardFields && typeof settings.personCardFields === "object"
      ? settings.personCardFields
      : null;

  if (savedFields) {
    return Object.fromEntries(
      Object.entries(DEFAULT_PERSON_CARD_FIELDS).map(([key, defaultValue]) => [
        key,
        typeof savedFields[key] === "boolean" ? savedFields[key] : defaultValue,
      ]),
    );
  }

  const showShares = settings.showOwnershipOnTree !== false;
  const shareDisplay = settings.shareDisplay || "both";
  return {
    ...DEFAULT_PERSON_CARD_FIELDS,
    ownershipFraction: showShares && shareDisplay !== "percentage",
    ownershipPercentage: showShares && shareDisplay !== "fraction",
  };
}

/**
 * Current owners come from the post-transfer ledger. A deceased person is no
 * longer a current owner, but their transmission records preserve the share
 * held immediately before it passed to their successors. Show that historical
 * share on the deceased person's card without adding it to today's totals.
 */
export function buildTreeCardOwnershipByPerson(currentOwners = [], transmissions = []) {
  const ownershipByPerson = {};
  currentOwners.forEach((owner) => {
    const personId = String(owner?.personId || "");
    const share = Number(owner?.share);
    if (personId && Number.isFinite(share) && share > 0) ownershipByPerson[personId] = share;
  });

  const historicalShares = new Map();
  transmissions.forEach((transmission) => {
    const deceasedId = String(transmission?.deceasedId || "");
    const shareAtDeath = Number(transmission?.amount);
    if (!deceasedId || !Number.isFinite(shareAtDeath) || shareAtDeath <= 0) return;
    historicalShares.set(deceasedId, (historicalShares.get(deceasedId) || 0) + shareAtDeath);
  });
  historicalShares.forEach((share, deceasedId) => {
    ownershipByPerson[deceasedId] = share;
  });

  return ownershipByPerson;
}
