import { approximateFraction } from "../../domain/ownership.js";
import { personDisplayName } from "../../domain/people.js";
import { capitalisedName, compactNodeWidth, isDeceasedPerson } from "./treePresentation.js";

function ownershipLabel(ownership, shareDisplay) {
  if (ownership === 0) return "0%";

  const fraction = approximateFraction(ownership);
  const fractionText = `${fraction.numerator}/${fraction.denominator}`;
  const percentageText = `${(ownership * 100).toLocaleString("en-MT", {
    maximumFractionDigits: 4,
  })}%`;

  if (shareDisplay === "fraction") return fractionText;
  if (shareDisplay === "percentage") return percentageText;
  return `${fractionText} · ${percentageText}`;
}

export function FamilyPersonCard({
  person,
  variant = "",
  people,
  cardName,
  ownershipByPerson,
  causaMortisCoverageByPerson,
  shareDisplay,
  showOwnership,
  selectedPersonId,
  onSelectPerson,
}) {
  const isDeceased = isDeceasedPerson(person, variant);
  const incompleteCausaMortis = (causaMortisCoverageByPerson[person.id] || []).filter(
    (row) => row.status !== "complete",
  );
  const hasOwnership = Object.prototype.hasOwnProperty.call(ownershipByPerson, person.id);
  const ownership = hasOwnership ? ownershipByPerson[person.id] : 0;
  const name = cardName(person);
  const accessibleName =
    !person.isPlaceholder && String(person.fullName || "").trim()
      ? capitalisedName(personDisplayName(person, people))
      : name;
  const sexClass = ["Male", "Female"].includes(person.sex) ? person.sex.toLowerCase() : "";
  const classNames = [
    "family-node",
    sexClass,
    isDeceased && "deceased",
    incompleteCausaMortis.length && "cm-share-incomplete",
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
      {!person.isPlaceholder && showOwnership && hasOwnership && (
        <div className="family-node-ownership">
          {ownershipLabel(ownership, shareDisplay)} ownership
        </div>
      )}
    </button>
  );
}
