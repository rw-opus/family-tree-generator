import { Home, Trash2 } from "lucide-react";
import {
  buildPropertyVendorTaxReport,
  buildTaxCalculationReport,
} from "../domain/propertyVendorTax.js";
import {
  buildCurrentOwnerPresentations,
  ownerPresentationsById,
  reconcileFractionPercentageDisplay,
} from "../domain/ownershipPresentation.js";
import { fractionForShare } from "../domain/shares.js";
import { HoverHelpLabel } from "./HoverHelpLabel.jsx";
import { InitialOwnershipEditor } from "./InitialOwnershipEditor.jsx";
import { PropertyOwnershipSummary } from "./PropertyOwnershipSummary.jsx";
import { SuccessionTraceControl } from "./SuccessionTraceControl.jsx";
import { TaxReadinessGuideLauncher } from "./TaxReadinessGuide.jsx";
import { TaxCalculationPanel } from "./TaxCalculationPanel.jsx";

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

export function Properties({
  properties,
  people,
  outsideParties,
  singleProperty = false,
  onSelectPerson,
  selectedOutsideOwnerId,
  onSelectOutsideOwner,
  onPickInitialOwner,
  onRegisterInitialOwnershipFlush,
  taxReadinessGuideSummary = null,
  onStartTaxReadinessGuide,
  onChange,
}) {
  const updateProperties = (nextProperties) => onChange({ properties: nextProperties });
  const updateProperty = (id, patch) =>
    updateProperties(
      properties.map((property) => (property.id === id ? { ...property, ...patch } : property)),
    );
  const addProperty = () => updateProperties([...properties, makeProperty()]);
  const removeProperty = (id) =>
    updateProperties(properties.filter((property) => property.id !== id));

  return (
    <div className={`calculator-stack ${singleProperty ? "single-property-case" : ""}`}>
      {properties.map((property) => {
        const vendorReport = buildPropertyVendorTaxReport(property, people, outsideParties);
        const { startingOwnership, ownership } = vendorReport;
        const taxCalculationReport = startingOwnership.isComplete
          ? buildTaxCalculationReport(property, people, outsideParties, vendorReport)
          : null;
        const currentOwnerPresentationsById = ownerPresentationsById(
          buildCurrentOwnerPresentations(
            vendorReport.ledger.owners,
            property.saleValue,
            taxCalculationReport,
          ),
        );
        const startingPercentageDisplay = reconcileFractionPercentageDisplay(
          (property.owners || []).map(fractionForShare),
          { keys: (property.owners || []).map((owner) => owner.personId || owner.id) },
        );
        const ownershipTotalLabel =
          startingPercentageDisplay.totalDisplayPercentageLabel ||
          `${(
            startingOwnership.enteredTotalPercent ?? startingOwnership.totalPercent
          ).toLocaleString("en-MT", { maximumFractionDigits: 2 })}%`;
        const unassignedOwnershipLabel = startingOwnership.unassignedFraction?.denominator
          ? `${startingOwnership.unassignedFraction.numerator}/${startingOwnership.unassignedFraction.denominator}`
          : "an entered share";
        const ownershipNoticeTitle = startingOwnership.hasUnassignedOwners
          ? `Fractions total ${ownershipTotalLabel}, but ${unassignedOwnershipLabel} has no owner.`
          : startingOwnership.isUnset
            ? "No initial ownership has been entered."
            : `Initial ownership totals ${ownershipTotalLabel}.`;
        const ownershipNoticeDetail = startingOwnership.hasUnassignedOwners
          ? "Choose a person for every positive fraction."
          : startingOwnership.isUnset
            ? "Enter the original owner or owners below."
            : "Initial ownership must equal 100%.";

        return (
          <section className="editor-panel unified-property-workspace" key={property.id}>
            <section
              id={
                singleProperty
                  ? "property-workspace-setup"
                  : `property-workspace-setup-${property.id}`
              }
              className="property-workspace-section"
            >
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Property</p>
                  <h2>{singleProperty ? "Property & initial ownership" : property.address}</h2>
                </div>
                {!singleProperty && (
                  <button
                    type="button"
                    className="icon-button"
                    title="Remove property"
                    onClick={() => removeProperty(property.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              <div className="form-grid">
                <label className="full-width">
                  <HoverHelpLabel
                    label="Address"
                    help="Enter the full address of the property whose ownership is being traced."
                  />
                  <input
                    value={property.address || ""}
                    onChange={(event) =>
                      updateProperty(property.id, { address: event.target.value })
                    }
                    placeholder="Full address of the property"
                  />
                </label>
                {!singleProperty && (
                  <label className="full-width">
                    <HoverHelpLabel
                      label="Description"
                      help="Add an optional registry, title or internal reference that distinguishes this property."
                    />
                    <input
                      value={property.description || ""}
                      onChange={(event) =>
                        updateProperty(property.id, { description: event.target.value })
                      }
                      placeholder="Optional registry, title or internal reference"
                    />
                  </label>
                )}
                <label className="full-width">
                  <HoverHelpLabel
                    label="Value of the property being sold today (€) (optional)"
                    help="Enter the present sale value when tax calculations are required. Leave it blank to trace ownership only."
                  />
                  <input
                    aria-label="Value of the property being sold today"
                    type="number"
                    min="0"
                    step="any"
                    value={property.saleValue ?? ""}
                    onChange={(event) =>
                      updateProperty(property.id, { saleValue: event.target.value })
                    }
                  />
                </label>
              </div>

              {!startingOwnership.isComplete && (
                <div className="ownership-blocking-notice" role="alert">
                  <strong>{ownershipNoticeTitle}</strong>
                  <span>{ownershipNoticeDetail}</span>
                </div>
              )}

              <InitialOwnershipEditor
                property={property}
                people={people}
                outsideParties={outsideParties}
                onChange={(owners) => updateProperty(property.id, { owners })}
                helperText="Choose the original owner or owners. Fractions must total 100%."
                onPickFromTree={onPickInitialOwner}
                onRegisterPendingFlush={onRegisterInitialOwnershipFlush}
                onCreateOutsideParty={(party, owners) =>
                  onChange({
                    properties: properties.map((candidate) =>
                      candidate.id === property.id ? { ...candidate, owners } : candidate,
                    ),
                    outsideParties: [...outsideParties, party],
                  })
                }
              />
              {startingOwnership.isComplete && onStartTaxReadinessGuide && (
                <TaxReadinessGuideLauncher
                  summary={taxReadinessGuideSummary}
                  onStart={onStartTaxReadinessGuide}
                />
              )}
            </section>

            <section
              id={
                singleProperty
                  ? "property-workspace-ownership"
                  : `property-workspace-ownership-${property.id}`
              }
              className="property-workspace-section"
            >
              <div className="property-workspace-section-heading">
                <p className="eyebrow">Ownership</p>
                <h2>Current ownership & history</h2>
              </div>
              {startingOwnership.isComplete ? (
                <>
                  <PropertyOwnershipSummary
                    people={people}
                    outsideParties={outsideParties}
                    transfers={property.transfers || []}
                    startingOwnership={ownership.ownershipByPerson}
                    property={property}
                    vendorReport={vendorReport}
                    taxCalculationReport={taxCalculationReport}
                    currentOwnerPresentationsById={currentOwnerPresentationsById}
                    onSelectPerson={onSelectPerson}
                    selectedOutsideOwnerId={selectedOutsideOwnerId}
                    onSelectOutsideOwner={onSelectOutsideOwner}
                    onOutsideOwnerTransactionsChange={({
                      property: nextProperty,
                      transfers,
                      outsideParties: nextParties,
                    }) =>
                      onChange({
                        properties: properties.map((candidate) =>
                          candidate.id === property.id
                            ? nextProperty || { ...candidate, transfers }
                            : candidate,
                        ),
                        outsideParties: nextParties,
                      })
                    }
                  />
                  <SuccessionTraceControl
                    property={property}
                    people={people}
                    outsideParties={outsideParties}
                    propertyReport={vendorReport}
                    currentOwnerPresentationsById={currentOwnerPresentationsById}
                    onSelectPerson={onSelectPerson}
                    onSelectOutsideOwner={onSelectOutsideOwner}
                  />
                </>
              ) : (
                <p className="helper-text">
                  Complete the initial ownership above to calculate the current title.
                </p>
              )}
            </section>

            <section
              id={
                singleProperty ? "property-workspace-tax" : `property-workspace-tax-${property.id}`
              }
              className="property-workspace-section"
            >
              {startingOwnership.isComplete ? (
                <TaxCalculationPanel
                  property={property}
                  people={people}
                  outsideParties={outsideParties}
                  vendorReport={vendorReport}
                  taxCalculationReport={taxCalculationReport}
                  currentOwnerPresentationsById={currentOwnerPresentationsById}
                  onSelectPerson={onSelectPerson}
                  onSelectOutsideOwner={onSelectOutsideOwner}
                />
              ) : (
                <div className="tax-calculation-panel">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Sale information</p>
                      <h2>Tax Calculation</h2>
                    </div>
                  </div>
                  <p className="helper-text">
                    Complete the initial ownership above to calculate tax.
                  </p>
                </div>
              )}
            </section>
          </section>
        );
      })}

      {!singleProperty && (
        <button type="button" className="primary-button" onClick={addProperty}>
          <Home size={16} /> Add property
        </button>
      )}
      {!singleProperty && !properties.length && (
        <p className="helper-text">
          No properties yet. Add a property, then assign its initial owners from the family tree.
        </p>
      )}
    </div>
  );
}
