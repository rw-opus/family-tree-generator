import { FileSpreadsheet } from "lucide-react";
import { TAX_CALCULATION_DISCLAIMER } from "./LegalNotice.jsx";
import { isoDateToDisplay } from "../domain/dateFormat.js";
import { displayNotaryName } from "../domain/notary.js";
import { approximateFraction } from "../domain/ownership.js";
import { buildTaxCalculationReport } from "../domain/propertyVendorTax.js";
import { buildSuccessionTrace } from "../domain/successionTrace.js";
import { downloadVendorTaxSpreadsheet } from "../domain/vendorTaxExport.js";
import { VendorSettlementStatement } from "./VendorSettlementStatement.jsx";

const money = new Intl.NumberFormat("en-MT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

const fractionLabel = (share, exactFraction) => {
  const fraction = exactFraction?.denominator ? exactFraction : approximateFraction(share);
  return `${fraction.numerator}/${fraction.denominator}`;
};

const hasRecordedMoney = (value) =>
  String(value ?? "").trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;

const declarationHasValue = (declaration = {}) =>
  declaration.hasDeclaredValue === true ||
  declaration.valueRecorded === true ||
  Number(declaration.declaredValue) > 0;

const rowHasDeclaredValue = (row = {}) =>
  row.hasDeclaredValue === true ||
  row.valueRecorded === true ||
  (row.declarations || []).some(declarationHasValue) ||
  (row.sourceKind === "inheritance" &&
    Boolean(row.selectedMethod) &&
    Number(row.declaredValue) === 0) ||
  Number(row.declaredValue) > 0;

export function TaxCalculationPanel({
  property,
  people,
  outsideParties,
  vendorReport,
  taxCalculationReport = null,
  currentOwnerPresentationsById = null,
  onSelectPerson,
  onSelectOutsideOwner,
}) {
  const report =
    taxCalculationReport ||
    buildTaxCalculationReport(property, people, outsideParties, vendorReport);
  const historyEvents = buildSuccessionTrace({
    property,
    people,
    outsideParties,
    propertyReport: vendorReport,
    currentOwnerPresentationsById,
  });
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const outsidePartyIds = new Set(outsideParties.map((party) => party.id));
  const openParty = (partyId) => {
    if (outsidePartyIds.has(partyId)) {
      onSelectOutsideOwner?.(partyId);
      return;
    }
    onSelectPerson?.(partyId);
  };
  const hasSellingPrice = hasRecordedMoney(property.saleValue);
  const hasCalculatedSources = report.completeSourceCount > 0;
  const pendingVendors = report.vendors.filter((vendor) => vendor.incompleteSourceCount > 0);
  const pendingVendorNames = pendingVendors.map((vendor) => vendor.name).join(", ");

  return (
    <section className="tax-calculation-panel" aria-label="Tax Calculation">
      <div className="section-heading tax-calculation-heading">
        <div>
          <p className="eyebrow">Sale information</p>
          <h2>Tax Calculation</h2>
        </div>
        <span className="tax-download-action">
          <button
            type="button"
            className="secondary-button"
            disabled={!report.vendors.length}
            onClick={() => downloadVendorTaxSpreadsheet(report, property, historyEvents)}
          >
            <FileSpreadsheet size={16} /> Download one-sheet Excel
          </button>
          <VendorSettlementStatement
            report={report}
            property={property}
            people={people}
            onSelectPerson={onSelectPerson}
          />
          {!report.vendors.length && (
            <small>Add a living current owner to enable the export and vendor list.</small>
          )}
        </span>
      </div>
      <p className="helper-text">
        This is a read-only calculation from the family tree, ownership transfers, person-card
        Declaration Causa Mortis (CM) records and the property selling value.
      </p>
      <p className="tax-calculation-summary">
        Indicative calculation only. Verify the result before filing, signing or payment.
      </p>
      <details className="tax-calculation-disclaimer">
        <summary>Important limitations</summary>
        <p>{TAX_CALCULATION_DISCLAIMER}</p>
      </details>

      <details className="tax-calculation-history">
        <summary>
          <span>Full succession and transfer history</span>
          <b>{historyEvents.length} events</b>
        </summary>
        {historyEvents.length ? (
          <ol>
            {historyEvents.map((event) => (
              <li key={event.id}>
                <span>{event.date ? isoDateToDisplay(event.date) : "Undated"}</span>
                {event.personId && peopleById.has(event.personId) && onSelectPerson ? (
                  <button
                    type="button"
                    className="tax-history-person-link"
                    onClick={() => onSelectPerson(event.personId)}
                  >
                    {event.title}
                  </button>
                ) : (
                  <strong>{event.title}</strong>
                )}
                <p>{event.description}</p>
                {(event.warnings || []).map((warning) => (
                  <p className="succession-warning" key={warning}>
                    {warning}
                  </p>
                ))}
                {(event.participants || []).some(
                  (participant) =>
                    (participant.source === "person" && onSelectPerson) ||
                    (participant.source === "outside" && onSelectOutsideOwner),
                ) && (
                  <div className="tax-history-participants" aria-label="Transfer parties">
                    {(event.participants || [])
                      .filter(
                        (participant) =>
                          (participant.source === "person" && onSelectPerson) ||
                          (participant.source === "outside" && onSelectOutsideOwner),
                      )
                      .map((participant) => (
                        <button
                          type="button"
                          className="tax-history-party-link"
                          aria-label={`Open ${participant.role.toLowerCase()} ${participant.name}`}
                          key={`${participant.role}-${participant.id}`}
                          onClick={() => openParty(participant.id)}
                        >
                          <span>{participant.role}</span> {participant.name}
                        </button>
                      ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p>Complete the initial ownership to generate the succession history.</p>
        )}
      </details>

      {report.vendors.length ? (
        <div className="tax-calculation-vendors">
          {report.vendors.map((vendor) => (
            <article className="tax-calculation-vendor" key={vendor.id}>
              <header>
                <span>
                  {(peopleById.has(vendor.id) && onSelectPerson) ||
                  (outsidePartyIds.has(vendor.id) && onSelectOutsideOwner) ? (
                    <button
                      type="button"
                      className="tax-person-link"
                      onClick={() => openParty(vendor.id)}
                    >
                      {vendor.name}
                    </button>
                  ) : (
                    <strong>{vendor.name}</strong>
                  )}
                  <small>Total ownership {fractionLabel(vendor.share, vendor.shareFraction)}</small>
                </span>
                <span>
                  <strong>
                    {hasSellingPrice ? money.format(vendor.attributedSaleValue) : "Not entered"}
                  </strong>
                  <small>attributed selling price</small>
                </span>
              </header>
              <div className="tax-calculation-table-wrap">
                <table className="tax-calculation-table">
                  <caption className="sr-only">
                    Tax sources and available calculations for {vendor.name}
                  </caption>
                  <thead>
                    <tr>
                      <th>Provenance</th>
                      <th>Fraction</th>
                      <th>
                        <abbr title="Declaration Causa Mortis">CM</abbr> value
                      </th>
                      <th>Sale price</th>
                      <th>Difference</th>
                      <th>Tax calculation</th>
                      <th>Tax</th>
                      <th>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendor.rows.map((row) => (
                      <tr key={row.id}>
                        <td data-label="Provenance">
                          {row.provenancePersonId &&
                          ((peopleById.has(row.provenancePersonId) && onSelectPerson) ||
                            (outsidePartyIds.has(row.provenancePersonId) &&
                              onSelectOutsideOwner)) ? (
                            <button
                              type="button"
                              className="tax-provenance-link"
                              onClick={() => openParty(row.provenancePersonId)}
                            >
                              {row.provenance}
                            </button>
                          ) : (
                            <strong>{row.provenance}</strong>
                          )}
                          {row.inheritanceDate && (
                            <small>d. {isoDateToDisplay(row.inheritanceDate)}</small>
                          )}
                          {row.declarations.map((declaration) => (
                            <small key={declaration.id}>
                              <abbr title="Declaration Causa Mortis">CM</abbr>{" "}
                              {isoDateToDisplay(declaration.date) || "undated"}
                              {declaration.notaryName
                                ? ` · ${displayNotaryName(declaration.notaryName)}`
                                : ""}
                              {` · CM fraction ${fractionLabel(
                                declaration.declaredShare,
                                declaration.declaredShareFraction,
                              )}`}
                              {declarationHasValue(declaration)
                                ? ` · ${money.format(declaration.declaredValue)}`
                                : ""}
                            </small>
                          ))}
                        </td>
                        <td data-label="Fraction">{fractionLabel(row.share, row.shareFraction)}</td>
                        <td data-label="CM value">
                          {rowHasDeclaredValue(row) ? money.format(row.declaredValue) : "—"}
                        </td>
                        <td data-label="Sale price">
                          {hasSellingPrice ? money.format(row.attributedSaleValue) : "—"}
                        </td>
                        <td data-label="Difference">
                          {hasSellingPrice && rowHasDeclaredValue(row)
                            ? money.format(row.difference)
                            : "—"}
                        </td>
                        <td data-label="Tax choices">
                          {row.methods.length ? (
                            row.methods.map((method) => {
                              const selected = method.key === row.selectedMethod?.key;
                              return (
                                <small className={selected ? "selected" : ""} key={method.key}>
                                  <span className="tax-choice-badge">
                                    {selected ? "Applied" : "Alternative"}
                                  </span>
                                  {method.label}: {money.format(method.tax)}
                                  {method.requiresElection ? " · election" : ""}
                                </small>
                              );
                            })
                          ) : (
                            <small className="attention">
                              {hasSellingPrice
                                ? row.warning || "A detail is missing for this source"
                                : "Enter the selling price above to calculate tax"}
                            </small>
                          )}
                        </td>
                        <td data-label="Applied tax">
                          {row.selectedMethod ? money.format(row.tax) : "—"}
                        </td>
                        <td data-label="Net balance">
                          {row.selectedMethod ? money.format(row.net) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <footer>
                <span>
                  Tax payable{" "}
                  <strong>
                    {vendor.tax == null ? "Not calculated" : money.format(vendor.tax)}
                  </strong>
                </span>
                <span>
                  Net balance{" "}
                  <strong>
                    {vendor.net == null ? "Not calculated" : money.format(vendor.net)}
                  </strong>
                </span>
              </footer>
              {vendor.incompleteRowCount > 0 && (
                <p className="tax-calculation-warning">
                  Tax is not calculated for {vendor.incompleteRowCount} source{" "}
                  {vendor.incompleteRowCount === 1 ? "fraction" : "fractions"}. Complete{" "}
                  {vendor.incompleteRowCount === 1 ? "it" : "them"} on {vendor.name}&apos;s owner
                  card.
                </p>
              )}
            </article>
          ))}
        </div>
      ) : (
        <p className="helper-text">No living current owner is available as a vendor.</p>
      )}

      {report.vendors.length > 0 && (
        <>
          <div className={`tax-calculation-total ${report.totalsComplete ? "" : "partial"}`}>
            <span>
              Total sale value{" "}
              <strong>
                {hasSellingPrice ? money.format(report.totalSaleValue) : "Not entered"}
              </strong>
            </span>
            <span>
              {report.totalsComplete
                ? "Total tax"
                : hasCalculatedSources
                  ? "Calculated tax subtotal"
                  : "Tax subtotal"}{" "}
              <strong>
                {report.totalsComplete
                  ? money.format(report.totalTax)
                  : hasCalculatedSources
                    ? money.format(report.calculatedTaxSubtotal)
                    : "Not calculated"}
              </strong>
            </span>
            <span>
              {report.totalsComplete
                ? "Total net"
                : hasCalculatedSources
                  ? "Calculated net subtotal"
                  : "Net subtotal"}{" "}
              <strong>
                {report.totalsComplete
                  ? money.format(report.totalNet)
                  : hasCalculatedSources
                    ? money.format(report.calculatedNetSubtotal)
                    : "Not calculated"}
              </strong>
            </span>
          </div>
          {!report.totalsComplete && (
            <p className="tax-calculation-total-note" role="status">
              Final tax and net totals are not shown because {report.incompleteSourceCount} source
              {report.incompleteSourceCount === 1 ? " fraction is" : " fractions are"} not yet
              calculated{pendingVendorNames ? ` for ${pendingVendorNames}` : ""}.
              {report.unassessedSaleValue != null && report.unassessedSaleValue > 0
                ? ` ${money.format(report.unassessedSaleValue)} of the selling price remains unassessed.`
                : ""}
            </p>
          )}
        </>
      )}
      {report.excludedLotCount > 0 && (
        <p className="tax-calculation-warning">
          {report.excludedLotCount} deceased-person tax record
          {report.excludedLotCount === 1 ? " is" : "s are"} excluded.
        </p>
      )}
    </section>
  );
}
