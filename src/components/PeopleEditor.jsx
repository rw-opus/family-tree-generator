import { useMemo, useState } from "react";
import { FileUp, LocateFixed, Plus, Search, Trash2 } from "lucide-react";
import { DESIGNATIONS, createPerson, personDesignations } from "../domain/people.js";
import { parseGedcom } from "../domain/gedcom.js";
import { approximateFraction } from "../domain/ownership.js";

const ownershipLabel = (share = 0) => { const fraction = approximateFraction(share); return `${fraction.numerator}/${fraction.denominator} · ${(share * 100).toLocaleString("en-MT", { maximumFractionDigits: 4 })}%`; };

export function PeopleEditor({ people, ownershipByPerson = {}, onChange, onSelectPerson, selectedPersonId }) {
  const [query, setQuery] = useState("");
  const [importMode, setImportMode] = useState("replace");
  const [importStatus, setImportStatus] = useState("");
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const indexedPeople = useMemo(() => people.filter((person) => {
    const father = peopleById.get(person.fatherId)?.fullName || "";
    const mother = peopleById.get(person.motherId)?.fullName || "";
    return `${person.fullName} ${father} ${mother}`.toLowerCase().includes(query.trim().toLowerCase());
  }).sort((a, b) => (a.fullName || "").localeCompare(b.fullName || "")), [people, peopleById, query]);
  const update = (id, patch) => onChange(people.map((person) => person.id === id ? { ...person, ...patch } : person));
  const toggleDesignation = (person, designation) => {
    const existing = personDesignations(person);
    const designations = existing.includes(designation) ? existing.filter((value) => value !== designation) : [...existing, designation];
    if (designation === "Deceased" && !existing.includes(designation)) onChange(people.map((item) => ({ ...item, designations: item.id === person.id ? designations : personDesignations(item).filter((value) => value !== "Deceased") })));
    else update(person.id, { designations });
  };
  const importGedcom = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const result = parseGedcom(await file.text());
      if (!result.people.length) throw new Error("No individual records were found.");
      onChange(importMode === "replace" ? result.people : [...people, ...result.people]);
      setImportStatus(`Imported ${result.individualCount} people and ${result.familyCount} families from ${file.name}.`);
    } catch (error) {
      setImportStatus(`Could not import GEDCOM: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  };
  return <section className="editor-panel"><header><p className="eyebrow">People</p><h2>Family members</h2><p className="helper-text">Import a GEDCOM file or add people manually. Parent links power the searchable index and relational tree.</p></header>
    <div className="gedcom-import"><FileUp size={19} /><label>GEDCOM import<input type="file" accept=".ged,.gedcom,text/plain" onChange={importGedcom} /></label><label>Import behaviour<select value={importMode} onChange={(event) => setImportMode(event.target.value)}><option value="replace">Replace current people</option><option value="merge">Merge with current people</option></select></label></div>
    {importStatus && <p className="import-status" aria-live="polite">{importStatus}</p>}
    <div className="people-index"><div className="index-heading"><div><p className="eyebrow">Index</p><h3>People, fathers and mothers</h3></div><label className="people-search"><Search size={15} /><input aria-label="Search people index" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search any name" /></label></div>
      <div className="index-table"><div className="index-row index-head"><span>Person</span><span>Father</span><span>Mother</span><span>Ownership</span><span /></div>{indexedPeople.map((person) => <button type="button" className={`index-row ${selectedPersonId === person.id ? "selected" : ""}`} key={person.id} onClick={() => onSelectPerson?.(person.id)}><strong>{person.fullName || "Unnamed person"}</strong><span>{peopleById.get(person.fatherId)?.fullName || "—"}</span><span>{peopleById.get(person.motherId)?.fullName || "—"}</span><span className="index-ownership">{ownershipLabel(ownershipByPerson[person.id] || 0)}</span><LocateFixed size={15} /></button>)}</div>
    </div>
    <div className="people-list">{people.map((person, index) => <article className={`person-card ${selectedPersonId === person.id ? "selected-person" : ""}`} key={person.id}><div className="person-card-heading"><strong>{person.fullName || `Person ${index + 1}`}</strong><span className="person-ownership">{ownershipLabel(ownershipByPerson[person.id] || 0)}</span><button type="button" className="icon-button" title="Remove person" onClick={() => onChange(people.filter((item) => item.id !== person.id))}><Trash2 size={16} /></button></div><div className="person-fields"><label>Full name<input value={person.fullName} onChange={(event) => update(person.id, { fullName: event.target.value })} placeholder="Name and surname" /></label><label>Sex<select value={person.sex || ""} onChange={(event) => update(person.id, { sex: event.target.value })}><option value="">Not specified</option><option>Female</option><option>Male</option><option>Other</option></select></label><label>Father<select value={person.fatherId || ""} onChange={(event) => update(person.id, { fatherId: event.target.value })}><option value="">Not linked</option>{people.filter((item) => item.id !== person.id).map((item) => <option key={item.id} value={item.id}>{item.fullName || "Unnamed person"}</option>)}</select></label><label>Mother<select value={person.motherId || ""} onChange={(event) => update(person.id, { motherId: event.target.value })}><option value="">Not linked</option>{people.filter((item) => item.id !== person.id).map((item) => <option key={item.id} value={item.id}>{item.fullName || "Unnamed person"}</option>)}</select></label><label>Date of birth<input type="date" value={person.dateOfBirth || ""} onChange={(event) => update(person.id, { dateOfBirth: event.target.value })} /></label>{(personDesignations(person).includes("Deceased") || person.isDeceased) && <label>Date of death<input type="date" value={person.dateOfDeath || ""} onChange={(event) => update(person.id, { dateOfDeath: event.target.value })} /></label>}<label className="full-width">Notes<input value={person.notes || ""} onChange={(event) => update(person.id, { notes: event.target.value })} placeholder="Optional private note" /></label></div><div className="designation-list">{DESIGNATIONS.map((designation) => <label key={designation} className="designation-choice"><input type="checkbox" checked={personDesignations(person).includes(designation)} onChange={() => toggleDesignation(person, designation)} />{designation}</label>)}</div></article>)}</div>
    <button type="button" className="add-button" onClick={() => onChange([...people, createPerson()])}><Plus size={16} /> Add person</button>
  </section>;
}
