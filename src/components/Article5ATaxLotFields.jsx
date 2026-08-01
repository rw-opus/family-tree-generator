import {
  ARTICLE_5A_QUALIFYING_RATES,
  ARTICLE_5A_SPECIAL_TREATMENTS,
  INHERITANCE_CAUSA_MORTIS_CUTOFF,
} from "../domain/article5A.js";
import { isoDateToDisplay } from "../domain/dateFormat.js";
import { DateInput } from "./DateInput.jsx";

const isHousingRate = (value) => String(value || "").startsWith("housing-");

export function Article5ATaxLotFields({
  lot,
  effectiveLot,
  useDeclarationValues,
  declaredCoverage,
  inheritanceSources = [],
  selectedInheritanceSource = null,
  inheritanceDateInferred = false,
  onChange,
}) {
  const acquisitionType = lot.acquisitionType || "inheritance";
  const change = (patch) => onChange({ ...patch, selectedTaxMethod: "" });
  const dateField = acquisitionType === "inheritance" ? "inheritanceDate" : "acquisitionDate";
  const acquisitionDate = effectiveLot[dateField] || lot[dateField] || "";
  const preCausaMortisCutoff =
    acquisitionType === "inheritance" &&
    Boolean(acquisitionDate) &&
    acquisitionDate < INHERITANCE_CAUSA_MORTIS_CUTOFF;

  return (
    <>
      <label>
        Acquisition type
        <select
          aria-label="Acquisition type"
          value={acquisitionType}
          onChange={(event) =>
            change({
              acquisitionType: event.target.value,
              useDeclaredValues: event.target.value === "inheritance",
            })
          }
        >
          <option value="inheritance">Inheritance (causa mortis)</option>
          <option value="purchase">Purchase or other inter vivos acquisition</option>
          <option value="donation">Donation</option>
        </select>
      </label>
      {acquisitionType === "inheritance" && inheritanceSources.length > 0 && (
        <label>
          Inherited from
          <select
            aria-label="Inherited from deceased owner"
            value={
              lot.inheritanceSourceDeceasedId ||
              (inheritanceSources.length === 1
                ? selectedInheritanceSource?.deceasedId || ""
                : "manual")
            }
            onChange={(event) => {
              const source = inheritanceSources.find(
                (candidate) => candidate.deceasedId === event.target.value,
              );
              change({
                inheritanceSourceDeceasedId: source ? source.deceasedId : "manual",
                inheritanceDate: source?.inheritanceDate || lot.inheritanceDate || "",
                useDeclaredValues: source?.preCausaMortisCutoff ? false : lot.useDeclaredValues,
              });
            }}
          >
            {inheritanceSources.length > 1 && <option value="manual">Enter date manually</option>}
            {inheritanceSources.map((source) => (
              <option key={source.deceasedId} value={source.deceasedId}>
                {source.deceasedName}
                {source.inheritanceDate
                  ? ` · ${isoDateToDisplay(source.inheritanceDate)}`
                  : " · death date missing"}
                {source.preCausaMortisCutoff ? " · 7% treatment" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Transfer or intended deed date
        <DateInput
          value={lot.transferDate || ""}
          onChange={(value) => change({ transferDate: value })}
        />
      </label>
      <label>
        {acquisitionType === "inheritance" ? "Inheritance date" : "Acquisition date"}
        <DateInput
          value={acquisitionDate}
          disabled={inheritanceDateInferred}
          onChange={(value) => change({ [dateField]: value })}
        />
      </label>
      {preCausaMortisCutoff && (
        <p className="tax-lot-source full-width">
          No Declaration Causa Mortis or declared CM value applies. This inherited fraction is taxed
          at 7% of its transfer value under Article 5A(5)(c)(i).
        </p>
      )}
      {acquisitionType === "donation" && (
        <label>
          Donor&apos;s preceding acquisition date
          <DateInput
            value={lot.previousAcquisitionDate || ""}
            onChange={(value) => change({ previousAcquisitionDate: value })}
          />
        </label>
      )}
      <label>
        Fraction covered by this lot
        <span className="tax-lot-fraction">
          <input
            aria-label="Tax lot share numerator"
            type="number"
            min="0"
            step="1"
            disabled={acquisitionType === "inheritance" && useDeclarationValues}
            value={effectiveLot.shareNumerator ?? 0}
            onChange={(event) =>
              change({
                shareNumerator: event.target.value,
                useDeclaredValues: false,
              })
            }
          />
          <b>/</b>
          <input
            aria-label="Tax lot share denominator"
            type="number"
            min="1"
            step="1"
            disabled={acquisitionType === "inheritance" && useDeclarationValues}
            value={effectiveLot.shareDenominator ?? 1}
            onChange={(event) =>
              change({
                shareDenominator: event.target.value,
                useDeclaredValues: false,
              })
            }
          />
        </span>
      </label>
      {!preCausaMortisCutoff && (
        <label>
          {acquisitionType === "inheritance"
            ? "Causa mortis value for this fraction (€)"
            : "Acquisition value for this fraction (€)"}
          <input
            type="number"
            min="0"
            disabled={acquisitionType === "inheritance" && useDeclarationValues}
            value={effectiveLot.acquisitionValue ?? ""}
            onChange={(event) =>
              change({
                acquisitionValue: event.target.value,
                useDeclaredValues: false,
              })
            }
          />
        </label>
      )}
      {acquisitionType === "inheritance" && !preCausaMortisCutoff && (
        <label>
          Legal basis of acquisition value
          <select
            value={lot.acquisitionValueBasis || (useDeclarationValues ? "cm-declared" : "")}
            onChange={(event) => change({ acquisitionValueBasis: event.target.value })}
          >
            <option value="">Choose basis</option>
            <option value="cm-declared">Eligible causa mortis declaration value</option>
            <option value="market-at-inheritance">Market value at inheritance</option>
            <option value="final-assessment">Final and conclusive duty assessment</option>
          </select>
        </label>
      )}
      {acquisitionType === "inheritance" &&
        !preCausaMortisCutoff &&
        (lot.acquisitionValueBasis === "cm-declared" ||
          (!lot.acquisitionValueBasis && useDeclarationValues)) && (
          <label className="check-label">
            <input
              type="checkbox"
              checked={Boolean(lot.cmValueEligibilityConfirmed)}
              onChange={(event) => change({ cmValueEligibilityConfirmed: event.target.checked })}
            />
            CM timing and notice conditions for this value are confirmed
          </label>
        )}
      <label>
        Consideration for this fraction (€)
        <input
          type="number"
          min="0"
          value={
            lot.consideration === undefined || lot.consideration === ""
              ? lot.transferValue || ""
              : lot.consideration
          }
          onChange={(event) => change({ consideration: event.target.value })}
        />
      </label>
      <label>
        Market value of this fraction (€)
        <input
          type="number"
          min="0"
          value={lot.marketValue || ""}
          onChange={(event) => change({ marketValue: event.target.value })}
        />
      </label>
      {acquisitionType === "inheritance" && !preCausaMortisCutoff && (
        <label className="check-label full-width">
          <input
            type="checkbox"
            disabled={!declaredCoverage?.hasUsableDeclaredValues}
            checked={useDeclarationValues}
            onChange={(event) => change({ useDeclaredValues: event.target.checked })}
          />
          Use the accumulated value and fraction from the CM declarations
        </label>
      )}

      <details className="article5a-facts full-width">
        <summary>Article 5A conditions, special rates and exemptions</summary>
        <div className="article5a-facts-grid">
          <label className="check-label">
            <input
              type="checkbox"
              checked={Boolean(lot.isJudicialSale)}
              onChange={(event) => change({ isJudicialSale: event.target.checked })}
            />
            Transfer by judicial sale by auction
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={Boolean(lot.isProject)}
              onChange={(event) => change({ isProject: event.target.checked })}
            />
            Property forms part of a project
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={Boolean(lot.qualifiesFiveYearRate)}
              onChange={(event) =>
                change({
                  qualifiesFiveYearRate: event.target.checked,
                  qualifyingRate: event.target.checked ? "" : lot.qualifyingRate,
                })
              }
            />
            Apply 5% five-year conditions
          </label>
          {lot.qualifiesFiveYearRate && (
            <>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={Boolean(lot.relatedProjectWithinFiveYears)}
                  onChange={(event) =>
                    change({ relatedProjectWithinFiveYears: event.target.checked })
                  }
                />
                Related person held it as project property
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={Boolean(lot.developmentPermitWorks)}
                  onChange={(event) => change({ developmentPermitWorks: event.target.checked })}
                />
                Development-permit works were carried out
              </label>
            </>
          )}
          <label>
            Special qualifying rate
            <select
              value={lot.qualifyingRate || ""}
              onChange={(event) =>
                change({
                  qualifyingRate: event.target.value,
                  qualifiesFiveYearRate: event.target.value ? false : lot.qualifiesFiveYearRate,
                })
              }
            >
              {ARTICLE_5A_QUALIFYING_RATES.map((item) => (
                <option key={item.key || "none"} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {(lot.qualifyingRate === "sole-residence-2" ||
            (lot.qualifiesFiveYearRate && lot.developmentPermitWorks)) && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={Boolean(lot.acquiredForSoleResidence)}
                onChange={(event) => change({ acquiredForSoleResidence: event.target.checked })}
              />
              Sole-residence purpose declared in acquisition deed
            </label>
          )}
          {lot.qualifyingRate === "sole-residence-2" && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={Boolean(lot.ownsOtherResidentialProperty)}
                onChange={(event) => change({ ownsOtherResidentialProperty: event.target.checked })}
              />
              Transferor owns another residential property
            </label>
          )}
          {lot.qualifyingRate === "uca-5" && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={Boolean(lot.ucaCertificateConfirmed)}
                onChange={(event) => change({ ucaCertificateConfirmed: event.target.checked })}
              />
              Prescribed completion certificate confirmed
            </label>
          )}
          {isHousingRate(lot.qualifyingRate) && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={Boolean(lot.housingCertificateConfirmed)}
                onChange={(event) => change({ housingCertificateConfirmed: event.target.checked })}
              />
              Housing Authority benefit certificate confirmed
            </label>
          )}
          {acquisitionDate && acquisitionDate < "2004-01-01" && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={Boolean(lot.promiseNoticeBefore2014)}
                onChange={(event) => change({ promiseNoticeBefore2014: event.target.checked })}
              />
              Promise-of-sale notice given before 17 November 2014
            </label>
          )}
          <label className="full-width">
            Exemption or outside-Article-5A treatment
            <select
              value={lot.article5ASpecialTreatment || ""}
              onChange={(event) =>
                change({
                  article5ASpecialTreatment: event.target.value,
                  specialTreatmentConfirmed: false,
                })
              }
            >
              {ARTICLE_5A_SPECIAL_TREATMENTS.map((item) => (
                <option key={item.key || "none"} value={item.key}>
                  {item.label}
                  {item.rule ? ` — ${item.rule}` : ""}
                </option>
              ))}
            </select>
          </label>
          {lot.article5ASpecialTreatment && (
            <label className="check-label full-width">
              <input
                type="checkbox"
                checked={Boolean(lot.specialTreatmentConfirmed)}
                onChange={(event) => change({ specialTreatmentConfirmed: event.target.checked })}
              />
              I confirm that the statutory facts and deed requirements have been checked
            </label>
          )}
        </div>
      </details>
    </>
  );
}
