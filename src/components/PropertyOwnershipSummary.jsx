import { useMemo, useState } from "react";
import { isRecordedDeceased } from "../domain/deceasedStatus.js";
import { buildPropertyLedger } from "../domain/ownership.js";
import {
  buildCurrentOwnerPresentations,
  formatPercentageHundredths,
  formatOwnershipFraction,
  formatOwnershipPercentage,
  ownerPresentationsById,
  recordedNonNegativeMoney,
} from "../domain/ownershipPresentation.js";
import { OutsideOwnerInspector } from "./OutsideOwnerInspector.jsx";

const money = new Intl.NumberFormat("en-MT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

/**
 * Read-only current title calculated from initial ownership, successions and transfers.
 * A linked owner card remains the only place where a transaction can be changed.
 */
export function PropertyOwnershipSummary({
  people,
  outsideParties,
  transfers,
  startingOwnership,
  property = null,
  vendorReport = null,
  taxCalculationReport = null,
  currentOwnerPresentationsById: suppliedCurrentOwnerPresentationsById = null,
  onSelectPerson,
  selectedOutsideOwnerId: controlledOutsideOwnerId,
  onSelectOutsideOwner,
  onOutsideOwnerTransactionsChange,
}) {
  const [localOutsideOwnerId, setLocalOutsideOwnerId] = useState("");
  const selectedOutsideOwnerId = controlledOutsideOwnerId ?? localOutsideOwnerId;
  const selectOutsideOwner = (ownerId) => {
    if (onSelectOutsideOwner) onSelectOutsideOwner(ownerId);
    else setLocalOutsideOwnerId(ownerId);
  };
  const ledger = useMemo(
    () =>
      vendorReport?.ledger ||
      buildPropertyLedger(people, outsideParties, transfers, startingOwnership),
    [outsideParties, people, startingOwnership, transfers, vendorReport],
  );
  const currentOwnerPresentations = useMemo(() => {
    const generatedPresentationsById = ownerPresentationsById(
      buildCurrentOwnerPresentations(ledger.owners, property?.saleValue, taxCalculationReport),
    );
    return suppliedCurrentOwnerPresentationsById
      ? { ...generatedPresentationsById, ...suppliedCurrentOwnerPresentationsById }
      : generatedPresentationsById;
  }, [
    ledger.owners,
    property?.saleValue,
    suppliedCurrentOwnerPresentationsById,
    taxCalculationReport,
  ]);
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const partyName = (id) =>
    ledger.parties.find((party) => party.id === id)?.name || "Unknown party";

  const renderPartyName = (id, { allowOutsideOwnerCard = false } = {}) => {
    const person = peopleById.get(id);
    if (person && onSelectPerson) {
      return (
        <button
          type="button"
          className="ownership-person-link"
          onClick={() => onSelectPerson(person.id)}
        >
          {person.fullName || partyName(id)}
        </button>
      );
    }
    const outsideOwner = outsideParties.find((party) => party.id === id);
    if (allowOutsideOwnerCard && outsideOwner && property && onOutsideOwnerTransactionsChange) {
      return (
        <button
          type="button"
          className="ownership-person-link outside-owner-link"
          aria-label={`Open ${partyName(id)} owner card`}
          onClick={() => selectOutsideOwner(id)}
        >
          {/* The name is wrapped so the underline belongs to it rather than to
              the button, which would also draw under the appended hint. */}
          <span className="outside-owner-name">{partyName(id)}</span>
        </button>
      );
    }
    return partyName(id);
  };

  const selectedOutsideOwner = outsideParties.find((party) => party.id === selectedOutsideOwnerId);
  const titleDisplayHundredths = ledger.owners.reduce((total, owner) => {
    const value = currentOwnerPresentations[owner.id]?.displayPercentageHundredths;
    return Number.isSafeInteger(total) && Number.isSafeInteger(value) ? total + value : null;
  }, 0);
  const titlePercentageLabel =
    formatPercentageHundredths(titleDisplayHundredths) ||
    formatOwnershipPercentage(ledger.total, ledger.totalFraction);

  return (
    <section className="ownership-panel property-ownership-summary" aria-labelledby="current-title">
      <div className="section-heading">
        <div>
          <h3 id="current-title">Current title positions</h3>
        </div>
      </div>

      <div className="owner-list">
        {ledger.owners.length ? (
          ledger.owners.map((owner) => {
            const presentation = currentOwnerPresentations[owner.id];
            const currentValue = recordedNonNegativeMoney(presentation.value);
            const ownerPerson = peopleById.get(owner.id);
            const ownerIsDeceased = ownerPerson ? isRecordedDeceased(ownerPerson) : false;
            const valueLabel = ownerIsDeceased ? "Notional value" : "Current value";
            return (
              <div className="owner-row read-only-owner-row" key={owner.id}>
                {/* No provenance line. The name is the row; an outside owner is
                  already marked by the "Open owner card" affordance on its
                  link, so a second label under every name only added height. */}
                <span className="owner-identity">
                  <strong>{renderPartyName(owner.id, { allowOutsideOwnerCard: true })}</strong>
                  {ownerIsDeceased && (
                    <small className="owner-status">Heirs to be Identified</small>
                  )}
                </span>
                <span className="owner-share">
                  <strong>
                    {formatOwnershipFraction(presentation.share, presentation.shareFraction)}
                  </strong>
                  <small>
                    {presentation.displayPercentageLabel ||
                      formatOwnershipPercentage(presentation.share, presentation.shareFraction)}
                  </small>
                  <small
                    className="owner-value"
                    title={
                      currentValue === null
                        ? "Enter the property selling price to calculate this value."
                        : undefined
                    }
                  >
                    <span className="sr-only">{valueLabel} </span>
                    {currentValue === null ? "—" : money.format(currentValue)}
                  </small>
                </span>
              </div>
            );
          })
        ) : (
          <p className="helper-text">Complete the initial ownership to calculate current title.</p>
        )}
      </div>

      <div className={`ledger-total ${Math.abs(ledger.total - 1) < 1e-8 ? "valid" : "invalid"}`}>
        <span>Total title</span>
        <strong>{titlePercentageLabel}</strong>
      </div>

      {selectedOutsideOwner && property && onOutsideOwnerTransactionsChange && (
        <OutsideOwnerInspector
          key={selectedOutsideOwner.id}
          owner={selectedOutsideOwner}
          property={property}
          people={people}
          outsideParties={outsideParties}
          onChange={onOutsideOwnerTransactionsChange}
          onClose={() => selectOutsideOwner("")}
          onOpenSourcePerson={(sourceId) => {
            if (outsideParties.some((party) => party.id === sourceId)) {
              selectOutsideOwner(sourceId);
              return;
            }
            onSelectPerson?.(sourceId);
          }}
        />
      )}
    </section>
  );
}
