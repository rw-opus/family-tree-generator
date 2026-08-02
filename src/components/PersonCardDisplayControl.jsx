import { SlidersHorizontal } from "lucide-react";

const fieldOptions = [
  ["ownershipFraction", "Fractions"],
  ["ownershipPercentage", "Percentages"],
  ["willDetails", "Will details"],
  ["causaMortisDetails", "Causa mortis details"],
  ["dateOfDeath", "Dates of death"],
];

export function PersonCardDisplayControl({ fields, onChange }) {
  const updateField = (key, checked) => onChange({ ...fields, [key]: checked });

  return (
    <details className="person-card-display-control">
      <summary aria-label="Choose details shown on person cards">
        <SlidersHorizontal size={16} />
        <span>Card details</span>
      </summary>
      <div className="person-card-display-menu">
        <strong>Show on person cards and printouts</strong>
        {fieldOptions.map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={Boolean(fields[key])}
              onChange={(event) => updateField(key, event.target.checked)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </details>
  );
}
