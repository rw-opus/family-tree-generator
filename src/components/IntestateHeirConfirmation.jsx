import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  editedIntestacyAllocations,
  intestacyLegalContextSignature,
  intestacyConfirmationReadiness,
  isPersonDeceased,
  linkedLegalSpousesFor,
  linkedSpousesMissingDeathDates,
} from "../domain/familyOwnership.js";
import { approximateFraction } from "../domain/ownership.js";
import { MAX_FRACTION_INTEGER } from "../domain/fractions.js";
import { reconcileFractionPercentageDisplay } from "../domain/ownershipPresentation.js";
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
function shareLabel(share, shareDisplay, reconciledPercentageLabel = "") {
  const fraction = approximateFraction(share);
  const fractionText = `${fraction.numerator}/${fraction.denominator}`;
  const percentageText =
    reconciledPercentageLabel ||
    `${(share * 100).toLocaleString("en-MT", {
      maximumFractionDigits: 2,
    })}%`;
  if (shareDisplay === "fraction") return fractionText;
  if (shareDisplay === "percentage") return percentageText;
  return `${fractionText} · ${percentageText}`;
}

function totalLabel(shareDisplay, percentageDisplay) {
  const percentageLabel = percentageDisplay.totalDisplayPercentageLabel;
  if (percentageDisplay.isWhole) return shareLabel(1, shareDisplay, percentageLabel);
  return percentageLabel;
}

