import { SlidersHorizontal } from "lucide-react";

const fieldOptions = [
  ["ownershipFraction", "Fractions"],
  ["ownershipPercentage", "Percentages"],
  ["ownershipValue", "Current holding value"],
  ["successionBasis", "Testate / intestate"],
  ["willDetails", "Will details"],
  ["causaMortisDetails", "Causa mortis details"],
  ["dateOfDeath", "Dates of death"],
  ["stackLegalDetails", "Compact card width (stack legal details)"],
];

function FieldChoices({ fields, onChange }) {
  const updateField = (key, checked) => onChange({ ...fields, [key]: checked });

  return fieldOptions.map(([key, label]) => (
    <label key={key}>
      <input
        type="checkbox"
        checked={Boolean(fields[key])}
        onChange={(event) => updateField(key, event.target.checked)}
      />
      <span>{label}</span>
    </label>
  ));
}

export function PersonCardDisplayControl({ fields, onChange, embedded = false }) {
  if (embedded) {
    return (
      <fieldset className="person-card-display-fields">
        <legend>Show on person cards and printouts</legend>
        <div className="person-card-display-grid">
          <FieldChoices fields={fields} onChange={onChange} />
        </div>
      </fieldset>
    );
  }

  return (
    <details className="person-card-display-control">
      <summary aria-label="Choose details shown on person cards">
        <SlidersHorizontal size={16} />
        <span>Card details</span>
      </summary>
      <div className="person-card-display-menu">
        <strong>Show on person cards and printouts</strong>
        <FieldChoices fields={fields} onChange={onChange} />
      </div>
    </details>
  );
}
