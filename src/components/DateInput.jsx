import { useEffect, useState } from "react";
import { displayDateToIso, formatDateDraft, isoDateToDisplay } from "../domain/dateFormat.js";

/**
 * A text date field that displays DD-MM-YYYY while emitting only valid ISO
 * YYYY-MM-DD values for storage. Incomplete and invalid drafts remain local
 * until the user completes a valid date.
 */
export function DateInput({ value = "", onChange, onBlur, placeholder = "dd-mm-yyyy", ...props }) {
  const [draft, setDraft] = useState(() => isoDateToDisplay(value));
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    setDraft(isoDateToDisplay(value));
  }, [value]);

  const parsedValue = displayDateToIso(draft);
  const isInvalid = Boolean(draft) && parsedValue === null && (touched || draft.length === 10);

  const handleChange = (event) => {
    const nextDraft = formatDateDraft(event.target.value);
    const nextIsoValue = displayDateToIso(nextDraft);
    setDraft(nextDraft);
    setTouched(false);

    if (nextIsoValue !== null) onChange?.(nextIsoValue);
  };

  const handleBlur = (event) => {
    setTouched(true);
    onBlur?.(event);
  };

  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={10}
      placeholder={placeholder}
      pattern="\d{2}-\d{2}-\d{4}"
      value={draft}
      aria-invalid={isInvalid || undefined}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
}
