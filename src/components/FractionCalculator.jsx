import { useMemo, useState } from "react";
import { Calculator, X } from "lucide-react";
import { calculateFraction } from "../domain/fractions.js";

export function FractionCalculator() {
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState({ numerator: "1", denominator: "2" });
  const [right, setRight] = useState({ numerator: "1", denominator: "3" });
  const [operation, setOperation] = useState("add");
  const result = useMemo(() => calculateFraction(left, right, operation), [left, operation, right]);
  const update = (side, field, value) => side === "left" ? setLeft({ ...left, [field]: value }) : setRight({ ...right, [field]: value });
  return <>
    <button type="button" className="fraction-launcher" onClick={() => setOpen(true)} aria-label="Open fraction calculator"><Calculator size={18} /> Fractions</button>
    {open && <div className="fraction-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="fraction-dialog" role="dialog" aria-modal="true" aria-labelledby="fraction-title">
        <header><div><p className="eyebrow">Quick tool</p><h2 id="fraction-title">Fraction calculator</h2></div><button type="button" className="icon-button" aria-label="Close fraction calculator" onClick={() => setOpen(false)}><X size={17} /></button></header>
        <div className="fraction-expression">
          <div className="fraction-input" aria-label="First fraction"><input aria-label="First numerator" inputMode="numeric" value={left.numerator} onChange={(e) => update("left", "numerator", e.target.value)} /><span /><input aria-label="First denominator" inputMode="numeric" value={left.denominator} onChange={(e) => update("left", "denominator", e.target.value)} /></div>
          <select aria-label="Fraction operation" value={operation} onChange={(e) => setOperation(e.target.value)}><option value="add">+</option><option value="subtract">−</option><option value="multiply">×</option><option value="divide">÷</option></select>
          <div className="fraction-input" aria-label="Second fraction"><input aria-label="Second numerator" inputMode="numeric" value={right.numerator} onChange={(e) => update("right", "numerator", e.target.value)} /><span /><input aria-label="Second denominator" inputMode="numeric" value={right.denominator} onChange={(e) => update("right", "denominator", e.target.value)} /></div>
        </div>
        {"error" in result ? <p className="fraction-error" role="alert">{result.error}</p> : <div className="fraction-result" aria-live="polite"><div><span>Simplified result</span><strong>{result.numerator}/{result.denominator}</strong></div><div><span>Decimal</span><strong>{result.decimal.toLocaleString("en-MT", { maximumFractionDigits: 8 })}</strong></div><div><span>Percentage</span><strong>{result.percentage.toLocaleString("en-MT", { maximumFractionDigits: 4 })}%</strong></div></div>}
      </section>
    </div>}
  </>;
}

