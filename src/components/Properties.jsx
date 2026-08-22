import { useCallback, useEffect, useRef, useState } from "react";
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

export const PROPERTY_DETAILS_DRAFT_COMMIT_DELAY_MS = 700;

const propertyDetailsDraft = (property = {}) => ({
  propertyId: property.id || "",
  address: property.address || "",
  description: property.description || "",
  saleValue: property.saleValue ?? "",
});

const propertyDetailsEqual = (left, right) =>
  left.propertyId === right.propertyId &&
  left.address === right.address &&
  left.description === right.description &&
  left.saleValue === right.saleValue;

function BufferedPropertyDetails({
  property,
  singleProperty,
  onCommit,
  onRegisterPendingEditFlush,
}) {
  const initialDraft = propertyDetailsDraft(property);
  const [draft, setDraft] = useState(initialDraft);
  const draftRef = useRef(initialDraft);
  const baseDraftRef = useRef(initialDraft);
  const latestPropertyRef = useRef(property);
  const dirtyFieldsRef = useRef(new Set());
  const commitTimerRef = useRef(null);
  const onCommitRef = useRef(onCommit);
  const commitRef = useRef(() => true);

  latestPropertyRef.current = property;
  onCommitRef.current = onCommit;

  const clearCommitTimer = useCallback(() => {
    if (commitTimerRef.current === null) return;
    globalThis.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = null;
  }, []);

  commitRef.current = () => {
    clearCommitTimer();
    const dirtyFields = new Set(dirtyFieldsRef.current);
    if (!dirtyFields.size) return true;
    const currentDraft = draftRef.current;
    if (!currentDraft.propertyId) return false;

    const patch = {};
    dirtyFields.forEach((field) => {
      patch[field] = currentDraft[field];
    });

    let committed;
    try {
      committed = onCommitRef.current?.(currentDraft.propertyId, patch);
    } catch {
      return false;
    }
    if (committed === false || committed === null) return false;

    dirtyFieldsRef.current.clear();
    baseDraftRef.current = currentDraft;
    return true;
  };

  const commitDraft = useCallback(() => commitRef.current(), []);
  const hasPendingDraft = useCallback(() => dirtyFieldsRef.current.size > 0, []);

  useEffect(() => {
    if (!onRegisterPendingEditFlush) return undefined;
    return onRegisterPendingEditFlush({ flush: commitDraft, hasPending: hasPendingDraft });
  }, [commitDraft, hasPendingDraft, onRegisterPendingEditFlush]);

  useEffect(() => {
    const nextDraft = propertyDetailsDraft(property);
    if (draftRef.current.propertyId !== nextDraft.propertyId) {
      commitDraft();
      dirtyFieldsRef.current.clear();
      draftRef.current = nextDraft;
      baseDraftRef.current = nextDraft;
      setDraft(nextDraft);
      return;
    }
    if (dirtyFieldsRef.current.size === 0 && !propertyDetailsEqual(draftRef.current, nextDraft)) {
      draftRef.current = nextDraft;
      baseDraftRef.current = nextDraft;
      setDraft(nextDraft);
    }
  }, [
    commitDraft,
    property,
    property.address,
    property.description,
    property.id,
    property.saleValue,
  ]);

  useEffect(
    () => () => {
      commitRef.current();
      clearCommitTimer();
    },
    [clearCommitTimer],
  );

  const updateDraft = (field, value) => {
    const nextDraft = { ...draftRef.current, [field]: value };
    const dirtyFields = dirtyFieldsRef.current;
    if (value === baseDraftRef.current[field]) dirtyFields.delete(field);
    else dirtyFields.add(field);
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    clearCommitTimer();
    if (dirtyFields.size) {
      commitTimerRef.current = globalThis.setTimeout(() => {
        commitTimerRef.current = null;
        commitRef.current();
      }, PROPERTY_DETAILS_DRAFT_COMMIT_DELAY_MS);
    }
  };

  return (
    <div
      className="form-grid"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) commitDraft();
      }}
    >
      <label className="full-width">
        Address
        <input
          value={draft.address}
          onChange={(event) => updateDraft("address", event.target.value)}
          placeholder="Full address of the property"
        />
      </label>
      {!singleProperty && (
        <label className="full-width">
          Description
          <input
            value={draft.description}
            onChange={(event) => updateDraft("description", event.target.value)}
            placeholder="Optional registry, title or internal reference"
          />
        </label>
      )}
      <label className="full-width">
        Value of the property being sold today (€) (optional)
        <input
          aria-label="Value of the property being sold today"
          type="number"
          min="0"
          step="any"
          value={draft.saleValue}
          onChange={(event) => updateDraft("saleValue", event.target.value)}
        />
      </label>
    </div>
  );
}

export function Properties({
  properties,
  people,
  familyPersonIds = null,
  outsideParties,
  singleProperty = false,
  onSelectPerson,
  selectedOutsideOwnerId,
  onSelectOutsideOwner,
  onPickInitialOwner,
  onRegisterInitialOwnershipFlush,
  onRegisterPendingEditFlush,
  onPropertyDetailsChange,
  onPropertyOwnersChange,
  taxReadinessGuideSummary = null,
  onStartTaxReadinessGuide,
  onChange,
}) {
  const updateProperties = (nextProperties) => onChange({ properties: nextProperties });
  const updateProperty = (id, patch) =>
    updateProperties(
      properties.map((property) => (property.id === id ? { ...property, ...patch } : property)),
    );
  const commitPropertyDetails = (id, patch) =>
    onPropertyDetailsChange ? onPropertyDetailsChange(id, patch) : updateProperty(id, patch);
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

              <BufferedPropertyDetails
                property={property}
                singleProperty={singleProperty}
                onCommit={commitPropertyDetails}
                onRegisterPendingEditFlush={onRegisterPendingEditFlush}
              />

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
                onChange={(owners) =>
                  onPropertyOwnersChange
                    ? onPropertyOwnersChange(property.id, owners)
                    : updateProperty(property.id, { owners })
                }
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
                <h2>Current title positions & history</h2>
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
                  familyPersonIds={familyPersonIds}
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
