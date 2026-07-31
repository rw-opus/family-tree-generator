import { approximateFraction } from "../../domain/ownership.js";
import { linkedSpousesMissingDeathDates } from "../../domain/familyOwnership.js";
import { displayNotaryName } from "../../domain/notary.js";
import {
  formattedDate,
  personDisplayName,
  personGivenNames,
  personSurname,
} from "../../domain/people.js";
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
    .filter((declaration) => declaration.status === "complete")
    .map((declaration) => ({
      date: formattedDate(declaration.date),
      notaryName: displayNotaryName(declaration.notaryName),
    }))
    .filter((declaration) => declaration.date || declaration.notaryName);
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
  stackedLegalDetails = false,
  generation = 0,
  isWidestGeneration = false,
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
  const givenNames = capitalisedName(personGivenNames(person));
  const surname = capitalisedName(personSurname(person));
  const surnameAtBirth = capitalisedName(person.surnameAtBirth);
  const differentBirthSurname =
    surnameAtBirth && surnameAtBirth.localeCompare(surname, "en-MT", { sensitivity: "base" }) !== 0;
  // A descendant carrying the father's surname does not need it repeated on
  // every card; it is only worth the space where it differs.
  const fatherSurname = capitalisedName(
    personSurname(people.find((candidate) => candidate.id === person.fatherId) || {}),
  );
  const showSurname =
    Boolean(surname) &&
    (!fatherSurname ||
      fatherSurname.localeCompare(surname, "en-MT", { sensitivity: "base" }) !== 0);
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
    stackedLegalDetails && !person.isPlaceholder && "stacked-legal-details",
    selectedPersonId === person.id && "selected",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      data-person-id={person.id}
      data-family-generation={generation}
      data-widest-generation={isWidestGeneration ? "true" : undefined}
      aria-label={`Open ${accessibleName}`}
      onClick={() => onSelectPerson?.(person.id)}
      className={classNames}
      style={{
        "--family-node-width": `${stackedLegalDetails ? 112 : compactNodeWidth(name)}px`,
      }}
    >
      {stackedLegalDetails && !person.isPlaceholder ? (
        <div className="family-node-stacked-identity" title={accessibleName}>
          <div className="family-node-name">{givenNames || name}</div>
          {showSurname && <div className="family-node-surname">{surname}</div>}
          {differentBirthSurname && (
            <div className="family-node-birth-surname">Born {surnameAtBirth}</div>
          )}
        </div>
      ) : (
        <div className="family-node-name" title={accessibleName}>
          {name}
        </div>
      )}
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
      {!person.isPlaceholder &&
        (stackedLegalDetails || fields.dateOfDeath) &&
        isDeceased &&
        person.dateOfDeath && (
          <div className="family-node-detail">Died {formattedDate(person.dateOfDeath)}</div>
        )}
      {!person.isPlaceholder && fields.successionBasis && isDeceased && (
        <div className="family-node-detail">{isTestate ? "Testate" : "Intestate"}</div>
      )}
      {!person.isPlaceholder &&
        (stackedLegalDetails || fields.willDetails) &&
        isDeceased &&
        isTestate &&
        (person.willDate || person.willNotaryName) &&
        (stackedLegalDetails ? (
          <>
            {person.willDate && (
              <div className="family-node-detail">Will {formattedDate(person.willDate)}</div>
            )}
            {person.willNotaryName && (
              <div className="family-node-detail">
                Publishing Notary {displayNotaryName(person.willNotaryName)}
              </div>
            )}
          </>
        ) : (
          <div className="family-node-detail">
            Will{" "}
            {[formattedDate(person.willDate), displayNotaryName(person.willNotaryName)]
              .filter(Boolean)
              .join(" · ")}
          </div>
        ))}
      {!person.isPlaceholder &&
        stackedLegalDetails &&
        causaMortisDetails.map((declaration, index) => (
          <div className="family-node-cm-details" key={`${declaration.date}-${index}`}>
            {declaration.date && (
              <div className="family-node-detail">CM deed {declaration.date}</div>
            )}
            {declaration.notaryName && (
              <div className="family-node-detail">CM Notary {declaration.notaryName}</div>
            )}
          </div>
        ))}
      {!person.isPlaceholder &&
        !stackedLegalDetails &&
        fields.causaMortisDetails &&
        causaMortisDetails.length > 0 && (
          <div className="family-node-detail">
            CM{" "}
            {causaMortisDetails
              .map((declaration) =>
                [declaration.date, declaration.notaryName].filter(Boolean).join(" · "),
              )
              .join("; ")}
          </div>
        )}
    </button>
  );
}