export function IntestacyProposal({
  calculated,
  people,
  displayName,
  shareDisplay = "fraction",
  title = "Proposed under intestacy",
  confirmationLabel = "",
  confirmed = false,
  onConfirmationChange,
}) {
  const entries = [...(calculated?.shares || new Map()).entries()];
  const percentageDisplay = reconcileFractionPercentageDisplay(
    entries.map(
      ([personId, share]) =>
        calculated?.exactShares?.get?.(personId) || approximateFraction(Number(share) || 0),
    ),
    { keys: entries.map(([personId]) => personId) },
  );
  const peopleById = new Map(people.map((person) => [person.id, person]));
  return (
    <div className="calculated-intestacy">
      <div className="intestate-confirmation-heading">
        <strong>{title}</strong>
        {confirmationLabel && onConfirmationChange && (
          <label className="detail-checkbox intestacy-proposal-confirmation">
            <input
              type="checkbox"
              aria-label={confirmationLabel}
              checked={confirmed}
              disabled={entries.length === 0}
              onChange={(event) => onConfirmationChange(event.target.checked)}
            />
            {confirmationLabel}
          </label>
        )}
      </div>
      {entries.length > 0 ? (
        entries.map(([personId, share], index) => {
          const person = peopleById.get(personId);
          return (
            <div className="calculated-intestacy-row" key={personId}>
              <span>{displayName(person)}</span>
              <b>
                {shareLabel(
                  share,
                  shareDisplay,
                  percentageDisplay.rows[index]?.displayPercentageLabel,
                )}
              </b>
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
  const calculatedEntries = useMemo(
    () => [...(calculated?.shares || new Map()).entries()],
    [calculated?.shares],
  );
  const [editingHeirs, setEditingHeirs] = useState(false);
  const [draftRows, setDraftRows] = useState([]);
  const percentageEditsRef = useRef(new Set());
  const [draftContextSignature, setDraftContextSignature] = useState("");
  const [draftRowsModified, setDraftRowsModified] = useState(false);
  const calculatedShares = new Map(calculatedEntries);
  const calculatedPersonIds = new Set(calculatedShares.keys());
  const selectedPersonIds = new Set(draftRows.map((row) => row.personId).filter(Boolean));
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
  const draftPercentageDisplay = reconcileFractionPercentageDisplay(
    draftRows.map(fractionForShare),
    { keys: draftRows.map((row) => row.personId || row.id) },
  );
  const editedAllocation = editedIntestacyAllocations(
    people,
    deceased.id,
    calculated,
    outsideParties,
  );
  const savedReadiness = intestacyConfirmationReadiness(
    people,
    deceased.id,
    calculated,
    outsideParties,
  );
  const draftDeceased = {
    ...deceased,
    intestateHeirs: draftRows,
    intestateHeirsConfirmed: true,
  };
  const draftPeople = people.map((person) => (person.id === deceased.id ? draftDeceased : person));
  const readiness = intestacyConfirmationReadiness(
    draftPeople,
    deceased.id,
    calculated,
    outsideParties,
  );
  const currentContextSignature = intestacyLegalContextSignature(deceased, calculated);
  const draftContextStale =
    editingHeirs &&
    Boolean(draftContextSignature) &&
    draftContextSignature !== currentContextSignature;
  const totalComplete = readiness.totalComplete;
  const rowsCanOverride = editedAllocation.valid;
  const footerIsValid = draftRows.length === 0 || totalComplete;
  const draftCanApply = readiness.valid && !draftContextStale;

  const patchDeceased = (patch) => onUpdatePerson(deceased.id, patch);
  const calculatedDraftRows = useCallback(
    () =>
      calculatedEntries.map(([personId, share]) => ({
        id: crypto.randomUUID(),
        personId,
        ...shareFromPercentage(share * 100),
      })),
    [calculatedEntries],
  );
  const beginEditing = () => {
    setDraftRows(rows.length ? rows.map((row) => ({ ...row })) : calculatedDraftRows());
    setDraftContextSignature(currentContextSignature);
    // Existing saved rows are already a deliberate override. If the legal
    // context changes while they are open, retain them for review but do not
    // silently re-sign them against the new facts.
    setDraftRowsModified(rows.length > 0);
    setEditingHeirs(true);
  };
  const cancelEditing = () => {
    setDraftRows([]);
    setDraftContextSignature("");
    setDraftRowsModified(false);
    setShowOutsidePartyCreator(false);
    setEditingHeirs(false);
  };
  const useAutomaticCalculation = () => {
    patchDeceased({
      intestateHeirs: [],
      intestateHeirsConfirmed: false,
      intestateConfirmationBasis: "",
    });
    cancelEditing();
  };
  const applyDraft = () => {
    if (!draftCanApply) return;
    patchDeceased({
      intestateHeirs: draftRows.map((row) => ({ ...row })),
      intestateHeirsConfirmed: true,
      intestateConfirmationBasis: intestacyLegalContextSignature(draftDeceased, calculated),
    });
    cancelEditing();
  };
  const updateRow = (rowId, patch) => {
    setDraftRowsModified(true);
    setDraftRows((currentRows) =>
      currentRows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    );
  };
  const updateRowPercentage = (rowId, percentage) =>
    updateRow(rowId, shareFromPercentageInput(percentage));
  const updateRowFraction = (row, patch) => updateRow(row.id, shareFromFractionInput(row, patch));
  const addPerson = (personId) => {
    if (!personId || selectedPersonIds.has(personId)) return;
    const suggestedShare = calculatedShares.get(personId);
    setDraftRowsModified(true);
    setDraftRows((currentRows) => [
      ...currentRows,
      {
        id: crypto.randomUUID(),
        personId,
        ...shareFromPercentage(
          suggestedShare === undefined ? (currentRows.length ? 0 : 100) : suggestedShare * 100,
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
    if (!draftContextStale || draftRowsModified) return;

    // An untouched draft was only a copy of the automatic proposal. Keep that
    // copy in step when a spouse/death/family fact changes while the editor is
    // open. Once the user has changed any row, preserve it and require an
    // explicit restart instead of applying it under a different legal basis.
    setDraftRows(calculatedDraftRows());
    setDraftContextSignature(currentContextSignature);
  }, [calculatedDraftRows, currentContextSignature, draftContextStale, draftRowsModified]);
  useEffect(() => {
    setEditingHeirs(false);
    setDraftRows([]);
    setDraftContextSignature("");
    setDraftRowsModified(false);
    setShowOutsidePartyCreator(false);
  }, [deceased.id]);

  return (
    <div className="intestate-confirmation">
      <div className="intestate-confirmation-heading">
        <div>
          <strong>Beneficiaries</strong>
          <small>Applied automatically unless edited.</small>
        </div>
        {!editingHeirs && (
          <button type="button" className="text-button" onClick={beginEditing}>
            Edit Beneficiaries
          </button>
        )}
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
            <small className="succession-warning">Enter missing spouse death dates.</small>
          )}
        </div>
      )}

      <IntestacyProposal
        calculated={calculated}
        people={people}
        displayName={displayName}
        shareDisplay={shareDisplay}
        title="Calculated beneficiaries"
      />

      {!editingHeirs && rows.length > 0 && (
        <div className="confirmed-intestate-heirs">
          <div className="intestate-confirmation-heading">
            <strong>
              {rowsCanOverride
                ? "Edited beneficiaries active"
                : "Edited beneficiaries require review"}
            </strong>
            <button type="button" className="text-button" onClick={useAutomaticCalculation}>
              Use automatic calculation
            </button>
          </div>
          {!rowsCanOverride &&
            (editedAllocation.warnings || []).map((warning) => (
              <small className="succession-warning" key={warning}>
                {warning}
              </small>
            ))}
          {!rowsCanOverride &&
            savedReadiness.issues.map((issue, index) => (
              <small className="succession-warning" key={`${index}-${issue}`}>
                {issue}
              </small>
            ))}
          {!rowsCanOverride && (
            <small className="succession-warning">
              These saved edits are not active, so the automatic proposal remains in force.
            </small>
          )}
        </div>
      )}

      {editingHeirs && (
        <div className="confirmed-intestate-heirs">
          <div className="intestate-confirmation-heading">
            <strong>Edit Beneficiaries</strong>
            <button type="button" className="text-button" onClick={cancelEditing}>
              Cancel
            </button>
          </div>
          {draftContextStale && (
            <small className="succession-warning" role="alert">
              The death or family facts changed while these edits were open. Cancel and reopen Edit
              Beneficiaries before applying them.
            </small>
          )}
          {draftRows.map((row, index) => {
            const person = peopleById.get(row.personId) || outsidePartiesById.get(row.personId);
            const fraction = fractionForShare(row);
            const displayedPercentage = draftPercentageDisplay.rows[index]?.displayPercentage;
            const percentageBeingEdited = percentageEditsRef.current.has(row.id);
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
                      step="0.01"
                      inputMode="decimal"
                      value={
                        percentageBeingEdited
                          ? (row.sharePercentInput ?? "")
                          : (displayedPercentage ?? row.sharePercent ?? "")
                      }
                      onChange={(event) => {
                        percentageEditsRef.current.add(row.id);
                        updateRowPercentage(row.id, event.target.value);
                      }}
                      onBlur={() => {
                        percentageEditsRef.current.delete(row.id);
                        if (row.sharePercentInput === undefined) return;
                        updateRowFraction(row, {});
                      }}
                    />
                    <b>%</b>
                  </span>
                )}
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${displayName(person)} from edited heirs`}
                  onClick={() => {
                    setDraftRowsModified(true);
                    setDraftRows((currentRows) =>
                      currentRows.filter((candidate) => candidate.id !== row.id),
                    );
                  }}
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
              {draftRows.length === 0
                ? "No edited heirs. Automatic proposal applies."
                : `Total: ${totalLabel(shareDisplay, draftPercentageDisplay)} - must equal ${
                    shareDisplay === "fraction"
                      ? "1/1"
                      : shareDisplay === "percentage"
                        ? "100%"
                        : "1/1 · 100%"
                  }`}
            </small>
            <button
              type="button"
              className="compact-confirm"
              disabled={!draftCanApply}
              onClick={applyDraft}
            >
              Apply edited beneficiaries
            </button>
          </div>
          {draftRows.length > 0 &&
            !draftCanApply &&
            totalComplete &&
            readiness.issues
              .filter((issue) => issue !== "The heir shares must total 100%.")
              .map((issue, index) => (
                <small className="succession-warning" key={`${index}-${issue}`}>
                  {issue}
                </small>
              ))}
          <small>Not saved until applied.</small>
          {rows.length > 0 && (
            <button type="button" className="text-button" onClick={useAutomaticCalculation}>
              Remove edited beneficiaries and use automatic calculation
            </button>
          )}
        </div>
      )}
    </div>
  );
}
