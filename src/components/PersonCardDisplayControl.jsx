import { SlidersHorizontal } from "lucide-react";

const legalFieldOptions = [
  ["ownershipFraction", "Fractions"],
  ["ownershipPercentage", "Percentages"],
  ["ownershipValue", "Current holding value"],
  ["successionBasis", "Testate / intestate"],
  ["willDetails", "Will details"],
  ["causaMortisDetails", "Causa mortis details"],
];

const familyFieldOptions = [["dateOfDeath", "Dates of death"]];

const layoutFieldOptions = [["stackLegalDetails", "Compact card width (stack legal details)"]];

function FieldChoices({ fields, onChange, legalWorkspaceEnabled }) {
  const updateField = (key, checked) => onChange({ ...fields, [key]: checked });
  const fieldOptions = legalWorkspaceEnabled
    ? [...legalFieldOptions, ...familyFieldOptions, ...layoutFieldOptions]
    : familyFieldOptions;

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

export function PersonCardDisplayControl({ fields, onChange, legalWorkspaceEnabled = true }) {
  return (
    <details className="person-card-display-control">
      <summary>
        <SlidersHorizontal size={16} />
        <span>Person card details</span>
      </summary>
      <div className="person-card-display-menu">
        <strong>Show on person cards and printouts</strong>
        <FieldChoices
          fields={fields}
          onChange={onChange}
          legalWorkspaceEnabled={legalWorkspaceEnabled}
        />
      </div>
    </details>
  );
}
