import { useEffect, useId, useRef, useState } from "react";
import { Check, FilePlus2, Pencil, Trash2, X } from "lucide-react";
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
  error,
  onRemove,
  onComplete,
}) {
  const number = index + 1;
  const editorId = useId();
  const isComplete = isCompletedCausaMortisDeclaration(declaration);
  const [editing, setEditing] = useState(!isComplete);
  const [draft, setDraft] = useState(() => ({ ...declaration }));
  const [submitted, setSubmitted] = useState(false);
  const summaryRef = useRef(null);
  const firstFieldRef = useRef(null);
  const restoreSummaryFocus = useRef(false);
  const chronologyError = draft.date
    ? validateCausaMortisDateChronology(draft.date, dateOfDeath)
    : "";
  const declarationError = submitted ? error || chronologyError : chronologyError;
  const update = (patch) => {
    setSubmitted(false);
    setDraft((current) => ({ ...current, ...patch, status: "draft" }));
  };

  useEffect(() => {
    if (editing) return;
    setDraft({ ...declaration });
  }, [declaration, editing]);

  useEffect(() => {
    if (editing && isComplete) firstFieldRef.current?.focus();
    if (!editing && restoreSummaryFocus.current) {
      restoreSummaryFocus.current = false;
      summaryRef.current?.focus();
    }
  }, [editing, isComplete]);

  const openEditor = () => {
    setDraft({ ...declaration });
    setSubmitted(false);
    setEditing(true);
  };

  const cancelEditor = () => {
    setSubmitted(false);
    if (!isComplete) {
      setDraft({ ...declaration });
      return;
    }
    setDraft({ ...declaration });
    restoreSummaryFocus.current = true;
    setEditing(false);
  };

  const save = () => {
    setSubmitted(true);
    if (onComplete({ ...draft, id: declaration.id }) === false) return;
    restoreSummaryFocus.current = true;
    setEditing(false);
  };

  if (!editing && isComplete) {
    const declaredShare = fractionLabel(
      {
        numerator: declaration.declaredShareNumerator,
        denominator: declaration.declaredShareDenominator,
      },
      0,
    );
    const rawValue = String(declaration.immovablePropertyValue ?? "").trim();
    const value = Number(rawValue);
    return (
      <div className="causa-mortis-card complete collapsed">
        <button
          type="button"
          ref={summaryRef}
          className="causa-mortis-summary"
          aria-label={`Edit Declaration Causa Mortis ${number}`}
          aria-expanded="false"
          aria-controls={editorId}
          onClick={openEditor}
        >
          <span>
            <strong>Declaration Causa Mortis {number}</strong>
            <small>
              {[isoDateToDisplay(declaration.date), declaration.notaryName]
                .filter(Boolean)
                .join(" · ")}
            </small>
          </span>
          <span>
            <b>{declaredShare}</b>
            {rawValue && Number.isFinite(value) && value >= 0 && (
              <small>{money.format(value)}</small>
            )}
          </span>
          <Pencil size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`Remove causa mortis declaration ${number}`}
          onClick={() => onRemove(declaration.id)}
        >
          <Trash2 size={14} />
        </button>
      </div>
    );
  }

  return (
    <div
      id={editorId}
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
            ref={firstFieldRef}
            min="0"
            max={MAX_FRACTION_INTEGER}
            step="1"
            required
            value={draft.declaredShareNumerator ?? ""}
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
            value={draft.declaredShareDenominator ?? ""}
            onChange={(event) => update({ declaredShareDenominator: event.target.value })}
          />
        </span>
      </label>

      <label>
        <span>Date of Declaration Causa Mortis</span>
        <DateInput
          aria-label={`Date of Declaration Causa Mortis ${number}`}
          required
          value={draft.date || ""}
          onChange={(date) => update({ date })}
        />
      </label>

      <label>
        <span>Notary</span>
        <input
          aria-label={`Notary for Declaration Causa Mortis ${number}`}
          required
          value={draft.notaryName || ""}
          onChange={(event) => update({ notaryName: event.target.value })}
          placeholder="Notary's full name"
        />
      </label>

      <label>
        <span>Value declared (optional)</span>
        <span className="currency-input">
          <b>€</b>
          <input
            aria-label={`Immovable property value declared causa mortis ${number}`}
            type="number"
            min="0"
            step="any"
            value={draft.immovablePropertyValue || ""}
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
                  checked={(draft.declarantPersonIds || []).includes(party.id)}
                  onChange={() => {
                    const declarants = new Set(draft.declarantPersonIds || []);
                    if (declarants.has(party.id)) declarants.delete(party.id);
                    else declarants.add(party.id);
                    update({ declarantPersonIds: [...declarants] });
                  }}
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
        <button type="button" className="primary-button" onClick={save}>
          <Check size={14} />
          {isComplete ? "Save declaration" : "OK"}
        </button>
        <button type="button" className="secondary-button" onClick={cancelEditor}>
          <X size={14} />
          Cancel
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
  hasUnknownDeathDate,
  errors = {},
  onAddDeclaration,
  onAddDeclarationForProperty,
  onRemoveDeclaration,
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
          error={errors[declaration.id]}
          onRemove={onRemoveDeclaration}
          onComplete={onCompleteDeclaration}
        />
      ))}
    </div>
  );
}
