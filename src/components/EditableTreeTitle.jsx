import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";

export function EditableTreeTitle({ value = "", onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  const save = () => {
    const nextTitle = draft.trim();
    if (nextTitle && nextTitle !== value) onChange?.(nextTitle);
    if (!nextTitle) setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="stage-family-title">
        <input
          autoFocus
          className="stage-family-title-input"
          aria-label="Tree name"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setDraft(value);
              setEditing(false);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="stage-family-title">
      <button
        type="button"
        className="stage-family-title-button"
        aria-label={`Edit tree name: ${value}`}
        title="Click to edit the family-tree name"
        onClick={() => setEditing(true)}
      >
        <span>{value || "Untitled family tree"}</span>
        <Pencil aria-hidden="true" size={15} />
      </button>
    </div>
  );
}
