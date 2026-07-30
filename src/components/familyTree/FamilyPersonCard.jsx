import { approximateFraction } from "../../domain/ownership.js";
import { linkedSpousesMissingDeathDates } from "../../domain/familyOwnership.js";
import { formattedDate, personDisplayName } from "../../domain/people.js";
import {
  DEFAULT_PERSON_CARD_FIELDS,
  normalisePersonCardFields,
} from "../../domain/personCardDisplay.js";
import { capitalisedName, compactNodeWidth, isDeceasedPerson } from "./treePresentation.js";

function ownershipParts(ownership, fields) {
  const fraction = approximateFraction(ownership);
  const fractionText = `${fraction.numerator}/${fraction.denominator}`;
  const percentageText = `${(ownership * 100).toLocaleString("en-MT", {
    maximumFractionDigits: 4,
  })}%`;

  return [
    fields.ownershipFraction && fractionText,
    fields.ownershipPercentage && percentageText,
  ].filter(Boolean);
}

function formattedCurrency(value) {
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat("en-MT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(value);
}

function availableCausaMortisDetails(person) {
  return (person.causaMortisDeclarations || [])
    .map((declaration) =>
      [formattedDate(declaration.date), String(declaration.notaryName || "").trim()]
        .filter(Boolean)
        .join(" · "),
    )
    .filter(Boolean);
}

export function FamilyPersonCard({
  person,
  variant = "",
  people,
  cardName,
  ownershipByPerson,
  causaMortisCoverageByPerson,
  personCardFields = DEFAULT_PERSON_CARD_FIELDS,
  propertyValue,
  selectedPersonId,
  onSelectPerson,
}) {
  const isDeceased = isDeceasedPerson(person, variant);
  const incompleteCausaMortis = (causaMortisCoverageByPerson[person.id] || []).filter(
    (row) => row.status !== "complete",
  );
  const hasOwnership = Object.prototype.hasOwnProperty.call(ownershipByPerson, person.id);
  const ownership = hasOwnership ? ownershipByPerson[person.id] : 0;
  const fields = normalisePersonCardFields({ personCardFields });
  const shareParts = hasOwnership ? ownershipParts(ownership, fields) : [];
  const ownershipValue = Number(propertyValue) * ownership;
  const causaMortisDetails = availableCausaMortisDetails(person);
  const isTestate = person.inheritanceBasis === "will";
  const spousesMissingDeathDates =
    isDeceased && !isTestate ? linkedSpousesMissingDeathDates(people, person.id) : [];
  const missingSpouseNames = spousesMissingDeathDates.map((spouse) =>
    capitalisedName(personDisplayName(spouse, people)),
  );
  const name = cardName(person);
  const personName =
    !person.isPlaceholder && String(person.fullName || "").trim()
      ? capitalisedName(personDisplayName(person, people))
      : name;
  const accessibleName = `${personName}${
    missingSpouseNames.length
      ? `. Missing spouse death ${missingSpouseNames.length === 1 ? "date" : "dates"} for ${missingSpouseNames.join(", ")}`
      : ""
  }`;
  const sexClass = ["Male", "Female"].includes(person.sex) ? person.sex.toLowerCase() : "";
  const classNames = [
    "family-node",
    sexClass,
    isDeceased && "deceased",
    incompleteCausaMortis.length && "cm-share-incomplete",
    spousesMissingDeathDates.length && "succession-date-incomplete",
    person.isPlaceholder && "placeholder",
    selectedPersonId === person.id && "selected",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      data-person-id={person.id}
      aria-label={`Open ${accessibleName}`}
      onClick={() => onSelectPerson?.(person.id)}
      className={classNames}
      style={{ "--family-node-width": `${compactNodeWidth(name)}px` }}
    >
      <div className="family-node-name" title={accessibleName}>
        {name}
      </div>
      {!person.isPlaceholder && missingSpouseNames.length > 0 && (
        <div className="family-node-succession-alert">
          Missing spouse death {missingSpouseNames.length === 1 ? "date" : "dates"}:{" "}
          {missingSpouseNames.join(", ")}
        </div>
      )}
      {!person.isPlaceholder && shareParts.length > 0 && (
        <div className="family-node-ownership">{shareParts.join(" · ")}</div>
      )}
      {!person.isPlaceholder &&
        fields.ownershipValue &&
        hasOwnership &&
        Number(propertyValue) > 0 && (
          <div className="family-node-detail">Value {formattedCurrency(ownershipValue)}</div>
        )}
      {!person.isPlaceholder && fields.dateOfDeath && isDeceased && person.dateOfDeath && (
        <div className="family-node-detail">Died {formattedDate(person.dateOfDeath)}</div>
      )}
      {!person.isPlaceholder && fields.successionBasis && isDeceased && (
        <div className="family-node-detail">{isTestate ? "Testate" : "Intestate"}</div>
      )}
      {!person.isPlaceholder &&
        fields.willDetails &&
        isDeceased &&
        isTestate &&
        (person.willDate || person.willNotaryName) && (
          <div className="family-node-detail">
            Will{" "}
            {[formattedDate(person.willDate), String(person.willNotaryName || "").trim()]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}
      {!person.isPlaceholder && fields.causaMortisDetails && causaMortisDetails.length > 0 && (
        <div className="family-node-detail">CM {causaMortisDetails.join("; ")}</div>
      )}
    </button>
  );
}
