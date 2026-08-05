import { useMemo, useState } from "react";
import { ArrowRight, Building2, Plus, Trash2, UserRound } from "lucide-react";
import { isoDateToDisplay } from "../domain/dateFormat.js";
import {
  MAX_FRACTION_INTEGER,
  ZERO_FRACTION,
  compareFractions,
  fractionToNumber,
  normaliseFraction,
} from "../domain/fractions.js";
import { approximateFraction, buildPropertyLedger } from "../domain/ownership.js";
import { personChoiceLabel } from "../domain/people.js";
import { fractionForShare, shareFromPercentage } from "../domain/shares.js";
import { DateInput } from "./DateInput.jsx";

const blankParty = () => ({ name: "", type: "individual", registrationNumber: "" });
const blankTransfer = () => ({
  sellerId: "",
  buyerId: "",
  numerator: "",
  denominator: "",
  percentage: "",
  amountType: "all-share",
  shareInputMode: "fraction",
  date: "",
  consideration: "",
});
const percent = (share) =>
  `${(share * 100).toLocaleString("en-MT", { maximumFractionDigits: 2 })}%`;
const fractionLabel = (share) => {
  const fraction = approximateFraction(share);
  return `${fraction.numerator}/${fraction.denominator}`;
};

export function PropertyTransfers({
  people,
  outsideParties,
  transfers,
  startingOwnership,
  onChange,
}) {
  const [partyDraft, setPartyDraft] = useState(blankParty);
  const [transferDraft, setTransferDraft] = useState(blankTransfer);
  const ledger = useMemo(
    () => buildPropertyLedger(people, outsideParties, transfers, startingOwnership),
    [outsideParties, people, startingOwnership, transfers],
  );
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const choiceLabel = (party) => {
    const person = peopleById.get(party?.personId || party?.id);
    return person ? personChoiceLabel(person, people) : party?.name || "Unknown party";
  };
  const compareChoices = (first, second) =>
    choiceLabel(first).localeCompare(choiceLabel(second), "en-MT", {
      sensitivity: "base",
      numeric: true,
    });
  const partyName = (id) =>
    ledger.parties.find((party) => party.id === id)?.name || "Unknown party";
  const selectedSeller = ledger.owners.find((owner) => owner.id === transferDraft.sellerId) || null;
  const calculateTransfer = () => {
    if (!selectedSeller) return { error: "Select a current owner." };
    if (transferDraft.amountType === "all-share") {
      return {
        fraction: { numerator: 1, denominator: 1 },
        amountType: "seller-holding",
      };
    }

    let fraction;
    if (transferDraft.shareInputMode === "percentage") {
      const percentageInput = String(transferDraft.percentage ?? "").trim();
      const percentage = Number(percentageInput);
      if (!percentageInput || !Number.isFinite(percentage)) {
        return { error: "Enter a valid percentage." };
      }
      if (percentage <= 0) {
        return { error: "The transferred percentage must be greater than zero." };
      }
      if (percentage > 100) {
        return { error: "The transferred percentage cannot exceed 100%." };
      }
      fraction = fractionForShare(shareFromPercentage(percentage));
    } else {
      fraction = normaliseFraction(transferDraft.numerator, transferDraft.denominator);
      if (fraction.error) return fraction;
    }
    if (compareFractions(fraction, ZERO_FRACTION) <= 0) {
      return { error: "The transferred share must be greater than zero." };
    }
    if (compareFractions(fraction, selectedSeller.shareFraction) > 0) {
      return {
        error: "The transferred share cannot be greater than the seller's current holding.",
      };
    }
    return { fraction, amountType: "whole-property" };
  };
  const transferCalculation = calculateTransfer();
  const definedTransferHasInput =
    transferDraft.amountType === "defined-share" &&
    (transferDraft.shareInputMode === "percentage"
      ? Boolean(String(transferDraft.percentage ?? "").trim())
      : Boolean(
          String(transferDraft.numerator ?? "").trim() ||
          String(transferDraft.denominator ?? "").trim(),
        ));
  const addParty = (event) => {
    event.preventDefault();
    if (!partyDraft.name.trim()) return;
    const party = { id: crypto.randomUUID(), ...partyDraft, name: partyDraft.name.trim() };
    onChange({ outsideParties: [...outsideParties, party], transfers });
    setPartyDraft(blankParty());
    setTransferDraft((draft) => ({ ...draft, buyerId: party.id }));
  };
  const addTransfer = (event) => {
    event.preventDefault();
    const calculation = calculateTransfer();
    if (calculation.error) {
      return setTransferDraft((draft) => ({ ...draft, error: calculation.error }));
    }
    const record = { ...transferDraft };
    delete record.percentage;
    delete record.shareInputMode;
    delete record.error;
    const next = {
      id: crypto.randomUUID(),
      ...record,
      numerator: String(calculation.fraction.numerator),
      denominator: String(calculation.fraction.denominator),
      amountType: calculation.amountType,
    };
    const check = buildPropertyLedger(
      people,
      outsideParties,
      [...transfers, next],
      startingOwnership,
    ).entries.at(-1);
    if (check.error) return setTransferDraft((draft) => ({ ...draft, error: check.error }));
    onChange({ outsideParties, transfers: [...transfers, next] });
    setTransferDraft(blankTransfer());
  };
  return (
    <div className="ownership-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Title after inheritance</p>
          <h3>Ownership transfers</h3>
        </div>
      </div>
      <p className="helper-text">
        Record sales of this property separately from the family tree. Each transaction updates the
        ownership ledger without changing who inherited what.
      </p>
      <div className="ownership-grid">
        <div>
          <h3>Current owners</h3>
          <div className="owner-list">
            {ledger.owners.length ? (
              ledger.owners.map((owner) => (
                <div className="owner-row" key={owner.id}>
                  <span className={`party-icon ${owner.type}`}>
                    {owner.type === "company" ? <Building2 size={16} /> : <UserRound size={16} />}
                  </span>
                  <span>
                    <strong>{owner.name}</strong>
                    <small>
                      {owner.source === "family-tree"
                        ? "Family tree"
                        : owner.type === "company"
                          ? "Outside company"
                          : "Outside individual"}
                    </small>
                  </span>
                  <span className="owner-share">
                    <strong>{fractionLabel(owner.share)}</strong>
                    <small>{percent(owner.share)}</small>
                  </span>
                </div>
              ))
            ) : (
              <p className="helper-text">Assign owners above to establish the first owners.</p>
            )}
          </div>
          <div
            className={`ledger-total ${Math.abs(ledger.total - 1) < 1e-8 ? "valid" : "invalid"}`}
          >
            <span>Total title</span>
            <strong>{percent(ledger.total)}</strong>
          </div>
        </div>
        <form className="transfer-form" onSubmit={addTransfer}>
          <h3>Record a sale or transfer</h3>
          <label>
            Seller
            <select
              value={transferDraft.sellerId}
              onChange={(e) =>
                setTransferDraft({ ...transferDraft, sellerId: e.target.value, error: "" })
              }
            >
              <option value="">Select current owner</option>
              {[...ledger.owners].sort(compareChoices).map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {choiceLabel(owner)} — {fractionLabel(owner.share)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Buyer
            <select
              value={transferDraft.buyerId}
              onChange={(e) =>
                setTransferDraft({ ...transferDraft, buyerId: e.target.value, error: "" })
              }
            >
              <option value="">Select person or company</option>
              {ledger.parties
                .filter((party) => party.id !== transferDraft.sellerId)
                .sort(compareChoices)
                .map((party) => (
                  <option key={party.id} value={party.id}>
                    {choiceLabel(party)}
                    {party.type === "company" ? " (company)" : ""}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Transfer measurement
            <select
              aria-label="Transfer measurement"
              value={transferDraft.amountType}
              onChange={(e) =>
                setTransferDraft({ ...transferDraft, amountType: e.target.value, error: "" })
              }
            >
              <option value="all-share">All of the Share</option>
              <option value="defined-share">Define fraction or percentage</option>
            </select>
          </label>
          {transferDraft.amountType === "defined-share" && (
            <div className="transfer-definition">
              <label>
                Enter share as
                <select
                  aria-label="Transfer share format"
                  value={transferDraft.shareInputMode}
                  onChange={(e) =>
                    setTransferDraft({
                      ...transferDraft,
                      shareInputMode: e.target.value,
                      error: "",
                    })
                  }
                >
                  <option value="fraction">Fraction</option>
                  <option value="percentage">Percentage</option>
                </select>
              </label>
              {transferDraft.shareInputMode === "percentage" ? (
                <label>
                  Percentage of the whole property
                  <span className="transfer-percentage">
                    <input
                      aria-label="Transfer percentage"
                      type="number"
                      min="0"
                      max={
                        selectedSeller ? fractionToNumber(selectedSeller.shareFraction) * 100 : 100
                      }
                      step="any"
                      inputMode="decimal"
                      value={transferDraft.percentage}
                      onChange={(e) =>
                        setTransferDraft({
                          ...transferDraft,
                          percentage: e.target.value,
                          error: "",
                        })
                      }
                    />
                    <span>%</span>
                  </span>
                </label>
              ) : (
                <div className="transfer-fraction">
                  <label>
                    Numerator
                    <input
                      aria-label="Transfer numerator"
                      type="number"
                      min="0"
                      max={MAX_FRACTION_INTEGER}
                      step="1"
                      inputMode="numeric"
                      value={transferDraft.numerator}
                      onChange={(e) =>
                        setTransferDraft({
                          ...transferDraft,
                          numerator: e.target.value,
                          error: "",
                        })
                      }
                    />
                  </label>
                  <span>/</span>
                  <label>
                    Denominator
                    <input
                      aria-label="Transfer denominator"
                      type="number"
                      min="1"
                      max={MAX_FRACTION_INTEGER}
                      step="1"
                      inputMode="numeric"
                      value={transferDraft.denominator}
                      onChange={(e) =>
                        setTransferDraft({
                          ...transferDraft,
                          denominator: e.target.value,
                          error: "",
                        })
                      }
                    />
                  </label>
                </div>
              )}
            </div>
          )}
          {selectedSeller && (
            <p className="helper-text transfer-limit">
              Current holding: {selectedSeller.shareFraction.numerator}/
              {selectedSeller.shareFraction.denominator} of the property. A defined amount cannot
              exceed this share.
            </p>
          )}
          {definedTransferHasInput && transferCalculation.error && (
            <p className="transfer-error" role="alert">
              {transferCalculation.error}
            </p>
          )}
          <div className="form-grid compact">
            <label>
              Transfer date
              <DateInput
                value={transferDraft.date}
                onChange={(value) => setTransferDraft({ ...transferDraft, date: value })}
              />
            </label>
            <label>
              Consideration (€)
              <input
                type="number"
                min="0"
                value={transferDraft.consideration}
                onChange={(e) =>
                  setTransferDraft({ ...transferDraft, consideration: e.target.value })
                }
              />
            </label>
          </div>
          {transferDraft.error && (
            <p className="transfer-error" role="alert">
              {transferDraft.error}
            </p>
          )}
          <button
            type="submit"
            className="primary-button"
            disabled={Boolean(transferCalculation.error)}
          >
            <ArrowRight size={16} /> Apply transfer
          </button>
        </form>
      </div>
      <details className="outside-party">
        <summary>
          <Plus size={15} /> Add an outside buyer or company
        </summary>
        <form onSubmit={addParty} className="form-grid">
          <label>
            Name or registered name
            <input
              value={partyDraft.name}
              onChange={(e) => setPartyDraft({ ...partyDraft, name: e.target.value })}
              placeholder="Buyer name"
            />
          </label>
          <label>
            Party type
            <select
              value={partyDraft.type}
              onChange={(e) => setPartyDraft({ ...partyDraft, type: e.target.value })}
            >
              <option value="individual">Individual</option>
              <option value="company">Company</option>
            </select>
          </label>
          {partyDraft.type === "company" && (
            <label>
              Company registration number
              <input
                value={partyDraft.registrationNumber}
                onChange={(e) =>
                  setPartyDraft({ ...partyDraft, registrationNumber: e.target.value })
                }
              />
            </label>
          )}
          <button type="submit" className="secondary-button">
            <Plus size={16} /> Add buyer
          </button>
        </form>
      </details>
      {ledger.entries.length > 0 && (
        <div className="transfer-history">
          <h3>Transfer history</h3>
          {ledger.entries.map((entry) => (
            <div className={`history-row ${entry.error ? "invalid" : ""}`} key={entry.id}>
              <span>{isoDateToDisplay(entry.date) || "Undated"}</span>
              <strong>
                {partyName(entry.sellerId)} <ArrowRight size={13} /> {partyName(entry.buyerId)}
              </strong>
              <span>
                {entry.error ||
                  `${entry.kind === "donation" ? "Donation — " : ""}${fractionLabel(entry.amount)} of whole property (${percent(entry.amount)})`}
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label="Remove transfer"
                onClick={() =>
                  onChange({
                    outsideParties,
                    transfers: transfers.filter((transfer) => transfer.id !== entry.id),
                  })
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
