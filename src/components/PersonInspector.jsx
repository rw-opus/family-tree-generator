import { useMemo, useState } from "react";
import {
  Baby,
  FileUp,
  Heart,
  Search,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import {
  DESIGNATIONS,
  composeFullName,
  createPerson,
  hasDesignation,
  personGivenNames,
  personRelationshipCounts,
  personSurname,
  personDesignations,
} from "../domain/people.js";
import { parseGedcom } from "../domain/gedcom.js";
import { approximateFraction } from "../domain/ownership.js";

const relationshipActions = [
  { key: "father", label: "Father", icon: UserRound },
  { key: "mother", label: "Mother", icon: UserRound },
  { key: "spouse", label: "Spouse", icon: Heart },
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
  const fraction = approximateFraction(share);
  const fractionText = `${fraction.numerator}/${fraction.denominator}`;
  const percentageText = `${(share * 100).toLocaleString("en-MT", {
    maximumFractionDigits: 4,
  })}%`;
  if (shareDisplay === "fraction") return fractionText;
  if (shareDisplay === "percentage") return percentageText;
  return `${fractionText} · ${percentageText}`;
}

export function PersonInspector({
  people,
  ownershipByPerson = {},
  selectedPersonId,
  shareDisplay = "both",
  caseDependencyLabels = [],
  onChange,
  onSelectPerson,
}) {
  const [query, setQuery] = useState("");
  const [importMode, setImportMode] = useState("replace");
  const [importStatus, setImportStatus] = useState("");
  const selectedPerson = people.find((person) => person.id === selectedPersonId) || people[0];
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
        return `${person.fullName} ${father} ${mother}`.toLowerCase().includes(needle);
      })
      .slice(0, 12);
  }, [people, peopleById, query]);

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

  const toggleDesignation = (designation) => {
    const current = personDesignations(selectedPerson);
    const next = current.includes(designation)
      ? current.filter((value) => value !== designation)
      : [...current, designation];
    updateSelected({ designations: next });
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
    if (!selectedPerson) return;
    const counts = personRelationshipCounts(people, selectedPerson);
    if ((kind === "father" && counts.father) || (kind === "mother" && counts.mother)) {
      return;
    }
    const relative = createPerson();
    let selectedPatch = {};

    if (kind === "father") {
      Object.assign(relative, { sex: "Male", designations: ["Parent"] });
      selectedPatch = { fatherId: relative.id };
    }
    if (kind === "mother") {
      Object.assign(relative, { sex: "Female", designations: ["Parent"] });
      selectedPatch = { motherId: relative.id };
    }
    if (kind === "spouse") {
      Object.assign(relative, {
        designations: [hasDesignation(selectedPerson, "Deceased") ? "Surviving Spouse" : "Spouse"],
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

    const updatedPeople = people.map((person) =>
      person.id === selectedPerson.id ? { ...person, ...selectedPatch } : person,
    );
    onChange([...updatedPeople, relative]);
  };

  const removeSelected = () => {
    if (!selectedPerson || people.length === 1 || deleteBlockers.length) return;
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

  const ownership = ownershipByPerson[selectedPerson.id] || 0;
  const isDeceased =
    Boolean(selectedPerson.isDeceased) || hasDesignation(selectedPerson, "Deceased");
  const displayedSurnameAtBirth =
    selectedPerson.surnameAtBirth ||
    (selectedPerson.sex === "Male" ? personSurname(selectedPerson) : "");
  const displayedGivenNames = personGivenNames(selectedPerson);
  const displayedSurname = personSurname(selectedPerson);
  const relationshipCounts = personRelationshipCounts(people, selectedPerson);
  const deleteBlockers = [
    ...(relationshipCounts.child
      ? [`${relationshipCounts.child} ${relationshipCounts.child === 1 ? "child" : "children"}`]
      : []),
    ...caseDependencyLabels,
  ];
  const deleteDisabled = people.length === 1 || deleteBlockers.length > 0;
  const deleteMessage =
    people.length === 1
      ? "A tree must contain at least one person."
      : deleteBlockers.length
        ? `Remove ${deleteBlockers.join(" and ")} first.`
        : "Spouse and sibling links will be removed automatically.";

  return (
    <div className="person-inspector">
      <section className="inspector-profile">
        <div className={`person-avatar ${selectedPerson.sex?.toLowerCase() || "unknown"}`}>
          {initials(selectedPerson.fullName)}
        </div>
        <div>
          <p className="eyebrow">Selected person</p>
          <h2>{selectedPerson.fullName || "Unnamed person"}</h2>
          <span>{ownershipLabel(ownership, shareDisplay)} ownership</span>
        </div>
        <button
          type="button"
          className="icon-button"
          title={deleteDisabled ? deleteMessage : "Remove selected person"}
          disabled={deleteDisabled}
          onClick={removeSelected}
        >
          <Trash2 size={16} />
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
              disabled={(key === "father" || key === "mother") && relationshipCounts[key] > 0}
              title={
                (key === "father" || key === "mother") && relationshipCounts[key] > 0
                  ? `${label} already added`
                  : `Add ${label.toLowerCase()}`
              }
              onClick={() => addRelative(key)}
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
      </section>

      <section className="inspector-section">
        <p className="eyebrow">Personal details</p>
        <div className="inspector-fields">
          <label>
            <span>Names</span>
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
          <label>
            <span>Surname at birth</span>
            <input
              value={displayedSurnameAtBirth}
              onChange={(event) => updateSelected({ surnameAtBirth: event.target.value })}
              placeholder={selectedPerson.sex === "Male" ? "Same as current surname" : ""}
            />
          </label>
          <label className="deceased-toggle">
            <span>Deceased</span>
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
            <label>
              <span>Date of death</span>
              <input
                type="date"
                value={selectedPerson.dateOfDeath || ""}
                onChange={(event) => updateSelected({ dateOfDeath: event.target.value })}
              />
            </label>
          )}
          <label>
            <span>Father</span>
            <select
              value={selectedPerson.fatherId || ""}
              onChange={(event) => updateSelected({ fatherId: event.target.value })}
            >
              <option value="">Not linked</option>
              {people
                .filter((person) => person.id !== selectedPerson.id)
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName || "Unnamed person"}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>Mother</span>
            <select
              value={selectedPerson.motherId || ""}
              onChange={(event) => updateSelected({ motherId: event.target.value })}
            >
              <option value="">Not linked</option>
              {people
                .filter((person) => person.id !== selectedPerson.id)
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName || "Unnamed person"}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>Notes</span>
            <textarea
              rows="2"
              value={selectedPerson.notes || ""}
              onChange={(event) => updateSelected({ notes: event.target.value })}
              placeholder="Private notes about this person"
            />
          </label>
        </div>
        <details className="relationship-labels">
          <summary>Succession labels</summary>
          <div className="designation-list inspector-designations">
            {DESIGNATIONS.filter((designation) => designation !== "Deceased").map(
              (designation) => (
                <label key={designation} className="designation-choice">
                  <input
                    type="checkbox"
                    checked={personDesignations(selectedPerson).includes(designation)}
                    onChange={() => toggleDesignation(designation)}
                  />
                  {designation}
                </label>
              ),
            )}
          </div>
        </details>
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
              <span>{initials(person.fullName)}</span>
              <strong>{person.fullName || "Unnamed person"}</strong>
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
