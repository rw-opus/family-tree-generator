import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  editedIntestacyAllocations,
  intestacyLegalContextSignature,
  intestacyConfirmationReadiness,
  intestacyShareTotalIsComplete,
  isPersonDeceased,
  linkedLegalSpousesFor,
  linkedSpousesMissingDeathDates,
} from "../domain/familyOwnership.js";
import { approximateFraction } from "../domain/ownership.js";
import { MAX_FRACTION_INTEGER } from "../domain/fractions.js";
import { personChoiceLabel, sortPeopleForChoice } from "../domain/people.js";
import {
  fractionForShare,
  shareFromFractionInput,
  shareFromPercentage,
  shareFromPercentageInput,
} from "../domain/shares.js";
import { DateInput } from "./DateInput.jsx";
import { OutsidePartyCreator } from "./OutsidePartyCreator.jsx";

const CREATE_OUTSIDE_PARTY = "__create_outside_party__";
const totalPercentage = (rows = []) =>
  rows.reduce((total, row) => total + (Number(row.sharePercent) || 0), 0);

function shareLabel(share, shareDisplay) {
  const fraction = approximateFraction(share);
  const fractionText = `${fraction.numerator}/${fraction.denominator}`;
  const percentageText = `${(share * 100).toLocaleString("en-MT", {
    maximumFractionDigits: 2,
  })}%`;
  if (shareDisplay === "fraction") return fractionText;
  if (shareDisplay === "percentage") return percentageText;
  return `${fractionText} · ${percentageText}`;
}

