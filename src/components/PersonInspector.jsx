import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Baby,
  Check,
  FilePlus2,
  FileUp,
  Heart,
  Pencil,
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
  personAncestors,
  personGivenNames,
  personIdentityIssues,
  personRelationshipCounts,
  personSurname,
  personDesignations,
} from "../domain/people.js";
import { parseGedcom } from "../domain/gedcom.js";
import {
  confirmedIntestacyAllocations,
  intestateAllocations,
  isPersonDeceased,
  linkedSpousesFor,
} from "../domain/familyOwnership.js";
import { approximateFraction } from "../domain/ownership.js";
import { fractionForShare, shareFromFraction, shareFromPercentage } from "../domain/shares.js";
import { IntestateHeirConfirmation } from "./IntestateHeirConfirmation.jsx";

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

const money = new Intl.NumberFormat("en-MT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

export function PersonInspector({
  people,
  properties = [],
  ownershipByPerson = {},
  causaMortisCoverage = [],
  selectedPersonId,
  shareDisplay = "both",
  onShareDisplayChange,
  caseDependencyLabels = [],
  familyPersonIds = null,
  onChange,
  onSelectPerson,
}) {
  const [importMode, setImportMode] = useState("replace");
  const [importStatus, setImportStatus] = useState("");
  const [spouseChooserOpen, setSpouseChooserOpen] = useState(false);
  const [existingSpouseId, setExistingSpouseId] = useState("");
  const [childPartnerChooserOpen, setChildPartnerChooserOpen] = useState(false);
  const [childPartnerId, setChildPartnerId] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [ownershipDisplay, setOwnershipDisplay] = useState(
    shareDisplay === "percentage" ? "percentage" : "fraction",
  );
  const selectedPerson =
    people.find((person) => person.id === selectedPersonId) ||
    (familyPersonIds === null ? people[0] : undefined);
  const currentFamilyPersonIds = Array.isArray(familyPersonIds)
    ? familyPersonIds
    : people.map((person) => person.id);
  const previousSelectedPersonIdRef = useRef("");
  const displayName = useCallback((person) => personDisplayName(person, people), [people]);
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);

  useEffect(() => {
    const nextPersonId = selectedPerson?.id || "";
    if (previousSelectedPersonIdRef.current === nextPersonId) return;
    previousSelectedPersonIdRef.current = nextPersonId;
    setSpouseChooserOpen(false);
    setExistingSpouseId("");
    setChildPartnerChooserOpen(false);
    setChildPartnerId("");
    setIsEditing(Boolean(selectedPerson && personIdentityIssues(selectedPerson).length));
  }, [selectedPerson]);

  useEffect(() => {
    setOwnershipDisplay(shareDisplay === "percentage" ? "percentage" : "fraction");
  }, [shareDisplay]);

  const updatePerson = (personId, patch) => {
    onChange(people.map((person) => (person.id === personId ? { ...person, ...patch } : person)));
  };

  const updateSelected = (patch) => {
    if (!selectedPerson) return;
    updatePerson(selectedPerson.id, patch);
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
      (!selectedPerson.surnameAtBirth || selectedPerson.surnameAtBirth === previousSurname)
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

  const selectSex = (sex, checked) => {
    updateSex(checked ? sex : "");
  };

  const changeOwnershipDisplay = (mode) => {
    setOwnershipDisplay(mode);
    onShareDisplayChange?.(mode);
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
      willHeirs: (selectedPerson.willHeirs || []).filter((heir) => heir.id !== heirId),
    });
  };

  const updateCausaMortisDeclaration = (declarationId, patch) => {
    updateSelected({
      causaMortisDeclarations: (selectedPerson.causaMortisDeclarations || []).map((declaration) =>
        declaration.id === declarationId ? { ...declaration, ...patch } : declaration,
      ),
    });
  };

  const addCausaMortisDeclaration = () => {
    const coverageTarget =
      causaMortisCoverage.find((row) => row.status !== "complete") || causaMortisCoverage[0];
    const propertyId =
      coverageTarget?.propertyId || (properties.length === 1 ? properties[0].id : "");
    const remainingShare = coverageTarget
      ? Math.max(0, coverageTarget.requiredShare - coverageTarget.declaredShare)
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
          declarantPersonIds: declarationCandidates.map((person) => person.id),
        },
      ],
    });
  };

  const removeCausaMortisDeclaration = (declarationId) => {
    updateSelected({
      causaMortisDeclarations: (selectedPerson.causaMortisDeclarations || []).filter(
        (declaration) => declaration.id !== declarationId,
      ),
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
    if (checked) setIsEditing(true);
    updateSelected({
      designations: checked ? ["Deceased", ...current] : current,
      isDeceased: checked,
      dateOfDeath: checked ? selectedPerson.dateOfDeath || "" : "",
    });
  };

  const addRelative = (kind, secondParentId = "") => {
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
      const secondParent = people.find((person) => person.id === secondParentId);
      if (
        selectedPerson.sex === "Female" ||
        (selectedPerson.sex !== "Male" && secondParent?.sex === "Male")
      ) {
        relative.motherId = selectedPerson.id;
        relative.fatherId = secondParent?.id || "";
      } else {
        relative.fatherId = selectedPerson.id;
        relative.motherId = secondParent?.id || "";
      }
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
        return person;
      }),
    );
    setExistingSpouseId("");
    setSpouseChooserOpen(false);
  };

  const removeSelected = () => {
    if (!selectedPerson || currentFamilyPersonIds.length <= 1 || deleteBlockers.length) {
      return;
    }
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
    onSelectPerson(currentFamilyPersonIds.find((personId) => personId !== selectedPerson.id) || "");
  };

  const removePartnerLink = (partnerId) => {
    if (!selectedPerson || !partnerId) return;
    const hasSharedChildren = people.some((person) => {
      const parentIds = new Set([person.fatherId, person.motherId].filter(Boolean));
      return parentIds.has(selectedPerson.id) && parentIds.has(partnerId);
    });
    if (hasSharedChildren) return;
    onChange(
      people.map((person) => {
        if (person.id === selectedPerson.id) {
          return {
            ...person,
            spouseIds: (person.spouseIds || []).filter((id) => id !== partnerId),
          };
        }
        if (person.id === partnerId) {
          return {
            ...person,
            spouseIds: (person.spouseIds || []).filter((id) => id !== selectedPerson.id),
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
      onChange(nextPeople, { replaceFamilyGroup: importMode === "replace" });
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
            onChange([...people, person]);
            onSelectPerson(person.id);
          }}
        >
          Add first person
        </button>
      </div>
    );
  }

  const hasOwnership = Object.prototype.hasOwnProperty.call(ownershipByPerson, selectedPerson.id);
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
  const willTotal = willHeirs.reduce((total, heir) => total + (Number(heir.sharePercent) || 0), 0);
  const automaticIntestacy =
    isDeceased && inheritanceBasis === "intestacy"
      ? intestateAllocations(people, selectedPerson.id)
      : null;
  const confirmedIntestacy =
    automaticIntestacy &&
    confirmedIntestacyAllocations(people, selectedPerson.id, automaticIntestacy);
  const successionHeirIds =
    inheritanceBasis === "will"
      ? willHeirs.map((heir) => heir.personId).filter(Boolean)
      : [
          ...((confirmedIntestacy?.valid
            ? confirmedIntestacy.shares
            : automaticIntestacy?.shares
          )?.keys() || []),
        ];
  const successionHeirs = successionHeirIds
    .map((personId) => peopleById.get(personId))
    .filter(Boolean);
  const allSuccessionHeirsDeceased =
    successionHeirs.length > 0 && successionHeirs.every((person) => isPersonDeceased(person));
  const descendants = personDescendants(people, selectedPerson.id);
  const descendantIds = new Set(descendants.map((person) => person.id));
  const ancestorIds = new Set(
    personAncestors(people, selectedPerson.id).map((person) => person.id),
  );
  const declarationCandidateIds = new Set(successionHeirIds);
  const declarationCandidates = people.filter((person) => declarationCandidateIds.has(person.id));
  const causaMortisDeclarations = selectedPerson.causaMortisDeclarations || [];
  const requiresCausaMortisDetails =
    Boolean(selectedPerson.dateOfDeath) && selectedPerson.dateOfDeath > "1992-11-25";
  const displayedSurnameAtBirth =
    selectedPerson.surnameAtBirth ||
    (selectedPerson.sex === "Male" ? personSurname(selectedPerson) : "");
  const displayedGivenNames = personGivenNames(selectedPerson);
  const displayedSurname = personSurname(selectedPerson);
  const propertySaleValue = Number(properties[0]?.saleValue) || 0;
  const estimatedPropertyValue = propertySaleValue * ownership;
  const relationshipCounts = personRelationshipCounts(people, selectedPerson);
  const linkedPartners = linkedSpousesFor(people, selectedPerson.id);
  const linkedSpouseIds = new Set(linkedPartners.map((person) => person.id));
  const sharedChildrenByPartnerId = new Map(
    linkedPartners.map((partner) => [
      partner.id,
      people.filter((person) => {
        const parentIds = new Set([person.fatherId, person.motherId].filter(Boolean));
        return parentIds.has(selectedPerson.id) && parentIds.has(partner.id);
      }),
    ]),
  );
  const addChild = () => {
    if (linkedPartners.length > 1) {
      setChildPartnerChooserOpen((open) => !open);
      return;
    }
    addRelative("child", linkedPartners[0]?.id);
  };
  const existingSpouseCandidates = people.filter(
    (person) =>
      person.id !== selectedPerson.id &&
      !linkedSpouseIds.has(person.id) &&
      !descendantIds.has(person.id) &&
      !ancestorIds.has(person.id),
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
      ? [`${descendants.length} ${descendants.length === 1 ? "descendant" : "descendants"}`]
      : []),
    ...(hasOwnership && ownership > 1e-10 ? ["the person's property ownership"] : []),
    ...caseDependencyLabels,
  ];
  const deleteDisabled = currentFamilyPersonIds.length <= 1 || deleteBlockers.length > 0;
  const deleteMessage =
    currentFamilyPersonIds.length <= 1
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
                ((key === "father" || key === "mother") && relationshipCounts[key] > 0)
              }
              title={
                !identityComplete
                  ? identityMessage
                  : (key === "father" || key === "mother") && relationshipCounts[key] > 0
                    ? `${label} already added`
                    : `Add ${label.toLowerCase()}`
              }
              aria-expanded={key === "spouse" ? spouseChooserOpen : undefined}
              onClick={() =>
                key === "spouse"
                  ? setSpouseChooserOpen((open) => !open)
                  : key === "child"
                    ? addChild()
                    : addRelative(key)
              }
            >
              <Icon size={16} />
              {label}
              {relationshipCounts[key] > 0 && (
                <span
                  className="relationship-count"
                  aria-label={`${relationshipCounts[key]} linked`}
                >
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
        {childPartnerChooserOpen && identityComplete && (
          <div className="spouse-chooser child-partner-chooser">
            <span>Choose the other parent for this child</span>
            <div>
              <select
                aria-label="Child's other parent"
                value={childPartnerId}
                onChange={(event) => setChildPartnerId(event.target.value)}
              >
                <option value="">No other parent assigned yet</option>
                {linkedPartners.map((person) => (
                  <option key={person.id} value={person.id}>
                    {displayName(person)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  addRelative("child", childPartnerId);
                  setChildPartnerChooserOpen(false);
                  setChildPartnerId("");
                }}
              >
                <Baby size={15} />
                Add child
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
          </div>
        </fieldset>
        <div className="person-status-controls">
          <div className="person-status-control" role="group" aria-label="Sex">
            <span>Sex</span>
            <span className="sex-checkbox-options">
              {["Female", "Male", "Other"].map((sex) => (
                <label className="detail-checkbox" key={sex}>
                  <input
                    type="checkbox"
                    checked={selectedPerson.sex === sex}
                    onChange={(event) => selectSex(sex, event.target.checked)}
                  />
                  {sex}
                </label>
              ))}
            </span>
          </div>
          <label className="person-status-control deceased-status-control">
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
        </div>

        <div className="person-share-summary">
          <div className="person-share-heading">
            <span>Estimated property share</span>
            <span className="person-share-toggle" aria-label="Estimated share display">
              <button
                type="button"
                className={ownershipDisplay === "fraction" ? "active" : ""}
                aria-pressed={ownershipDisplay === "fraction"}
                onClick={() => changeOwnershipDisplay("fraction")}
              >
                Fraction
              </button>
              <button
                type="button"
                className={ownershipDisplay === "percentage" ? "active" : ""}
                aria-pressed={ownershipDisplay === "percentage"}
                onClick={() => changeOwnershipDisplay("percentage")}
              >
                Percentage
              </button>
            </span>
          </div>
          <div className="person-share-value">
            <strong>
              {hasOwnership ? ownershipLabel(ownership, ownershipDisplay) : "Not yet calculated"}
            </strong>
            <small>
              {hasOwnership && propertySaleValue > 0
                ? `Estimated value ${money.format(estimatedPropertyValue)}`
                : "Enter the initial owner and property selling price to calculate a value."}
            </small>
          </div>
        </div>

        <fieldset className="person-edit-fields" disabled={!isEditing && !isDeceased}>
          {isDeceased && (
            <div className="person-succession">
              <label className="succession-detail-row">
                <span>Date of death</span>
                <input
                  type="date"
                  value={selectedPerson.dateOfDeath || ""}
                  onChange={(event) => updateSelected({ dateOfDeath: event.target.value })}
                />
              </label>
              <label className="succession-detail-row">
                <span>Estate</span>
                <select
                  aria-label="Inheritance basis"
                  value={inheritanceBasis}
                  onChange={(event) => updateSelected({ inheritanceBasis: event.target.value })}
                >
                  <option value="intestacy">Intestate</option>
                  <option value="will">Testate</option>
                </select>
              </label>

              {inheritanceBasis === "intestacy" ? (
                <IntestateHeirConfirmation
                  deceased={selectedPerson}
                  people={people}
                  calculated={automaticIntestacy}
                  displayName={displayName}
                  onUpdatePerson={updatePerson}
                  onSelectPerson={onSelectPerson}
                />
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
                    <span>Will notary (optional)</span>
                    <input
                      value={selectedPerson.willNotaryName || ""}
                      onChange={(event) => updateSelected({ willNotaryName: event.target.value })}
                      placeholder="Notary's name"
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
                      Total:{" "}
                      {willTotal.toLocaleString("en-MT", {
                        maximumFractionDigits: 4,
                      })}
                      % {Math.abs(willTotal - 100) < 1e-8 ? "✓" : "— must equal 100%"}
                    </small>
                  </div>
                </div>
              )}

              {requiresCausaMortisDetails && (
                <div className="causa-mortis-records">
                  <div className="causa-mortis-heading">
                    <div>
                      <strong>Declarations Causa Mortis</strong>
                      <small>
                        Required for a death after 25 November 1992. Add every declaration
                        separately.
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
                    <div className="causa-mortis-coverage" aria-label="Causa mortis share coverage">
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
                                Required {fractionLabel(row.requiredShare)} · Declared{" "}
                                {fractionLabel(row.declaredShare)}
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
                          onClick={() => removeCausaMortisDeclaration(declaration.id)}
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
                              {property.address || property.description || "Unnamed property"}
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
                        <span>Date of Declaration Causa Mortis</span>
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
                        <span>Notary (optional)</span>
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
                          Value declared
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
                        <strong>Declarants / heirs</strong>
                        <small>
                          Identified heirs are selected by default. Untick anyone who did not make
                          this declaration.
                        </small>
                        {declarationCandidates.length ? (
                          <div>
                            {declarationCandidates.map((person) => (
                              <label key={person.id}>
                                <input
                                  type="checkbox"
                                  checked={(declaration.declarantPersonIds || []).includes(
                                    person.id,
                                  )}
                                  onChange={() =>
                                    toggleCausaMortisDeclarant(declaration, person.id)
                                  }
                                />
                                {displayName(person)}
                              </label>
                            ))}
                          </div>
                        ) : (
                          <small>
                            Add or identify the heirs on the tree before selecting declarants.
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
                          : successionHeirs.length
                            ? "Declared immovable-property value is required because at least one identified heir is living."
                            : "Declared immovable-property value is required until the heirs are identified."}
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
                {linkedPartners.map((partner) => {
                  const sharedChildren = sharedChildrenByPartnerId.get(partner.id) || [];
                  return (
                    <span key={partner.id}>
                      <span className="person-partner-link-identity">
                        <strong>{displayName(partner)}</strong>
                        {sharedChildren.length > 0 && (
                          <small>
                            Reassign {sharedChildren.length} shared{" "}
                            {sharedChildren.length === 1 ? "child" : "children"} first.
                          </small>
                        )}
                      </span>
                      <button
                        type="button"
                        disabled={sharedChildren.length > 0}
                        title={
                          sharedChildren.length
                            ? "Reassign the shared children's parents before removing this link."
                            : "Remove this partner link"
                        }
                        onClick={() => removePartnerLink(partner.id)}
                        aria-label={`Remove partner link to ${displayName(partner)}`}
                      >
                        Remove link
                      </button>
                    </span>
                  );
                })}
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
          <input type="file" accept=".ged,.gedcom,text/plain" onChange={importGedcom} />
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
