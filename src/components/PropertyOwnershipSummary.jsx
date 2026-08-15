import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { isoDateToDisplay } from "../domain/dateFormat.js";
import { approximateFraction, buildPropertyLedger } from "../domain/ownership.js";
import { OutsideOwnerInspector } from "./OutsideOwnerInspector.jsx";

const percent = (share) =>
  `${(share * 100).toLocaleString("en-MT", { maximumFractionDigits: 2 })}%`;

const fractionLabel = (share, exactFraction = null) => {
  const fraction = exactFraction?.denominator ? exactFraction : approximateFraction(share);
  return `${fraction.numerator}/${fraction.denominator}`;
};

/**
 * Read-only title and history calculated from initial ownership, successions and transfers.
 * A linked owner card remains the only place where a transaction can be changed.
 */
export function PropertyOwnershipSummary({
  people,
  outsideParties,
  transfers,
  startingOwnership,
  property = null,
  vendorReport = null,
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
          {partyName(id)}
        </button>
      );
    }
    return partyName(id);
  };

  const selectedOutsideOwner = outsideParties.find((party) => party.id === selectedOutsideOwnerId);

  return (
    <section className="ownership-panel property-ownership-summary" aria-labelledby="current-title">
      <div className="section-heading">
        <div>
          <h3 id="current-title">Current ownership</h3>
        </div>
      </div>

      <div className="owner-list">
        {ledger.owners.length ? (
          ledger.owners.map((owner) => (
            <div className="owner-row read-only-owner-row" key={owner.id}>
              {/* No provenance line. The name is the row; an outside owner is
                  already marked by the "Open owner card" affordance on its
                  link, so a second label under every name only added height. */}
              <span className="owner-identity">
                <strong>{renderPartyName(owner.id, { allowOutsideOwnerCard: true })}</strong>
              </span>
              <span className="owner-share">
                <strong>{fractionLabel(owner.share, owner.shareFraction)}</strong>
                <small>{percent(owner.share)}</small>
              </span>
            </div>
          ))
        ) : (
          <p className="helper-text">Complete the initial ownership to calculate current title.</p>
        )}
      </div>

      <div className={`ledger-total ${Math.abs(ledger.total - 1) < 1e-8 ? "valid" : "invalid"}`}>
        <span>Total title</span>
        <strong>{percent(ledger.total)}</strong>
      </div>

      {ledger.entries.length > 0 && (
        <div className="transfer-history read-only-transfer-history">
          <h3>Recorded transfer history</h3>
          <p className="helper-text">
            Sales and donations are edited from the relevant person or outside-owner card.
          </p>
          {ledger.entries.map((entry) => (
            <div className={`history-row ${entry.error ? "invalid" : ""}`} key={entry.id}>
              <span>{isoDateToDisplay(entry.date) || "Undated"}</span>
              <strong>
                {renderPartyName(entry.sellerId, { allowOutsideOwnerCard: true })}{" "}
                <ArrowRight size={13} aria-hidden="true" />{" "}
                {renderPartyName(entry.buyerId, { allowOutsideOwnerCard: true })}
              </strong>
              <span>
                {entry.error ||
                  `${entry.kind === "donation" ? "Donation" : "Sale"} · ${fractionLabel(entry.amount, entry.amountFraction)} of the property (${percent(entry.amount)})`}
              </span>
            </div>
          ))}
        </div>
      )}

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
