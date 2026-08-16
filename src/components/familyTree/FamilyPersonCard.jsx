import { compareFractions } from "../../domain/fractions.js";
import {
  formatOwnershipFraction,
  formatOwnershipPercentage,
  ownershipFraction,
  recordedNonNegativeMoney,
} from "../../domain/ownershipPresentation.js";
import { isPersonDeceased } from "../../domain/familyOwnership.js";
import {
  findPartnerRelationship,
  partnerIdsForPerson,
  partnerRelationshipStatusAt,
} from "../../domain/partnerRelationships.js";
import { INHERITANCE_CAUSA_MORTIS_CUTOFF } from "../../domain/article5A.js";
import { displayNotaryName } from "../../domain/notary.js";
import { isCausaMortisCoverageActionRequired } from "../../domain/causaMortisPresentation.js";
import { isPotentialParentSurvivalUnresolved } from "../../domain/potentialParentSurvival.js";
import { validateWillDateChronology } from "../../domain/chronology.js";
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

function ownershipParts(ownership, fields, exactFraction, displayPercentageLabel = "") {
  return [
    fields.ownershipFraction && formatOwnershipFraction(ownership, exactFraction),
    fields.ownershipPercentage &&
      (displayPercentageLabel || formatOwnershipPercentage(ownership, exactFraction)),
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

function availableCausaMortisDetails(person, propertyId = "") {
  if (person.dateOfDeath && person.dateOfDeath < INHERITANCE_CAUSA_MORTIS_CUTOFF) {
    return [];
  }
  return (person.causaMortisDeclarations || [])
    .filter(
      (declaration) =>
        declaration.status === "complete" &&
        (!propertyId || !declaration.propertyId || declaration.propertyId === propertyId),
    )
    .map((declaration) => ({
      date: formattedDate(declaration.date),
      notaryName: displayNotaryName(declaration.notaryName),
    }))
    .filter((declaration) => declaration.date || declaration.notaryName);
}

export function familyPersonCardState({
  person,
  people = [],
  variant = "",
  deathDateMissing = false,
  historicalLawWarnings = [],
  causaMortisCoverage = [],
}) {
  const isDeceased = isDeceasedPerson(person, variant);
  const ownDeathDateMissing =
    deathDateMissing === true && isDeceased && !String(person.dateOfDeath || "").trim();
  const causaMortisActionRequired = causaMortisCoverage.some(isCausaMortisCoverageActionRequired);
  const recordedWills = personWills(person).filter(
    (will) => will.date || will.notaryName || will.description,
  );
  const validRecordedWills = recordedWills.filter(
    (will) => validateWillDateChronology(will.date, person.dateOfDeath) === "",
  );
  const latestWill = operativeWill(person);
  const isTestate = person.inheritanceBasis === "will";
  const willDetailsActionRequired =
    isDeceased && isTestate && (validRecordedWills.length !== recordedWills.length || !latestWill);
  const excludedLinkedSpouses =
    isDeceased && person.unmarriedOrWidowedAtDeath === true
      ? partnerIdsForPerson(people, person.id)
          .map((partnerId) => ({
            partner: people.find((candidate) => candidate.id === partnerId),
            relationship: findPartnerRelationship(people, person.id, partnerId),
          }))
          .filter(
            ({ partner, relationship }) =>
              partner &&
              !isPotentialParentSurvivalUnresolved(partner) &&
              partnerRelationshipStatusAt(relationship, person.dateOfDeath || "") === "active" &&
              (!isPersonDeceased(partner) ||
                (Boolean(person.dateOfDeath) &&
                  Boolean(partner.dateOfDeath) &&
                  partner.dateOfDeath > person.dateOfDeath)),
          )
          .map(({ partner }) => partner)
      : [];
  const survivalStatusRequired = isPotentialParentSurvivalUnresolved(person);
  const surnameAtBirthReviewRequired = person.surnameAtBirthReviewRequired === true;
  const historicalLawWarning = isDeceased ? historicalLawWarnings.join(" ") : "";
  const spouseAtDeathConflict = excludedLinkedSpouses.length > 0;

  return {
    causaMortisActionRequired,
    historicalLawWarning,
    isDeceased,
    isTestate,
    latestWill,
    validRecordedWills,
    deathDateMissing: ownDeathDateMissing,
    excludedLinkedSpouses,
    spouseAtDeathConflict,
    survivalStatusRequired,
    surnameAtBirthReviewRequired,
    willDetailsActionRequired,
    redActionRequired:
      causaMortisActionRequired ||
      survivalStatusRequired ||
      surnameAtBirthReviewRequired ||
      spouseAtDeathConflict ||
      willDetailsActionRequired ||
      Boolean(historicalLawWarning),
  };
}

export function FamilyPersonCard({
  person,
  variant = "",
  people,
  deathDateMissing = false,
  cardName,
  ownershipByPerson,
  ownershipFractionsByPerson = {},
  currentOwnerPresentationsByPerson = {},
  historicalLawWarningsByPerson = {},
  causaMortisCoverageByPerson = {},
  personCardFields = DEFAULT_PERSON_CARD_FIELDS,
  propertyId = "",
  ownershipSnapshotActive = false,
  selectedPersonId,
  onSelectPerson,
  stackedLegalDetails = false,
  generation = 0,
  isWidestGeneration = false,
  tabIndex = -1,
  onKeyDown,
}) {
  const cardState = familyPersonCardState({
    person,
    people,
    variant,
    deathDateMissing,
    historicalLawWarnings: historicalLawWarningsByPerson[person.id] || [],
    causaMortisCoverage: causaMortisCoverageByPerson[person.id] || [],
  });
  const {
    causaMortisActionRequired,
    historicalLawWarning,
    isDeceased,
    isTestate,
    latestWill,
    validRecordedWills,
    deathDateMissing: ownDeathDateMissing,
    excludedLinkedSpouses,
    spouseAtDeathConflict,
    survivalStatusRequired,
    surnameAtBirthReviewRequired,
    willDetailsActionRequired,
  } = cardState;
  const hasOwnership = Object.prototype.hasOwnProperty.call(ownershipByPerson, person.id);
  const ownership = hasOwnership ? ownershipByPerson[person.id] : 0;
  const currentOwnerPresentation = currentOwnerPresentationsByPerson[person.id] || null;
  const currentOwnershipValue = recordedNonNegativeMoney(currentOwnerPresentation?.value);
  const hasCurrentOwnership = Boolean(currentOwnerPresentation);
  const useCurrentPresentation = !ownershipSnapshotActive && !isDeceased && hasCurrentOwnership;
  const displayedOwnership = useCurrentPresentation ? currentOwnerPresentation.share : ownership;
  const displayedOwnershipFraction = useCurrentPresentation
    ? currentOwnerPresentation.shareFraction
    : ownershipFraction(ownership, ownershipFractionsByPerson[person.id]);
  const hasDisplayedOwnership = useCurrentPresentation || hasOwnership;
  const fields = normalisePersonCardFields({ personCardFields });
  const shareParts = hasDisplayedOwnership
    ? ownershipParts(
        displayedOwnership,
        fields,
        displayedOwnershipFraction,
        useCurrentPresentation ? currentOwnerPresentation.displayPercentageLabel : "",
      )
    : [];
  const displayedShareIsCurrent =
    currentOwnerPresentation &&
    compareFractions(displayedOwnershipFraction, currentOwnerPresentation.shareFraction) === 0;
  const causaMortisDetails = availableCausaMortisDetails(person, propertyId);
  const excludedSpouseNames = excludedLinkedSpouses.map((spouse) =>
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
  const accessibleName = `${personName}${ownDeathDateMissing ? ". Date of death missing" : ""}${
    spouseAtDeathConflict
      ? `. No spouse survived is selected, so ${excludedSpouseNames.join(", ")} is excluded from the succession`
      : ""
  }`;
  const missingDataActionRequired =
    causaMortisActionRequired ||
    survivalStatusRequired ||
    surnameAtBirthReviewRequired ||
    spouseAtDeathConflict ||
    willDetailsActionRequired;
  const actionRequiredGuidance = [
    missingDataActionRequired &&
      "Action required: open this person's card and update the missing detail.",
    historicalLawWarning && "Action required: check the historical law before relying on shares.",
  ]
    .filter(Boolean)
    .join(" ");
  const sexClass = ["Male", "Female"].includes(person.sex) ? person.sex.toLowerCase() : "";
  const classNames = [
    "family-node",
    sexClass,
    isDeceased && "deceased",
    causaMortisActionRequired && "cm-share-incomplete",
    ownDeathDateMissing && "succession-date-incomplete",
    survivalStatusRequired && "survival-status-required",
    surnameAtBirthReviewRequired && "surname-at-birth-review-required",
    spouseAtDeathConflict && "spouse-at-death-conflict",
    willDetailsActionRequired && "will-details-invalid",
    historicalLawWarning && "historical-law-review-required",
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
      title={[actionRequiredGuidance, historicalLawWarning].filter(Boolean).join(" ") || undefined}
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
      {!person.isPlaceholder && ownDeathDateMissing && (
        <div className="family-node-succession-alert">Date of death missing</div>
      )}
      {!person.isPlaceholder && spouseAtDeathConflict && (
        <div className="family-node-succession-alert">
          No spouse at death: {excludedSpouseNames.join(", ")} excluded
        </div>
      )}
      {!person.isPlaceholder && survivalStatusRequired && (
        <div className="family-node-survival-alert">Confirm whether alive or dead</div>
      )}
      {!person.isPlaceholder && surnameAtBirthReviewRequired && (
        <div className="family-node-surname-alert">Confirm surname at birth</div>
      )}
      {!person.isPlaceholder && historicalLawWarning && (
        <div className="family-node-law-alert">Check historical law</div>
      )}
      {!person.isPlaceholder && willDetailsActionRequired && (
        <div className="family-node-will-alert">Fix will date</div>
      )}
      {!person.isPlaceholder && shareParts.length > 0 && (
        <div className="family-node-ownership">{shareParts.join(" · ")}</div>
      )}
      {!person.isPlaceholder &&
        fields.ownershipValue &&
        hasCurrentOwnership &&
        displayedShareIsCurrent &&
        currentOwnershipValue !== null && (
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
        validRecordedWills.length > 0 &&
        (stackedLegalDetails ? (
          <>
            {validRecordedWills.map((will) => (
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
        isDeceased &&
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
        isDeceased &&
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
