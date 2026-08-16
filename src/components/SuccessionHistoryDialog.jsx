import { Printer, X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { isoDateToDisplay } from "../domain/dateFormat.js";
import { recordedNonNegativeMoney } from "../domain/ownershipPresentation.js";

const money = new Intl.NumberFormat("en-MT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

const eventTypeLabel = (event) => {
  if (event.type === "initial") return "Initial title";
  if (event.type === "succession") return "Succession";
  if (event.id === "proposed-sale") return "Proposed sale";
  if (event.transferKind === "donation") return "Donation";
  if (event.transferKind === "sale") return "Sale";
  return "Sale or transfer";
};

export function SuccessionHistoryDialog({
  property,
  events,
  onSelectPerson,
  onSelectOutsideOwner,
  onClose,
}) {
  const sellingPrice = recordedNonNegativeMoney(property.saleValue);
  const canOpenParticipant = (participant) =>
    (participant.source === "person" && onSelectPerson) ||
    (participant.source === "outside" && onSelectOutsideOwner);
  const openParticipant = (participant) => {
    onClose();
    if (participant.source === "person") onSelectPerson?.(participant.id);
    if (participant.source === "outside") onSelectOutsideOwner?.(participant.id);
  };

  useEffect(() => {
    document.body.classList.add("succession-history-open");
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.classList.remove("succession-history-open");
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return createPortal(
    <div className="succession-history-dialog" role="dialog" aria-modal="true">
      <article className="succession-history-sheet">
        <header className="succession-history-header">
          <div>
            <p className="eyebrow">Property ownership record</p>
            <h2>Full Succession History</h2>
            <p>{property.address || "Property address not entered"}</p>
          </div>
          <div className="succession-history-actions">
            <button type="button" className="secondary-button" onClick={() => window.print()}>
              <Printer size={16} /> Print history
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Close full succession history"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <section className="succession-history-summary">
          <div>
            <span>Selling price</span>
            <strong>{sellingPrice === null ? "Not entered" : money.format(sellingPrice)}</strong>
          </div>
          <div>
            <span>Recorded events</span>
            <strong>{events.length}</strong>
          </div>
        </section>

        {events.length ? (
          <ol className="succession-history-list">
            {events.map((event, index) => (
              <li
                key={event.id}
                className={`succession-history-item ${event.type}${event.invalid ? " invalid" : ""}`}
              >
                <span className="succession-history-number">{index + 1}</span>
                <div>
                  <p>
                    <span>{eventTypeLabel(event)}</span>
                    <time>{event.date ? isoDateToDisplay(event.date) : "Undated event"}</time>
                  </p>
                  {event.personId && onSelectPerson ? (
                    <h3>
                      <button
                        type="button"
                        className="history-person-link"
                        onClick={() => {
                          onClose();
                          onSelectPerson(event.personId);
                        }}
                      >
                        {event.title}
                      </button>
                    </h3>
                  ) : (
                    <h3>{event.title}</h3>
                  )}
                  <p>{event.description}</p>
                  {(event.warnings || []).map((warning) => (
                    <p className="succession-warning" key={warning}>
                      {warning}
                    </p>
                  ))}
                  {(event.participants || []).some(canOpenParticipant) && (
                    <div className="succession-history-participants" aria-label="Transfer parties">
                      {(event.participants || []).filter(canOpenParticipant).map((participant) => (
                        <button
                          type="button"
                          className="history-party-link"
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
              </li>
            ))}
          </ol>
        ) : (
          <p className="succession-history-empty">
            Enter the initial ownership shares to create the property history.
          </p>
        )}
      </article>
    </div>,
    document.body,
  );
}
