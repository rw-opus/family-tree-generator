import { useMemo, useState } from "react";
import { FilePlus2, Files, Plus, Trash2 } from "lucide-react";
import { isoDateToDisplay } from "../domain/dateFormat.js";
import { declarationCoverage, validateDeclaration } from "../domain/declarations.js";
import { displayNotaryName } from "../domain/notary.js";
import { approximateFraction } from "../domain/ownership.js";
import { DateInput } from "./DateInput.jsx";

const money = new Intl.NumberFormat("en-MT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});
const blankDeclaration = () => ({
  type: "original",
  status: "draft",
  date: "",
  notaryName: "",
  reference: "",
  scope: "",
  notes: "",
  participants: [],
});

// declarationCoverage/validateDeclaration are shared with the legacy heir-list declarations
// (SuccessionDeclarations.jsx); here each participant's "heirId" field holds a property owner's
// personId instead of a manual heir record id.
export function PropertyDeclarations({ property, owners, declarations, onChange }) {
  const [draft, setDraft] = useState(blankDeclaration);
  const [selectedOwner, setSelectedOwner] = useState("");
  const coverage = useMemo(() => declarationCoverage(owners, declarations), [declarations, owners]);
  const addDeclarant = () => {
    const owner = owners.find((item) => item.id === selectedOwner);
    if (!owner || draft.participants.some((participant) => participant.heirId === owner.id)) return;
    const fraction = approximateFraction(owner.share);
    const declaredValue = owner.share * (Number(property.marketValue) || 0);
    setDraft({
      ...draft,
      error: "",
      participants: [
        ...draft.participants,
        {
          heirId: owner.id,
          numerator: fraction.numerator,
          denominator: fraction.denominator,
          declaredValue,
        },
      ],
    });
    setSelectedOwner("");
  };
  const updateParticipant = (ownerId, patch) =>
    setDraft({
      ...draft,
      error: "",
      participants: draft.participants.map((participant) =>
        participant.heirId === ownerId ? { ...participant, ...patch } : participant,
      ),
    });
  const addDeclaration = (event) => {
    event.preventDefault();
    const error = validateDeclaration(draft);
    if (error) return setDraft({ ...draft, error });
    onChange([...declarations, { id: crypto.randomUUID(), ...draft, error: undefined }]);
    setDraft(blankDeclaration());
  };
  const ownerName = (id) =>
    owners.find((owner) => owner.id === id)?.name || "Removed or unnamed owner";

  return (
    <div className="declaration-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Causa mortis deeds</p>
          <h3>Declarations of succession</h3>
        </div>
      </div>
      <p className="helper-text">
        Each DCM records its declarants individually. For every owner appearing on the deed, enter
        the fraction of the whole property declared and the value attributed to that fraction.
      </p>
      <div className="declaration-layout">
        <form className="declaration-form" onSubmit={addDeclaration}>
          <div className="form-grid compact">
            <label>
              Declaration type
              <select
                value={draft.type}
                onChange={(e) => setDraft({ ...draft, type: e.target.value })}
              >
                <option value="original">Original declaration</option>
                <option value="additional">Additional declaration</option>
              </select>
            </label>
            <label>
              Status
              <select
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value, error: "" })}
              >
                <option value="draft">Draft / planned</option>
                <option value="published">Published and registered</option>
              </select>
            </label>
            <label>
              Publication date
              <DateInput
                value={draft.date}
                onChange={(value) => setDraft({ ...draft, date: value, error: "" })}
              />
            </label>
            <label>
              Notary
              <input
                value={draft.notaryName}
                onChange={(e) => setDraft({ ...draft, notaryName: e.target.value, error: "" })}
                placeholder="Notary's full name"
              />
            </label>
            <label>
              Deed or registration reference
              <input
                value={draft.reference}
                onChange={(e) => setDraft({ ...draft, reference: e.target.value })}
              />
            </label>
            <label>
              Scope covered
              <input
                value={draft.scope}
                onChange={(e) => setDraft({ ...draft, scope: e.target.value })}
                placeholder="Whole property, share or additional asset"
              />
            </label>
          </div>
          <fieldset className="declarant-picker">
            <legend>Declarants and amounts appearing in this DCM</legend>
            <div className="add-declarant">
              <select
                aria-label="Owner to add as declarant"
                value={selectedOwner}
                onChange={(e) => setSelectedOwner(e.target.value)}
              >
                <option value="">Choose an owner</option>
                {owners
                  .filter(
                    (owner) =>
                      !draft.participants.some((participant) => participant.heirId === owner.id),
                  )
                  .map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                className="secondary-button"
                onClick={addDeclarant}
                disabled={!selectedOwner}
              >
                <Plus size={15} /> Add declarant
              </button>
            </div>
            {draft.participants.length ? (
              <div className="declarant-rows">
                {draft.participants.map((participant) => (
                  <div className="declarant-row" key={participant.heirId}>
                    <strong>{ownerName(participant.heirId)}</strong>
                    <div className="declared-fraction">
                      <label>
                        Numerator
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={participant.numerator}
                          onChange={(e) =>
                            updateParticipant(participant.heirId, { numerator: e.target.value })
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
                          value={participant.denominator}
                          onChange={(e) =>
                            updateParticipant(participant.heirId, { denominator: e.target.value })
                          }
                        />
                      </label>
                    </div>
                    <label>
                      Declared value (€)
                      <input
                        type="number"
                        min="0"
                        value={participant.declaredValue}
                        onChange={(e) =>
                          updateParticipant(participant.heirId, { declaredValue: e.target.value })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove ${ownerName(participant.heirId)} from declaration`}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          participants: draft.participants.filter(
                            (item) => item.heirId !== participant.heirId,
                          ),
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="helper-text">
                Choose one or more owners. Suggested fractions and values come from the automatic
                ownership above and remain editable.
              </p>
            )}
          </fieldset>
          <label>
            Notes
            <input
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="Optional filing or follow-up note"
            />
          </label>
          {draft.error && (
            <p className="transfer-error" role="alert">
              {draft.error}
            </p>
          )}
          <button type="submit" className="primary-button">
            <FilePlus2 size={16} /> Add declaration
          </button>
        </form>
        <div className="coverage-panel">
          <h3>Published coverage by owner</h3>
          {coverage.length ? (
            coverage.map((item) => (
              <div className="coverage-row detailed" key={item.heirId}>
                <span>
                  {item.name}
                  <small>
                    {item.publishedCount
                      ? `${item.publishedCount} published DCM${item.publishedCount === 1 ? "" : "s"}`
                      : item.declarationCount
                        ? `${item.declarationCount} draft`
                        : "No DCM"}
                  </small>
                </span>
                <strong
                  className={
                    item.status === "complete"
                      ? "covered"
                      : !item.publishedCount && item.declarationCount
                        ? "draft"
                        : "missing"
                  }
                >
                  {item.publishedCount ? (
                    <>
                      {approximateFraction(item.publishedFraction).numerator}/
                      {approximateFraction(item.publishedFraction).denominator}
                      <small>{money.format(item.publishedValue)}</small>
                      <small>
                        {item.status === "invalid"
                          ? "Needs fraction/value details"
                          : item.status === "over"
                            ? "Over-declared"
                            : item.status === "under"
                              ? "Under-declared"
                              : "Complete"}
                      </small>
                    </>
                  ) : item.declarationCount ? (
                    "Draft only"
                  ) : (
                    "Not declared"
                  )}
                </strong>
              </div>
            ))
          ) : (
            <p className="helper-text">No owners yet — assign owners above first.</p>
          )}
          <p className="helper-text">
            Totals aggregate published DCM entries for this property. Additional declarations remain
            separate records.
          </p>
        </div>
      </div>
      {declarations.length > 0 && (
        <div className="declaration-list">
          {declarations.map((declaration, index) => (
            <article className="declaration-card" key={declaration.id}>
              <span className="declaration-icon">
                <Files size={18} />
              </span>
              <div>
                <strong>
                  {declaration.type === "additional" ? "Additional" : "Original"} DCM {index + 1}
                </strong>
                <p>
                  {declaration.status === "published"
                    ? `Published ${isoDateToDisplay(declaration.date)}`
                    : "Draft / planned"}
                  {declaration.notaryName ? ` · ${displayNotaryName(declaration.notaryName)}` : ""}
                  {declaration.reference ? ` · ${declaration.reference}` : ""}
                </p>
                <small>{declaration.scope || "Scope not specified"}</small>
                <div className="declaration-participants">
                  {(declaration.participants || []).map((participant) => (
                    <span key={participant.heirId}>
                      <strong>{ownerName(participant.heirId)}</strong> {participant.numerator}/
                      {participant.denominator} ·{" "}
                      {money.format(Number(participant.declaredValue || 0))}
                    </span>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Remove declaration"
                onClick={() => onChange(declarations.filter((item) => item.id !== declaration.id))}
              >
                <Trash2 size={15} />
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
