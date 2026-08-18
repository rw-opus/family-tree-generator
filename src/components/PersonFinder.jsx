import { Search, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { personChoiceLabel, personDisplayName } from "../domain/people.js";

const normaliseSearch = (value) =>
  String(value || "")
    .trim()
    .toLocaleLowerCase();

export function PersonFinder({ people = [], onSelectPerson }) {
  const detailsRef = useRef(null);
  const [query, setQuery] = useState("");
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const results = useMemo(() => {
    const needle = normaliseSearch(query);
    return people
      .map((person) => {
        const father = peopleById.get(person.fatherId);
        const mother = peopleById.get(person.motherId);
        const name = personDisplayName(person, people);
        const fatherName = father ? personDisplayName(father, people) : "";
        const motherName = mother ? personDisplayName(mother, people) : "";
        return {
          person,
          name,
          choiceLabel: personChoiceLabel(person, people),
          fatherName,
          motherName,
          searchText: normaliseSearch(`${name} ${fatherName} ${motherName}`),
        };
      })
      .filter((entry) => !needle || entry.searchText.includes(needle))
      .sort((first, second) =>
        first.choiceLabel.localeCompare(second.choiceLabel, "en-MT", {
          sensitivity: "base",
          numeric: true,
        }),
      );
  }, [people, peopleById, query]);

  const choosePerson = (personId) => {
    onSelectPerson?.(personId);
    setQuery("");
    detailsRef.current?.removeAttribute("open");
  };

  return (
    <details className="person-finder" ref={detailsRef}>
      <summary aria-label="Find person" title="Find person">
        <Search size={15} />
        <span className="person-finder-label-full">Find person</span>
        <span className="person-finder-label-short">Find</span>
      </summary>
      <div className="person-finder-popover">
        <label>
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">Find a person on this family tree</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or parent name"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear person search">
              <X size={14} />
            </button>
          )}
        </label>
        <div className="person-finder-results">
          {results.map(({ person, choiceLabel, fatherName, motherName }) => (
            <button type="button" key={person.id} onClick={() => choosePerson(person.id)}>
              <strong>{choiceLabel}</strong>
              <small>
                {fatherName || motherName
                  ? `${fatherName ? `Father: ${fatherName}` : "Father not recorded"} · ${
                      motherName ? `Mother: ${motherName}` : "Mother not recorded"
                    }`
                  : "Parents not recorded"}
              </small>
            </button>
          ))}
          {!results.length && <p>No person matches this search.</p>}
        </div>
      </div>
    </details>
  );
}
