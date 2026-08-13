import { useState } from "react";
import { Building2, UserRound } from "lucide-react";

const blankParty = () => ({
  type: "individual",
  name: "",
  registrationNumber: "",
});

export function OutsidePartyCreator({
  onCreate,
  onCancel,
  submitLabel = "Add as heir",
  helperText = "This party remains outside the family tree and can still hold or sell a property share.",
  ariaLabelPrefix = "Unconnected heir",
}) {
  const [draft, setDraft] = useState(blankParty);

  const submit = (event) => {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name) return;
    onCreate({
      id: crypto.randomUUID(),
      type: draft.type,
      name,
      registrationNumber: draft.registrationNumber.trim(),
    });
    setDraft(blankParty());
  };

  return (
    <form className="outside-party-creator" onSubmit={submit}>
      <label>
        <span>Type</span>
        <select
          aria-label={`${ariaLabelPrefix} type`}
          value={draft.type}
          onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))}
        >
          <option value="individual">Individual</option>
          <option value="company">Company</option>
        </select>
      </label>
      <label>
        <span>{draft.type === "company" ? "Company name" : "Full name"}</span>
        <span className="outside-party-name-input">
          {draft.type === "company" ? <Building2 size={15} /> : <UserRound size={15} />}
          <input
            aria-label={`${ariaLabelPrefix} name`}
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            placeholder={draft.type === "company" ? "Company Limited" : "Full name"}
          />
        </span>
      </label>
      {draft.type === "company" && (
        <label>
          <span>Registration (optional)</span>
          <input
            aria-label={`${ariaLabelPrefix} company registration number`}
            value={draft.registrationNumber}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                registrationNumber: event.target.value,
              }))
            }
          />
        </label>
      )}
      <div>
        <button type="submit" className="primary-button" disabled={!draft.name.trim()}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {helperText && <small>{helperText}</small>}
    </form>
  );
}
