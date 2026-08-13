const taxRateText = (rate) => {
  if (rate === "" || rate === null || rate === undefined || !Number.isFinite(Number(rate))) {
    return "";
  }
  return `${Number((Number(rate) * 100).toFixed(4))}%`;
};

/**
 * Returns the authoritative wording for an applied tax treatment. Some valid
 * treatments are manual, exempt or blended and deliberately have no single rate.
 */
export function appliedTaxMethodDescription(method = null) {
  if (!method) return "";
  const label = String(method.label || "").trim();
  const rate = taxRateText(method.rate);

  if (label) return !rate || label.includes(rate) ? label : `${rate} — ${label}`;
  if (rate) return rate;

  const rule = String(method.rule || "").trim();
  if (rule) return `Rule ${rule}`;
  return String(method.note || "").trim() || "Calculated tax treatment";
}

export function appliedTaxMethodDescriptions(rows = []) {
  return [
    ...new Set(rows.map((row) => appliedTaxMethodDescription(row?.selectedMethod)).filter(Boolean)),
  ];
}
