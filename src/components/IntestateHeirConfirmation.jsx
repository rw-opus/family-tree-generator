import { useState } from "react";
import { Check, Trash2 } from "lucide-react";
import {
  confirmedIntestacyAllocations,
  intestacyConfirmationReadiness,
  intestacyAllocationSignature,
  intestacyShareTotalIsComplete,
  isPersonDeceased,
  linkedSpousesFor,
  linkedSpousesMissingDeathDates,
} from "../domain/familyOwnership.js";
import { approximateFraction } from "../domain/ownership.js";
import {
  fractionForShare,
  shareFromFractionInput,
  shareFromPercentage,
  shareFromPercentageInput,
} from "../domain/shares.js";
import { DateInput } from "./DateInput.jsx";

const OTHER_PERSON = "__other_person__";
const totalPercentage = (rows = []) =>
  rows.reduce((total, row) => total + (Number(row.sharePercent) || 0), 0);

function shareLabel(share, shareDisplay) {
  const fraction = approximateFraction(share);
  const fractionText = `${fraction.numerator}/${fraction.denominator}`;
  const percentageText = `${(share * 100).toLocaleString("en-MT", {
    maximumFractionDigits: 4,
  })}%`;
  if (shareDisplay === "fraction") return fractionText;
  if (shareDisplay === "percentage") return percentageText;
  return `${fractionText} · ${percentageText}`;
}

function totalLabel(totalPercent, shareDisplay) {
  if (intestacyShareTotalIsComplete(totalPercent)) return shareLabel(1, shareDisplay);
  return `${totalPercent.toLocaleString("en-MT", { maximumFractionDigits: 8 })}%`;
}

export function IntestacyProposal({
  calculated,
  people,
  displayName,
  shareDisplay = "fraction",
  title = "Proposed under intestacy",
  actionLabel = "",
  onApply,
}) {
  const entries = [...(calculated?.shares || new Map()).entries()];
  const peopleById = new Map(people.map((person) => [person.id, person]));
  return (
    <div className="calculated-intestacy">
      <div className="intestate-confirmation-heading">
        <strong>{title}</strong>
        {entries.length > 0 && actionLabel && onApply && (
          <button type="button" className="text-button" onClick={onApply}>
            {actionLabel}
          </button>
        )}
      </div>
      {entries.length > 0 ? (
        entries.map(([personId, share]) => {
          const person = peopleById.get(personId);
          return (
            <div className="calculated-intestacy-row" key={personId}>
              <span>{displayName(person)}</span>
              <b>{shareLabel(share, shareDisplay)}</b>
            </div>
          );
        })
      ) : (
        <small>No statutory proposal can yet be calculated.</small>
      )}
      {(calculated?.warnings || []).map((warning, index) => (
        <small className="succession-warning" key={`${index}-${warning}`}>
          {warning}
        </small>
      ))}
    </div>
  );
}

