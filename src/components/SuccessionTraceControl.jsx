import { BookOpen, ChevronLeft, ChevronRight, Play, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { isoDateToDisplay } from "../domain/dateFormat.js";
import { buildSuccessionTrace } from "../domain/successionTrace.js";
import { SuccessionHistoryDialog } from "./SuccessionHistoryDialog.jsx";

/** Read-only, step-by-step ownership history for the Property & Tax workspace. */
export function SuccessionTraceControl({
  property,
  people = [],
  outsideParties = [],
  propertyReport,
  currentOwnerPresentationsById = null,
  onSelectPerson,
  onSelectOutsideOwner,
}) {
  const headingId = useId();
  const [traceIndex, setTraceIndex] = useState(-1);
  const [historyOpen, setHistoryOpen] = useState(false);
  const traceEvents = useMemo(
    () =>
      buildSuccessionTrace({
        property,
        people,
        outsideParties,
        propertyReport,
        currentOwnerPresentationsById,
      }),
    [currentOwnerPresentationsById, outsideParties, people, property, propertyReport],
  );
  const traceEvent = traceIndex >= 0 ? traceEvents[traceIndex] : null;
  const personIds = useMemo(() => new Set(people.map((person) => person.id)), [people]);

  const canOpenParticipant = (participant) =>
    (participant.source === "person" && onSelectPerson) ||
    (participant.source === "outside" && onSelectOutsideOwner);
  const openParticipant = (participant) => {
    if (participant.source === "person") onSelectPerson?.(participant.id);
    if (participant.source === "outside") onSelectOutsideOwner?.(participant.id);
  };

  useEffect(() => {
    if (traceIndex >= traceEvents.length) setTraceIndex(traceEvents.length ? 0 : -1);
  }, [traceEvents.length, traceIndex]);

  const showTraceEvent = (nextIndex) => {
    if (!traceEvents.length) return;
    setTraceIndex(Math.max(0, Math.min(traceEvents.length - 1, nextIndex)));
  };

  return (
    <>
      <section className="succession-trace-control" aria-labelledby={headingId}>
        <div className="succession-trace-heading">
          <div>
            <h3 id={headingId}>Trace succession</h3>
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
            <button type="button" className="trace-end-button" onClick={() => setTraceIndex(-1)}>
              <X size={14} /> End trace
            </button>
          )}
        </div>

        {traceEvent ? (
          <div
            className={`succession-trace-event ${traceEvent.type}${traceEvent.invalid ? " invalid" : ""}`}
            aria-live="polite"
            aria-atomic="true"
          >
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
              <span>{traceEvent.date ? isoDateToDisplay(traceEvent.date) : "Undated event"}</span>
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
              {(traceEvent.participants || []).some(canOpenParticipant) && (
                <div className="succession-trace-participants" aria-label="Transfer parties">
                  {(traceEvent.participants || []).filter(canOpenParticipant).map((participant) => (
                    <button
                      type="button"
                      className="trace-party-link"
                      aria-label={`Open ${participant.role.toLowerCase()} ${participant.name}`}
                      key={`${participant.role}-${participant.id}`}
                      onClick={() => openParticipant(participant)}
                    >
                      <span>{participant.role}</span> {participant.name}
                    </button>
                  ))}
                </div>
              )}
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

      {historyOpen && (
        <SuccessionHistoryDialog
          property={property}
          events={traceEvents}
          onSelectPerson={onSelectPerson}
          onSelectOutsideOwner={onSelectOutsideOwner}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </>
  );
}
