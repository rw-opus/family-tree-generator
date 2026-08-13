import { useEffect, useState } from "react";
import { DateInput } from "../DateInput.jsx";
import "./FinalWithholdingTaxSection.css";

const money = new Intl.NumberFormat("en-MT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

const unresolvedRows = (vendorTax) =>
  (vendorTax?.rows || []).filter((row) => row.tax == null || !row.selectedMethod);

const provenanceName = (row, prefixPattern) => {
  if (row?.provenancePersonName) return row.provenancePersonName;
  const provenance = String(row?.provenance || "");
  const withoutPrefix = provenance.replace(new RegExp(`^${prefixPattern}\\s+`, "i"), "");
  return withoutPrefix.split(/\s+(?:—|–|-)\s+/)[0]?.trim() || "source person";
};

const inheritedSourceName = (row) => provenanceName(row, "Inherited from");

const sourcePersonName = (row) => provenanceName(row, "(?:Donated by|Acquired from)");

function InitialAcquisitionResolution({ row, onConfirm }) {
  const [acquisitionDate, setAcquisitionDate] = useState(row.acquisitionDate || "");

  useEffect(() => {
    setAcquisitionDate(row.acquisitionDate || "");
  }, [row.id, row.acquisitionDate]);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!acquisitionDate) return;
    onConfirm?.({ row, acquisitionDate });
  };

  return (
    <form className="fwt-initial-acquisition" onSubmit={handleSubmit}>
      <label className="fwt-acquisition-field" htmlFor={`fwt-acquisition-${row.id}`}>
        <span>Original acquisition date</span>
        <DateInput
          id={`fwt-acquisition-${row.id}`}
          value={acquisitionDate}
          onChange={setAcquisitionDate}
          aria-label="Original acquisition date"
        />
      </label>
      <button type="submit" disabled={!acquisitionDate || !onConfirm}>
        Confirm date
      </button>
    </form>
  );
}

function DonationValueResolution({ row, onConfirm }) {
  const [acquisitionValue, setAcquisitionValue] = useState(row.acquisitionValue ?? "");

  useEffect(() => {
    setAcquisitionValue(row.acquisitionValue ?? "");
  }, [row.id, row.acquisitionValue]);

  const valueIsValid =
    String(acquisitionValue).trim() !== "" &&
    Number.isFinite(Number(acquisitionValue)) &&
    Number(acquisitionValue) >= 0;

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!valueIsValid) return;
    onConfirm?.({ row, acquisitionValue, acquisitionValueBasis: "deed-value" });
  };

  return (
    <form className="fwt-donation-value" onSubmit={handleSubmit}>
      <label className="fwt-acquisition-field" htmlFor={`fwt-donation-value-${row.id}`}>
        <span>Donation Value (optional)</span>
        <span className="fwt-money-input">
          <span aria-hidden="true">€</span>
          <input
            id={`fwt-donation-value-${row.id}`}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={acquisitionValue}
            onChange={(event) => setAcquisitionValue(event.target.value)}
            aria-label="Donation Value"
          />
        </span>
      </label>
      <button type="submit" disabled={!valueIsValid || !onConfirm}>
        Confirm value
      </button>
    </form>
  );
}

function PendingSource({
  row,
  isPersonDeceased,
  onOpenSourcePerson,
  onConfirmInitialAcquisition,
  onConfirmDonationAcquisitionValue,
}) {
  const inherited = row.sourceKind === "inheritance" && Boolean(row.provenancePersonId);
  const initialOwnership =
    !isPersonDeceased &&
    row.sourceKind === "initial" &&
    row.requiresOriginalAcquisitionDate === true;
  const warning = row.warning
    ? `${row.warning} Tax values are optional.`
    : "Optional tax detail not supplied. Ownership fractions are unaffected.";

  return (
    <li className="fwt-pending-source">
      <b>{row.provenance || "Source fraction"}</b>
      <span>{warning}</span>
      {inherited && onOpenSourcePerson && (
        <button
          type="button"
          className="fwt-source-link"
          onClick={() => onOpenSourcePerson(row.provenancePersonId)}
        >
          Open {inheritedSourceName(row)} CM details
        </button>
      )}
      {row.sourceKind === "donation" &&
        row.provenancePersonId &&
        !row.provenancePersonDeceased &&
        onOpenSourcePerson && (
          <button
            type="button"
            className="fwt-source-link"
            onClick={() => onOpenSourcePerson(row.provenancePersonId)}
          >
            Open {sourcePersonName(row)} original acquisition details
          </button>
        )}
      {initialOwnership && (
        <InitialAcquisitionResolution row={row} onConfirm={onConfirmInitialAcquisition} />
      )}
      {row.sourceKind === "donation" && row.requiresDonationAcquisitionValue === true && (
        <DonationValueResolution row={row} onConfirm={onConfirmDonationAcquisitionValue} />
      )}
    </li>
  );
}

/**
 * Compact owner-card summary and resolution actions for Final Withholding Tax.
 * The Tax Calculation screen remains read-only; source data is completed here or
 * on the deceased source person's causa mortis record.
 */
export function FinalWithholdingTaxSection({
  vendorTax = null,
  additionalResolutionRows = [],
  isPersonDeceased = false,
  onOpenSourcePerson,
  onConfirmInitialAcquisition,
  onConfirmDonationAcquisitionValue,
}) {
  if (!vendorTax && !additionalResolutionRows.length) {
    return (
      <section className="final-withholding-tax-section" aria-label="Final Withholding Tax">
        <div className="fwt-status-row">
          <span>Final Withholding Tax</span>
          <strong>{isPersonDeceased ? "Not applicable" : "Not a current vendor"}</strong>
        </div>
      </section>
    );
  }

  const pendingRows = unresolvedRows(vendorTax);
  const resolutionRows = [...pendingRows];
  additionalResolutionRows.forEach((row) => {
    if (
      resolutionRows.some(
        (candidate) =>
          candidate.originalOwnerRecordId &&
          candidate.originalOwnerRecordId === row.originalOwnerRecordId,
      )
    ) {
      return;
    }
    resolutionRows.push(row);
  });
  const isPending = Boolean(vendorTax) && (vendorTax.tax == null || pendingRows.length > 0);
  const status = !vendorTax
    ? "Not a current vendor"
    : isPending
      ? "Not calculated"
      : money.format(Number(vendorTax.tax) || 0);

  return (
    <section className="final-withholding-tax-section" aria-label="Final Withholding Tax">
      <div className="fwt-status-row">
        <span>Final Withholding Tax</span>
        <strong>{status}</strong>
      </div>

      {resolutionRows.length ? (
        <>
          <small className="fwt-summary">
            Optional tax details are absent for {resolutionRows.length} source{" "}
            {resolutionRows.length === 1 ? "fraction" : "fractions"}.
          </small>
          <ul className="fwt-pending-sources">
            {resolutionRows.map((row, index) => (
              <PendingSource
                key={row.id || `${row.provenance || "source"}-${index}`}
                row={row}
                isPersonDeceased={isPersonDeceased}
                onOpenSourcePerson={onOpenSourcePerson}
                onConfirmInitialAcquisition={onConfirmInitialAcquisition}
                onConfirmDonationAcquisitionValue={onConfirmDonationAcquisitionValue}
              />
            ))}
          </ul>
        </>
      ) : vendorTax ? (
        <small className="fwt-summary">Calculated from the recorded source fractions.</small>
      ) : null}
    </section>
  );
}
