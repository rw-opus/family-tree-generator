import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Baby,
  Check,
  FilePlus2,
  FileUp,
  Heart,
  Pencil,
  Search,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import {
  composeFullName,
  createPerson,
  hasDesignation,
  personDescendants,
  personDisplayName,
  personGivenNames,
  personIdentityIssues,
  personRelationshipCounts,
  personSurname,
  personDesignations,
} from "../domain/people.js";
import { parseGedcom } from "../domain/gedcom.js";
import {
  intestateAllocations,
  isPersonDeceased,
} from "../domain/familyOwnership.js";
import { approximateFraction } from "../domain/ownership.js";
import {
  fractionForShare,
  shareFromFraction,
  shareFromPercentage,
} from "../domain/shares.js";

const relationshipActions = [
  { key: "father", label: "Father", icon: UserRound },
  { key: "mother", label: "Mother", icon: UserRound },
  { key: "spouse", label: "Partner", icon: Heart },
  { key: "child", label: "Child", icon: Baby },
  { key: "sibling", label: "Brother / sister", icon: UsersRound },
];

function initials(name) {
  const value = String(name || "").trim();
  if (!value) return "?";
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function ownershipLabel(share = 0, shareDisplay = "both") {
  if (share === 0) return "0%";
  const fraction = approximateFraction(share);
  const fractionText = `${fraction.numerator}/${fraction.denominator}`;
  const percentageText = `${(share * 100).toLocaleString("en-MT", {
    maximumFractionDigits: 4,
  })}%`;
  if (shareDisplay === "fraction") return fractionText;
  if (shareDisplay === "percentage") return percentageText;
  return `${fractionText} · ${percentageText}`;
}

function fractionLabel(share = 0) {
  const fraction = approximateFraction(Math.max(0, share));
  return `${fraction.numerator}/${fraction.denominator}`;
}

export function PersonInspector({
  people,
  properties = [],
  ownershipByPerson = {},
  causaMortisCoverage = [],
  selectedPersonId,
  shareDisplay = "both",
  caseDependencyLabels = [],
  onChange,
  onSelectPerson,
}) {
  const [query, setQuery] = useState("");
  const [importMode, setImportMode] = useState("replace");
  const [importStatus, setImportStatus] = useState("");
  const [spouseChooserOpen, setSpouseChooserOpen] = useState(false);
  const [existingSpouseId, setExistingSpouseId] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const selectedPerson = people.find((person) => person.id === selectedPersonId) || people[0];
  const previousSelectedPersonIdRef = useRef("");
  const displayName = useCallback(
    (person) => personDisplayName(person, people),
    [people],
  );
  const peopleById = useMemo(
    () => new Map(people.map((person) => [person.id, person])),
    [people],
  );
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return people.slice(0, 8);
    return people
      .filter((person) => {
        const father = peopleById.get(person.fatherId)?.fullName || "";
        const mother = peopleById.get(person.motherId)?.fullName || "";
        return `${displayName(person)} ${father} ${mother}`.toLowerCase().includes(needle);
      })
      .slice(0, 12);
  }, [displayName, people, peopleById, query]);

  useEffect(() => {
    const nextPersonId = selectedPerson?.id || "";
    if (previousSelectedPersonIdRef.current === nextPersonId) return;
    previousSelectedPersonIdRef.current = nextPersonId;
    setSpouseChooserOpen(false);
    setExistingSpouseId("");
    setIsEditing(
      Boolean(selectedPerson && personIdentityIssues(selectedPerson).length),
    );
  }, [selectedPerson]);

  const updateSelected = (patch) => {
    if (!selectedPerson) return;
    onChange(
      people.map((person) =>
        person.id === selectedPerson.id ? { ...person, ...patch } : person,
      ),
    );
  };

  const updateGivenNames = (givenNames) => {
    updateSelected({
      givenNames,
      fullName: composeFullName(givenNames, personSurname(selectedPerson)),
    });
  };

  const updateSurname = (surname) => {
    const previousSurname = personSurname(selectedPerson);
    const patch = {
      surname,
      fullName: composeFullName(personGivenNames(selectedPerson), surname),
    };
    if (
      selectedPerson.sex === "Male" &&
      (!selectedPerson.surnameAtBirth ||
        selectedPerson.surnameAtBirth === previousSurname)
    ) {
      patch.surnameAtBirth = surname;
    }
    updateSelected(patch);
  };

  const updateSex = (sex) => {
    const patch = { sex };
    if (sex === "Male" && !selectedPerson.surnameAtBirth) {
      patch.surnameAtBirth = personSurname(selectedPerson);
    }
    updateSelected(patch);
  };

  const updateWillHeir = (heirId, patch) => {
    updateSelected({
      willHeirs: (selectedPerson.willHeirs || []).map((heir) =>
        heir.id === heirId ? { ...heir, ...patch } : heir,
      ),
    });
  };

  const updateWillHeirPercentage = (heirId, percentage) => {
    updateWillHeir(heirId, shareFromPercentage(percentage));
  };

  const updateWillHeirFraction = (heir, patch) => {
    const current = fractionForShare(heir);
    updateWillHeir(
      heir.id,
      shareFromFraction(
        patch.numerator ?? current.numerator,
        patch.denominator ?? current.denominator,
      ),
    );
  };

  const addWillHeir = () => {
    const hasHeirs = (selectedPerson.willHeirs || []).length > 0;
    const share = shareFromPercentage(hasHeirs ? 0 : 100);
    updateSelected({
      willHeirs: [
        ...(selectedPerson.willHeirs || []),
        {
          id: crypto.randomUUID(),
          personId: "",
          ...share,
        },
      ],
    });
  };

  const removeWillHeir = (heirId) => {
    updateSelected({
      willHeirs: (selectedPerson.willHeirs || []).filter(
        (heir) => heir.id !== heirId,
      ),
    });
  };

  const updateCausaMortisDeclaration = (declarationId, patch) => {
    updateSelected({
      causaMortisDeclarations: (
        selectedPerson.causaMortisDeclarations || []
      ).map((declaration) =>
        declaration.id === declarationId
          ? { ...declaration, ...patch }
          : declaration,
      ),
    });
  };

  const addCausaMortisDeclaration = () => {
    const coverageTarget =
      causaMortisCoverage.find((row) => row.status !== "complete") ||
      causaMortisCoverage[0];
    const propertyId =
      coverageTarget?.propertyId ||
      (properties.length === 1 ? properties[0].id : "");
    const remainingShare = coverageTarget
      ? Math.max(
          0,
          coverageTarget.requiredShare - coverageTarget.declaredShare,
        )
      : 0;
    const remainingFraction = approximateFraction(remainingShare);
    updateSelected({
      causaMortisDeclarations: [
        ...(selectedPerson.causaMortisDeclarations || []),
        {
          id: crypto.randomUUID(),
          propertyId,
          declaredShareNumerator: remainingFraction.numerator,
          declaredShareDenominator: remainingFraction.denominator,
          date: "",
          notaryName: "",
          immovablePropertyValue: "",
          declarantPersonIds: declarationCandidates
            .filter((person) =>
              descendantIds.has(person.id),
            )
            .map((person) => person.id),
        },
      ],
    });
  };

  const removeCausaMortisDeclaration = (declarationId) => {
    updateSelected({
      causaMortisDeclarations: (
        selectedPerson.causaMortisDeclarations || []
      ).filter((declaration) => declaration.id !== declarationId),
    });
  };

  const toggleCausaMortisDeclarant = (declaration, personId) => {
    const current = new Set(declaration.declarantPersonIds || []);
    if (current.has(personId)) current.delete(personId);
    else current.add(personId);
    updateCausaMortisDeclaration(declaration.id, {
      declarantPersonIds: [...current],
    });
  };

  const setDeceased = (checked) => {
    const current = personDesignations(selectedPerson).filter(
      (designation) => designation !== "Deceased",
    );
    updateSelected({
      designations: checked ? ["Deceased", ...current] : current,
      isDeceased: checked,
      dateOfDeath: checked ? selectedPerson.dateOfDeath || "" : "",
    });
  };

  const addRelative = (kind) => {
    if (!selectedPerson || personIdentityIssues(selectedPerson).length) return;
    const counts = personRelationshipCounts(people, selectedPerson);
    if ((kind === "father" && counts.father) || (kind === "mother" && counts.mother)) {
      return;
    }
    const relative = createPerson();
    let selectedPatch = {};

    if (kind === "father") {
      Object.assign(relative, { sex: "Male", designations: ["Parent"] });
      selectedPatch = {
        fatherId: relative.id,
        fatherExplicitlyUnassigned: false,
      };
    }
    if (kind === "mother") {
      Object.assign(relative, { sex: "Female", designations: ["Parent"] });
      selectedPatch = {
        motherId: relative.id,
        motherExplicitlyUnassigned: false,
      };
    }
    if (kind === "spouse") {
      Object.assign(relative, {
        designations: [hasDesignation(selectedPerson, "Deceased") ? "Surviving Spouse" : "Partner"],
        spouseIds: [selectedPerson.id],
      });
      selectedPatch = {
        spouseIds: [...new Set([...(selectedPerson.spouseIds || []), relative.id])],
      };
    }
    if (kind === "child") {
      Object.assign(relative, { designations: ["Child"] });
      if (selectedPerson.sex === "Female") relative.motherId = selectedPerson.id;
      else relative.fatherId = selectedPerson.id;
    }
    if (kind === "sibling") {
      Object.assign(relative, {
        designations: ["Sibling"],
        fatherId: selectedPerson.fatherId || "",
        motherId: selectedPerson.motherId || "",
        siblingIds: [selectedPerson.id],
      });
      selectedPatch = {
        siblingIds: [...new Set([...(selectedPerson.siblingIds || []), relative.id])],
      };
    }

    const updatedPeople = people.map((person) => {
      if (person.id === selectedPerson.id) {
        return { ...person, ...selectedPatch };
      }
      if (kind !== "spouse") return person;
      if (
        person.fatherId === selectedPerson.id &&
        !person.motherId &&
        !person.motherExplicitlyUnassigned
      ) {
        return { ...person, motherId: relative.id };
      }
      if (
        person.motherId === selectedPerson.id &&
        !person.fatherId &&
        !person.fatherExplicitlyUnassigned
      ) {
        return { ...person, fatherId: relative.id };
      }
      return person;
    });
    onChange([...updatedPeople, relative]);
  };

  const linkExistingSpouse = () => {
    if (!selectedPerson || !existingSpouseId || existingSpouseId === selectedPerson.id) {
      return;
    }
    const existingPerson = people.find((person) => person.id === existingSpouseId);
    if (!existingPerson) return;
    onChange(
      people.map((person) => {
        if (person.id === selectedPerson.id) {
          return {
            ...person,
            spouseIds: [...new Set([...(person.spouseIds || []), existingPerson.id])],
          };
        }
        if (person.id === existingPerson.id) {
          return {
            ...person,
            spouseIds: [...new Set([...(person.spouseIds || []), selectedPerson.id])],
          };
        }
        if (
          person.fatherId === selectedPerson.id &&
          !person.motherId &&
          !person.motherExplicitlyUnassigned
        ) {
          return { ...person, motherId: existingPerson.id };
        }
        if (
          person.motherId === selectedPerson.id &&
          !person.fatherId &&
          !person.fatherExplicitlyUnassigned
        ) {
          return { ...person, fatherId: existingPerson.id };
        }
        return person;
      }),
    );
    setExistingSpouseId("");
    setSpouseChooserOpen(false);
  };

  const removeSelected = () => {
    if (!selectedPerson || people.length === 1 || deleteBlockers.length) return;
    const confirmed = window.confirm(
      `Are you sure you want to delete ${displayName(selectedPerson)} from the family tree? This cannot be undone.`,
    );
    if (!confirmed) return;
    onChange(
      people
        .filter((person) => person.id !== selectedPerson.id)
        .map((person) => ({
          ...person,
          fatherId: person.fatherId === selectedPerson.id ? "" : person.fatherId,
          motherId: person.motherId === selectedPerson.id ? "" : person.motherId,
          spouseIds: (person.spouseIds || []).filter((id) => id !== selectedPerson.id),
          siblingIds: (person.siblingIds || []).filter((id) => id !== selectedPerson.id),
        })),
    );
    onSelectPerson(people.find((person) => person.id !== selectedPerson.id)?.id || "");
  };

  const removePartnerLink = (partnerId) => {
    if (!selectedPerson || !partnerId) return;
    onChange(
      people.map((person) => {
        if (person.id === selectedPerson.id) {
          return {
            ...person,
            spouseIds: (person.spouseIds || []).filter(
              (id) => id !== partnerId,
            ),
          };
        }
        if (person.id === partnerId) {
          return {
            ...person,
            spouseIds: (person.spouseIds || []).filter(
              (id) => id !== selectedPerson.id,
            ),
          };
        }
        return person;
      }),
    );
  };

  const importGedcom = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const result = parseGedcom(await file.text());
      if (!result.people.length) throw new Error("No individual records were found.");
      const nextPeople = importMode === "replace" ? result.people : [...people, ...result.people];
      onChange(nextPeople);
      onSelectPerson(nextPeople[0]?.id || "");
      setImportStatus(
        `Imported ${result.individualCount} people and ${result.familyCount} families.`,
      );
    } catch (error) {
      setImportStatus(`Could not import GEDCOM: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  };

  if (!selectedPerson) {
    return (
      <div className="inspector-empty">
        <UsersRound size={30} />
        <h2>Start the family tree</h2>
        <p>Add a person or import a GEDCOM file.</p>
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            const person = createPerson();
            onChange([person]);
            onSelectPerson(person.id);
          }}
        >
          Add first person
        </button>
      </div>
    );
  }

  const hasOwnership = Object.prototype.hasOwnProperty.call(
    ownershipByPerson,
    selectedPerson.id,
  );
  const ownership = hasOwnership ? ownershipByPerson[selectedPerson.id] : 0;
  const isDeceased =
    Boolean(selectedPerson.isDeceased) || hasDesignation(selectedPerson, "Deceased");
  const identityIssues = personIdentityIssues(selectedPerson);
  const identityComplete = identityIssues.length === 0;
  const identityMessage = identityComplete
    ? ""
    : `Complete ${identityIssues.join(
        identityIssues.length > 1 ? ", " : "",
      )} before adding relatives.`;
  const selectedDisplayName = displayName(selectedPerson);
  const inheritanceBasis = selectedPerson.inheritanceBasis || "intestacy";
  const willHeirs = selectedPerson.willHeirs || [];
  const willTotal = willHeirs.reduce(
    (total, heir) => total + (Number(heir.sharePercent) || 0),
    0,
  );
  const automaticIntestacy =
    isDeceased && inheritanceBasis === "intestacy"
      ? intestateAllocations(people, selectedPerson.id)
      : null;
  const successionHeirIds =
    inheritanceBasis === "will"
      ? willHeirs.map((heir) => heir.personId).filter(Boolean)
      : [...(automaticIntestacy?.shares.keys() || [])];
  const successionHeirs = successionHeirIds
    .map((personId) => peopleById.get(personId))
    .filter(Boolean);
  const allSuccessionHeirsDeceased =
    successionHeirs.length > 0 &&
    successionHeirs.every((person) => isPersonDeceased(person));
  const descendants = personDescendants(people, selectedPerson.id);
  const descendantIds = new Set(descendants.map((person) => person.id));
  const declarationCandidateIds = new Set([
    ...descendantIds,
    ...successionHeirIds,
  ]);
  const declarationCandidates = people.filter((person) =>
    declarationCandidateIds.has(person.id),
  );
  const parentCandidates = people.filter(
    (person) =>
      person.id !== selectedPerson.id && !descendantIds.has(person.id),
  );
  const causaMortisDeclarations =
    selectedPerson.causaMortisDeclarations || [];
  const requiresCausaMortisDetails =
    Boolean(selectedPerson.dateOfDeath) &&
    selectedPerson.dateOfDeath > "1992-11-25";
  const displayedSurnameAtBirth =
    selectedPerson.surnameAtBirth ||
    (selectedPerson.sex === "Male" ? personSurname(selectedPerson) : "");
  const displayedGivenNames = personGivenNames(selectedPerson);
  const displayedSurname = personSurname(selectedPerson);
  const relationshipCounts = personRelationshipCounts(people, selectedPerson);
  const linkedSpouseIds = new Set([
    ...(selectedPerson.spouseIds || []),
    ...people
      .filter((person) => (person.spouseIds || []).includes(selectedPerson.id))
      .map((person) => person.id),
  ]);
  const linkedPartners = [...linkedSpouseIds]
    .map((personId) => peopleById.get(personId))
    .filter(Boolean);
  const existingSpouseCandidates = people.filter(
    (person) =>
      person.id !== selectedPerson.id &&
      !linkedSpouseIds.has(person.id),
  );
  const deleteBlockers = [
    ...(linkedPartners.length
      ? [
          `${linkedPartners.length} ${
            linkedPartners.length === 1 ? "partner link" : "partner links"
          }`,
        ]
      : []),
    ...(descendants.length
      ? [
          `${descendants.length} ${
            descendants.length === 1 ? "descendant" : "descendants"
          }`,
        ]
      : []),
    ...(hasOwnership && ownership > 1e-10
      ? ["the person's property ownership"]
      : []),
    ...caseDependencyLabels,
  ];
  const deleteDisabled = people.length === 1 || deleteBlockers.length > 0;
  const deleteMessage =
    people.length === 1
      ? "A tree must contain at least one person."
      : deleteBlockers.length
        ? `Remove ${deleteBlockers.join(" and ")} first.`
        : "No partner or descendant dependencies. Confirmation is required.";

  return (
    <div className="person-inspector">
      <section className="inspector-profile">
        <div className={`person-avatar ${selectedPerson.sex?.toLowerCase() || "unknown"}`}>
          {initials(selectedDisplayName)}
        </div>
        <div>
          <p className="eyebrow">Selected person</p>
          <h2>{selectedDisplayName}</h2>
          {hasOwnership && <span>{ownershipLabel(ownership, shareDisplay)} ownership</span>}
        </div>
        <button
          type="button"
          className={`person-edit-button ${isEditing ? "active" : ""}`}
          aria-pressed={isEditing}
          onClick={() => setIsEditing((editing) => !editing)}
        >
          {isEditing ? <Check size={15} /> : <Pencil size={15} />}
          {isEditing ? "Done" : "Edit"}
        </button>
      </section>

      <section className="inspector-section">
        <div className="inspector-section-heading">
          <div>
            <p className="eyebrow">Relationships</p>
            <h3>Add around this person</h3>
          </div>
        </div>
        <div className="relationship-actions">
          {relationshipActions.map(({ key, label, icon: Icon }) => (
            <button
              type="button"
              key={key}
              disabled={
                !identityComplete ||
                ((key === "father" || key === "mother") &&
                  relationshipCounts[key] > 0)
              }
              title={
                !identityComplete
                  ? identityMessage
                  : (key === "father" || key === "mother") &&
                      relationshipCounts[key] > 0
                  ? `${label} already added`
                  : `Add ${label.toLowerCase()}`
              }
              aria-expanded={key === "spouse" ? spouseChooserOpen : undefined}
              onClick={() =>
                key === "spouse"
                  ? setSpouseChooserOpen((open) => !open)
                  : addRelative(key)
              }
            >
              <Icon size={16} />
              {label}
              {relationshipCounts[key] > 0 && (
                <span className="relationship-count" aria-label={`${relationshipCounts[key]} linked`}>
                  {relationshipCounts[key]}
                </span>
              )}
            </button>
          ))}
        </div>
        {!identityComplete && (
          <p className="relationship-prerequisite" role="status">
            Identify this person first: {identityIssues.join(", ")}.
          </p>
        )}
        {spouseChooserOpen && identityComplete && (
          <div className="spouse-chooser">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                addRelative("spouse");
                setSpouseChooserOpen(false);
              }}
            >
              <UserRound size={15} />
              Create new partner
            </button>
            <span>or link an existing person</span>
            <div>
              <select
                aria-label="Existing partner"
                value={existingSpouseId}
                disabled={!existingSpouseCandidates.length}
                onChange={(event) => setExistingSpouseId(event.target.value)}
              >
                <option value="">
                  {existingSpouseCandidates.length
                    ? "Choose from family list"
                    : "No unlinked people available"}
                </option>
                {existingSpouseCandidates.map((person) => (
                  <option key={person.id} value={person.id}>
                    {displayName(person)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="primary-button"
                disabled={!existingSpouseId}
                onClick={linkExistingSpouse}
              >
                <Heart size={15} />
                Link partner
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="inspector-section">
        <p className="eyebrow">Personal details</p>
        <fieldset className="person-edit-fields" disabled={!isEditing}>
        <div className="inspector-fields">
          <label>
            <span>Name</span>
            <input
              autoFocus={!displayedGivenNames}
              value={displayedGivenNames}
              onChange={(event) => updateGivenNames(event.target.value)}
              placeholder="Given name or names"
            />
          </label>
          <label>
            <span>Surname</span>
            <input
              value={displayedSurname}
              onChange={(event) => updateSurname(event.target.value)}
              placeholder="Current surname"
            />
          </label>
          <label>
            <span>Surname at birth</span>
            <input
              value={displayedSurnameAtBirth}
              onChange={(event) => updateSelected({ surnameAtBirth: event.target.value })}
              placeholder={selectedPerson.sex === "Male" ? "Same as current surname" : ""}
            />
          </label>
          <label>
            <span>Sex</span>
            <select
              value={selectedPerson.sex || ""}
              onChange={(event) => updateSex(event.target.value)}
            >
              <option value="">Not specified</option>
              <option>Female</option>
              <option>Male</option>
              <option>Other</option>
            </select>
          </label>
          {selectedPerson.fatherId && (
            <label>
              <span>Father</span>
              <select
                aria-label="Father"
                value={selectedPerson.fatherId}
                onChange={(event) =>
                  updateSelected({
                    fatherId: event.target.value,
                    fatherExplicitlyUnassigned: !event.target.value,
                  })
                }
              >
                <option value="">Not assigned</option>
                {parentCandidates.map((person) => (
                  <option key={person.id} value={person.id}>
                    {displayName(person)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {selectedPerson.motherId && (
            <label>
              <span>Mother</span>
              <select
                aria-label="Mother"
                value={selectedPerson.motherId}
                onChange={(event) =>
                  updateSelected({
                    motherId: event.target.value,
                    motherExplicitlyUnassigned: !event.target.value,
                  })
                }
              >
                <option value="">Not assigned</option>
                {parentCandidates.map((person) => (
                  <option key={person.id} value={person.id}>
                    {displayName(person)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <label className="deceased-status-control">
          <span>Status</span>
          <span className="detail-checkbox">
            <input
              type="checkbox"
              checked={isDeceased}
              onChange={(event) => setDeceased(event.target.checked)}
            />
            This person is deceased.
          </span>
        </label>
        {isDeceased && (
          <div className="person-succession">
            <div className="person-succession-heading">
              <div>
                <strong>Succession on death</strong>
                <small>Record how this person's ownership passes to the heirs.</small>
              </div>
              <select
                aria-label="Inheritance basis"
                value={inheritanceBasis}
                onChange={(event) =>
                  updateSelected({ inheritanceBasis: event.target.value })
                }
              >
                <option value="intestacy">Intestate</option>
                <option value="will">Testate (will)</option>
              </select>
            </div>
            <label className="succession-detail-row">
              <span>Date of death</span>
              <input
                type="date"
                value={selectedPerson.dateOfDeath || ""}
                onChange={(event) =>
                  updateSelected({ dateOfDeath: event.target.value })
                }
              />
            </label>

            {inheritanceBasis === "intestacy" ? (
              <div className="automatic-heirs">
                <strong>Calculated heirs</strong>
                {automaticIntestacy?.shares.size ? (
                  [...automaticIntestacy.shares.entries()].map(([personId, share]) => {
                    const heir = peopleById.get(personId);
                    return (
                      <div key={personId}>
                        <span>{displayName(heir)}</span>
                        <b>{ownershipLabel(share, shareDisplay)}</b>
                      </div>
                    );
                  })
                ) : (
                  <small>No supported heir can yet be calculated.</small>
                )}
                {automaticIntestacy?.warnings.map((warning) => (
                  <small className="succession-warning" key={warning}>
                    {warning}
                  </small>
                ))}
              </div>
            ) : (
              <div className="will-details">
                <label>
                  <span>Will date</span>
                  <input
                    type="date"
                    value={selectedPerson.willDate || ""}
                    onChange={(event) => updateSelected({ willDate: event.target.value })}
                  />
                </label>
                <label>
                  <span>Will notary</span>
                  <input
                    value={selectedPerson.willNotaryName || ""}
                    onChange={(event) =>
                      updateSelected({ willNotaryName: event.target.value })
                    }
                    placeholder="Notary's name"
                  />
                </label>
                <label className="will-notes">
                  <span>Will notes</span>
                  <textarea
                    rows="2"
                    value={selectedPerson.willNotes || ""}
                    onChange={(event) =>
                      updateSelected({ willNotes: event.target.value })
                    }
                    placeholder="Will details, references, institutes or other notes"
                  />
                </label>
                <div className="will-beneficiaries">
                  <div className="will-beneficiaries-heading">
                    <strong>Beneficiaries</strong>
                    <button type="button" className="text-button" onClick={addWillHeir}>
                      Add beneficiary
                    </button>
                  </div>
                  {willHeirs.map((heir) => {
                    const fraction = fractionForShare(heir);
                    return (
                      <div className="will-heir-row" key={heir.id}>
                        <select
                          aria-label="Will beneficiary"
                          value={heir.personId || ""}
                          onChange={(event) =>
                            updateWillHeir(heir.id, { personId: event.target.value })
                          }
                        >
                          <option value="">Choose person</option>
                          {people
                            .filter((person) => person.id !== selectedPerson.id)
                            .map((person) => (
                              <option key={person.id} value={person.id}>
                                {displayName(person)}
                              </option>
                            ))}
                        </select>
                        <span className="will-heir-fraction">
                          <input
                            aria-label="Will share numerator"
                            type="number"
                            min="0"
                            step="1"
                            value={fraction.numerator}
                            onChange={(event) =>
                              updateWillHeirFraction(heir, {
                                numerator: event.target.value,
                              })
                            }
                          />
                          <b>/</b>
                          <input
                            aria-label="Will share denominator"
                            type="number"
                            min="1"
                            step="1"
                            value={fraction.denominator}
                            onChange={(event) =>
                              updateWillHeirFraction(heir, {
                                denominator: event.target.value,
                              })
                            }
                          />
                        </span>
                        <span className="will-heir-percent">
                          <input
                            aria-label="Will share percentage"
                            type="number"
                            min="0"
                            max="100"
                            step="any"
                            value={heir.sharePercent ?? 0}
                            onChange={(event) =>
                              updateWillHeirPercentage(heir.id, event.target.value)
                            }
                          />
                          <b>%</b>
                        </span>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Remove will beneficiary"
                          onClick={() => removeWillHeir(heir.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                  <small
                    className={
                      Math.abs(willTotal - 100) < 1e-8
                        ? "succession-total valid"
                        : "succession-total invalid"
                    }
                  >
                    Total: {willTotal.toLocaleString("en-MT", {
                      maximumFractionDigits: 4,
                    })}% {Math.abs(willTotal - 100) < 1e-8 ? "✓" : "— must equal 100%"}
                  </small>
                </div>
              </div>
            )}

            {requiresCausaMortisDetails && (
              <div className="causa-mortis-records">
                <div className="causa-mortis-heading">
                  <div>
                    <strong>Causa mortis declarations</strong>
                    <small>
                      Death after 25 November 1992 · record each declaration separately.
                    </small>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={addCausaMortisDeclaration}
                  >
                    <FilePlus2 size={14} />
                    Add declaration
                  </button>
                </div>

                {causaMortisCoverage.length > 0 && (
                  <div
                    className="causa-mortis-coverage"
                    aria-label="Causa mortis share coverage"
                  >
                    {causaMortisCoverage.map((row) => {
                      const difference = Math.abs(row.difference);
                      const differenceLabel =
                        row.status === "under"
                          ? `Missing ${fractionLabel(difference)}`
                          : row.status === "over"
                            ? `Excess ${fractionLabel(difference)}`
                            : "Complete";
                      return (
                        <div
                          className={`causa-mortis-coverage-row ${row.status}`}
                          key={row.propertyId}
                        >
                          <span>
                            <strong>{row.propertyAddress}</strong>
                            <small>
                              Required {fractionLabel(row.requiredShare)} ·
                              Declared {fractionLabel(row.declaredShare)}
                            </small>
                          </span>
                          <b>{differenceLabel}</b>
                        </div>
                      );
                    })}
                  </div>
                )}

                {!causaMortisDeclarations.length && (
                  <small className="causa-mortis-empty">
                    No causa mortis declaration recorded yet.
                  </small>
                )}

                {causaMortisDeclarations.map((declaration, index) => (
                  <div className="causa-mortis-card" key={declaration.id}>
                    <div className="causa-mortis-card-heading">
                      <strong>Declaration CM {index + 1}</strong>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Remove causa mortis declaration ${index + 1}`}
                        onClick={() =>
                          removeCausaMortisDeclaration(declaration.id)
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <label>
                      <span>Property</span>
                      <select
                        aria-label={`Property declared causa mortis ${index + 1}`}
                        value={
                          declaration.propertyId ||
                          (properties.length === 1 ? properties[0].id : "")
                        }
                        onChange={(event) =>
                          updateCausaMortisDeclaration(declaration.id, {
                            propertyId: event.target.value,
                          })
                        }
                      >
                        <option value="">Select property</option>
                        {properties.map((property) => (
                          <option key={property.id} value={property.id}>
                            {property.address ||
                              property.description ||
                              "Unnamed property"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Share declared CM</span>
                      <span className="causa-mortis-fraction">
                        <input
                          aria-label={`Causa mortis share numerator ${index + 1}`}
                          type="number"
                          min="0"
                          step="1"
                          value={declaration.declaredShareNumerator ?? ""}
                          onChange={(event) =>
                            updateCausaMortisDeclaration(declaration.id, {
                              declaredShareNumerator: event.target.value,
                            })
                          }
                        />
                        <b>/</b>
                        <input
                          aria-label={`Causa mortis share denominator ${index + 1}`}
                          type="number"
                          min="1"
                          step="1"
                          value={declaration.declaredShareDenominator ?? ""}
                          onChange={(event) =>
                            updateCausaMortisDeclaration(declaration.id, {
                              declaredShareDenominator: event.target.value,
                            })
                          }
                        />
                      </span>
                    </label>
                    <label>
                      <span>Declaration date</span>
                      <input
                        type="date"
                        value={declaration.date || ""}
                        onChange={(event) =>
                          updateCausaMortisDeclaration(declaration.id, {
                            date: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>Notary</span>
                      <input
                        value={declaration.notaryName || ""}
                        onChange={(event) =>
                          updateCausaMortisDeclaration(declaration.id, {
                            notaryName: event.target.value,
                          })
                        }
                        placeholder="Notary's full name"
                      />
                    </label>
                    <label>
                      <span>
                        Immovable property value
                        {allSuccessionHeirsDeceased ? " (optional)" : ""}
                      </span>
                      <span className="currency-input">
                        <b>€</b>
                        <input
                          aria-label={`Immovable property value declared causa mortis ${index + 1}`}
                          type="number"
                          min="0"
                          step="any"
                          required={!allSuccessionHeirsDeceased}
                          value={declaration.immovablePropertyValue || ""}
                          onChange={(event) =>
                            updateCausaMortisDeclaration(declaration.id, {
                              immovablePropertyValue: event.target.value,
                            })
                          }
                        />
                      </span>
                    </label>
                    <div className="causa-mortis-declarants">
                      <strong>Declarants</strong>
                      <small>
                        Descendants are selected by default. Untick anyone who
                        did not make this declaration.
                      </small>
                      {declarationCandidates.length ? (
                        <div>
                          {declarationCandidates.map((person) => (
                            <label key={person.id}>
                              <input
                                type="checkbox"
                                checked={(
                                  declaration.declarantPersonIds || []
                                ).includes(person.id)}
                                onChange={() =>
                                  toggleCausaMortisDeclarant(
                                    declaration,
                                    person.id,
                                  )
                                }
                              />
                              {displayName(person)}
                              {!descendantIds.has(person.id) && (
                                <small>heir</small>
                              )}
                            </label>
                          ))}
                        </div>
                      ) : (
                        <small>
                          Add the deceased person's descendants or heirs to the
                          tree to select the declarants.
                        </small>
                      )}
                    </div>
                    <small
                      className={
                        allSuccessionHeirsDeceased
                          ? "causa-mortis-value-note optional"
                          : "causa-mortis-value-note required"
                      }
                    >
                      {allSuccessionHeirsDeceased
                        ? "Declared immovable-property value is optional because every identified heir is now deceased."
                        : "Declared immovable-property value is required because at least one identified heir is living."}
                    </small>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {linkedPartners.length > 0 && (
          <div className="person-partner-links">
            <span>Partner links</span>
            <div>
              {linkedPartners.map((partner) => (
                <span key={partner.id}>
                  <strong>{displayName(partner)}</strong>
                  <button
                    type="button"
                    onClick={() => removePartnerLink(partner.id)}
                    aria-label={`Remove partner link to ${displayName(partner)}`}
                  >
                    Remove link
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="person-delete-control">
          <button
            type="button"
            className="danger-button"
            disabled={deleteDisabled}
            onClick={removeSelected}
          >
            <Trash2 size={15} />
            Delete person
          </button>
          <small>{deleteMessage}</small>
        </div>
        </fieldset>
      </section>

      <section className="inspector-section">
        <p className="eyebrow">Find a person</p>
        <label className="inspector-search">
          <Search size={15} />
          <input
            aria-label="Search family members"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or parent"
          />
        </label>
        <div className="inspector-results">
          {results.map((person) => (
            <button
              type="button"
              className={person.id === selectedPerson.id ? "active" : ""}
              key={person.id}
              onClick={() => onSelectPerson(person.id)}
            >
              <span>{initials(displayName(person))}</span>
              <strong>{displayName(person)}</strong>
            </button>
          ))}
        </div>
      </section>

      <section className="inspector-section gedcom-tool">
        <div>
          <p className="eyebrow">Import</p>
          <h3>GEDCOM family file</h3>
        </div>
        <select
          aria-label="GEDCOM import behaviour"
          value={importMode}
          onChange={(event) => setImportMode(event.target.value)}
        >
          <option value="replace">Replace current tree</option>
          <option value="merge">Merge into current tree</option>
        </select>
        <label className="gedcom-button">
          <FileUp size={17} />
          Choose GEDCOM file
          <input
            type="file"
            accept=".ged,.gedcom,text/plain"
            onChange={importGedcom}
          />
        </label>
        {importStatus && (
          <p className="import-status" aria-live="polite">
            {importStatus}
          </p>
        )}
      </section>
    </div>
  );
}
