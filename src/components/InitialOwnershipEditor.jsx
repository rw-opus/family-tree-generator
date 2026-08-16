import { Building2, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { MAX_FRACTION_INTEGER } from "../domain/fractions.js";
import { reconcileFractionPercentageDisplay } from "../domain/ownershipPresentation.js";
import {
  assignInitialOwnerPerson,
  propertyStartingOwnershipStatus,
  remainingInitialOwnershipShare,
} from "../domain/propertyVendorTax.js";
import { personChoiceLabel, sortPeopleForChoice } from "../domain/people.js";
import {
  fractionForShare,
  shareFromFractionInput,
  shareFromPercentageInput,
} from "../domain/shares.js";
import { OutsidePartyCreator } from "./OutsidePartyCreator.jsx";

const makeOwner = (owners = []) => ({
  id: crypto.randomUUID(),
  personId: "",
  ...remainingInitialOwnershipShare(owners),
});

export function InitialOwnershipEditor({
  property,
  people,
  outsideParties = [],
  onChange,
  heading = "Initial owner/s of the property",
  helperText = "Select any person already on the family tree and enter the fraction originally owned.",
  onPickFromTree,
  onCreateOutsideParty,
}) {
  const [outsidePartyOpen, setOutsidePartyOpen] = useState(false);
  const percentageEditsRef = useRef(new Set());
  const owners = property.owners || [];
  const status = propertyStartingOwnershipStatus(property);
  const percentageDisplay = reconcileFractionPercentageDisplay(owners.map(fractionForShare), {
    keys: owners.map((owner) => owner.personId || owner.id),
  });
  const totalPercentageLabel =
    percentageDisplay.totalDisplayPercentageLabel ||
    `${status.enteredTotalPercent.toLocaleString("en-MT", {
      maximumFractionDigits: 2,
    })}%`;
  const unassignedLabel = status.unassignedFraction?.denominator
    ? `${status.unassignedFraction.numerator}/${status.unassignedFraction.denominator}`
    : "an entered share";
  const statusMessage = status.isComplete
    ? "valid"
    : status.hasUnassignedOwners
      ? "an owner is still required"
      : "must equal 100%";
  const updateOwners = (nextOwners) => onChange(nextOwners);
  const updateOwner = (ownerId, patch) =>
    updateOwners(owners.map((owner) => (owner.id === ownerId ? { ...owner, ...patch } : owner)));
  const addOwner = () => updateOwners([...owners, makeOwner(owners)]);
  const pickNewOwnerFromTree = () => {
    const availableOwner = owners.find((owner) => !owner.personId);
    if (availableOwner) {
      onPickFromTree?.(availableOwner.id);
      return;
    }
    const owner = makeOwner(owners);
    updateOwners([...owners, owner]);
    onPickFromTree?.(owner.id);
  };

  return (
    <div className="initial-ownership-editor">
      <div className="section-heading initial-ownership-heading">
        <div>
          <p className="eyebrow">Initial title</p>
          <h3>{heading}</h3>
        </div>
        <span className={`initial-title-badge ${status.isComplete ? "valid" : "invalid"}`}>
          {totalPercentageLabel}
        </span>
      </div>
      {helperText && <p className="helper-text">{helperText}</p>}
      <p className={`share-status ${status.isComplete ? "valid" : "invalid"}`}>
        Fractions entered: {totalPercentageLabel} — {statusMessage}
      </p>
      <div className="initial-owner-list">
        {owners.length > 0 && (
          <div className="initial-owner-columns" aria-hidden="true">
            <span>Person</span>
            <span>Fraction</span>
            <span>Percentage</span>
            <span />
          </div>
        )}
        {owners.map((owner, index) => {
          const ownerFraction = fractionForShare(owner);
          const displayedPercentage = percentageDisplay.rows[index]?.displayPercentage;
          const percentageBeingEdited = percentageEditsRef.current.has(owner.id);
          const ownerNeedsSelection =
            !owner.personId && !ownerFraction.error && Number(ownerFraction.numerator) > 0;
          const ownerNumerator = owner.shareNumerator ?? ownerFraction.numerator;
          const ownerDenominator = owner.shareDenominator ?? ownerFraction.denominator;
          return (
            <div
              className={`initial-owner-row${ownerNeedsSelection ? " missing-owner" : ""}`}
              key={owner.id}
            >
              <span className="initial-owner-person-control">
                <select
                  aria-label="Initial owner"
                  value={owner.personId}
                  onChange={(event) =>
                    updateOwners(assignInitialOwnerPerson(owners, owner.id, event.target.value))
                  }
                >
                  <option value="">Choose person</option>
                  {sortPeopleForChoice(people).map((person) => (
                    <option key={person.id} value={person.id}>
                      {personChoiceLabel(person, people)}
                    </option>
                  ))}
                  {outsideParties.length > 0 && (
                    <optgroup label="Outside individuals and companies">
                      {[...outsideParties]
                        .sort((left, right) =>
                          String(left.name || "").localeCompare(String(right.name || ""), "en-MT", {
                            sensitivity: "base",
                            numeric: true,
                          }),
                        )
                        .map((party) => (
                          <option key={party.id} value={party.id}>
                            {party.name || "Unnamed party"}
                            {party.type === "company" ? " (company)" : " (outside individual)"}
                          </option>
                        ))}
                    </optgroup>
                  )}
                </select>
                {onPickFromTree && (
                  <button
                    type="button"
                    className="initial-owner-tree-pick-button"
                    title="Select this owner by clicking a person on the tree"
                    aria-label={`Select ${owner.personId ? "a replacement initial owner" : "initial owner"} from tree`}
                    onClick={() => onPickFromTree(owner.id)}
                  >
                    Tree
                  </button>
                )}
              </span>
              <span className="initial-owner-fraction">
                <input
                  aria-label="Initial ownership numerator"
                  type="number"
                  min="0"
                  max={MAX_FRACTION_INTEGER}
                  step="1"
                  value={ownerNumerator}
                  onChange={(event) =>
                    updateOwner(
                      owner.id,
                      shareFromFractionInput(owner, { numerator: event.target.value }),
                    )
                  }
                />
                <b>/</b>
                <input
                  aria-label="Initial ownership denominator"
                  type="number"
                  min="1"
                  max={MAX_FRACTION_INTEGER}
                  step="1"
                  value={ownerDenominator}
                  onChange={(event) =>
                    updateOwner(
                      owner.id,
                      shareFromFractionInput(owner, { denominator: event.target.value }),
                    )
                  }
                />
              </span>
              <span className="initial-owner-percentage">
                <input
                  aria-label="Initial ownership percentage"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  inputMode="decimal"
                  value={
                    percentageBeingEdited
                      ? (owner.sharePercentInput ?? "")
                      : (displayedPercentage ?? owner.sharePercent ?? "")
                  }
                  onChange={(event) => {
                    percentageEditsRef.current.add(owner.id);
                    updateOwner(owner.id, shareFromPercentageInput(event.target.value));
                  }}
                  onBlur={() => {
                    percentageEditsRef.current.delete(owner.id);
                    if (owner.sharePercentInput === undefined) return;
                    updateOwner(owner.id, shareFromFractionInput(owner));
                  }}
                />
                <b>%</b>
              </span>
              <button
                type="button"
                className="icon-button"
                title="Remove owner"
                aria-label="Remove initial owner"
                onClick={() => updateOwners(owners.filter((item) => item.id !== owner.id))}
              >
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
      </div>
      {status.hasUnassignedOwners && (
        <p className="initial-owner-assignment-warning" role="alert">
          Fractions total {totalPercentageLabel}, but {unassignedLabel} still needs an owner.
        </p>
      )}
      <div className="initial-owner-actions">
        <button type="button" className="add-button" onClick={addOwner}>
          <Plus size={16} /> Add initial owner
        </button>
        {onPickFromTree && (
          <button
            type="button"
            className="secondary-button initial-owner-tree-add-button"
            onClick={pickNewOwnerFromTree}
          >
            Select from tree
          </button>
        )}
        {onCreateOutsideParty && (
          <button
            type="button"
            className="secondary-button"
            aria-expanded={outsidePartyOpen}
            onClick={() => setOutsidePartyOpen((open) => !open)}
          >
            <Building2 size={16} /> Add outside owner
          </button>
        )}
      </div>
      {outsidePartyOpen && (
        <OutsidePartyCreator
          submitLabel="Add owner"
          helperText="The individual or company remains outside the family tree but can hold a property share."
          ariaLabelPrefix="Outside owner"
          onCreate={(party) => {
            const availableOwner = owners.find((owner) => !owner.personId);
            const nextOwners = availableOwner
              ? assignInitialOwnerPerson(owners, availableOwner.id, party.id)
              : [...owners, { ...makeOwner(owners), personId: party.id }];
            onCreateOutsideParty(party, nextOwners);
            setOutsidePartyOpen(false);
          }}
          onCancel={() => setOutsidePartyOpen(false)}
        />
      )}
    </div>
  );
}
