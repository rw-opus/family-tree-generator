import { useState } from "react";
import { Check, Trash2 } from "lucide-react";
import {
  confirmedIntestacyAllocations,
  intestacyAllocationSignature,
  isPersonDeceased,
  linkedSpousesFor,
  linkedSpousesMissingDeathDates,
} from "../domain/familyOwnership.js";
import { approximateFraction } from "../domain/ownership.js";
import { fractionForShare, shareFromFraction, shareFromPercentage } from "../domain/shares.js";

const OTHER_PERSON = "__other_person__";
const totalPercentage = (rows = []) =>
  rows.reduce((total, row) => total + (Number(row.sharePercent) || 0), 0);

function shareLabel(share, shareDisplay) {
  if (shareDisplay === "fraction") {
    const fraction = approximateFraction(share);
    return `${fraction.numerator}/${fraction.denominator}`;
  }
  return `${(share * 100).toLocaleString("en-MT", { maximumFractionDigits: 4 })}%`;
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
  const hasCompleteRows =
    rows.length > 0 &&
    rows.every((row) => row.personId && Number(row.sharePercent) > 0) &&
    selectedPersonIds.size === rows.length &&
    Math.abs(total - 100) < 1e-8;
  const canConfirm =
    hasCompleteRows && Boolean(deceased.dateOfDeath) && partnersMissingDeathDate.length === 0;

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
    updateRow(rowId, {
      ...shareFromPercentage(percentage),
      sharePercent: percentage,
    });
  const updateRowFraction = (row, patch) => {
    const current = fractionForShare(row);
    const numerator = patch.numerator ?? row.shareNumerator ?? current.numerator;
    const denominator = patch.denominator ?? row.shareDenominator ?? current.denominator;
    updateRow(row.id, {
      ...shareFromFraction(numerator, denominator),
      shareNumerator: numerator,
      shareDenominator: denominator,
    });
  };
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
            Linked partners are treated as spouses. The proposed persons and shares come from the
            intestacy calculation.
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
                <input
                  aria-label={`Date of death for ${displayName(partner)}`}
                  type="date"
                  value={partner.dateOfDeath || ""}
                  onChange={(event) =>
                    onUpdatePerson(partner.id, { dateOfDeath: event.target.value })
                  }
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

      <div className="calculated-intestacy">
        <div className="intestate-confirmation-heading">
          <strong>Proposed under intestacy</strong>
          {calculatedEntries.length > 0 && (
            <button type="button" className="text-button" onClick={applyCalculated}>
              Use proposed shares
            </button>
          )}
        </div>
        {calculatedEntries.length > 0 ? (
          calculatedEntries.map(([personId, share]) => {
            const person = people.find((candidate) => candidate.id === personId);
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
        {(calculated?.warnings || []).map((warning) => (
          <small className="succession-warning" key={warning}>
            {warning}
          </small>
        ))}
      </div>

      <div className="confirmed-intestate-heirs">
        <strong>Heirs to be confirmed</strong>
        {rows.map((row) => {
          const person = people.find((candidate) => candidate.id === row.personId);
          const fraction = fractionForShare(row);
          const numerator = row.shareNumerator ?? fraction.numerator;
          const denominator = row.shareDenominator ?? fraction.denominator;
          return (
            <div className={`confirmed-heir-row ${shareDisplay}`} key={row.id}>
              <span className="confirmed-heir-name">{displayName(person)}</span>
              {shareDisplay === "fraction" ? (
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
              ) : (
                <span className="confirmed-heir-percent">
                  <input
                    aria-label={`Confirmed share percentage for ${displayName(person)}`}
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value={row.sharePercent ?? ""}
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
          <small
            className={hasCompleteRows ? "succession-total valid" : "succession-total invalid"}
          >
            Total: {shareLabel(total / 100, shareDisplay)}{" "}
            {hasCompleteRows
              ? "Complete"
              : `- must equal ${shareDisplay === "fraction" ? "1/1" : "100%"}`}
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
