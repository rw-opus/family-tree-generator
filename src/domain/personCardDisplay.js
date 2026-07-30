export const DEFAULT_PERSON_CARD_FIELDS = Object.freeze({
  ownershipFraction: true,
  ownershipPercentage: true,
  ownershipValue: false,
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
