import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  GitBranch,
  Landmark,
  Play,
  ReceiptText,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { isoDateToDisplay } from "../domain/dateFormat.js";
import { approximateFraction } from "../domain/ownership.js";
import { buildSuccessionTrace } from "../domain/successionTrace.js";
import { downloadVendorTaxSpreadsheet } from "../domain/vendorTaxExport.js";
import { InitialOwnershipEditor } from "./InitialOwnershipEditor.jsx";
import { PersonCardDisplayControl } from "./PersonCardDisplayControl.jsx";
import { SuccessionHistoryDialog } from "./SuccessionHistoryDialog.jsx";

const money = new Intl.NumberFormat("en-MT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

const shareLabel = (share, exactFraction = null) => {
  const fraction = exactFraction?.denominator
    ? exactFraction
    : approximateFraction(Number(share) || 0);
  return `${fraction.numerator}/${fraction.denominator} · ${(
    (Number(share) || 0) * 100
  ).toLocaleString("en-MT", { maximumFractionDigits: 2 })}%`;
};

export function TreePropertyPanel({
  property,
  properties = [],
  activePropertyId = "",
  people,
  outsideParties,
  propertyReport,
  taxReport = null,
  cardFields,
  onCardFieldsChange,
  onPropertyChange,
  onPropertySelect,
  onFocusEvent,
  onOpenProperty,
  onOpenTax,
  onSelectPerson,
  onPickInitialOwner,
  expanded: controlledExpanded,
  onExpandedChange,
  initialOwnerSelectionActive = false,
  hideCollapsedTrigger = false,
}) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const [traceIndex, setTraceIndex] = useState(-1);
  const [historyOpen, setHistoryOpen] = useState(false);
  const onFocusEventRef = useRef(onFocusEvent);
  const expanded = controlledExpanded ?? localExpanded;
  const traceEvents = useMemo(
    () => buildSuccessionTrace({ property, people, outsideParties, propertyReport }),
    [outsideParties, people, property, propertyReport],
  );
  const traceEvent = traceIndex >= 0 ? traceEvents[traceIndex] : null;
  const saleValue = Math.max(0, Number(property.saleValue) || 0);
  const startingStatus = propertyReport.startingOwnership;
  const startingDisplayPercent = startingStatus.enteredTotalPercent ?? startingStatus.totalPercent;
  const currentOwners = propertyReport.ledger?.owners || [];
  const personIds = useMemo(() => new Set(people.map((person) => person.id)), [people]);
  const taxByOwnerId = useMemo(
    () => new Map((taxReport?.vendors || []).map((vendor) => [vendor.id, vendor])),
    [taxReport],
  );

  useEffect(() => {
    if (traceIndex >= traceEvents.length) setTraceIndex(traceEvents.length ? 0 : -1);
  }, [traceEvents.length, traceIndex]);

  useEffect(() => {
    onFocusEventRef.current = onFocusEvent;
  }, [onFocusEvent]);

  useEffect(() => {
    if (traceIndex < 0) return;
    onFocusEventRef.current?.(traceEvent);
  }, [traceEvent, traceIndex]);

  const showTraceEvent = (nextIndex) => {
    if (!traceEvents.length) return;
    const boundedIndex = Math.max(0, Math.min(traceEvents.length - 1, nextIndex));
    setTraceIndex(boundedIndex);
    onFocusEvent?.(traceEvents[boundedIndex]);
  };

  const endTrace = () => {
    setTraceIndex(-1);
    onFocusEvent?.(null);
  };

  const toggleExpanded = () => {
    const nextExpanded = !expanded;
    if (controlledExpanded === undefined) setLocalExpanded(nextExpanded);
    onExpandedChange?.(nextExpanded);
  };

  return (
    <>
      {(expanded || !hideCollapsedTrigger) && (
        <aside
          id="ownership-tax-details"
          className={`tree-property-panel ${expanded ? "expanded" : "collapsed"}${
            initialOwnerSelectionActive ? " initial-owner-selection-active" : ""
          }`}
          aria-label="Ownership and Tax"
        >
          <button
            type="button"
            className="tree-property-panel-toggle"
            aria-expanded={expanded}
            aria-label={expanded ? "Close Ownership and Tax" : "Open Ownership and Tax"}
            title={expanded ? "Close Ownership and Tax" : "Open Ownership and Tax"}
            onClick={toggleExpanded}
          >
            <span>
              <Landmark size={17} />
              <strong>Ownership &amp; Tax</strong>
            </span>
            <span className="tree-property-panel-price">
              {saleValue ? money.format(saleValue) : "Set selling price"}
              <ChevronDown size={16} />
            </span>
          </button>

          {expanded && (
            <div className="tree-property-panel-body">
              {properties.length > 1 && (
                <label className="tree-property-selector">
                  <span>Property currently being calculated</span>
                  <select
                    value={activePropertyId}
                    onChange={(event) => onPropertySelect?.(event.target.value)}
                  >
                    {properties.map((item, index) => (
                      <option value={item.id} key={item.id}>
                        {item.address || `Property ${index + 1}`}
                      </option>
                    ))}
                  </select>
                  <small>
                    This family contains {properties.length} saved property records. Only the
                    selected property is shown and calculated at a time.
                  </small>
                </label>
              )}
              <section className="tree-property-summary">
                <label>
                  <span>Property address</span>
                  <input
                    aria-label="Property address on tree"
                    value={property.address || ""}
                    onChange={(event) => onPropertyChange({ address: event.target.value })}
                    placeholder="Full address"
                  />
                </label>
                <label>
                  <span>Selling price</span>
                  <span className="tree-property-price-input">
                    <b>€</b>
                    <input
                      aria-label="Property selling price on tree"
                      type="number"
                      min="0"
                      step="any"
                      value={property.saleValue || ""}
                      onChange={(event) => onPropertyChange({ saleValue: event.target.value })}
                    />
                  </span>
                </label>
              </section>

              <details className="tree-control-section" open>
                <summary>
                  <span>Initial ownership</span>
                  <b className={startingStatus.isComplete ? "valid" : "invalid"}>
                    {startingDisplayPercent.toLocaleString("en-MT", {
                      maximumFractionDigits: 2,
                    })}
                    %
                  </b>
                </summary>
                <InitialOwnershipEditor
                  compact
                  property={property}
                  people={people}
                  heading="Initial shares"
                  helperText="Choose the original owner or owners. Their fractions must total 100%."
                  onChange={(owners) => onPropertyChange({ owners })}
                  onPickFromTree={onPickInitialOwner}
                />
              </details>

              <details className="tree-control-section">
                <summary>
                  <span>Current owners &amp; values</span>
                  <b>{currentOwners.length}</b>
                </summary>
                <div className="tree-current-owners">
                  {currentOwners.length ? (
                    currentOwners.map((owner) => {
                      const vendorTax = taxByOwnerId.get(owner.id);
                      const ownerPersonId = owner.personId || owner.id;
                      return (
                        <div key={owner.id}>
                          {personIds.has(ownerPersonId) && onSelectPerson ? (
                            <button
                              type="button"
                              className="tree-person-link"
                              aria-label={`Open ${owner.name} person details`}
                              onClick={() => onSelectPerson(ownerPersonId)}
                            >
                              {owner.name}
                            </button>
                          ) : (
                            <span>{owner.name}</span>
                          )}
                          <span>
                            <b>{shareLabel(owner.share, owner.shareFraction)}</b>
                            <small>
                              Value {saleValue ? money.format(saleValue * owner.share) : "not set"}
                            </small>
                            <small className={vendorTax?.tax == null ? "pending" : "calculated"}>
                              Tax {vendorTax?.tax == null ? "pending" : money.format(vendorTax.tax)}
                            </small>
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    <p>Complete the initial shares to calculate the current title.</p>
                  )}
                  {currentOwners.length > 0 && (
                    <footer className="tree-current-owner-tax-actions">
                      <button type="button" onClick={onOpenTax || onOpenProperty}>
                        <ReceiptText size={14} /> View full tax workings
                      </button>
                      <button
                        type="button"
                        disabled={!taxReport?.vendors?.length}
                        onClick={() =>
                          downloadVendorTaxSpreadsheet(taxReport, property, traceEvents)
                        }
                      >
                        <FileSpreadsheet size={14} /> Download one-sheet Excel
                      </button>
                    </footer>
                  )}
                </div>
              </details>

              <details className="tree-control-section">
                <summary>
                  <span>Person card details</span>
                  <b>Choose details</b>
                </summary>
                <PersonCardDisplayControl
                  embedded
                  fields={cardFields}
                  onChange={onCardFieldsChange}
                />
              </details>

              <section className="succession-trace-control" aria-live="polite">
                <div className="succession-trace-heading">
                  <div>
                    <span>Trace Succession</span>
                    <small>
                      Person cards show ownership at each step; values use the selling price above.
                    </small>
                  </div>
                  {traceIndex < 0 && (
                    <button
                      type="button"
                      className="trace-start-button"
                      disabled={!traceEvents.length}
                      onClick={() => showTraceEvent(0)}
                    >
                      <Play size={14} /> Start
                    </button>
                  )}
                  {traceIndex >= 0 && (
                    <button type="button" className="trace-end-button" onClick={endTrace}>
                      <X size={14} /> End trace
                    </button>
                  )}
                </div>
                {traceEvent ? (
                  <div className={`succession-trace-event ${traceEvent.type}`}>
                    <div className="succession-trace-counter">
                      <button
                        type="button"
                        aria-label="Previous succession event"
                        disabled={traceIndex === 0}
                        onClick={() => showTraceEvent(traceIndex - 1)}
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <span>
                        {traceIndex + 1} of {traceEvents.length}
                      </span>
                      <button
                        type="button"
                        aria-label="Next succession event"
                        disabled={traceIndex === traceEvents.length - 1}
                        onClick={() => showTraceEvent(traceIndex + 1)}
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                    <div className="succession-trace-description">
                      <span>
                        {traceEvent.date ? isoDateToDisplay(traceEvent.date) : "Undated event"}
                      </span>
                      {traceEvent.personId &&
                      personIds.has(traceEvent.personId) &&
                      onSelectPerson ? (
                        <button
                          type="button"
                          className="tree-person-link trace-person-link"
                          onClick={() => onSelectPerson(traceEvent.personId)}
                        >
                          {traceEvent.title}
                        </button>
                      ) : (
                        <strong>{traceEvent.title}</strong>
                      )}
                      <p>{traceEvent.description}</p>
                    </div>
                  </div>
                ) : (
                  <p className="succession-trace-empty">
                    {traceEvents.length
                      ? `${traceEvents.length} ownership events are ready to trace.`
                      : "Enter the initial shares to begin the trace."}
                  </p>
                )}
                <button
                  type="button"
                  className="succession-history-open-button"
                  disabled={!traceEvents.length}
                  onClick={() => setHistoryOpen(true)}
                >
                  <BookOpen size={14} /> View full history
                </button>
              </section>

              <button type="button" className="tree-property-open-button" onClick={onOpenProperty}>
                <GitBranch size={15} /> Open property setup
              </button>
            </div>
          )}
        </aside>
      )}
      {historyOpen && (
        <SuccessionHistoryDialog
          property={property}
          events={traceEvents}
          onSelectPerson={onSelectPerson}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </>
  );
}
