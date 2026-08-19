import { CircleHelp } from "lucide-react";

export function HoverHelpLabel({ label, help }) {
  return (
    <span className="hover-help-label" title={help} aria-label={`${label}. ${help}`}>
      <span>{label}</span>
      <CircleHelp size={13} aria-hidden="true" />
    </span>
  );
}
