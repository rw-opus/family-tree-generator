import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Pause,
  SkipForward,
} from "lucide-react";
import { useEffect, useRef } from "react";

const issueFieldByCode = {
  "identity-names": ["data-person-field", "given-names"],
  "identity-surname": ["data-person-field", "surname"],
  "identity-surname-at-birth": ["data-person-field", "surname-at-birth"],
  "identity-surname-at-birth-review": ["data-person-field", "surname-at-birth"],
  "identity-sex": ["data-person-field", "sex"],
  "death-date": ["data-person-field", "date-of-death"],
  "required-spouse-death-date": ["data-person-field", "date-of-death"],
  "initial-acquisition-date": ["data-tax-readiness-field", "original-acquisition-date"],
  "donor-original-acquisition-date": ["data-tax-readiness-field", "original-acquisition-date"],
  "donation-acquisition-value": ["data-tax-readiness-field", "donation-value"],
  "donation-date-correction": ["data-tax-readiness-field", "donation-date"],
  "causa-mortis-acquisition-value": ["data-tax-readiness-field", "causa-mortis-value"],
};

export function taxReadinessIssueControl(target, issue = {}) {
  if (!target) return null;
  const field = issue.targetField
    ? ["data-tax-readiness-field", issue.targetField]
    : issue.code === "operative-will"
      ? ["data-tax-readiness-field", issue.targetId ? "will-date" : "add-will"]
      : issueFieldByCode[issue.code];
  const matchingControls = field
    ? [
        ...new Set([
          ...target.querySelectorAll(`[${field[0]}="${field[1]}"]`),
          ...target.querySelectorAll(`[data-tax-readiness-aliases~="${field[1]}"]`),
        ]),
      ]
    : [];
  if (!issue.targetId) return matchingControls[0] || null;
  return (
    matchingControls.find((control) => control.dataset.taxReadinessTargetId === issue.targetId) ||
    null
  );
}

export function TaxReadinessGuideLauncher({ summary, onStart }) {
  const pendingCount = Number(summary?.pendingCount || 0);
  const skippedCount = Number(summary?.skippedCount || 0);
  const canContinue = summary?.canContinue === true;
  const active = summary?.status === "active";
  const paused = summary?.status === "paused";
  const label = active
    ? "Continue guided tax setup"
    : paused
      ? "Resume guided tax setup"
      : "Start guided tax setup";

  return (
    <section className="tax-readiness-launcher" aria-label="Guided tax setup">
      <div>
        <h3>Guided tax setup</h3>
        <p>
          Review the relevant person cards in family order. You can skip unknown details and return
          to them later.
        </p>
        <small aria-live="polite">
          {pendingCount
            ? `${pendingCount} ${pendingCount === 1 ? "person needs" : "people need"} information${
                skippedCount ? `; ${skippedCount} skipped for now` : ""
              }.`
            : skippedCount
              ? `${skippedCount} skipped ${skippedCount === 1 ? "person remains" : "people remain"}.`
              : "No missing person-card information is currently detected."}
        </small>
      </div>
      <button
        type="button"
        className="secondary-button tax-readiness-start"
        onClick={onStart}
        disabled={!pendingCount && !skippedCount && !canContinue}
      >
        {pendingCount || skippedCount ? <ClipboardCheck size={16} /> : <CheckCircle2 size={16} />}
        {label}
      </button>
    </section>
  );
}

export function TaxReadinessGuideBar({
  personId,
  personName,
  position,
  total,
  issues = [],
  canGoBack = false,
  onGoToSection,
  onBack,
  onNext,
  onSkip,
  onPause,
}) {
  const headingRef = useRef(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [personId]);

  return (
    <section className="tax-readiness-guide-bar" aria-labelledby="tax-readiness-guide-heading">
      <div className="tax-readiness-guide-copy">
        <p className="eyebrow">Guided tax setup</p>
        <h2 id="tax-readiness-guide-heading" ref={headingRef} tabIndex="-1">
          {personName}
        </h2>
        <p className="tax-readiness-progress" aria-live="polite">
          Person {position} of {total}; {issues.length} {issues.length === 1 ? "detail" : "details"}{" "}
          {issues.length === 1 ? "needs" : "need"} attention.
        </p>
        {issues.length ? (
          <ul className="tax-readiness-issues">
            {issues.map((issue) => (
              <li key={issue.key}>
                <span>{issue.prompt}</span>
                <button type="button" onClick={() => onGoToSection?.(issue)}>
                  Go to section
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="tax-readiness-complete-card">
            The currently detected requirements on this card are complete. Continue when ready.
          </p>
        )}
      </div>
      <div className="tax-readiness-guide-actions">
        <button type="button" className="secondary-button" disabled={!canGoBack} onClick={onBack}>
          <ArrowLeft size={16} /> Previous
        </button>
        {issues.length ? (
          <button type="button" className="secondary-button" onClick={onSkip}>
            <SkipForward size={16} /> Skip for now
          </button>
        ) : (
          <button type="button" className="primary-button" onClick={onNext}>
            Next card <ArrowRight size={16} />
          </button>
        )}
        <button type="button" className="text-button" onClick={onPause}>
          <Pause size={15} /> Pause guide
        </button>
      </div>
    </section>
  );
}