function totalLabel(totalPercent, shareDisplay) {
  if (intestacyShareTotalIsComplete(totalPercent)) return shareLabel(1, shareDisplay);
  return `${totalPercent.toLocaleString("en-MT", { maximumFractionDigits: 2 })}%`;
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
  outsideParties = [],
  calculated,
  shareDisplay = "fraction",
  displayName,
  onUpdatePerson,
  onCreateOutsideParty,
  onSelectPerson,
}) {
  const [showOutsidePartyCreator, setShowOutsidePartyCreator] = useState(false);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const outsidePartiesById = new Map(outsideParties.map((party) => [party.id, party]));
  const rows = deceased.intestateHeirs || [];
  const calculatedEntries = [...(calculated?.shares || new Map()).entries()];
  const [editingHeirs, setEditingHeirs] = useState(
    rows.length > 0 || calculatedEntries.length === 0,
  );
  const calculatedShares = new Map(calculatedEntries);
  const calculatedPersonIds = new Set(calculatedShares.keys());
  const selectedPersonIds = new Set(rows.map((row) => row.personId).filter(Boolean));
  const linkedPartners = linkedLegalSpousesFor(people, deceased.id, deceased.dateOfDeath);
  const partnersMissingDeathDate = linkedSpousesMissingDeathDates(
    people,
    deceased.id,
    deceased.dateOfDeath,
  );
  const availableCalledPeople = sortPeopleForChoice(
    people.filter(
      (person) => calculatedPersonIds.has(person.id) && !selectedPersonIds.has(person.id),
    ),
    people,
  );
  const availableOtherPeople = sortPeopleForChoice(
    people.filter(
      (person) =>
        person.id !== deceased.id &&
        !calculatedPersonIds.has(person.id) &&
        !selectedPersonIds.has(person.id),
    ),
    people,
  );
  const availableOutsideParties = outsideParties
    .filter((party) => !selectedPersonIds.has(party.id))
    .sort((first, second) =>
      displayName(first).localeCompare(displayName(second), "en-MT", {
        sensitivity: "base",
        numeric: true,
      }),
    );
  const total = totalPercentage(rows);
  const editedAllocation = editedIntestacyAllocations(
    people,
    deceased.id,
    calculated,
    outsideParties,
  );
  const readiness = intestacyConfirmationReadiness(people, deceased.id, calculated, outsideParties);
  const totalComplete = readiness.totalComplete;
  const rowsCanOverride = editedAllocation.valid;
  const footerIsValid = rows.length === 0 || totalComplete;

  const patchDeceased = (patch) => onUpdatePerson(deceased.id, patch);
  const replaceRows = (nextRows) => {
    const nextDeceased = { ...deceased, intestateHeirs: nextRows };
    patchDeceased({
      intestateHeirs: nextRows,
      intestateHeirsConfirmed: false,
      intestateConfirmationBasis: intestacyLegalContextSignature(nextDeceased, calculated),
    });
  };
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
    setShowOutsidePartyCreator(false);
  };
  const createOutsideParty = (party) => {
    onCreateOutsideParty?.(party);
    addPerson(party.id);
  };
  useEffect(() => {
    setEditingHeirs(rows.length > 0 || calculatedEntries.length === 0);
  }, [calculatedEntries.length, deceased.id, rows.length]);

  const applyCalculated = () => {
    replaceRows(
      calculatedEntries.map(([personId, share]) => ({
        id: crypto.randomUUID(),
        personId,
        ...shareFromPercentage(share * 100),
      })),
    );
    setEditingHeirs(true);
  };

  return (
    <div className="intestate-confirmation">
      <div className="intestate-confirmation-heading">
        <div>
          <strong>Beneficiaries</strong>
          <small>
            Calculated beneficiaries apply automatically. Choose Edit Beneficiaries only when you
            need to change the people or fractions.
          </small>
        </div>
      </div>

      {linkedPartners.length > 0 && (
        <div className="partner-survival">
          <strong>Spouses at the date of death</strong>
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
              Enter every deceased partner&apos;s date of death before relying on the automatic
              heirs.
            </small>
          )}
        </div>
      )}

      <IntestacyProposal
        calculated={calculated}
        people={people}
        displayName={displayName}
        shareDisplay={shareDisplay}
        title="Calculated beneficiaries"
        actionLabel={editingHeirs ? "" : "Edit Beneficiaries"}
        onApply={applyCalculated}
      />

      {editingHeirs && (
        <div className="confirmed-intestate-heirs">
          <div className="intestate-confirmation-heading">
            <strong>Edit Beneficiaries</strong>
            {calculatedEntries.length > 0 && (
              <button type="button" className="text-button" onClick={() => setEditingHeirs(false)}>
                Close editor
              </button>
            )}
          </div>
          {rows.map((row) => {
            const person = peopleById.get(row.personId) || outsidePartiesById.get(row.personId);
            const fraction = fractionForShare(row);
            const numerator = row.shareNumerator ?? fraction.numerator;
            const denominator = row.shareDenominator ?? fraction.denominator;
            return (
              <div className={`confirmed-heir-row ${shareDisplay}`} key={row.id}>
                <span className="confirmed-heir-name">{displayName(person)}</span>
                {shareDisplay !== "percentage" && (
                  <span className="confirmed-heir-fraction">
                    <input
                      aria-label={`Share numerator for ${displayName(person)}`}
                      type="number"
                      min="0"
                      max={MAX_FRACTION_INTEGER}
                      step="1"
                      value={numerator}
                      onChange={(event) =>
                        updateRowFraction(row, { numerator: event.target.value })
                      }
                    />
                    <b>/</b>
                    <input
                      aria-label={`Share denominator for ${displayName(person)}`}
                      type="number"
                      min="1"
                      max={MAX_FRACTION_INTEGER}
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
                      aria-label={`Share percentage for ${displayName(person)}`}
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
                  aria-label={`Remove ${displayName(person)} from edited heirs`}
                  onClick={() => replaceRows(rows.filter((candidate) => candidate.id !== row.id))}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}

          <select
            aria-label="Add an heir or override the intestacy proposal"
            value=""
            onChange={(event) => {
              if (event.target.value === CREATE_OUTSIDE_PARTY) {
                setShowOutsidePartyCreator(true);
                return;
              }
              addPerson(event.target.value);
            }}
          >
            <option value="">Add any heir</option>
            {availableCalledPeople.length > 0 && (
              <optgroup label="Statutory proposal">
                {availableCalledPeople.map((person) => (
                  <option key={person.id} value={person.id}>
                    {personChoiceLabel(person, people)}
                  </option>
                ))}
              </optgroup>
            )}
            {availableOtherPeople.length > 0 && (
              <optgroup label="Other people on the family tree">
                {availableOtherPeople.map((person) => (
                  <option key={person.id} value={person.id}>
                    {personChoiceLabel(person, people)}
                  </option>
                ))}
              </optgroup>
            )}
            {availableOutsideParties.length > 0 && (
              <optgroup label="Unconnected people and companies">
                {availableOutsideParties.map((party) => (
                  <option key={party.id} value={party.id}>
                    {displayName(party)}
                    {party.type === "company" ? " (company)" : " (unconnected)"}
                  </option>
                ))}
              </optgroup>
            )}
            {onCreateOutsideParty && (
              <option value={CREATE_OUTSIDE_PARTY}>Create unconnected person or company...</option>
            )}
          </select>

          {showOutsidePartyCreator && (
            <OutsidePartyCreator
              onCreate={createOutsideParty}
              onCancel={() => setShowOutsidePartyCreator(false)}
            />
          )}

          <div className="intestate-confirmation-footer">
            <small
              className={footerIsValid ? "succession-total valid" : "succession-total invalid"}
            >
              {rows.length === 0
                ? "No edited heirs. Automatic proposal applies."
                : `Total: ${totalLabel(total, shareDisplay)} ${
                    rowsCanOverride
                      ? "Override active"
                      : `- must equal ${
                          shareDisplay === "fraction"
                            ? "1/1"
                            : shareDisplay === "percentage"
                              ? "100%"
                              : "1/1 · 100%"
                        }`
                  }`}
            </small>
          </div>
          {rows.length > 0 &&
            !rowsCanOverride &&
            totalComplete &&
            readiness.issues
              .filter((issue) => issue !== "The heir shares must total 100%.")
              .map((issue, index) => (
                <small className="succession-warning" key={`${index}-${issue}`}>
                  {issue}
                </small>
              ))}
          {rows.length > 0 && !editedAllocation.valid && (
            <>
              {(editedAllocation.warnings || []).map((warning) => (
                <small className="succession-warning" key={warning}>
                  {warning}
                </small>
              ))}
              <small className="succession-warning">
                These edited heirs are not yet usable, so the automatic proposal remains in force.
              </small>
            </>
          )}
        </div>
      )}
    </div>
  );
}
