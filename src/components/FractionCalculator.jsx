import { useMemo, useState } from "react";
import { Calculator, X } from "lucide-react";
import { calculateFraction, MAX_FRACTION_DIGITS } from "../domain/fractions.js";

const operations = [
  { value: "add", symbol: "+", label: "Add" },
  { value: "subtract", symbol: "−", label: "Subtract" },
  { value: "multiply", symbol: "×", label: "Multiply" },
  { value: "divide", symbol: "÷", label: "Divide" },
];

export function FractionCalculator() {
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState({ numerator: "1", denominator: "2" });
  const [right, setRight] = useState({ numerator: "1", denominator: "3" });
  const [operation, setOperation] = useState("add");
  const result = useMemo(() => calculateFraction(left, right, operation), [left, operation, right]);
  const update = (side, field, value) => {
    if (side === "left") setLeft({ ...left, [field]: value });
    else setRight({ ...right, [field]: value });
  };

  return (
    <>
      <button
        type="button"
        className="fraction-launcher"
        onClick={() => setOpen(true)}
        aria-label="Open fraction calculator"
      >
        <span className="mini-calculator-screen">½</span>
        <span className="mini-calculator-keys" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
        {/* Named in plain sight: the icon on its own read as decoration. */}
        <span className="fraction-launcher-label" aria-hidden="true">
          Fractions
        </span>
      </button>
      {open && (
        <div
          className="fraction-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            className="fraction-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fraction-title"
          >
            <header>
              <div>
                <p className="eyebrow">Quick tool</p>
                <h2 id="fraction-title">
                  <Calculator size={17} /> Fraction calculator
                </h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close fraction calculator"
                onClick={() => setOpen(false)}
              >
                <X size={16} />
              </button>
            </header>

            <div className={`fraction-display ${"error" in result ? "invalid" : ""}`}>
              <small>Result</small>
              {"error" in result ? (
                <strong>—</strong>
              ) : (
                <>
                  <strong>
                    {result.numerator}
                    <span>/</span>
                    {result.denominator}
                  </strong>
                  <span>
                    {result.percentage.toLocaleString("en-MT", {
                      maximumFractionDigits: 2,
                    })}
                    %
                  </span>
                </>
              )}
            </div>

            <div className="fraction-expression">
              <div className="fraction-input" aria-label="First fraction">
                <input
                  aria-label="First numerator"
                  inputMode="numeric"
                  maxLength={MAX_FRACTION_DIGITS + 1}
                  value={left.numerator}
                  onChange={(event) => update("left", "numerator", event.target.value)}
                />
                <span />
                <input
                  aria-label="First denominator"
                  inputMode="numeric"
                  maxLength={MAX_FRACTION_DIGITS + 1}
                  value={left.denominator}
                  onChange={(event) => update("left", "denominator", event.target.value)}
                />
              </div>
              <strong className="fraction-operation-symbol">
                {operations.find((item) => item.value === operation)?.symbol}
              </strong>
              <div className="fraction-input" aria-label="Second fraction">
                <input
                  aria-label="Second numerator"
                  inputMode="numeric"
                  maxLength={MAX_FRACTION_DIGITS + 1}
                  value={right.numerator}
                  onChange={(event) => update("right", "numerator", event.target.value)}
                />
                <span />
                <input
                  aria-label="Second denominator"
                  inputMode="numeric"
                  maxLength={MAX_FRACTION_DIGITS + 1}
                  value={right.denominator}
                  onChange={(event) => update("right", "denominator", event.target.value)}
                />
              </div>
            </div>

            <div className="fraction-operation-pad" aria-label="Fraction operation">
              {operations.map((item) => (
                <button
                  type="button"
                  className={operation === item.value ? "active" : ""}
                  aria-label={item.label}
                  aria-pressed={operation === item.value}
                  key={item.value}
                  onClick={() => setOperation(item.value)}
                >
                  {item.symbol}
                </button>
              ))}
            </div>

            {"error" in result ? (
              <p className="fraction-error" role="alert">
                {result.error}
              </p>
            ) : (
              <div className="fraction-result" aria-live="polite">
                <span>Decimal</span>
                <strong>
                  {result.decimal.toLocaleString("en-MT", {
                    maximumFractionDigits: 8,
                  })}
                </strong>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
