import { Calculator, Home, Plus, Trash2 } from "lucide-react";
import { approximateFraction } from "../domain/ownership.js";
import { buildPropertyVendorTaxReport } from "../domain/propertyVendorTax.js";
import { fractionForShare, shareFromFraction, shareFromPercentage } from "../domain/shares.js";
import { PropertyDeclarations } from "./PropertyDeclarations.jsx";
import { PropertyTransfers } from "./PropertyTransfers.jsx";

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
const makeLot = () => ({
  id: crypto.randomUUID(),
  ownerId: "",
  inheritanceDate: "",
  shareNumerator: 0,
  shareDenominator: 1,
  acquisitionValue: "",
  transferValue: "",
  useDeclaredValues: true,
  selectedTaxMethod: "",
  taxTreatment: "inheritance",
  manualTaxAmount: "",
});

const ownersTotal = (owners = []) =>
  owners.reduce((total, owner) => total + (Number(owner.sharePercent) || 0), 0);

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
  const updateOwnerFraction = (property, owner, patch) => {
    const current = fractionForShare(owner);
    updateOwner(
      property,
      owner.id,
      shareFromFraction(
        patch.numerator ?? current.numerator,
        patch.denominator ?? current.denominator,
      ),
    );
  };
  const updateOwnerPercentage = (property, owner, percentage) =>
    updateOwner(property, owner.id, shareFromPercentage(percentage));
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
      saleLots: (property.saleLots || []).map((lot) =>
        lot.id === lotId ? { ...lot, ...patch } : lot,
      ),
    });
  const removeLot = (property, lotId) =>
    updateProperty(property.id, {
      saleLots: (property.saleLots || []).filter((lot) => lot.id !== lotId),
    });

  return (
    <div className={`calculator-stack ${singleProperty ? "single-property-case" : ""}`}>
      {properties.map((property) => {
        const owners = property.owners || [];
        const total = ownersTotal(owners);
        const {
          ownership: result,
          declarationOwners,
          ledger,
          saleRows,
          deceasedVendorIds,
          livingVendors,
          taxSummary,
        } = buildPropertyVendorTaxReport(property, people, outsideParties);
        const livingVendorIds = new Set(livingVendors.map((vendor) => vendor.id));
        return (
          <section className="editor-panel" key={property.id}>
            {showProperty && (
              <>
                {!singleProperty && (
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
                      <label>
                        Market value (€)
                        <input
                          type="number"
                          min="0"
                          value={property.marketValue}
                          onChange={(event) =>
                            updateProperty(property.id, { marketValue: event.target.value })
                          }
                        />
                      </label>
                    </div>
                  </>
                )}
              </>
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
                <p
                  className={`share-status ${Math.abs(total - 100) < 0.001 || !owners.length ? "valid" : "invalid"}`}
                >
                  Initial title allocated: {total.toFixed(2)}%{" "}
                  {owners.length
                    ? Math.abs(total - 100) < 0.001
                      ? "— valid"
                      : "— must equal 100%"
                    : ""}
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
                    return (
                      <div className="initial-owner-row" key={owner.id}>
                        <select
                          aria-label="Initial owner"
                          value={owner.personId}
                          onChange={(event) =>
                            updateOwner(property, owner.id, {
                              personId: event.target.value,
                            })
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
                            value={ownerFraction.numerator}
                            onChange={(event) =>
                              updateOwnerFraction(property, owner, {
                                numerator: event.target.value,
                              })
                            }
                          />
                          <b>/</b>
                          <input
                            aria-label="Initial ownership denominator"
                            type="number"
                            min="1"
                            step="1"
                            value={ownerFraction.denominator}
                            onChange={(event) =>
                              updateOwnerFraction(property, owner, {
                                denominator: event.target.value,
                              })
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
                            value={owner.sharePercent}
                            onChange={(event) =>
                              updateOwnerPercentage(property, owner, event.target.value)
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

                {owners.length > 0 && (
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
                              {row.sharePercent.toLocaleString("en-MT", {
                                maximumFractionDigits: 4,
                              })}
                              %
                            </b>
                          </div>
                        );
                      })
                    ) : (
                      <small>
                        Complete the selected initial owners to calculate the later title.
                      </small>
                    )}
                    {property.marketValue && (
                      <small>Market value {money.format(Number(property.marketValue) || 0)}</small>
                    )}
                  </div>
                )}

                <PropertyDeclarations
                  property={property}
                  owners={declarationOwners}
                  declarations={property.declarations || []}
                  onChange={(declarations) => updateProperty(property.id, { declarations })}
                />
              </>
            )}

            {showOwnership && (
              <PropertyTransfers
                people={people}
                outsideParties={outsideParties}
                transfers={property.transfers || []}
                startingOwnership={result.ownershipByPerson}
                onChange={handleTransfersChange(property)}
              />
            )}

            {showTax && (
              <>
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Later disposal</p>
                    <h3>Seller tax lots</h3>
                  </div>
                </div>
                <p className="helper-text">
                  Use one lot for each inherited fraction. The sale price and causa mortis value in
                  that lot must cover the same fraction.
                </p>
                <div className="people-list">
                  {saleRows.map(
                    ({
                      lot,
                      effectiveLot,
                      declaredCoverage,
                      usePublishedValues,
                      result: lotResult,
                    }) => (
                      <article
                        className={`person-card ${
                          deceasedVendorIds.has(lot.ownerId) ? "excluded-vendor-lot" : ""
                        }`}
                        key={lot.id}
                      >
                        <div className="person-card-heading">
                          <strong>
                            {ledger.parties.find((party) => party.id === lot.ownerId)?.name ||
                              "Unassigned owner"}
                          </strong>
                          <button
                            type="button"
                            className="icon-button"
                            title="Remove tax lot"
                            onClick={() => removeLot(property, lot.id)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <div className="form-grid">
                          <label>
                            Owner
                            <select
                              value={lot.ownerId}
                              onChange={(event) =>
                                updateLot(property, lot.id, {
                                  ownerId: event.target.value,
                                  selectedTaxMethod: "",
                                  useDeclaredValues: true,
                                  taxTreatment:
                                    ledger.parties.find((party) => party.id === event.target.value)
                                      ?.type === "company"
                                      ? "manual"
                                      : "inheritance",
                                })
                              }
                            >
                              <option value="">Choose owner</option>
                              {lot.ownerId && !livingVendorIds.has(lot.ownerId) && (
                                <option value={lot.ownerId}>
                                  {ledger.parties.find((party) => party.id === lot.ownerId)?.name ||
                                    "Unavailable vendor"}
                                  {deceasedVendorIds.has(lot.ownerId)
                                    ? " — deceased and excluded"
                                    : " — not a current vendor"}
                                </option>
                              )}
                              {livingVendors.map((party) => (
                                <option key={party.id} value={party.id}>
                                  {party.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Tax treatment
                            <select
                              aria-label="Tax treatment"
                              value={lot.taxTreatment || "inheritance"}
                              disabled={
                                ledger.parties.find((party) => party.id === lot.ownerId)?.type ===
                                "company"
                              }
                              onChange={(event) =>
                                updateLot(property, lot.id, {
                                  taxTreatment: event.target.value,
                                  selectedTaxMethod: "",
                                })
                              }
                            >
                              <option value="inheritance">Inherited-property calculation</option>
                              <option value="manual">Manual assessment</option>
                            </select>
                          </label>
                          {lot.taxTreatment !== "manual" && (
                            <label>
                              Inheritance date
                              <input
                                type="date"
                                value={lot.inheritanceDate}
                                onChange={(event) =>
                                  updateLot(property, lot.id, {
                                    inheritanceDate: event.target.value,
                                    selectedTaxMethod: "",
                                  })
                                }
                              />
                            </label>
                          )}
                          {lot.taxTreatment === "manual" && (
                            <label>
                              Manually assessed tax (€)
                              <input
                                type="number"
                                min="0"
                                value={lot.manualTaxAmount || ""}
                                onChange={(event) =>
                                  updateLot(property, lot.id, {
                                    manualTaxAmount: event.target.value,
                                    selectedTaxMethod: "manual",
                                  })
                                }
                              />
                            </label>
                          )}
                          {lot.taxTreatment !== "manual" && (
                            <>
                              <label>
                                Fraction covered by this lot
                                <span className="tax-lot-fraction">
                                  <input
                                    aria-label="Tax lot share numerator"
                                    type="number"
                                    min="0"
                                    step="1"
                                    disabled={usePublishedValues}
                                    value={effectiveLot.shareNumerator ?? 0}
                                    onChange={(event) =>
                                      updateLot(property, lot.id, {
                                        shareNumerator: event.target.value,
                                        useDeclaredValues: false,
                                      })
                                    }
                                  />
                                  <b>/</b>
                                  <input
                                    aria-label="Tax lot share denominator"
                                    type="number"
                                    min="1"
                                    step="1"
                                    disabled={usePublishedValues}
                                    value={effectiveLot.shareDenominator ?? 1}
                                    onChange={(event) =>
                                      updateLot(property, lot.id, {
                                        shareDenominator: event.target.value,
                                        useDeclaredValues: false,
                                      })
                                    }
                                  />
                                </span>
                              </label>
                              <label>
                                Accumulated causa mortis value (€)
                                <input
                                  type="number"
                                  min="0"
                                  disabled={usePublishedValues}
                                  value={effectiveLot.acquisitionValue}
                                  onChange={(event) =>
                                    updateLot(property, lot.id, {
                                      acquisitionValue: event.target.value,
                                      useDeclaredValues: false,
                                    })
                                  }
                                />
                              </label>
                            </>
                          )}
                          <label>
                            Sale price of the same fraction (€)
                            <input
                              type="number"
                              min="0"
                              value={lot.transferValue}
                              onChange={(event) =>
                                updateLot(property, lot.id, {
                                  transferValue: event.target.value,
                                })
                              }
                            />
                          </label>
                          {lot.taxTreatment !== "manual" && (
                            <label className="check-label full-width">
                              <input
                                type="checkbox"
                                disabled={!declaredCoverage?.publishedCount}
                                checked={usePublishedValues}
                                onChange={(event) =>
                                  updateLot(property, lot.id, {
                                    useDeclaredValues: event.target.checked,
                                  })
                                }
                              />
                              Use the accumulated values and fraction from published CM declarations
                            </label>
                          )}
                        </div>
                        {deceasedVendorIds.has(lot.ownerId) && (
                          <p className="excluded-vendor-notice">
                            Excluded: this person is deceased. No vendor tax is calculated or
                            carried into the payable totals.
                          </p>
                        )}
                        {lot.ownerId &&
                          !livingVendorIds.has(lot.ownerId) &&
                          !deceasedVendorIds.has(lot.ownerId) && (
                            <p className="excluded-vendor-notice">
                              Excluded: this party is not a current owner of the property and
                              therefore is not on the vendor list.
                            </p>
                          )}
                        {lot.taxTreatment !== "manual" &&
                          usePublishedValues &&
                          livingVendorIds.has(lot.ownerId) && (
                            <p className="tax-lot-source">
                              Published CM total: {effectiveLot.shareNumerator}/
                              {effectiveLot.shareDenominator}
                              {" · "}
                              {money.format(Number(effectiveLot.acquisitionValue) || 0)}
                            </p>
                          )}
                        {lot.taxTreatment !== "manual" &&
                          !declaredCoverage?.publishedCount &&
                          livingVendorIds.has(lot.ownerId) && (
                            <p className="tax-lot-source attention">
                              No published CM value is linked to this owner. Enter the fraction and
                              its declared value manually.
                            </p>
                          )}
                        {lotResult.warning && livingVendorIds.has(lot.ownerId) && (
                          <p className="transfer-error" role="status">
                            {lotResult.warning}
                          </p>
                        )}
                        {livingVendorIds.has(lot.ownerId) && (
                          <div className="method-list">
                            {lotResult.methods.map((method) => (
                              <button
                                type="button"
                                className={[
                                  "method",
                                  method.key === lotResult.selected ? "selected" : "",
                                  method.key === lotResult.recommended ? "best" : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                key={method.key}
                                onClick={() =>
                                  updateLot(property, lot.id, {
                                    selectedTaxMethod: method.key,
                                  })
                                }
                              >
                                <span>{method.label}</span>
                                <strong>{money.format(method.tax)}</strong>
                                <small>
                                  Taxable basis {money.format(method.basis)}
                                  {method.key === lotResult.selected
                                    ? " · Selected"
                                    : method.key === lotResult.recommended
                                      ? " · Lowest estimate"
                                      : " · Choose this method"}
                                </small>
                              </button>
                            ))}
                          </div>
                        )}
                      </article>
                    ),
                  )}
                </div>
                <button type="button" className="add-button" onClick={() => addLot(property)}>
                  <Plus size={16} /> Add tax lot
                </button>
                <div className="vendor-tax-summary">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Vendors</p>
                      <h3>Tax payable by each living vendor</h3>
                    </div>
                  </div>
                  {taxSummary.vendors.length ? (
                    <div className="vendor-tax-list">
                      {taxSummary.vendors.map((vendor) => {
                        const ownershipFraction = approximateFraction(vendor.share);
                        return (
                          <article className="vendor-tax-card" key={vendor.id}>
                            <div className="vendor-tax-heading">
                              <span>
                                <strong>{vendor.name}</strong>
                                <small>
                                  Current vendor · {ownershipFraction.numerator}/
                                  {ownershipFraction.denominator} ownership
                                </small>
                              </span>
                              <span>
                                <strong>{money.format(vendor.tax)}</strong>
                                <small>selected tax payable</small>
                              </span>
                            </div>
                            {vendor.rows.length ? (
                              <div className="vendor-tax-lots">
                                {vendor.rows.map((row, index) => {
                                  const selectedMethod = row.result.methods.find(
                                    (method) => method.key === row.result.selected,
                                  );
                                  return (
                                    <div key={row.lot.id}>
                                      <span>
                                        Lot {index + 1} ·{" "}
                                        {row.lot.taxTreatment === "manual"
                                          ? "Manual assessment"
                                          : `${row.effectiveLot.shareNumerator}/${row.effectiveLot.shareDenominator} · ${
                                              row.lot.inheritanceDate || "date missing"
                                            }`}
                                      </span>
                                      <span>
                                        Sale {money.format(Number(row.result.transferValue) || 0)}
                                      </span>
                                      <strong>
                                        {selectedMethod
                                          ? `${selectedMethod.label}: ${money.format(
                                              selectedMethod.tax,
                                            )}`
                                          : "Tax details incomplete"}
                                      </strong>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <small className="vendor-no-lots">
                                No tax lot has been entered for this vendor.
                              </small>
                            )}
                            <div className="vendor-tax-subtotal">
                              <span>
                                {vendor.lotCount} tax {vendor.lotCount === 1 ? "lot" : "lots"} ·
                                sale proceeds {money.format(vendor.saleValue)}
                              </span>
                              <strong>{money.format(vendor.tax)}</strong>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="helper-text">No living current owner is available as a vendor.</p>
                  )}
                  {taxSummary.excludedLotCount > 0 && (
                    <p className="excluded-vendor-summary">
                      {taxSummary.excludedLotCount} deceased-person tax{" "}
                      {taxSummary.excludedLotCount === 1 ? "lot has" : "lots have"} been excluded
                      completely.
                    </p>
                  )}
                </div>
                {taxSummary.vendors.length > 0 && (
                  <div className="grand-total">
                    <Calculator size={18} />
                    <span>Total tax payable by living vendors</span>
                    <strong>{money.format(taxSummary.total)}</strong>
                  </div>
                )}
              </>
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
