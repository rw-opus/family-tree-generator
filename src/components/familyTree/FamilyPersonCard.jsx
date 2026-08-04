import { approximateFraction } from "../../domain/ownership.js";
import { linkedSpousesMissingDeathDates } from "../../domain/familyOwnership.js";
import { INHERITANCE_CAUSA_MORTIS_CUTOFF } from "../../domain/article5A.js";
import { displayNotaryName } from "../../domain/notary.js";
import { displayWillDate, operativeWill, personWills } from "../../domain/wills.js";
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

function ownershipParts(ownership, fields, exactFraction) {
  const fraction = exactFraction?.denominator ? exactFraction : approximateFraction(ownership);
  const fractionText = `${fraction.numerator}/${fraction.denominator}`;
  const percentageText = `${(ownership * 100).toLocaleString("en-MT", {
    maximumFractionDigits: 2,
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
  if (person.dateOfDeath && person.dateOfDeath < INHERITANCE_CAUSA_MORTIS_CUTOFF) {
    return [];
  }
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
  ownershipFractionsByPerson = {},
  currentOwnershipByPerson = {},
  causaMortisCoverageByPerson,
  personCardFields = DEFAULT_PERSON_CARD_FIELDS,
  propertyValue,
  ownershipSnapshotActive = false,
  selectedPersonId,
  onSelectPerson,
  stackedLegalDetails = false,
  generation = 0,
  isWidestGeneration = false,
  tabIndex = -1,
  onKeyDown,
}) {
  const isDeceased = isDeceasedPerson(person, variant);
  const incompleteCausaMortis = (causaMortisCoverageByPerson[person.id] || []).filter(
    (row) => row.status !== "complete",
  );
  const hasOwnership = Object.prototype.hasOwnProperty.call(ownershipByPerson, person.id);
  const ownership = hasOwnership ? ownershipByPerson[person.id] : 0;
  const hasCurrentOwnership = Object.prototype.hasOwnProperty.call(
    currentOwnershipByPerson,
    person.id,
  );
  const currentOwnership = hasCurrentOwnership ? currentOwnershipByPerson[person.id] : 0;
  const fields = normalisePersonCardFields({ personCardFields });
  const shareParts = hasOwnership
    ? ownershipParts(ownership, fields, ownershipFractionsByPerson[person.id])
    : [];
  const currentOwnershipValue = Number(propertyValue) * currentOwnership;
  const causaMortisDetails = availableCausaMortisDetails(person);
  const isTestate = person.inheritanceBasis === "will";
  const recordedWills = personWills(person).filter(
    (will) => will.date || will.notaryName || will.description,
  );
  const latestWill = operativeWill(person);
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
  const showSurname = Boolean(surname);
  const personName =
    !person.isPlaceholder && String(person.fullName || "").trim()
      ? capitalisedName(personDisplayName(person, people))
      : name;
  const accessibleName = `${personName}${
    missingSpouseNames.length
      ? `. Missing spouse death ${missingSpouseNames.length === 1 ? "date" : "dates"} for ${missingSpouseNames.join(", ")}`
      : ""
  }`;
  const survivalStatusRequired = person.survivalStatusRequired === true;
  const actionRequired = incompleteCausaMortis.length > 0 || survivalStatusRequired;
  const actionRequiredGuidance = actionRequired
    ? "Action required: open this person's card and update the missing detail."
    : "";
  const sexClass = ["Male", "Female"].includes(person.sex) ? person.sex.toLowerCase() : "";
  const classNames = [
    "family-node",
    sexClass,
    isDeceased && "deceased",
    incompleteCausaMortis.length && "cm-share-incomplete",
    spousesMissingDeathDates.length && "succession-date-incomplete",
    survivalStatusRequired && "survival-status-required",
    person.isPlaceholder && "placeholder",
    stackedLegalDetails && !person.isPlaceholder && "stacked-legal-details",
    ownershipSnapshotActive && hasOwnership && "trace-ownership-snapshot",
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
      aria-label={`Open ${accessibleName}${actionRequiredGuidance ? `. ${actionRequiredGuidance}` : ""}`}
      title={actionRequiredGuidance || undefined}
      onClick={() => onSelectPerson?.(person.id)}
      onKeyDown={onKeyDown}
      tabIndex={tabIndex}
      className={classNames}
      style={{
        "--family-node-width": `${stackedLegalDetails ? 112 : compactNodeWidth(name)}px`,
      }}
    >
      {!person.isPlaceholder ? (
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
      {!person.isPlaceholder && survivalStatusRequired && (
        <div className="family-node-survival-alert">Confirm whether alive or dead</div>
      )}
      {!person.isPlaceholder && shareParts.length > 0 && (
        <div className="family-node-ownership">{shareParts.join(" · ")}</div>
      )}
      {!person.isPlaceholder &&
        fields.ownershipValue &&
        hasCurrentOwnership &&
        Number(propertyValue) > 0 && (
          <div className="family-node-detail">
            {ownershipSnapshotActive ? "Value at this step" : "Current value"}{" "}
            {formattedCurrency(currentOwnershipValue)}
          </div>
        )}
      {!person.isPlaceholder && fields.dateOfDeath && isDeceased && person.dateOfDeath && (
        <div className="family-node-detail">d. {formattedDate(person.dateOfDeath)}</div>
      )}
      {!person.isPlaceholder && fields.successionBasis && isDeceased && (
        <div className="family-node-detail">{isTestate ? "Testate" : "Intestate"}</div>
      )}
      {!person.isPlaceholder &&
        fields.willDetails &&
        isDeceased &&
        isTestate &&
        recordedWills.length > 0 &&
        (stackedLegalDetails ? (
          <>
            {recordedWills.map((will) => (
              <div className="family-node-will-details" key={will.id}>
                {will.date && (
                  <div className="family-node-detail">Will {displayWillDate(will.date)}</div>
                )}
                {will.notaryName && (
                  <div className="family-node-detail">{displayNotaryName(will.notaryName)}</div>
                )}
                {!will.notaryName && will.description && (
                  <div className="family-node-detail">{will.description}</div>
                )}
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="family-node-detail">
              Will{latestWill?.date ? ` ${displayWillDate(latestWill.date)}` : ""}
            </div>
            {latestWill?.notaryName && (
              <div className="family-node-detail">{displayNotaryName(latestWill.notaryName)}</div>
            )}
            {!latestWill?.notaryName && latestWill?.description && (
              <div className="family-node-detail">{latestWill.description}</div>
            )}
          </>
        ))}
      {!person.isPlaceholder &&
        stackedLegalDetails &&
        fields.causaMortisDetails &&
        causaMortisDetails.map((declaration, index) => (
          <div className="family-node-cm-details" key={`${declaration.date}-${index}`}>
            {declaration.date && (
              <div className="family-node-detail">
                <abbr title="Declaration Causa Mortis">CM</abbr> deed {declaration.date}
              </div>
            )}
            {declaration.notaryName && (
              <div className="family-node-detail">
                <abbr title="Declaration Causa Mortis">CM</abbr> Notary {declaration.notaryName}
              </div>
            )}
          </div>
        ))}
      {!person.isPlaceholder &&
        !stackedLegalDetails &&
        fields.causaMortisDetails &&
        causaMortisDetails.length > 0 && (
          <div className="family-node-detail">
            <abbr title="Declaration Causa Mortis">CM</abbr>{" "}
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
