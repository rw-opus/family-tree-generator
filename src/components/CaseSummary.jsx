import { Building2, CalendarDays, FileText, MapPin, UsersRound } from "lucide-react";
import { declarationCoverage } from "../domain/declarations.js";
import { approximateFraction } from "../domain/ownership.js";
import { formattedDate } from "../domain/people.js";
import { fractionForShare } from "../domain/shares.js";

const money = new Intl.NumberFormat("en-MT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

export function CaseSummary({ tree }) {
  const heirs = (tree.succession?.heirs || []).filter((heir) => Number(heir.sharePercent || 0) > 0);
  const shareDisplay = tree.settings?.shareDisplay || "both";
  const coverage = declarationCoverage(heirs, tree.declarations || []);
  const coverageFor = (id) => coverage.find((item) => item.heirId === id);
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
  </section>;
}
