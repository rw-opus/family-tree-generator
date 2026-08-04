import { FileSpreadsheet } from "lucide-react";
import { isoDateToDisplay } from "../domain/dateFormat.js";
import { displayNotaryName } from "../domain/notary.js";
import { approximateFraction } from "../domain/ownership.js";
import { buildTaxCalculationReport } from "../domain/propertyVendorTax.js";
import { downloadVendorTaxSpreadsheet } from "../domain/vendorTaxExport.js";

const money = new Intl.NumberFormat("en-MT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

const fractionLabel = (share, exactFraction) => {
  const fraction = exactFraction?.denominator ? exactFraction : approximateFraction(share);
  return `${fraction.numerator}/${fraction.denominator}`;
};

export function TaxCalculationPanel({ property, people, outsideParties, vendorReport }) {
  const report = buildTaxCalculationReport(property, people, outsideParties, vendorReport);

  return (
    <section className="tax-calculation-panel" aria-label="Tax Calculation">
      <div className="section-heading tax-calculation-heading">
        <div>
          <p className="eyebrow">Sale information</p>
          <h3>Tax Calculation</h3>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={!report.vendors.length}
          onClick={() => downloadVendorTaxSpreadsheet(report, property)}
        >
          <FileSpreadsheet size={16} /> Download Excel
        </button>
      </div>
      <p className="helper-text">
        This is a read-only calculation from the family tree, ownership transfers, person-card
        Declaration Causa Mortis (CM) records and the property selling value.
      </p>

      {report.vendors.length ? (
        <div className="tax-calculation-vendors">
          {report.vendors.map((vendor) => (
            <article className="tax-calculation-vendor" key={vendor.id}>
              <header>
                <span>
                  <strong>{vendor.name}</strong>
                  <small>Total ownership {fractionLabel(vendor.share, vendor.shareFraction)}</small>
                </span>
                <span>
                  <strong>{money.format(vendor.attributedSaleValue)}</strong>
                  <small>attributed selling price</small>
                </span>
              </header>
              <div className="tax-calculation-table-wrap">
                <table className="tax-calculation-table">
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
                        <td>
                          <strong>{row.provenance}</strong>
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
                              {` · ${money.format(declaration.declaredValue)}`}
                            </small>
                          ))}
                        </td>
                        <td>{fractionLabel(row.share, row.shareFraction)}</td>
                        <td>{money.format(row.declaredValue)}</td>
                        <td>{money.format(row.attributedSaleValue)}</td>
                        <td>{money.format(row.difference)}</td>
                        <td>
                          {row.methods.length ? (
                            row.methods.map((method) => (
                              <small
                                className={method.key === row.selectedMethod?.key ? "selected" : ""}
                                key={method.key}
                              >
                                {method.label}: {money.format(method.tax)}
                                {method.requiresElection ? " · election" : ""}
                              </small>
                            ))
                          ) : (
                            <small className="attention">{row.warning || "Incomplete"}</small>
                          )}
                        </td>
                        <td>{row.selectedMethod ? money.format(row.tax) : "—"}</td>
                        <td>{row.selectedMethod ? money.format(row.net) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <footer>
                <span>
                  Tax payable{" "}
                  <strong>{vendor.tax == null ? "Pending" : money.format(vendor.tax)}</strong>
                </span>
                <span>
                  Net balance{" "}
                  <strong>{vendor.net == null ? "Pending" : money.format(vendor.net)}</strong>
                </span>
              </footer>
              {vendor.incompleteRowCount > 0 && (
                <p className="tax-calculation-warning">
                  {vendor.incompleteRowCount} source fraction
                  {vendor.incompleteRowCount === 1 ? " needs" : "s need"} more acquisition or{" "}
                  <abbr title="Declaration Causa Mortis">CM</abbr> data before its tax can be
                  finalised.
                </p>
              )}
            </article>
          ))}
        </div>
      ) : (
        <p className="helper-text">No living current owner is available as a vendor.</p>
      )}

      {report.vendors.length > 0 && (
        <div className="tax-calculation-total">
          <span>
            Total sale value <strong>{money.format(report.totalSaleValue)}</strong>
          </span>
          <span>
            Total tax{" "}
            <strong>{report.totalTax == null ? "Pending" : money.format(report.totalTax)}</strong>
          </span>
          <span>
            Total net{" "}
            <strong>{report.totalNet == null ? "Pending" : money.format(report.totalNet)}</strong>
          </span>
        </div>
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
