import { isRecordedDeceased } from "./deceasedStatus.js";
import {
  formatOwnershipFraction,
  formatOwnershipPercentage,
  ownershipFraction,
  ownershipShare,
  recordedNonNegativeMoney,
} from "./ownershipPresentation.js";
import { personDisplayName, personGivenNames, personSurname } from "./people.js";
import { personWills } from "./wills.js";

const text = (value) => String(value ?? "").trim();

const parentage = (person, peopleById, people) => {
  const relationship =
    String(person.sex || "").toLowerCase() === "male"
      ? "Son"
      : String(person.sex || "").toLowerCase() === "female"
        ? "Daughter"
        : "Child";
  const parents = [person.fatherId, person.motherId]
    .map((id) => peopleById.get(text(id)))
    .filter(Boolean)
    .map((parent) => personDisplayName(parent, people));
  return parents.length ? `${relationship} of ${parents.join(" & ")}` : relationship;
};

/**
 * One canonical presentation row for both the editable Tree Register and its
 * Excel worksheet. Ownership and values are deliberately read-only here: they
 * come from the same current/historical title calculation used by tree cards.
 */
export function buildTreeRegisterRows({
  people = [],
  property = {},
  ownershipByPerson = {},
  ownershipFractionsByPerson = {},
  currentOwnerPresentationsByPerson = {},
} = {}) {
  const sourcePeople = Array.isArray(people) ? people : [];
  const peopleById = new Map(sourcePeople.map((person) => [text(person.id), person]));
  const propertyValue = recordedNonNegativeMoney(property.saleValue);

  return sourcePeople.map((person) => {
    const deceased = isRecordedDeceased(person);
    const currentPresentation = currentOwnerPresentationsByPerson[person.id] || null;
    const historicalShare = Math.max(0, Number(ownershipByPerson[person.id]) || 0);
    const share = deceased ? historicalShare : Math.max(0, Number(currentPresentation?.share) || 0);
    const shareFraction = deceased
      ? ownershipFraction(share, ownershipFractionsByPerson[person.id])
      : ownershipFraction(share, currentPresentation?.shareFraction);
    const hasHolding = deceased ? historicalShare > 0 : Boolean(currentPresentation);
    const holdingValue = deceased
      ? propertyValue === null || !hasHolding
        ? null
        : propertyValue * ownershipShare(share, shareFraction)
      : recordedNonNegativeMoney(currentPresentation?.value);

    return {
      personId: text(person.id),
      surname: personSurname(person),
      name: personGivenNames(person),
      parentage: parentage(person, peopleById, sourcePeople),
      fatherId: text(person.fatherId),
      motherId: text(person.motherId),
      deceased,
      dateOfDeath: text(person.dateOfDeath),
      dateOfDeathUnknown: person.dateOfDeathUnknown === true,
      successionBasis: deceased
        ? person.inheritanceBasis === "will"
          ? "will"
          : "intestacy"
        : "living",
      wills: personWills(person),
      causaMortisDeclarations: (person.causaMortisDeclarations || []).filter(
        (declaration) =>
          !property.id || !declaration.propertyId || declaration.propertyId === property.id,
      ),
      hasHolding,
      share,
      shareFraction,
      fractionLabel: hasHolding ? formatOwnershipFraction(share, shareFraction) : "",
      percentageLabel: hasHolding
        ? currentPresentation?.displayPercentageLabel ||
          formatOwnershipPercentage(share, shareFraction)
        : "",
      holdingValue,
      holdingValueKind: deceased ? "Notional value" : "Current value",
    };
  });
}

export function treeRegisterDisplayName(row = {}) {
  return [text(row.name), text(row.surname)].filter(Boolean).join(" ") || "Unnamed person";
}
