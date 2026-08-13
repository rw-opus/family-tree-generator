import { Printer, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { approximateFraction } from "../domain/ownership.js";
import { appliedTaxMethodDescription } from "../domain/vendorSettlement.js";
import "./VendorSettlementStatement.css";

const money = new Intl.NumberFormat("en-MT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

const hasRecordedMoney = (value) =>
  String(value ?? "").trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;

const hasFiniteRecordedNumber = (value) =>
  String(value ?? "").trim() !== "" && Number.isFinite(Number(value));

const fractionLabel = (share, exactFraction) => {
  const fraction = exactFraction?.denominator ? exactFraction : approximateFraction(share);
  return `${fraction.numerator}/${fraction.denominator}`;
};

const rowMethodLabel = (row) => {
  return appliedTaxMethodDescription(row.selectedMethod) || "Not calculated";
};

const unresolvedRows = (vendor) =>
  (vendor.rows || []).filter(
    (row) =>
      !row.selectedMethod ||
      !hasRecordedMoney(row.attributedSaleValue) ||
      !hasRecordedMoney(row.tax) ||
      !hasFiniteRecordedNumber(row.net),
  );

const vendorIsComplete = (vendor) =>
  unresolvedRows(vendor).length === 0 &&
  Number(vendor.incompleteSourceCount ?? vendor.incompleteRowCount ?? 0) === 0 &&
  hasRecordedMoney(vendor.attributedSaleValue) &&
  hasRecordedMoney(vendor.tax) &&
  hasFiniteRecordedNumber(vendor.net);

function VendorName({ vendor, onSelectPerson, onClose }) {
  if (!onSelectPerson) return <strong>{vendor.name}</strong>;
  return (
    <button
      type="button"
      className="vendor-settlement-person-link"
      onClick={() => {
        onClose();
        onSelectPerson(vendor.id);
      }}
    >
      {vendor.name}
    </button>
  );
}

function AppliedMethods({ vendor }) {
  const rows = vendor.rows || [];
  if (!rows.length) return <span className="vendor-settlement-pending">Not calculated</span>;

  return (
    <ul className="vendor-settlement-methods">
      {rows.map((row, index) => (
        <li key={row.id || `${vendor.id}-tax-source-${index}`}>
          <span>{fractionLabel(row.share, row.shareFraction)}</span>
          <b>
            {rowMethodLabel(row)}
            {row.selectedMethod && hasRecordedMoney(row.tax) ? ` · ${money.format(row.tax)}` : ""}
          </b>
        </li>
      ))}
    </ul>
  );
}

function VendorSettlementDialog({ report, property, people, onSelectPerson, onClose }) {
  const titleId = useId();
  const closeButtonRef = useRef(null);
  const vendors = report?.vendors || [];
  const selectablePersonIds = new Set((people || []).map((person) => person.id));
  const statementSaleValue = hasRecordedMoney(report?.totalSaleValue)
    ? Number(report.totalSaleValue)
    : hasRecordedMoney(property?.saleValue)
      ? Number(property.saleValue)
      : null;
  const completeVendors = vendors.filter(vendorIsComplete);
  const pendingVendorCount = vendors.length - completeVendors.length;
  const totalsComplete = report?.totalsComplete ?? (pendingVendorCount === 0 && vendors.length > 0);

  useEffect(() => {
    document.body.classList.add("vendor-settlement-open");
    closeButtonRef.current?.focus();
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.classList.remove("vendor-settlement-open");
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="vendor-settlement-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <article className="vendor-settlement-sheet">
        <header className="vendor-settlement-header">
          <div>
            <p className="eyebrow">Property sale distribution</p>
            <h2 id={titleId}>Vendor Settlement Statement</h2>
            <p>{property?.address || "Property address not entered"}</p>
          </div>
          <div className="vendor-settlement-actions">
            <button type="button" className="secondary-button" onClick={() => window.print()}>
              <Printer size={16} /> Print statement
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              className="icon-button"
              aria-label="Close vendor settlement statement"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <section className="vendor-settlement-summary" aria-label="Statement summary">
          <div>
            <span>Selling price</span>
            <strong>
              {statementSaleValue == null ? "Not entered" : money.format(statementSaleValue)}
            </strong>
          </div>
          <div>
            <span>Vendors</span>
            <strong>{vendors.length}</strong>
          </div>
          <div>
            <span>Calculation status</span>
            <strong>{totalsComplete ? "Complete" : "Tax details pending"}</strong>
          </div>
        </section>

        {vendors.length ? (
          <div className="vendor-settlement-table-wrap">
            <table className="vendor-settlement-table">
              <caption className="sr-only">
                Ownership, sale-price, tax and net settlement for every vendor
              </caption>
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Ownership fraction</th>
                  <th>Price share before tax</th>
                  <th>Applied tax method or rate by source</th>
                  <th>Tax due</th>
                  <th>Net balance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((vendor) => {
                  const complete = vendorIsComplete(vendor);
                  const pendingSources = Math.max(
                    unresolvedRows(vendor).length,
                    Number(vendor.incompleteSourceCount ?? vendor.incompleteRowCount ?? 0),
                  );
                  return (
                    <tr className="vendor-settlement-vendor-row" key={vendor.id}>
                      <td data-label="Vendor">
                        <VendorName
                          vendor={vendor}
                          onSelectPerson={
                            selectablePersonIds.has(vendor.id) ? onSelectPerson : undefined
                          }
                          onClose={onClose}
                        />
                      </td>
                      <td data-label="Ownership fraction">
                        {fractionLabel(vendor.share, vendor.shareFraction)}
                      </td>
                      <td data-label="Price share before tax">
                        {hasRecordedMoney(vendor.attributedSaleValue)
                          ? money.format(Number(vendor.attributedSaleValue))
                          : "Not entered"}
                      </td>
                      <td data-label="Applied tax methods">
                        <AppliedMethods vendor={vendor} />
                      </td>
                      <td data-label="Tax due">
                        {complete ? money.format(Number(vendor.tax)) : "Not calculated"}
                      </td>
                      <td data-label="Net balance">
                        {complete ? money.format(Number(vendor.net)) : "Not calculated"}
                      </td>
                      <td data-label="Status">
                        <span
                          className={`vendor-settlement-status ${complete ? "complete" : "pending"}`}
                        >
                          {complete
                            ? "Complete"
                            : statementSaleValue != null
                              ? `${pendingSources || 1} source ${
                                  (pendingSources || 1) === 1 ? "pending" : "sources pending"
                                }`
                              : "Selling price pending"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan="2">Totals</th>
                  <td data-label="Price share before tax">
                    {hasRecordedMoney(report.totalSaleValue)
                      ? money.format(Number(report.totalSaleValue))
                      : "Not entered"}
                  </td>
                  <td aria-label="Applied tax methods total">—</td>
                  <td data-label="Tax due">
                    {totalsComplete &&
                    report.totalTax != null &&
                    Number.isFinite(Number(report.totalTax))
                      ? money.format(Number(report.totalTax))
                      : "Not calculated"}
                  </td>
                  <td data-label="Net balance">
                    {totalsComplete &&
                    report.totalNet != null &&
                    Number.isFinite(Number(report.totalNet))
                      ? money.format(Number(report.totalNet))
                      : "Not calculated"}
                  </td>
                  <td data-label="Status">
                    {totalsComplete ? "Complete" : `${pendingVendorCount} vendor(s) pending`}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <p className="vendor-settlement-empty">
            No living current owner is available as a vendor.
          </p>
        )}

        {!totalsComplete && vendors.length > 0 && (
          <p className="vendor-settlement-warning">
            Overall tax and net totals remain uncalculated until every vendor source has its tax
            treatment. Completed vendor figures remain visible above.
          </p>
        )}
        <p className="vendor-settlement-disclaimer">
          Indicative calculation only. Verify all ownership and tax figures before filing, signing,
          payment or distribution.
        </p>
      </article>
    </div>,
    document.body,
  );
}

export function VendorSettlementStatement({ report, property, people = [], onSelectPerson }) {
  const [isOpen, setIsOpen] = useState(false);
  const hasVendors = Boolean(report?.vendors?.length);

  return (
    <>
      <button
        type="button"
        className="secondary-button vendor-settlement-open-button"
        disabled={!hasVendors}
        onClick={() => setIsOpen(true)}
      >
        <Printer size={16} /> Open printable vendor list
      </button>
      {isOpen && (
        <VendorSettlementDialog
          report={report}
          property={property}
          people={people}
          onSelectPerson={onSelectPerson}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  );
}
