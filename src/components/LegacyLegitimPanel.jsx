import {
  applyLegacyArticle616ToWill,
  buildLegacyArticle616ChildBranches,
  classifyLegacyArticle616Date,
} from "../domain/legacyLegitim.js";
import { approximateFraction } from "../domain/ownership.js";

function shareLabel(share = 0, mode = "fraction") {
  const value = Math.max(0, Number(share) || 0);
  const fraction = approximateFraction(value);
  const fractionText = `${fraction.numerator}/${fraction.denominator}`;
  const percentageText = `${(value * 100).toLocaleString("en-MT", {
    maximumFractionDigits: 4,
  })}%`;
  if (mode === "percentage") return percentageText;
  if (mode === "both") return `${fractionText} · ${percentageText}`;
  return fractionText;
}

function visibleBranchPeople(branches, peopleById) {
  const rows = [];
  const visit = (branch, depth) => {
    const person = peopleById.get(branch.id);
    if (person) rows.push({ branch, person, depth });
    (branch.children || []).forEach((child) => visit(child, depth + 1));
  };
  branches.forEach((branch) => visit(branch, 0));
  return rows;
}

function exceptionValue(branch) {
  if (branch.article616Eligibility === "separate-old-law") return "separate-old-law";
  if (branch.article616Eligibility === "excluded") return "excluded";
  if (branch.participation === "renounced") return "renounced";
  return "automatic";
}

export function LegacyLegitimPanel({
  deceased,
  people,
  shareDisplay = "fraction",
  displayName,
  onUpdatePerson,
}) {
  if (
    classifyLegacyArticle616Date(deceased?.dateOfDeath).regime !== "legacy" ||
    (deceased.inheritanceBasis || "intestacy") !== "will"
  ) {
    return null;
  }

  const branches = buildLegacyArticle616ChildBranches(people, deceased);
  if (!branches.length) return null;

  const protection = applyLegacyArticle616ToWill({ people, deceased });
  const calculation = protection.calculation;
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const exceptionRows = visibleBranchPeople(branches, peopleById);

  const setException = (personId, value) => {
    const current = Array.isArray(deceased.legacyArticle616Statuses)
      ? deceased.legacyArticle616Statuses
      : [];
    const remaining = current.filter((row) => row.personId !== personId);
    const exception =
      value === "renounced"
        ? { personId, article616Eligibility: "qualifying", participation: "renounced" }
        : value === "separate-old-law"
          ? { personId, article616Eligibility: "separate-old-law" }
          : value === "excluded"
            ? { personId, article616Eligibility: "excluded" }
            : null;
    onUpdatePerson(deceased.id, {
      legacyArticle616Statuses: exception ? [...remaining, exception] : remaining,
    });
  };

  return (
    <section className="legacy-legitim-panel" aria-label="Old-law child legitim">
      <div className="legacy-legitim-heading">
        <div>
          <strong>Children&apos;s legitim</strong>
          <small>Automatically applied for a death before 01-03-2005</small>
        </div>
        {calculation && !calculation.unresolved && (
          <b>{shareLabel(calculation.collectiveFraction.decimal, shareDisplay)} collectively</b>
        )}
      </div>

      <p className="legacy-legitim-rule">
        Every recorded child is assumed eligible and worthy. If a child died before the testator,
        that child&apos;s will is ignored and their descendants take the branch by representation.
      </p>

      {calculation && !calculation.unresolved && (
        <div className="legacy-legitim-results">
          {calculation.beneficiaryFloors.map((floor) => {
            const person = peopleById.get(floor.beneficiaryId);
            return (
              <div className="legacy-legitim-result" key={floor.beneficiaryId}>
                <span>{person ? displayName(person) : "Unknown descendant"}</span>
                <span>
                  Personal legitim <b>{shareLabel(floor.fraction.decimal, shareDisplay)}</b>
                </span>
                {protection.resolved && (
                  <span>
                    Effective share{" "}
                    <b>{shareLabel(protection.shares.get(floor.beneficiaryId), shareDisplay)}</b>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {protection.warnings.length > 0 && !protection.adjusted && (
        <div className="legacy-legitim-diagnostics">
          {protection.warnings.map((warning) => (
            <small key={warning}>{warning}</small>
          ))}
        </div>
      )}

      <details className="legacy-legitim-exceptions">
        <summary>Change an exceptional child status</summary>
        <div className="legacy-legitim-statuses">
          {exceptionRows.map(({ branch, person, depth }) => (
            <label
              className="legacy-legitim-status-row"
              key={person.id}
              style={{ "--legacy-depth": depth }}
            >
              <span title={displayName(person)}>{displayName(person)}</span>
              <select
                aria-label={`Old-law exception for ${displayName(person)}`}
                value={exceptionValue(branch)}
                onChange={(event) => setException(person.id, event.target.value)}
              >
                <option value="automatic">Automatic — inherits or is represented</option>
                <option value="renounced">Does not take — redistribute the legitim</option>
                <option value="separate-old-law">Apply separate old-law category</option>
                <option value="excluded">Exclude from this calculation</option>
              </select>
            </label>
          ))}
        </div>
      </details>
    </section>
  );
}
