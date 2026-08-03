import { useMemo, useState } from "react";
import { ArrowRight, Building2, Plus, Trash2, UserRound } from "lucide-react";
import { isoDateToDisplay } from "../domain/dateFormat.js";
import { approximateFraction, buildPropertyLedger } from "../domain/ownership.js";
import { DateInput } from "./DateInput.jsx";

const blankParty = () => ({ name: "", type: "individual", registrationNumber: "" });
const blankTransfer = () => ({
  sellerId: "",
  buyerId: "",
  numerator: "1",
  denominator: "2",
  amountType: "seller-holding",
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
  const partyName = (id) =>
    ledger.parties.find((party) => party.id === id)?.name || "Unknown party";
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
    const next = { id: crypto.randomUUID(), ...transferDraft };
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
              {ledger.owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name} — {fractionLabel(owner.share)}
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
                .map((party) => (
                  <option key={party.id} value={party.id}>
                    {party.name}
                    {party.type === "company" ? " (company)" : ""}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Transfer measurement
            <select
              value={transferDraft.amountType}
              onChange={(e) =>
                setTransferDraft({ ...transferDraft, amountType: e.target.value, error: "" })
              }
            >
              <option value="seller-holding">Fraction of seller's current holding</option>
              <option value="whole-property">Fraction of the whole property</option>
            </select>
          </label>
          <div className="transfer-fraction">
            <label>
              Numerator
              <input
                type="number"
                min="0"
                step="1"
                value={transferDraft.numerator}
                onChange={(e) =>
                  setTransferDraft({ ...transferDraft, numerator: e.target.value, error: "" })
                }
              />
            </label>
            <span>/</span>
            <label>
              Denominator
              <input
                type="number"
                min="1"
                step="1"
                value={transferDraft.denominator}
                onChange={(e) =>
                  setTransferDraft({ ...transferDraft, denominator: e.target.value, error: "" })
                }
              />
            </label>
          </div>
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
          <button type="submit" className="primary-button">
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
                  `${fractionLabel(entry.amount)} of whole property (${percent(entry.amount)})`}
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
