import { Building2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { HoverHelpLabel } from "./HoverHelpLabel.jsx";
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
  onRegisterPendingFlush,
}) {
  const [outsidePartyOpen, setOutsidePartyOpen] = useState(false);
  const [draftOwners, setDraftOwners] = useState(() => property.owners || []);
  const percentageEditsRef = useRef(new Set());
  const latestDraftOwnersRef = useRef(draftOwners);
  const dirtyRef = useRef(false);
  const onChangeRef = useRef(onChange);
  latestDraftOwnersRef.current = draftOwners;
  onChangeRef.current = onChange;

  const commitOwners = useCallback((nextOwners) => {
    const result = onChangeRef.current(nextOwners);
    if (result === null || result === false) return false;
    dirtyRef.current = false;
    latestDraftOwnersRef.current = nextOwners;
    setDraftOwners(nextOwners);
    return true;
  }, []);

  const flushDraftOwners = useCallback(() => {
    if (!dirtyRef.current) return true;
    return commitOwners(latestDraftOwnersRef.current);
  }, [commitOwners]);

  useEffect(() => {
    if (!dirtyRef.current) {
      const nextOwners = property.owners || [];
      latestDraftOwnersRef.current = nextOwners;
      setDraftOwners(nextOwners);
    }
  }, [property.owners]);

  useEffect(() => {
    if (!onRegisterPendingFlush) return undefined;
    const controller = {
      flush: flushDraftOwners,
      hasPending: () => dirtyRef.current,
    };
    const unregister = onRegisterPendingFlush(controller);
    return () => {
      flushDraftOwners();
      unregister?.();
    };
  }, [flushDraftOwners, onRegisterPendingFlush]);

  const owners = draftOwners;
  const status = propertyStartingOwnershipStatus({ ...property, owners });
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
  const updateDraftOwner = (ownerId, patch) => {
    const nextOwners = latestDraftOwnersRef.current.map((owner) => {
      if (owner.id !== ownerId) return owner;
      const updated = { ...owner, ...patch };
      if (
        !Object.prototype.hasOwnProperty.call(patch, "sharePercentInput") ||
        patch.sharePercentInput === undefined
      ) {
        delete updated.sharePercentInput;
      }
      return updated;
    });
    dirtyRef.current = true;
    latestDraftOwnersRef.current = nextOwners;
    setDraftOwners(nextOwners);
  };
  const addOwner = () => {
    if (!flushDraftOwners()) return;
    commitOwners([...latestDraftOwnersRef.current, makeOwner(latestDraftOwnersRef.current)]);
  };
  const pickNewOwnerFromTree = () => {
    if (!flushDraftOwners()) return;
    const currentOwners = latestDraftOwnersRef.current;
    const availableOwner = currentOwners.find((owner) => !owner.personId);
    if (availableOwner) {
      onPickFromTree?.(availableOwner.id);
      return;
    }
    const owner = makeOwner(currentOwners);
    if (!commitOwners([...currentOwners, owner])) return;
    onPickFromTree?.(owner.id);
  };

  return (
    <div
      className={`initial-ownership-editor ${status.isComplete ? "is-complete" : "needs-setup"}`}
    >
      <div className="section-heading initial-ownership-heading">
        <div>
          <p className="eyebrow">{status.isComplete ? "Initial title" : "Required first step"}</p>
          <h3 title="Record who owned the property before the successions and transfers tracked in this workspace.">
            {heading}
          </h3>
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
            <HoverHelpLabel
              label="Person"
              help="Choose the person or outside party who originally held this share."
            />
            <HoverHelpLabel
              label="Fraction"
              help="Enter the exact share as a numerator and denominator, for example 1/2."
            />
            <HoverHelpLabel
              label="Percentage"
              help="You may enter the share as a percentage instead; the fraction is updated automatically."
            />
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
                  title="Choose the person or outside party who originally held this share."
                  value={owner.personId}
                  onChange={(event) => {
                    if (!flushDraftOwners()) return;
                    commitOwners(
                      assignInitialOwnerPerson(
                        latestDraftOwnersRef.current,
                        owner.id,
                        event.target.value,
                      ),
                    );
                  }}
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
                    onClick={() => {
                      if (flushDraftOwners()) onPickFromTree(owner.id);
                    }}
                  >
                    Tree
                  </button>
                )}
              </span>
              <span className="initial-owner-fraction">
                <input
                  aria-label="Initial ownership numerator"
                  title="The top number of the owner's exact fraction."
                  type="number"
                  min="0"
                  max={MAX_FRACTION_INTEGER}
                  step="1"
                  value={ownerNumerator}
                  onChange={(event) =>
                    updateDraftOwner(
                      owner.id,
                      shareFromFractionInput(owner, { numerator: event.target.value }),
                    )
                  }
                  onBlur={flushDraftOwners}
                />
                <b>/</b>
                <input
                  aria-label="Initial ownership denominator"
                  title="The bottom number of the owner's exact fraction."
                  type="number"
                  min="1"
                  max={MAX_FRACTION_INTEGER}
                  step="1"
                  value={ownerDenominator}
                  onChange={(event) =>
                    updateDraftOwner(
                      owner.id,
                      shareFromFractionInput(owner, { denominator: event.target.value }),
                    )
                  }
                  onBlur={flushDraftOwners}
                />
              </span>
              <span className="initial-owner-percentage">
                <input
                  aria-label="Initial ownership percentage"
                  title="The owner's initial share as a percentage. All owners together must total 100%."
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
                    updateDraftOwner(owner.id, shareFromPercentageInput(event.target.value));
                  }}
                  onBlur={() => {
                    percentageEditsRef.current.delete(owner.id);
                    if (owner.sharePercentInput === undefined) return;
                    updateDraftOwner(owner.id, shareFromFractionInput(owner));
                    flushDraftOwners();
                  }}
                />
                <b>%</b>
              </span>
              <button
                type="button"
                className="icon-button"
                title="Remove owner"
                aria-label="Remove initial owner"
                onClick={() => {
                  if (!flushDraftOwners()) return;
                  commitOwners(latestDraftOwnersRef.current.filter((item) => item.id !== owner.id));
                }}
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
        <button
          type="button"
          className="add-button"
          title="Add another original owner and assign the remaining unallocated share."
          onClick={addOwner}
        >
          <Plus size={16} /> Add initial owner
        </button>
        {onPickFromTree && (
          <button
            type="button"
            className="secondary-button initial-owner-tree-add-button"
            title="Return to the family tree and click the person who was an original owner."
            onClick={pickNewOwnerFromTree}
          >
            Select from tree
          </button>
        )}
        {onCreateOutsideParty && (
          <button
            type="button"
            className="secondary-button"
            title="Add an original owner who is not represented by a person on this family tree."
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
            if (!flushDraftOwners()) return false;
            const currentOwners = latestDraftOwnersRef.current;
            const availableOwner = currentOwners.find((owner) => !owner.personId);
            const nextOwners = availableOwner
              ? assignInitialOwnerPerson(currentOwners, availableOwner.id, party.id)
              : [...currentOwners, { ...makeOwner(currentOwners), personId: party.id }];
            const result = onCreateOutsideParty(party, nextOwners);
            if (result === null || result === false) return false;
            setOutsidePartyOpen(false);
            return true;
          }}
          onCancel={() => setOutsidePartyOpen(false)}
        />
      )}
    </div>
  );
}
