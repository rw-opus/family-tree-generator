import {
  Building2,
  Calculator,
  CalendarDays,
  FileText,
  MapPin,
  UsersRound,
} from "lucide-react";
import { declarationCoverage } from "../domain/declarations.js";
import { approximateFraction } from "../domain/ownership.js";
import { formattedDate } from "../domain/people.js";
import { buildPropertyVendorTaxReport } from "../domain/propertyVendorTax.js";
import { fractionForShare } from "../domain/shares.js";

const money = new Intl.NumberFormat("en-MT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

export function CaseSummary({ tree }) {
  const heirs = (tree.succession?.heirs || []).filter((heir) => Number(heir.sharePercent || 0) > 0);
  const shareDisplay = tree.settings?.shareDisplay || "both";
  const coverage = declarationCoverage(heirs, tree.declarations || []);
  const coverageFor = (id) => coverage.find((item) => item.heirId === id);
  const propertyTaxReports = (tree.properties || []).map((property) => ({
    property,
    report: buildPropertyVendorTaxReport(
      property,
      tree.people || [],
      tree.outsideParties || [],
    ),
  }));
  const livingVendorTaxTotal = propertyTaxReports.reduce(
    (total, item) => total + item.report.taxSummary.total,
    0,
  );
  const shareLabel = (heir) => {
    const fraction = fractionForShare(heir);
    const fractionText = `${fraction.numerator}/${fraction.denominator}`;
    const percentageText = `${Number(heir.sharePercent || 0).toLocaleString("en-MT", { maximumFractionDigits: 6 })}%`;
    if (shareDisplay === "fraction") return fractionText;
    if (shareDisplay === "percentage") return percentageText;
    return `${fractionText} · ${percentageText}`;
  };
  return <section className="case-summary" aria-label="Case summary">
    <header><p className="eyebrow">At a glance</p><h2>{tree.title || "Unnamed family tree"}</h2></header>
    <div className="summary-facts">
      <div><MapPin size={17} /><span>Property address<strong>{tree.property?.address || "Not entered"}</strong></span></div>
      <div><Building2 size={17} /><span>Property sale value<strong>{tree.property?.saleValue ? money.format(Number(tree.property.saleValue)) : "No sale value entered"}</strong></span></div>
      <div><CalendarDays size={17} /><span>Date of death<strong>{formattedDate(tree.succession?.dateOfDeath) || "Not entered"}</strong></span></div>
      <div><FileText size={17} /><span>Will date<strong>{tree.succession?.basis === "intestacy" ? "Intestate succession" : formattedDate(tree.succession?.willDate) || "Not entered"}</strong></span></div>
    </div>
    <div className="summary-heirs"><h3><UsersRound size={17} /> Heirs and published causa mortis values</h3>{heirs.length ? heirs.map((heir) => { const item = coverageFor(heir.id); const fraction = approximateFraction(item?.publishedFraction || 0); return <div className="summary-heir-row" key={heir.id}><span><strong>{heir.name || "Unnamed heir"}</strong><small>{shareLabel(heir)} succession share</small></span><span><strong>{item?.publishedCount ? `${fraction.numerator}/${fraction.denominator}` : "No published DCM"}</strong><small>{item?.publishedCount ? money.format(item.publishedValue) : "No declared value recorded"}</small></span></div>; }) : <p className="helper-text">No effective heirs have been entered.</p>}</div>
    <div className="summary-vendor-taxes">
      <h3><Calculator size={17} /> Tax payable by each living vendor</h3>
      {propertyTaxReports.length ? propertyTaxReports.map(({ property, report }) => (
        <section className="summary-property-tax" key={property.id}>
          <div className="summary-property-tax-heading">
            <strong>{property.address || "Unnamed property"}</strong>
            <span>{money.format(report.taxSummary.total)}</span>
          </div>
          {report.taxSummary.vendors.length ? report.taxSummary.vendors.map((vendor) => {
            const fraction = approximateFraction(vendor.share);
            return (
              <article className="summary-vendor-card" key={vendor.id}>
                <div>
                  <span>
                    <strong>{vendor.name}</strong>
                    <small>{fraction.numerator}/{fraction.denominator} current ownership · {vendor.lotCount} tax {vendor.lotCount === 1 ? "lot" : "lots"}</small>
                  </span>
                  <span>
                    <strong>{money.format(vendor.tax)}</strong>
                    <small>payable by this vendor</small>
                  </span>
                </div>
                {vendor.rows.map((row, index) => {
                  const method = row.result.methods.find(
                    (item) => item.key === row.result.selected,
                  );
                  return (
                    <p key={row.lot.id}>
                      Lot {index + 1}: {row.effectiveLot.shareNumerator}/{row.effectiveLot.shareDenominator} · {row.lot.inheritanceDate || "date missing"} · {method ? `${method.label} — ${money.format(method.tax)}` : "tax details incomplete"}
                    </p>
                  );
                })}
              </article>
            );
          }) : <p className="helper-text">No living current vendor is recorded for this property.</p>}
          {report.taxSummary.excludedLotCount > 0 && (
            <small className="summary-excluded">
              Deceased-person tax lots excluded: {report.taxSummary.excludedLotCount}.
            </small>
          )}
        </section>
      )) : <p className="helper-text">No properties have been added.</p>}
      <div className="summary-vendor-grand-total">
        <span>Total payable by all living vendors</span>
        <strong>{money.format(livingVendorTaxTotal)}</strong>
      </div>
    </div>
  </section>;
}
