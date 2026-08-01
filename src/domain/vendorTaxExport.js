import { isoDateToDisplay } from "./dateFormat.js";
import { approximateFraction } from "./ownership.js";

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const fractionLabel = (share) => {
  const fraction = approximateFraction(share);
  return `${fraction.numerator}/${fraction.denominator}`;
};

const moneyCell = (value) =>
  `<td class="money" x:num="${Math.max(0, Number(value) || 0)}">${escapeHtml(
    Math.max(0, Number(value) || 0).toFixed(2),
  )}</td>`;

export function vendorTaxSpreadsheetHtml(report, property = {}) {
  const rows = report.vendors.flatMap((vendor) =>
    vendor.rows.flatMap((row) => {
      const methods = row.methods.length ? row.methods : [null];
      return methods.map((method) => {
        const declarations = row.declarations.length
          ? row.declarations
              .map(
                (declaration) =>
                  `${isoDateToDisplay(declaration.date) || declaration.date || "Undated"}: EUR ${declaration.declaredValue.toFixed(2)}`,
              )
              .join("; ")
          : "";
        const tax = method?.tax || 0;
        return `<tr>
          <td>${escapeHtml(vendor.name)}</td>
          <td>${escapeHtml(fractionLabel(vendor.share))}</td>
          <td>${escapeHtml(row.provenance)}</td>
          <td>${escapeHtml(fractionLabel(row.share))}</td>
          <td>${escapeHtml(declarations)}</td>
          ${moneyCell(row.declaredValue)}
          ${moneyCell(row.attributedSaleValue)}
          ${moneyCell(row.difference)}
          <td>${escapeHtml(method?.label || row.warning || "Incomplete")}</td>
          <td>${method?.rate == null ? "" : escapeHtml(`${method.rate * 100}%`)}</td>
          ${moneyCell(method?.basis || 0)}
          ${moneyCell(tax)}
          ${moneyCell(row.attributedSaleValue - tax)}
        </tr>`;
      });
    }),
  );
  return `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="utf-8"><style>
  table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 10pt; }
  th { background: #004225; color: #fff; font-weight: 700; }
  th, td { border: 1px solid #9eb9aa; padding: 6px; vertical-align: top; }
  .money { mso-number-format: "€#,##0.00"; text-align: right; }
</style></head><body>
<h2>${escapeHtml(property.address || "Property")} — Tax Calculation</h2>
<table><thead><tr>
  <th>Vendor</th><th>Total ownership fraction</th><th>Provenance</th><th>Source fraction</th>
  <th>Relevant CM declarations</th><th>CM declared value</th><th>Attributed selling price</th>
  <th>Difference</th><th>Tax calculation</th><th>Rate</th><th>Tax basis</th>
  <th>Tax payable</th><th>Net balance</th>
</tr></thead><tbody>${rows.join("")}</tbody></table>
</body></html>`;
}

export function downloadVendorTaxSpreadsheet(report, property = {}) {
  const html = vendorTaxSpreadsheetHtml(report, property);
  const blob = new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const baseName = String(property.address || "tax-calculation")
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  link.href = url;
  link.download = `${baseName || "tax-calculation"}-tax-calculation.xls`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
