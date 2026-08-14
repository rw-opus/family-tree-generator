import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Play,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { isoDateToDisplay } from "../domain/dateFormat.js";
import { buildSuccessionTrace } from "../domain/successionTrace.js";
import { PersonCardDisplayControl } from "./PersonCardDisplayControl.jsx";
import { SuccessionHistoryDialog } from "./SuccessionHistoryDialog.jsx";

/** Tree-only display and history tools, kept separate from Property & Tax. */
export function TreeToolsPanel({
  property,
  people = [],
  outsideParties = [],
  propertyReport,
  cardFields,
  onCardFieldsChange,
  onFocusEvent,
  onSelectPerson,
  expanded: controlledExpanded,
  onExpandedChange,
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
  const personIds = useMemo(() => new Set(people.map((person) => person.id)), [people]);

  useEffect(() => {
    if (traceIndex >= traceEvents.length) setTraceIndex(traceEvents.length ? 0 : -1);
  }, [traceEvents.length, traceIndex]);

  useEffect(() => {
    onFocusEventRef.current = onFocusEvent;
  }, [onFocusEvent]);

  useEffect(() => {
    if (traceIndex >= 0) onFocusEventRef.current?.(traceEvent);
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
      <aside className={`tree-tools-panel ${expanded ? "expanded" : "collapsed"}`}>
        <button
          type="button"
          className="tree-tools-panel-toggle"
          aria-expanded={expanded}
          aria-label={expanded ? "Close tree tools" : "Open tree tools"}
          onClick={toggleExpanded}
        >
          <span>
            <SlidersHorizontal size={17} />
            <strong>Tree tools</strong>
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>

        {expanded && (
          <div className="tree-tools-panel-body">
            {/* Shown outright rather than behind a second disclosure: one click
                on Tree tools reveals everything the panel holds. */}
            <section className="tree-control-section">
              <h3>Person card details</h3>
              <PersonCardDisplayControl
                embedded
                fields={cardFields}
                onChange={onCardFieldsChange}
              />
            </section>

            <section className="succession-trace-control" aria-live="polite">
              <div className="succession-trace-heading">
                <div>
                  <span>Trace succession</span>
                  <small>Follow ownership from one event to the next.</small>
                </div>
                {traceIndex < 0 ? (
                  <button
                    type="button"
                    className="trace-start-button"
                    disabled={!traceEvents.length}
                    onClick={() => showTraceEvent(0)}
                  >
                    <Play size={14} /> Start
                  </button>
                ) : (
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
                    {traceEvent.personId && personIds.has(traceEvent.personId) && onSelectPerson ? (
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
                    {(traceEvent.warnings || []).map((warning) => (
                      <p className="succession-warning" key={warning}>
                        {warning}
                      </p>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="succession-trace-empty">
                  {traceEvents.length
                    ? `${traceEvents.length} ownership events are ready.`
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
          </div>
        )}
      </aside>

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
