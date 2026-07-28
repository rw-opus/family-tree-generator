import { Calculator, Home, Plus, Trash2 } from "lucide-react";
import { buildPropertyOwnership } from "../domain/familyOwnership.js";
import { buildPropertyLedger } from "../domain/ownership.js";
import { saleTaxLot } from "../domain/propertyTax.js";
import { PropertyDeclarations } from "./PropertyDeclarations.jsx";
import { PropertyTransfers } from "./PropertyTransfers.jsx";

const money = new Intl.NumberFormat("en-MT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

const makeProperty = () => ({
  id: crypto.randomUUID(),
  address: "",
  description: "",
  marketValue: "",
  owners: [],
  declarations: [],
  transfers: [],
  saleLots: [],
});

const makeOwner = () => ({ id: crypto.randomUUID(), personId: "", sharePercent: 0 });
const makeLot = () => ({
  id: crypto.randomUUID(),
  ownerId: "",
  inheritanceDate: "",
  acquisitionValue: "",
  transferValue: "",
  brokerageFees: "",
  qualifiesFivePercent: false,
  ownResidenceExempt: false,
});

const ownersTotal = (owners = []) =>
  owners.reduce((total, owner) => total + (Number(owner.sharePercent) || 0), 0);

const viaLabel = (via) => {
  if (via === "starting") return "Direct owner";
  if (via === "will") return "Inherited by will";
  if (via === "unresolved") return "Unresolved";
  return "Inherited by intestacy";
};

export function Properties({ properties, people, outsideParties, onChange }) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const updateProperties = (nextProperties) => onChange({ properties: nextProperties });
  const updateProperty = (id, patch) =>
    updateProperties(properties.map((property) => (property.id === id ? { ...property, ...patch } : property)));
  const addProperty = () => updateProperties([...properties, makeProperty()]);
  const removeProperty = (id) => updateProperties(properties.filter((property) => property.id !== id));

  const addOwner = (property) =>
    updateProperty(property.id, { owners: [...(property.owners || []), makeOwner()] });
  const updateOwner = (property, ownerId, patch) =>
    updateProperty(property.id, {
      owners: (property.owners || []).map((owner) =>
        owner.id === ownerId ? { ...owner, ...patch } : owner,
      ),
    });
  const removeOwner = (property, ownerId) =>
    updateProperty(property.id, {
      owners: (property.owners || []).filter((owner) => owner.id !== ownerId),
    });

  const handleTransfersChange = (property) => (patch) =>
    onChange({
      properties: properties.map((item) =>
        item.id === property.id ? { ...item, transfers: patch.transfers } : item,
      ),
      outsideParties: patch.outsideParties,
    });

  const addLot = (property) =>
    updateProperty(property.id, { saleLots: [...(property.saleLots || []), makeLot()] });
  const updateLot = (property, lotId, patch) =>
    updateProperty(property.id, {
      saleLots: (property.saleLots || []).map((lot) => (lot.id === lotId ? { ...lot, ...patch } : lot)),
    });
  const removeLot = (property, lotId) =>
    updateProperty(property.id, {
      saleLots: (property.saleLots || []).filter((lot) => lot.id !== lotId),
    });

  return (
    <div className="calculator-stack">
      {properties.map((property) => {
        const owners = property.owners || [];
        const total = ownersTotal(owners);
        const result = buildPropertyOwnership(people, property);
        const declarationOwners = Object.entries(result.ownershipByPerson).map(([personId, share]) => ({
          id: personId,
          name: peopleById.get(personId)?.fullName || "Unnamed person",
          share,
        }));
        const ledger = buildPropertyLedger(people, outsideParties, property.transfers || [], result.ownershipByPerson);
        const saleRows = (property.saleLots || []).map((lot) => ({ lot, result: saleTaxLot(lot) }));
        return (
          <section className="editor-panel" key={property.id}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Property</p>
                <h2>{property.address || "Unnamed property"}</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                title="Remove property"
                onClick={() => removeProperty(property.id)}
              >
                <Trash2 size={16} />
              </button>
            </div>
            <div className="form-grid">
              <label className="full-width">
                Address
                <input
                  value={property.address}
                  onChange={(event) => updateProperty(property.id, { address: event.target.value })}
                  placeholder="Full address of the property"
                />
              </label>
              <label className="full-width">
                Description
                <input
                  value={property.description}
                  onChange={(event) => updateProperty(property.id, { description: event.target.value })}
                  placeholder="Optional registry, title or internal reference"
                />
              </label>
              <label>
                Market value (€)
                <input
                  type="number"
                  min="0"
                  value={property.marketValue}
                  onChange={(event) => updateProperty(property.id, { marketValue: event.target.value })}
                />
              </label>
            </div>

            <div className="section-heading">
              <div>
                <p className="eyebrow">Ownership today</p>
                <h3>Owners of this property</h3>
              </div>
            </div>
            <p className={`share-status ${Math.abs(total - 100) < 0.001 || !owners.length ? "valid" : "invalid"}`}>
              Allocated: {total.toFixed(2)}% {owners.length ? (Math.abs(total - 100) < 0.001 ? "— valid" : "— must equal 100%") : ""}
            </p>
            <div className="people-list">
              {owners.map((owner) => (
                <article className="person-card" key={owner.id}>
                  <div className="form-grid">
                    <label>
                      Person
                      <select
                        value={owner.personId}
                        onChange={(event) => updateOwner(property, owner.id, { personId: event.target.value })}
                      >
                        <option value="">Choose person</option>
                        {people.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.fullName || "Unnamed person"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Share (%)
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="any"
                        value={owner.sharePercent}
                        onChange={(event) =>
                          updateOwner(property, owner.id, { sharePercent: event.target.value })
                        }
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    title="Remove owner"
                    onClick={() => removeOwner(property, owner.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </article>
              ))}
            </div>
            <button type="button" className="add-button" onClick={() => addOwner(property)}>
              <Plus size={16} /> Add owner
            </button>

            <div className="automatic-heirs">
              <strong>Who owns this property today</strong>
              <small>Deceased owners are followed automatically to their heirs by intestacy or will.</small>
              {result.breakdown.length ? (
                result.breakdown.map((row) => {
                  const person = peopleById.get(row.ownerId);
                  return (
                    <div key={`${row.ownerId}-${row.via}`}>
                      <span>
                        {person?.fullName || "Unnamed person"}
                        <small> · {viaLabel(row.via)}</small>
                      </span>
                      <b>
                        {row.numerator}/{row.denominator} · {row.sharePercent.toLocaleString("en-MT", { maximumFractionDigits: 4 })}%
                      </b>
                    </div>
                  );
                })
              ) : (
                <small>Add owners above to see how this property is currently held.</small>
              )}
              {property.marketValue && (
                <small>Market value {money.format(Number(property.marketValue) || 0)}</small>
              )}
            </div>

            <PropertyDeclarations
              property={property}
              owners={declarationOwners}
              declarations={property.declarations || []}
              onChange={(declarations) => updateProperty(property.id, { declarations })}
            />

            <PropertyTransfers
              people={people}
              outsideParties={outsideParties}
              transfers={property.transfers || []}
              startingOwnership={result.ownershipByPerson}
              onChange={handleTransfersChange(property)}
            />

            <div className="section-heading">
              <div>
                <p className="eyebrow">Later disposal</p>
                <h3>Seller tax lots</h3>
              </div>
            </div>
            <p className="helper-text">Use a separate lot for every owner, inheritance date or acquisition route.</p>
            <div className="people-list">
              {saleRows.map(({ lot, result: lotResult }) => (
                <article className="person-card" key={lot.id}>
                  <div className="person-card-heading">
                    <strong>{ledger.parties.find((party) => party.id === lot.ownerId)?.name || "Unassigned owner"}</strong>
                    <button type="button" className="icon-button" title="Remove tax lot" onClick={() => removeLot(property, lot.id)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="form-grid">
                    <label>
                      Owner
                      <select value={lot.ownerId} onChange={(e) => updateLot(property, lot.id, { ownerId: e.target.value })}>
                        <option value="">Choose owner</option>
                        {ledger.parties.map((party) => (
                          <option key={party.id} value={party.id}>{party.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>Inheritance date<input type="date" value={lot.inheritanceDate} onChange={(e) => updateLot(property, lot.id, { inheritanceDate: e.target.value })} /></label>
                    <label>Acquisition / causa mortis value (€)<input type="number" min="0" value={lot.acquisitionValue} onChange={(e) => updateLot(property, lot.id, { acquisitionValue: e.target.value })} /></label>
                    <label>Share of sale value (€)<input type="number" min="0" value={lot.transferValue} onChange={(e) => updateLot(property, lot.id, { transferValue: e.target.value })} /></label>
                    <label>Verified brokerage fees (€)<input type="number" min="0" value={lot.brokerageFees} onChange={(e) => updateLot(property, lot.id, { brokerageFees: e.target.value })} /></label>
                    <label className="check-label"><input type="checkbox" checked={lot.qualifiesFivePercent} onChange={(e) => updateLot(property, lot.id, { qualifiesFivePercent: e.target.checked })} /> Qualifies for 5% method</label>
                    <label className="check-label"><input type="checkbox" checked={lot.ownResidenceExempt} onChange={(e) => updateLot(property, lot.id, { ownResidenceExempt: e.target.checked })} /> Own-residence exemption confirmed</label>
                  </div>
                  <div className="method-list">
                    {lotResult.methods.map((method) => (
                      <div className={method.key === lotResult.recommended ? "method best" : "method"} key={method.key}>
                        <span>{method.label}</span>
                        <strong>{money.format(method.tax)}</strong>
                        {method.key === lotResult.recommended && <small>Lowest estimate</small>}
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
            <button type="button" className="add-button" onClick={() => addLot(property)}>
              <Plus size={16} /> Add tax lot
            </button>
            {saleRows.length > 0 && (
              <div className="grand-total">
                <Calculator size={18} />
                <span>Estimated seller tax total</span>
                <strong>{money.format(saleRows.reduce((sum, row) => sum + row.result.methods.find((method) => method.key === row.result.recommended).tax, 0))}</strong>
              </div>
            )}
          </section>
        );
      })}
      <button type="button" className="primary-button" onClick={addProperty}>
        <Home size={16} /> Add property
      </button>
      {!properties.length && (
        <p className="helper-text">
          No properties yet. Add a property, then assign its starting owners from the family tree — the
          automatic cascade will follow any deceased owner to their heirs.
        </p>
      )}
    </div>
  );
}
