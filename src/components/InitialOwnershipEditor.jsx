import { Plus, Trash2 } from "lucide-react";
import { MAX_FRACTION_INTEGER } from "../domain/fractions.js";
import { propertyStartingOwnershipStatus } from "../domain/propertyVendorTax.js";
import {
  fractionForShare,
  shareFromFractionInput,
  shareFromPercentageInput,
} from "../domain/shares.js";

const makeOwner = () => ({
  id: crypto.randomUUID(),
  personId: "",
  sharePercent: 0,
  shareNumerator: 0,
  shareDenominator: 1,
});

export function InitialOwnershipEditor({
  property,
  people,
  onChange,
  compact = false,
  heading = "Initial owner/s of the property",
  helperText = "Select any person already on the family tree and enter the fraction originally owned.",
}) {
  const owners = property.owners || [];
  const status = propertyStartingOwnershipStatus(property);
  const totalLabel = status.totalPercent.toLocaleString("en-MT", {
    maximumFractionDigits: 2,
  });
  const updateOwners = (nextOwners) => onChange(nextOwners);
  const updateOwner = (ownerId, patch) =>
    updateOwners(owners.map((owner) => (owner.id === ownerId ? { ...owner, ...patch } : owner)));

  return (
    <div className={`initial-ownership-editor ${compact ? "compact" : ""}`}>
      <div className="section-heading initial-ownership-heading">
        <div>
          <p className="eyebrow">Initial title</p>
          <h3>{heading}</h3>
        </div>
        <span className={`initial-title-badge ${status.isComplete ? "valid" : "invalid"}`}>
          {totalLabel}%
        </span>
      </div>
      {helperText && <p className="helper-text">{helperText}</p>}
      <p className={`share-status ${status.isComplete ? "valid" : "invalid"}`}>
        Initial title allocated: {totalLabel}% — {status.isComplete ? "valid" : "must equal 100%"}
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
        {owners.map((owner) => {
          const ownerFraction = fractionForShare(owner);
          const ownerNumerator = owner.shareNumerator ?? ownerFraction.numerator;
          const ownerDenominator = owner.shareDenominator ?? ownerFraction.denominator;
          return (
            <div className="initial-owner-row" key={owner.id}>
              <select
                aria-label="Initial owner"
                value={owner.personId}
                onChange={(event) => updateOwner(owner.id, { personId: event.target.value })}
              >
                <option value="">Choose person</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName || "Unnamed person"}
                  </option>
                ))}
              </select>
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
                  step="any"
                  value={owner.sharePercentInput ?? owner.sharePercent ?? ""}
                  onChange={(event) =>
                    updateOwner(owner.id, shareFromPercentageInput(event.target.value))
                  }
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
      <button
        type="button"
        className="add-button"
        onClick={() => updateOwners([...owners, makeOwner()])}
      >
        <Plus size={16} /> Add initial owner
      </button>
    </div>
  );
}