export function IntestateHeirConfirmation({
  deceased,
  people,
  calculated,
  shareDisplay = "fraction",
  displayName,
  onUpdatePerson,
  onSelectPerson,
}) {
  const [showOtherPerson, setShowOtherPerson] = useState(false);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const rows = deceased.intestateHeirs || [];
  const calculatedEntries = [...(calculated?.shares || new Map()).entries()];
  const calculatedShares = new Map(calculatedEntries);
  const calculatedPersonIds = new Set(calculatedShares.keys());
  const selectedPersonIds = new Set(rows.map((row) => row.personId).filter(Boolean));
  const linkedPartners = linkedSpousesFor(people, deceased.id);
  const partnersMissingDeathDate = linkedSpousesMissingDeathDates(people, deceased.id);
  const availableCalledPeople = people.filter(
    (person) => calculatedPersonIds.has(person.id) && !selectedPersonIds.has(person.id),
  );
  const availableOtherPeople = people.filter(
    (person) =>
      person.id !== deceased.id &&
      !calculatedPersonIds.has(person.id) &&
      !selectedPersonIds.has(person.id),
  );
  const total = totalPercentage(rows);
  const confirmation = confirmedIntestacyAllocations(people, deceased.id, calculated);
  const readiness = intestacyConfirmationReadiness(people, deceased.id, calculated);
  const totalComplete = readiness.totalComplete;
  const canConfirm = readiness.valid;

  const patchDeceased = (patch) => onUpdatePerson(deceased.id, patch);
  const replaceRows = (nextRows) =>
    patchDeceased({
      intestateHeirs: nextRows,
      intestateHeirsConfirmed: false,
      intestateConfirmationBasis: "",
    });
  const updateRow = (rowId, patch) =>
    replaceRows(rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  const updateRowPercentage = (rowId, percentage) =>
    updateRow(rowId, shareFromPercentageInput(percentage));
  const updateRowFraction = (row, patch) => updateRow(row.id, shareFromFractionInput(row, patch));
  const addPerson = (personId) => {
    if (!personId || selectedPersonIds.has(personId)) return;
    const suggestedShare = calculatedShares.get(personId);
    replaceRows([
      ...rows,
      {
        id: crypto.randomUUID(),
        personId,
        ...shareFromPercentage(
          suggestedShare === undefined ? (rows.length ? 0 : 100) : suggestedShare * 100,
        ),
      },
    ]);
    setShowOtherPerson(false);
  };
  const applyCalculated = () =>
    replaceRows(
      calculatedEntries.map(([personId, share]) => ({
        id: crypto.randomUUID(),
        personId,
        ...shareFromPercentage(share * 100),
      })),
    );
  const confirmRows = () => {
    if (!canConfirm) return;
    patchDeceased({
      intestateHeirsConfirmed: true,
      intestateConfirmationBasis: intestacyAllocationSignature(deceased, calculated),
    });
  };

  return (
    <div className="intestate-confirmation">
      <div className="intestate-confirmation-heading">
        <div>
          <strong>Confirm who inherited</strong>
          <small>
            Only explicitly linked partners are treated as spouses. Sharing a recorded child alone
            does not create a spouse share. The proposed persons and shares come from the intestacy
            calculation.
          </small>
        </div>
      </div>

      {linkedPartners.length > 0 && (
        <div className="partner-survival">
          <strong>Partners at the date of death</strong>
          {linkedPartners.map((partner) => (
            <label key={partner.id}>
              <button
                type="button"
                className="link-button"
                onClick={() => onSelectPerson(partner.id)}
              >
                {displayName(partner)}
              </button>
              {isPersonDeceased(partner) ? (
                <DateInput
                  aria-label={`Date of death for ${displayName(partner)}`}
                  value={partner.dateOfDeath || ""}
                  onChange={(value) => onUpdatePerson(partner.id, { dateOfDeath: value })}
                />
              ) : (
                <span>Living</span>
              )}
            </label>
          ))}
          {partnersMissingDeathDate.length > 0 && (
            <small className="succession-warning">
              Enter every deceased partner&apos;s date of death before confirming the heirs.
            </small>
          )}
        </div>
      )}

      <IntestacyProposal
        calculated={calculated}
        people={people}
        displayName={displayName}
        shareDisplay={shareDisplay}
        actionLabel="Use proposed shares"
        onApply={applyCalculated}
      />

      <div className="confirmed-intestate-heirs">
        <strong>Heirs to be confirmed</strong>
        {rows.map((row) => {
          const person = peopleById.get(row.personId);
          const fraction = fractionForShare(row);
          const numerator = row.shareNumerator ?? fraction.numerator;
          const denominator = row.shareDenominator ?? fraction.denominator;
          return (
            <div className={`confirmed-heir-row ${shareDisplay}`} key={row.id}>
              <span className="confirmed-heir-name">{displayName(person)}</span>
              {shareDisplay !== "percentage" && (
                <span className="confirmed-heir-fraction">
                  <input
                    aria-label={`Confirmed share numerator for ${displayName(person)}`}
                    type="number"
                    min="0"
                    step="1"
                    value={numerator}
                    onChange={(event) => updateRowFraction(row, { numerator: event.target.value })}
                  />
                  <b>/</b>
                  <input
                    aria-label={`Confirmed share denominator for ${displayName(person)}`}
                    type="number"
                    min="1"
                    step="1"
                    value={denominator}
                    onChange={(event) =>
                      updateRowFraction(row, { denominator: event.target.value })
                    }
                  />
                </span>
              )}
              {shareDisplay !== "fraction" && (
                <span className="confirmed-heir-percent">
                  <input
                    aria-label={`Confirmed share percentage for ${displayName(person)}`}
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value={row.sharePercentInput ?? row.sharePercent ?? ""}
                    onChange={(event) => updateRowPercentage(row.id, event.target.value)}
                  />
                  <b>%</b>
                </span>
              )}
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ${displayName(person)} from confirmed heirs`}
                onClick={() => replaceRows(rows.filter((candidate) => candidate.id !== row.id))}
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}

        <select
          aria-label="Add person called to intestate succession"
          value=""
          onChange={(event) => {
            if (event.target.value === OTHER_PERSON) {
              setShowOtherPerson(true);
              return;
            }
            addPerson(event.target.value);
          }}
        >
          <option value="">Add an heir</option>
          {availableCalledPeople.map((person) => (
            <option key={person.id} value={person.id}>
              {displayName(person)}
            </option>
          ))}
          {availableOtherPeople.length > 0 && (
            <option value={OTHER_PERSON}>Choose any other person...</option>
          )}
        </select>

        {showOtherPerson && (
          <select
            aria-label="Choose any other person as heir"
            value=""
            onChange={(event) => addPerson(event.target.value)}
          >
            <option value="">Choose another person</option>
            {availableOtherPeople.map((person) => (
              <option key={person.id} value={person.id}>
                {displayName(person)}
              </option>
            ))}
          </select>
        )}

        <div className="intestate-confirmation-footer">
          <small className={totalComplete ? "succession-total valid" : "succession-total invalid"}>
            Total: {totalLabel(total, shareDisplay)}{" "}
            {totalComplete
              ? "Complete"
              : `- must equal ${
                  shareDisplay === "fraction"
                    ? "1/1"
                    : shareDisplay === "percentage"
                      ? "100%"
                      : "1/1 · 100%"
                }`}
          </small>
          <button
            type="button"
            className={confirmation.valid ? "compact-confirm confirmed" : "compact-confirm"}
            disabled={!canConfirm}
            onClick={confirmRows}
          >
            <Check size={13} />
            {confirmation.valid ? "Confirmed" : "Confirm heirs"}
          </button>
        </div>
        {!canConfirm &&
          totalComplete &&
          readiness.issues
            .filter((issue) => issue !== "The heir shares must total 100%.")
            .map((issue, index) => (
              <small className="succession-warning" key={`${index}-${issue}`}>
                {issue}
              </small>
            ))}
        {deceased.intestateHeirsConfirmed && !confirmation.valid && (
          <small className="succession-warning">
            The earlier confirmation needs review because the family details or calculated
            succession changed.
          </small>
        )}
      </div>
    </div>
  );
}
