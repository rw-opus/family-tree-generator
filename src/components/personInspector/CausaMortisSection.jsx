import { Check, FilePlus2, Trash2 } from "lucide-react";
import { isCompletedCausaMortisDeclaration } from "../../domain/causaMortisCoverage.js";
import {
  advisoryCausaMortisCoverage,
  visibleCausaMortisCoverage,
} from "../../domain/causaMortisPresentation.js";
import { validateCausaMortisDateChronology } from "../../domain/chronology.js";
import { isoDateToDisplay } from "../../domain/dateFormat.js";
import { MAX_FRACTION_INTEGER } from "../../domain/fractions.js";
import { approximateFraction } from "../../domain/ownership.js";
import { DateInput } from "../DateInput.jsx";

const money = new Intl.NumberFormat("en-MT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

const fractionLabel = (exactFraction, numericFallback = 0) => {
  const fraction = exactFraction?.denominator
    ? exactFraction
    : approximateFraction(Math.max(0, numericFallback));
  return `${fraction.numerator}/${fraction.denominator}`;
};

const missingFractionFor = (coverage) =>
  coverage.missingFraction?.denominator
    ? coverage.missingFraction
    : approximateFraction(Math.max(0, -Number(coverage.difference || 0)));

function coverageActionLabel(coverage) {
  switch (coverage.status) {
    case "date-unknown":
      return coverage.deathDateText
        ? `Resolve date (${isoDateToDisplay(coverage.deathDateText) || coverage.deathDateText})`
        : "Enter exact death date";
    case "allocation-unresolved":
      return "Check declarants";
    // Retained for older saved cases; the current coverage builder emits "under".
    case "missing":
    case "mixed":
    case "under": {
      const missingFraction = missingFractionFor(coverage);
      return `Missing ${fractionLabel(missingFraction)}`;
    }
    case "complete":
      return "Complete";
    default:
      return "Check declaration";
  }
}

function coverageRequirementLabel(coverage) {
  if (coverage.status === "date-unknown") {
    return "Coverage cannot be decided from an unknown or approximate death date.";
  }
  const required = fractionLabel(coverage.requiredFraction, coverage.requiredShare);
  return coverage.status === "complete"
    ? `Required ${required} · Declared ${required}`
    : `Required ${required}`;
}

function missingRecipientLabels(coverage) {
  return (coverage.recipientCoverage || [])
    .filter((recipient) => recipient.status === "under")
    .map(
      (recipient) => `${recipient.name}: missing ${fractionLabel(missingFractionFor(recipient))}`,
    );
}

function CausaMortisCoverage({ coverage = [], properties = [], onAddDeclaration }) {
  const visibleCoverage = visibleCausaMortisCoverage(coverage);
  if (!visibleCoverage.length) return null;

  return (
    <div className="causa-mortis-coverage" aria-label="Causa mortis share coverage">
      {visibleCoverage.map((row) => {
        const property = properties.find((candidate) => candidate.id === row.propertyId);
        const sellingPrice = Number(property?.saleValue);
        const hasSellingPrice = Number.isFinite(sellingPrice) && sellingPrice > 0;
        const recipientIssues = missingRecipientLabels(row);

        return (
          <button
            type="button"
            className={`causa-mortis-coverage-row ${row.status}`}
            key={row.propertyId}
            onClick={() => onAddDeclaration(row.propertyId)}
            aria-label="Insert another causa mortis declaration"
            title="Insert another Declaration Causa Mortis for this property."
          >
            <span>
              <small>{coverageRequirementLabel(row)}</small>
              {recipientIssues.length > 0 && <small>{recipientIssues.join(" · ")}</small>}
              {row.status !== "date-unknown" && hasSellingPrice && (
                <small>
                  Required share of selling price {money.format(sellingPrice * row.requiredShare)}
                </small>
              )}
            </span>
            <b>{coverageActionLabel(row)}</b>
          </button>
        );
      })}
    </div>
  );
}

function CausaMortisOverDeclarationAdvice({ coverage = [] }) {
  if (!advisoryCausaMortisCoverage(coverage).length) return null;

  return (
    <p className="causa-mortis-over-advice">
      An entered CM fraction exceeds an inherited share. The tax calculation reduces the declaration
      proportionately to the share inherited.
    </p>
  );
}

function CausaMortisDeclaration({
  declaration,
  index,
  candidates = [],
  candidateLabel,
  dateOfDeath,
  allHeirsDeceased,
  error,
  onUpdate,
  onRemove,
  onToggleDeclarant,
  onComplete,
}) {
  const number = index + 1;
  const chronologyError = declaration.date
    ? validateCausaMortisDateChronology(declaration.date, dateOfDeath)
    : "";
  const declarationError = error || chronologyError;
  const isComplete = isCompletedCausaMortisDeclaration(declaration);
  const update = (patch) => onUpdate(declaration.id, patch);

  return (
    <div
      className={`causa-mortis-card ${isComplete ? "complete" : "draft"}${
        chronologyError ? " chronology-invalid" : ""
      }`}
    >
      <div className="causa-mortis-card-heading">
        <strong>Declaration Causa Mortis {number}</strong>
        <button
          type="button"
          className="icon-button"
          aria-label={`Remove causa mortis declaration ${number}`}
          onClick={() => onRemove(declaration.id)}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <label>
        <span>
          Share declared <abbr title="Declaration Causa Mortis">CM</abbr>
        </span>
        <span className="causa-mortis-fraction">
          <input
            aria-label={`Causa mortis share numerator ${number}`}
            type="number"
            min="0"
            max={MAX_FRACTION_INTEGER}
            step="1"
            required
            value={declaration.declaredShareNumerator ?? ""}
            onChange={(event) => update({ declaredShareNumerator: event.target.value })}
          />
          <b>/</b>
          <input
            aria-label={`Causa mortis share denominator ${number}`}
            type="number"
            min="1"
            max={MAX_FRACTION_INTEGER}
            step="1"
            required
            value={declaration.declaredShareDenominator ?? ""}
            onChange={(event) => update({ declaredShareDenominator: event.target.value })}
          />
        </span>
      </label>

      <label>
        <span>Date of Declaration Causa Mortis</span>
        <DateInput
          aria-label={`Date of Declaration Causa Mortis ${number}`}
          required
          value={declaration.date || ""}
          onChange={(date) => update({ date })}
        />
      </label>

      <label>
        <span>Notary</span>
        <input
          aria-label={`Notary for Declaration Causa Mortis ${number}`}
          required
          value={declaration.notaryName || ""}
          onChange={(event) => update({ notaryName: event.target.value })}
          placeholder="Notary's full name"
        />
      </label>

      <label>
        <span>Value declared{allHeirsDeceased ? " (optional)" : ""}</span>
        <span className="currency-input">
          <b>€</b>
          <input
            aria-label={`Immovable property value declared causa mortis ${number}`}
            type="number"
            min="0"
            step="any"
            required={!allHeirsDeceased}
            value={declaration.immovablePropertyValue || ""}
            onChange={(event) => update({ immovablePropertyValue: event.target.value })}
          />
        </span>
      </label>

      <div className="causa-mortis-declarants">
        <strong>Declarants / heirs</strong>
        <small>Untick anyone who did not declare.</small>
        {candidates.length ? (
          <div>
            {candidates.map((party) => (
              <label key={party.id}>
                <input
                  type="checkbox"
                  checked={(declaration.declarantPersonIds || []).includes(party.id)}
                  onChange={() => onToggleDeclarant(declaration, party.id)}
                />
                {candidateLabel(party)}
              </label>
            ))}
          </div>
        ) : (
          <small>Add or identify the heirs in this case before selecting declarants.</small>
        )}
      </div>

      <div className="causa-mortis-card-actions">
        {declarationError && <small role="alert">{declarationError}</small>}
        <button
          type="button"
          className="primary-button"
          disabled={isComplete}
          onClick={() => onComplete(declaration)}
        >
          <Check size={14} />
          OK
        </button>
      </div>
    </div>
  );
}

export function CausaMortisSection({
  declarations = [],
  coverage = [],
  properties = [],
  candidates = [],
  candidateLabel,
  dateOfDeath,
  allHeirsDeceased,
  hasUnknownDeathDate,
  errors = {},
  onAddDeclaration,
  onAddDeclarationForProperty,
  onUpdateDeclaration,
  onRemoveDeclaration,
  onToggleDeclarant,
  onCompleteDeclaration,
}) {
  return (
    <div className="causa-mortis-records">
      <div className="causa-mortis-heading">
        <div>
          <strong>Causa Mortis</strong>
          {hasUnknownDeathDate && <small>Enter the exact death date.</small>}
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={onAddDeclaration}
          title={
            declarations.length
              ? "Insert another Declaration Causa Mortis."
              : "Record the first Declaration Causa Mortis."
          }
        >
          <FilePlus2 size={14} />
          Insert CM Declaration
        </button>
      </div>

      <CausaMortisCoverage
        coverage={coverage}
        properties={properties}
        onAddDeclaration={onAddDeclarationForProperty}
      />
      <CausaMortisOverDeclarationAdvice coverage={coverage} />

      {!declarations.length && (
        <small className="causa-mortis-empty">No declaration recorded.</small>
      )}

      {declarations.map((declaration, index) => (
        <CausaMortisDeclaration
          key={declaration.id}
          declaration={declaration}
          index={index}
          candidates={candidates}
          candidateLabel={candidateLabel}
          dateOfDeath={dateOfDeath}
          allHeirsDeceased={allHeirsDeceased}
          error={errors[declaration.id]}
          onUpdate={onUpdateDeclaration}
          onRemove={onRemoveDeclaration}
          onToggleDeclarant={onToggleDeclarant}
          onComplete={onCompleteDeclaration}
        />
      ))}
    </div>
  );
}
