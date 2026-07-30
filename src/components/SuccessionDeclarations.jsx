import { useMemo, useState } from "react";
import { FilePlus2, Files, Plus, Trash2 } from "lucide-react";
import { declarationCoverage, validateDeclaration } from "../domain/declarations.js";
import { inheritedValue } from "../domain/propertyTax.js";
import { approximateFraction } from "../domain/ownership.js";

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

export function SuccessionDeclarations({ heirs, property, declarations, onChange }) {
  const [draft, setDraft] = useState(blankDeclaration);
  const [selectedHeir, setSelectedHeir] = useState("");
  const coverage = useMemo(() => declarationCoverage(heirs, declarations), [declarations, heirs]);
  const addDeclarant = () => {
    const heir = heirs.find((item) => item.id === selectedHeir);
    if (!heir || draft.participants.some((participant) => participant.heirId === heir.id)) return;
    const wholePropertyShare =
      (Number(property.deceasedOwnershipPercent || 0) / 100) *
      (Number(property.rightPercent || 0) / 100) *
      (Number(heir.sharePercent || 0) / 100);
    const fraction = approximateFraction(wholePropertyShare);
    setDraft({
      ...draft,
      error: "",
      participants: [
        ...draft.participants,
        {
          heirId: heir.id,
          numerator: fraction.numerator,
          denominator: fraction.denominator,
          declaredValue: inheritedValue(property, heir),
        },
      ],
    });
    setSelectedHeir("");
  };
  const updateParticipant = (heirId, patch) =>
    setDraft({
      ...draft,
      error: "",
      participants: draft.participants.map((participant) =>
        participant.heirId === heirId ? { ...participant, ...patch } : participant,
      ),
    });
  const addDeclaration = (event) => {
    event.preventDefault();
    const error = validateDeclaration(draft);
    if (error) return setDraft({ ...draft, error });
    onChange([...declarations, { id: crypto.randomUUID(), ...draft, error: undefined }]);
    setDraft(blankDeclaration());
  };
  const heirName = (id) => heirs.find((heir) => heir.id === id)?.name || "Removed or unnamed heir";
  const participantsOf = (declaration) =>
    declaration.participants ||
    (declaration.heirIds || []).map((heirId) => ({
      heirId,
      numerator: 0,
      denominator: 1,
      declaredValue: 0,
    }));
  return (
    <section className="editor-panel declaration-panel">
      <header>
        <p className="eyebrow">Causa mortis deeds</p>
        <h2>Declarations of succession</h2>
        <p className="helper-text">
          Each DCM records its declarants individually. For every heir appearing on the deed, enter
          the fraction of the whole property declared and the value attributed to that fraction.
        </p>
      </header>
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
              <input
                type="date"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value, error: "" })}
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
              Property / scope covered
              <input
                value={draft.scope}
                onChange={(e) => setDraft({ ...draft, scope: e.target.value })}
                placeholder="Property, share or additional asset"
              />
            </label>
          </div>
          <fieldset className="declarant-picker">
            <legend>Declarants and amounts appearing in this DCM</legend>
            <div className="add-declarant">
              <select
                aria-label="Heir to add as declarant"
                value={selectedHeir}
                onChange={(e) => setSelectedHeir(e.target.value)}
              >
                <option value="">Choose an heir</option>
                {heirs
                  .filter(
                    (heir) =>
                      !draft.participants.some((participant) => participant.heirId === heir.id),
                  )
                  .map((heir) => (
                    <option key={heir.id} value={heir.id}>
                      {heir.name || "Unnamed heir"}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                className="secondary-button"
                onClick={addDeclarant}
                disabled={!selectedHeir}
              >
                <Plus size={15} /> Add declarant
              </button>
            </div>
            {draft.participants.length ? (
              <div className="declarant-rows">
                {draft.participants.map((participant) => (
                  <div className="declarant-row" key={participant.heirId}>
                    <strong>{heirName(participant.heirId)}</strong>
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
                      aria-label={`Remove ${heirName(participant.heirId)} from declaration`}
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
                Choose one or more heirs. Suggested fractions and values come from the calculated
                inheritance and remain editable.
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
          <h3>Published coverage by heir</h3>
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
            <p className="helper-text">No heirs added.</p>
          )}
          <p className="helper-text">
            Totals aggregate published DCM entries for this case. Additional declarations remain
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
                    ? `Published ${declaration.date || ""}`
                    : "Draft / planned"}
                  {declaration.notaryName ? ` · ${declaration.notaryName}` : ""}
                  {declaration.reference ? ` · ${declaration.reference}` : ""}
                </p>
                <small>{declaration.scope || "Scope not specified"}</small>
                <div className="declaration-participants">
                  {participantsOf(declaration).map((participant) => (
                    <span key={participant.heirId}>
                      <strong>{heirName(participant.heirId)}</strong> {participant.numerator}/
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
    </section>
  );
}
