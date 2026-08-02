import {
  applyLegacyArticle616ToWill,
  buildLegacyArticle616ChildBranches,
  calculateLegacyArticle616Legitim,
  classifyLegacyArticle616Date,
  compareLegacyArticle616LegitimFloors,
} from "../domain/legacyLegitim.js";
import { approximateFraction } from "../domain/ownership.js";

const money = new Intl.NumberFormat("en-MT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

function allocationRowsAreComplete(rows = []) {
  if (!Array.isArray(rows) || !rows.length) return false;
  const selectedIds = rows.map((row) => String(row?.personId || "")).filter(Boolean);
  const totalPercent = rows.reduce(
    (total, row) => total + Math.max(0, Number(row?.sharePercent) || 0),
    0,
  );
  return (
    selectedIds.length === rows.length &&
    new Set(selectedIds).size === rows.length &&
    rows.every((row) => Number(row?.sharePercent) > 0) &&
    Math.abs(totalPercent - 100) <= 1e-6
  );
}

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

function visibleStatusPeople(roots, peopleById) {
  const result = [];
  const visit = (node, depth) => {
    const person = peopleById.get(node.id);
    if (person) result.push({ node, person, depth });
    (node.children || []).forEach((child) => visit(child, depth + 1));
  };
  roots.forEach((root) => visit(root, 0));
  return result;
}

export function LegacyLegitimPanel({
  deceased,
  people,
  shareDisplay = "fraction",
  displayName,
  onUpdatePerson,
  intestacyConfirmed,
  willAllocationValid,
}) {
  if (classifyLegacyArticle616Date(deceased?.dateOfDeath).regime !== "legacy") return null;

  const childBranches = buildLegacyArticle616ChildBranches(people, deceased);
  if (!childBranches.length) return null;
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const statusPeople = visibleStatusPeople(childBranches, peopleById);
  const estate = deceased.legacyArticle616Estate || {};
  const estateAdjustmentsStarted = [
    estate.debts,
    estate.funeralExpenses,
    estate.gratuitousDispositions,
  ].some((value) => String(value ?? "").trim() !== "");
  const calculation = calculateLegacyArticle616Legitim({ childBranches, estate });
  const inheritanceBasis = deceased.inheritanceBasis || "intestacy";
  const protectedWill =
    inheritanceBasis === "will" ? applyLegacyArticle616ToWill({ people, deceased }) : null;
  const actualAllocations =
    inheritanceBasis === "will" && protectedWill?.resolved
      ? [...protectedWill.shares].map(([personId, share]) => ({ personId, share }))
      : inheritanceBasis === "will"
        ? deceased.willHeirs || []
        : deceased.intestateHeirs || [];
  const comparison = compareLegacyArticle616LegitimFloors(calculation, actualAllocations);
  const beneficiaryFloorsById = new Map(
    calculation.beneficiaryFloors.map((floor) => [floor.beneficiaryId, floor]),
  );
  const allocationIsComplete =
    inheritanceBasis === "will"
      ? willAllocationValid === true && protectedWill?.resolved === true
      : allocationRowsAreComplete(actualAllocations);
  const actualSharesFinal =
    allocationIsComplete &&
    (inheritanceBasis === "will" ||
      (intestacyConfirmed ?? deceased.intestateHeirsConfirmed === true));

  const patchStatus = (personId, patch) => {
    const current = Array.isArray(deceased.legacyArticle616Statuses)
      ? deceased.legacyArticle616Statuses
      : [];
    const existing = current.find((row) => row.personId === personId);
    const next = existing
      ? current.map((row) => (row.personId === personId ? { ...row, ...patch } : row))
      : [...current, { personId, ...patch }];
    onUpdatePerson(deceased.id, { legacyArticle616Statuses: next });
  };

  const patchEstate = (field, value) =>
    onUpdatePerson(deceased.id, {
      legacyArticle616Estate: { ...estate, [field]: value },
    });

  return (
    <section className="legacy-legitim-panel" aria-label="Old-law child legitim">
      <div className="legacy-legitim-heading">
        <div>
          <strong>Old-law child legitim</strong>
          <small>Article 616 child-branch check · deaths before 01-03-2005</small>
        </div>
        {!calculation.unresolved && (
          <b>{shareLabel(calculation.collectiveFraction.decimal, shareDisplay)} collectively</b>
        )}
      </div>

      <p className="legacy-legitim-rule">
        This is each qualifying child branch&apos;s minimum in full ownership. A larger inheritance
        satisfies and absorbs it; the minimum is never added on top.
      </p>
      <p className="legacy-legitim-advisory">
        For a complete will, these minimums are applied automatically to this property and the named
        beneficiaries receive the disposable portion. Adjust the child statuses if the whole
        estate satisfies the legitim elsewhere. Ascendant legitim and separate old-law child
        categories are not calculated here.
      </p>

      <div className="legacy-legitim-statuses">
        {statusPeople.map(({ node, person, depth }) => (
          <div
            className="legacy-legitim-status-row"
            key={person.id}
            style={{ "--legacy-depth": depth }}
          >
            <span title={displayName(person)}>{displayName(person)}</span>
            <select
              aria-label={`Old article 616 status for ${displayName(person)}`}
              value={node.article616Eligibility}
              onChange={(event) =>
                patchStatus(person.id, { article616Eligibility: event.target.value })
              }
            >
              <option value="unconfirmed">Confirm child status</option>
              <option value="qualifying">Qualifying under article 616</option>
              <option value="separate-old-law">Separate old-law child rules</option>
              <option value="excluded">Confirmed outside article 616</option>
            </select>
            <select
              aria-label={`Old legitim participation for ${displayName(person)}`}
              value={node.participation}
              onChange={(event) => patchStatus(person.id, { participation: event.target.value })}
            >
              <option value="unconfirmed">Confirm participation</option>
              <option value="participating">Participates</option>
              <option value="predeceased">Predeceased · represented</option>
              <option value="renounced">Renounced</option>
              <option value="incapable">Incapable</option>
              <option value="unworthy">Unworthy</option>
              <option value="disinherited">Disinherited</option>
            </select>
          </div>
        ))}
      </div>

      {calculation.unresolved ? (
        <div className="legacy-legitim-diagnostics">
          {calculation.diagnostics.map((message, index) => (
            <small key={`${index}-${message}`}>{message}</small>
          ))}
        </div>
      ) : (
        <>
          <div className="legacy-legitim-summary">
            <span>
              Counted child branches <b>{calculation.countedBranchCount}</b>
            </span>
            <span>
              Collective legitim{" "}
              <b>{shareLabel(calculation.collectiveFraction.decimal, shareDisplay)}</b>
            </span>
            <span>
              Normal personal floor{" "}
              <b>{shareLabel(calculation.normalPerCountedBranchFraction.decimal, shareDisplay)}</b>
            </span>
          </div>

          <div className="legacy-legitim-results">
            {(actualSharesFinal ? comparison.rows : calculation.beneficiaryFloors).map((entry) => {
              const beneficiaryId = entry.beneficiaryId;
              const person = peopleById.get(beneficiaryId);
              const calculatedFloor = beneficiaryFloorsById.get(beneficiaryId);
              const row = actualSharesFinal ? entry : null;
              return (
                <div
                  className={`legacy-legitim-result ${row?.status || "draft"}`}
                  key={beneficiaryId}
                >
                  <span>{person ? displayName(person) : "Unknown beneficiary"}</span>
                  <span>
                    Personal minimum{" "}
                    <b>
                      {shareLabel(
                        row ? row.requiredShare : calculatedFloor?.fraction?.decimal,
                        shareDisplay,
                      )}
                    </b>
                    {calculatedFloor?.amount !== null && calculatedFloor?.amount !== undefined
                      ? ` · illustrative ${money.format(calculatedFloor.amount)}`
                      : ""}
                  </span>
                  {row ? (
                    <>
                      <span>
                        Property allocation <b>{shareLabel(row.actualShare, shareDisplay)}</b>
                      </span>
                      <strong>
                        {row.status === "shortfall"
                          ? `Indicative property shortfall ${shareLabel(row.shortfall, shareDisplay)}`
                          : row.absorbed
                            ? "Covered · absorbed in larger property share"
                            : "Covered by property share"}
                      </strong>
                    </>
                  ) : (
                    <strong>Complete and confirm the inheritance allocation to compare</strong>
                  )}
                </div>
              );
            })}
          </div>
          {!actualSharesFinal && (
            <small className="legacy-legitim-draft-note">
              No satisfaction result is shown until every beneficiary is selected and the shares
              total 100%{inheritanceBasis === "intestacy" ? " and are confirmed" : ""}.
            </small>
          )}
        </>
      )}

      <details className="legacy-legitim-estate">
        <summary>Optional adjusted-estate value</summary>
        <div>
          <label>
            <span>Gross estate</span>
            <input
              aria-label="Old-law gross estate"
              type="number"
              min="0"
              step="any"
              value={estate.grossEstate ?? ""}
              onChange={(event) => patchEstate("grossEstate", event.target.value)}
            />
          </label>
          <label>
            <span>Estate debts</span>
            <input
              aria-label="Old-law estate debts"
              type="number"
              min="0"
              step="any"
              value={estate.debts ?? ""}
              onChange={(event) => patchEstate("debts", event.target.value)}
            />
          </label>
          <label>
            <span>Funeral expenses</span>
            <input
              aria-label="Old-law funeral expenses"
              type="number"
              min="0"
              step="any"
              value={estate.funeralExpenses ?? ""}
              onChange={(event) => patchEstate("funeralExpenses", event.target.value)}
            />
          </label>
          <label>
            <span>Included gifts</span>
            <input
              aria-label="Old-law included gratuitous dispositions"
              type="number"
              min="0"
              step="any"
              value={estate.gratuitousDispositions ?? ""}
              onChange={(event) => patchEstate("gratuitousDispositions", event.target.value)}
            />
          </label>
        </div>
        {!calculation.estateBase.amountProvided && estateAdjustmentsStarted && (
          <small className="legacy-legitim-estate-warning">
            Enter the gross estate before an illustrative amount can be calculated.
          </small>
        )}
        {calculation.estateBase.deductionsExceedAssets && (
          <small className="legacy-legitim-estate-warning">
            Debts and funeral expenses exceed the entered assets and included gifts. Check the
            figures.
          </small>
        )}
        {calculation.estateBase.amountProvided && (
          <>
            <p>
              Illustrative adjusted estate{" "}
              <b>{money.format(calculation.estateBase.adjustedEstate)}</b>
            </p>
            <small>
              Enter the complete estate and obtain legal confirmation before treating these amounts
              as satisfied or payable.
            </small>
          </>
        )}
      </details>
    </section>
  );
}
