import { Building2, FolderPlus, UserRound } from "lucide-react";
import { approximateFraction } from "../domain/ownership.js";

const percentage = (share) =>
  `${((Number(share) || 0) * 100).toLocaleString("en-MT", {
    maximumFractionDigits: 2,
  })}%`;

export function ExternalOwnerDirectory({ outsideParties, currentOwners, onCreateFamilyTree }) {
  const ownersById = new Map(currentOwners.map((owner) => [owner.id, owner]));

  return (
    <section className="case-workspace-section external-owner-directory">
      <div className="case-workspace-heading">
        <div>
          <p className="eyebrow">Separate ownership parties</p>
          <h2>External individuals and companies</h2>
        </div>
      </div>
      <p className="helper-text">
        These records can own property without being inserted into a genealogical family tree. An
        individual can later become the root of a separate family-tree tab.
      </p>
      {outsideParties.length ? (
        <div className="external-owner-grid">
          {outsideParties.map((party) => {
            const owner = ownersById.get(party.id);
            const share = owner?.share || 0;
            const fraction = approximateFraction(share);
            const isCompany = party.type === "company";

            return (
              <article
                className={`external-owner-card ${isCompany ? "company" : "individual"}`}
                key={party.id}
              >
                <span className="external-owner-icon">
                  {isCompany ? <Building2 size={20} /> : <UserRound size={20} />}
                </span>
                <span className="external-owner-identity">
                  <strong>
                    {party.name || (isCompany ? "Unnamed company" : "Unnamed individual")}
                  </strong>
                  <small>
                    {isCompany
                      ? party.registrationNumber || "Company number not entered"
                      : "External individual"}
                  </small>
                </span>
                <span className="external-owner-share">
                  <strong>
                    {fraction.numerator}/{fraction.denominator}
                  </strong>
                  <small>
                    {owner ? `${percentage(share)} current ownership` : "No current holding"}
                  </small>
                </span>
                {!isCompany && (
                  <button
                    type="button"
                    className="secondary-button compact"
                    onClick={() => onCreateFamilyTree(party)}
                  >
                    <FolderPlus size={15} /> Create family tree
                  </button>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="empty-workspace-message">
          No separate individuals or companies have been added to this property case.
        </p>
      )}
    </section>
  );
}
