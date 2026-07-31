import {
  fatherSurnameDefaultPatch,
  givenNamesFromFullName,
  surnameFromFullName,
} from "./people.js";
import { PARTNER_RELATIONSHIP_TYPES, partnerRelationshipKey } from "./partnerRelationships.js";

const MONTHS = {
  JAN: "01",
  FEB: "02",
  MAR: "03",
  APR: "04",
  MAY: "05",
  JUN: "06",
  JUL: "07",
  AUG: "08",
  SEP: "09",
  OCT: "10",
  NOV: "11",
  DEC: "12",
};

function exactDate(value = "") {
  const match = String(value)
    .trim()
    .toUpperCase()
    .match(/^(\d{1,2})\s+([A-Z]{3})\s+(\d{4})$/);
  if (!match || !MONTHS[match[2]]) return "";
  return `${match[3]}-${MONTHS[match[2]]}-${match[1].padStart(2, "0")}`;
}

function cleanName(value = "") {
  return value.replace(/\//g, " ").replace(/\s+/g, " ").trim();
}

function surnameFromGedcomName(value = "") {
  return value.match(/\/([^/]+)\//)?.[1]?.trim() || "";
}

function givenNamesFromGedcomName(value = "") {
  const gedcomGivenNames = value.match(/^([^/]*)\//)?.[1]?.trim();
  return gedcomGivenNames || givenNamesFromFullName(cleanName(value));
}

export function parseGedcom(text, idFactory = () => crypto.randomUUID()) {
  const individuals = new Map();
  const families = [];
  let record = null;
  let event = "";
  String(text || "")
    .split(/\r?\n/)
    .forEach((rawLine) => {
      const match = rawLine.match(/^(\d+)\s+(?:(@\S+@)\s+)?(\S+)(?:\s+(.*))?$/);
      if (!match) return;
      const level = Number(match[1]);
      const pointer = match[2] || "";
      const tag = match[3];
      const value = match[4] || "";
      if (level === 0) {
        event = "";
        if (tag === "INDI") {
          record = {
            type: "INDI",
            pointer,
            name: "",
            givenNames: "",
            surnameAtBirth: "",
            sex: "",
            birthText: "",
            deathText: "",
            isDeceased: false,
          };
          individuals.set(pointer, record);
        } else if (tag === "FAM") {
          record = {
            type: "FAM",
            pointer,
            husband: "",
            wife: "",
            children: [],
            marriageText: "",
          };
          families.push(record);
        } else record = null;
        return;
      }
      if (!record) return;
      if (record.type === "INDI") {
        if (level === 1 && tag === "NAME") {
          record.name = cleanName(value);
          record.givenNames = givenNamesFromGedcomName(value);
          record.surnameAtBirth = surnameFromGedcomName(value);
        } else if (level === 1 && tag === "SEX")
          record.sex = value === "M" ? "Male" : value === "F" ? "Female" : value || "Other";
        else if (level === 1 && ["BIRT", "DEAT"].includes(tag)) {
          event = tag;
          if (tag === "DEAT") record.isDeceased = true;
        } else if (level === 2 && tag === "DATE" && event === "BIRT")
          record.birthText = value.trim();
        else if (level === 2 && tag === "DATE" && event === "DEAT") record.deathText = value.trim();
      } else if (record.type === "FAM") {
        if (level === 1) {
          event = tag === "MARR" ? "MARR" : "";
          if (tag === "HUSB") record.husband = value.trim();
          else if (tag === "WIFE") record.wife = value.trim();
          else if (tag === "CHIL") record.children.push(value.trim());
        } else if (level === 2 && tag === "DATE" && event === "MARR") {
          record.marriageText = value.trim();
        }
      }
    });
  const idMap = new Map([...individuals.keys()].map((pointer) => [pointer, idFactory()]));
  const people = [...individuals.values()].map((person) => ({
    id: idMap.get(person.pointer),
    gedcomId: person.pointer,
    fullName: person.name,
    givenNames: person.givenNames || givenNamesFromFullName(person.name),
    surname: person.surnameAtBirth || surnameFromFullName(person.name),
    sex: person.sex,
    surnameAtBirth:
      person.surnameAtBirth || (person.sex === "Male" ? surnameFromFullName(person.name) : ""),
    dateOfBirth: exactDate(person.birthText),
    dateOfDeath: exactDate(person.deathText),
    gedcomBirthDate: person.birthText,
    gedcomDeathDate: person.deathText,
    isDeceased: person.isDeceased,
    fatherId: "",
    motherId: "",
    spouseIds: [],
    siblingIds: [],
    designations: [],
    notes: "",
  }));
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const spouseIdsByPerson = new Map(people.map((person) => [person.id, new Set()]));
  const marriagesByKey = new Map();
  families.forEach((family) => {
    const fatherId = idMap.get(family.husband) || "";
    const motherId = idMap.get(family.wife) || "";
    family.children.forEach((childPointer) => {
      const child = peopleById.get(idMap.get(childPointer));
      if (child) {
        child.fatherId = fatherId;
        child.motherId = motherId;
      }
    });
    const relationshipKey = partnerRelationshipKey(fatherId, motherId);
    if (relationshipKey) {
      spouseIdsByPerson.get(fatherId).add(motherId);
      spouseIdsByPerson.get(motherId).add(fatherId);

      const existing = marriagesByKey.get(relationshipKey);
      const startDate = exactDate(family.marriageText);
      marriagesByKey.set(relationshipKey, {
        personIds: relationshipKey.split("::"),
        startDate: existing?.startDate || startDate,
      });
    }
  });

  spouseIdsByPerson.forEach((spouseIds, personId) => {
    peopleById.get(personId).spouseIds = [...spouseIds];
  });

  marriagesByKey.forEach(({ personIds, startDate }) => {
    const [ownerId, partnerId] = personIds;
    const owner = peopleById.get(ownerId);
    if (!owner) return;
    owner.partnerRelationships = [
      ...(owner.partnerRelationships || []),
      {
        personId: partnerId,
        type: PARTNER_RELATIONSHIP_TYPES.MARRIAGE,
        ...(startDate ? { startDate } : {}),
      },
    ];
  });

  people.forEach((person) => {
    if (!person.fatherId) return;
    Object.assign(person, fatherSurnameDefaultPatch(person, peopleById.get(person.fatherId)));
  });
  return {
    people,
    individualCount: people.length,
    familyCount: families.length,
  };
}
