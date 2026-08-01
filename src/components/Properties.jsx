import { Home, Plus, Trash2 } from "lucide-react";
import { buildPropertyVendorTaxReport } from "../domain/propertyVendorTax.js";
import {
  fractionForShare,
  shareFromFractionInput,
  shareFromPercentageInput,
} from "../domain/shares.js";
import { PropertyTransfers } from "./PropertyTransfers.jsx";
import { TaxCalculationPanel } from "./TaxCalculationPanel.jsx";

const money = new Intl.NumberFormat("en-MT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

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

const makeOwner = () => ({
  id: crypto.randomUUID(),
  personId: "",
  sharePercent: 0,
  shareNumerator: 0,
  shareDenominator: 1,
});

const viaLabel = (via) => {
  if (via === "starting") return "Direct owner";
  if (via === "will") return "Inherited by will";
  if (via === "unresolved") return "Unresolved";
  return "Inherited by intestacy";
};

export function Properties({
  properties,
  people,
  outsideParties,
  singleProperty = false,
  section = "all",
  onChange,
}) {
  const showSaleValue = section === "all" || section === "property";
  const showProperty = section === "all" || section === "property" || section === "ownership";
  const showOwnership = section === "all" || section === "ownership";
  const showTax = section === "all" || section === "tax";
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const updateProperties = (nextProperties) => onChange({ properties: nextProperties });
  const updateProperty = (id, patch) =>
    updateProperties(
      properties.map((property) => (property.id === id ? { ...property, ...patch } : property)),
    );
  const addProperty = () => updateProperties([...properties, makeProperty()]);
  const removeProperty = (id) =>
    updateProperties(properties.filter((property) => property.id !== id));
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

  return (
    <div className={`calculator-stack ${singleProperty ? "single-property-case" : ""}`}>
      {properties.map((property) => {
        const owners = property.owners || [];
        const vendorReport = buildPropertyVendorTaxReport(property, people, outsideParties);
        const { startingOwnership, ownership: result } = vendorReport;
        const ownershipTotalLabel = startingOwnership.totalPercent.toLocaleString("en-MT", {
          maximumFractionDigits: 4,
        });

        return (
          <section className="editor-panel" key={property.id}>
            {showProperty && !singleProperty && (
              <>
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
                      onChange={(event) =>
                        updateProperty(property.id, { address: event.target.value })
                      }
                      placeholder="Full address of the property"
                    />
                  </label>
                  <label className="full-width">
                    Description
                    <input
                      value={property.description}
                      onChange={(event) =>
                        updateProperty(property.id, { description: event.target.value })
                      }
                      placeholder="Optional registry, title or internal reference"
                    />
                  </label>
                </div>
              </>
            )}

            {!startingOwnership.isComplete && (
              <div className="ownership-blocking-notice" role="alert">
                <strong>
                  {startingOwnership.isUnset
                    ? "No starting ownership has been set."
                    : `Starting ownership totals ${ownershipTotalLabel}%.`}
                </strong>
                <span>
                  {startingOwnership.isUnset
                    ? "Enter who owned this property before any transfers."
                    : "Starting ownership must equal 100% before calculated shares, transfers or tax figures are shown."}
                  {!showProperty && " Open Owners & transfers to complete the initial title."}
                </span>
              </div>
            )}

            {showSaleValue && (
              <div className="form-grid property-sale-value">
                <label className="full-width">
                  Value of the property being sold today (€)
                  <input
                    aria-label="Value of the property being sold today"
                    type="number"
                    min="0"
                    step="any"
                    value={property.saleValue || ""}
                    onChange={(event) =>
                      updateProperty(property.id, { saleValue: event.target.value })
                    }
                  />
                </label>
              </div>
            )}

            {showProperty && (
              <>
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Initial title</p>
                    <h3>Initial owner/s of the property</h3>
                  </div>
                </div>
                <p className="helper-text">
                  Select any person already on the family tree and enter the fraction originally
                  owned. Initial owners may be added whenever they are identified.
                </p>
                <p className={`share-status ${startingOwnership.isComplete ? "valid" : "invalid"}`}>
                  Initial title allocated: {ownershipTotalLabel}% —{" "}
                  {startingOwnership.isComplete ? "valid" : "must equal 100%"}
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
                          onChange={(event) =>
                            updateOwner(property, owner.id, { personId: event.target.value })
                          }
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
                            step="1"
                            value={ownerNumerator}
                            onChange={(event) =>
                              updateOwner(
                                property,
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
                            step="1"
                            value={ownerDenominator}
                            onChange={(event) =>
                              updateOwner(
                                property,
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
                              updateOwner(
                                property,
                                owner.id,
                                shareFromPercentageInput(event.target.value),
                              )
                            }
                          />
                          <b>%</b>
                        </span>
                        <button
                          type="button"
                          className="icon-button"
                          title="Remove owner"
                          onClick={() => removeOwner(property, owner.id)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <button type="button" className="add-button" onClick={() => addOwner(property)}>
                  <Plus size={16} /> Add initial owner
                </button>
              </>
            )}

            {showOwnership && startingOwnership.isComplete && (
              <div className="automatic-heirs">
                <strong>Calculated title after inheritance</strong>
                <small>
                  The initial fractions are followed automatically through intestacy, wills and
                  recorded transfers.
                </small>
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
                          {row.numerator}/{row.denominator} ·{" "}
                          {row.sharePercent.toLocaleString("en-MT", { maximumFractionDigits: 4 })}%
                        </b>
                      </div>
                    );
                  })
                ) : (
                  <small>Complete the selected initial owners to calculate the later title.</small>
                )}
                {property.marketValue && (
                  <small>Market value {money.format(Number(property.marketValue) || 0)}</small>
                )}
              </div>
            )}

            {showOwnership && startingOwnership.isComplete && (
              <PropertyTransfers
                people={people}
                outsideParties={outsideParties}
                transfers={property.transfers || []}
                startingOwnership={result.ownershipByPerson}
                onChange={handleTransfersChange(property)}
              />
            )}

            {showTax && startingOwnership.isComplete && (
              <TaxCalculationPanel
                property={property}
                people={people}
                outsideParties={outsideParties}
                vendorReport={vendorReport}
              />
            )}
          </section>
        );
      })}
      {showProperty && !singleProperty && (
        <button type="button" className="primary-button" onClick={addProperty}>
          <Home size={16} /> Add property
        </button>
      )}
      {showProperty && !singleProperty && !properties.length && (
        <p className="helper-text">
          No properties yet. Add a property, then assign its starting owners from the family tree —
          the automatic cascade will follow any deceased owner to their heirs.
        </p>
      )}
    </div>
  );
}
