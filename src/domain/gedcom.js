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
  const warnings = [];
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
            notes: [],
            hasAdoptionRecord: false,
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
            divorceText: "",
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
        else if (level === 1 && tag === "ADOP") record.hasAdoptionRecord = true;
        else if ((level === 1 || level === 2) && tag === "NOTE" && value.trim())
          record.notes.push(value.trim());
      } else if (record.type === "FAM") {
        if (level === 1) {
          event = tag === "MARR" || tag === "DIV" ? tag : "";
          if (tag === "HUSB") record.husband = value.trim();
          else if (tag === "WIFE") record.wife = value.trim();
          else if (tag === "CHIL") record.children.push(value.trim());
        } else if (level === 2 && tag === "DATE" && event === "MARR") {
          record.marriageText = value.trim();
        } else if (level === 2 && tag === "DATE" && event === "DIV") {
          record.divorceText = value.trim();
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
    notes: person.notes.join("\n"),
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
        if (fatherId && child.fatherId && child.fatherId !== fatherId) {
          warnings.push(
            `${child.fullName || childPointer} appears as a child of more than one father; the first relationship was retained.`,
          );
        } else if (fatherId) child.fatherId = fatherId;
        if (motherId && child.motherId && child.motherId !== motherId) {
          warnings.push(
            `${child.fullName || childPointer} appears as a child of more than one mother; the first relationship was retained.`,
          );
        } else if (motherId) child.motherId = motherId;
      } else {
        warnings.push(`Family ${family.pointer || "record"} refers to a child that was not found.`);
      }
    });
    const relationshipKey = partnerRelationshipKey(fatherId, motherId);
    if (relationshipKey) {
      spouseIdsByPerson.get(fatherId)?.add(motherId);
      spouseIdsByPerson.get(motherId)?.add(fatherId);

      const existing = marriagesByKey.get(relationshipKey);
      const startDate = exactDate(family.marriageText);
      const endDate = exactDate(family.divorceText);
      marriagesByKey.set(relationshipKey, {
        personIds: relationshipKey.split("::"),
        startDate: existing?.startDate || startDate,
        endDate: existing?.endDate || endDate,
      });
    } else if (family.husband || family.wife) {
      warnings.push(
        `Family ${family.pointer || "record"} refers to a spouse who was not found; no partner link was created.`,
      );
    }
  });

  spouseIdsByPerson.forEach((spouseIds, personId) => {
    peopleById.get(personId).spouseIds = [...spouseIds];
  });

  marriagesByKey.forEach(({ personIds, startDate, endDate }) => {
    const [ownerId, partnerId] = personIds;
    const owner = peopleById.get(ownerId);
    if (!owner) return;
    owner.partnerRelationships = [
      ...(owner.partnerRelationships || []),
      {
        personId: partnerId,
        type: PARTNER_RELATIONSHIP_TYPES.MARRIAGE,
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate, endReason: "divorce" } : {}),
      },
    ];
  });

  people.forEach((person) => {
    if (!person.fatherId) return;
    Object.assign(person, fatherSurnameDefaultPatch(person, peopleById.get(person.fatherId)));
  });

  people.forEach((person) => {
    if (person.gedcomBirthDate && !person.dateOfBirth) {
      warnings.push(
        `${person.fullName || person.gedcomId}: birth date “${person.gedcomBirthDate}” was preserved as source text but not used as an exact legal date.`,
      );
    }
    if (person.gedcomDeathDate && !person.dateOfDeath) {
      warnings.push(
        `${person.fullName || person.gedcomId}: death date “${person.gedcomDeathDate}” was preserved as source text but not used as an exact legal date.`,
      );
    }
    const imported = individuals.get(person.gedcomId);
    if (imported?.hasAdoptionRecord) {
      warnings.push(
        `${person.fullName || person.gedcomId}: an adoption record was found and needs manual legal review.`,
      );
    }
  });
  families.forEach((family) => {
    if (family.marriageText && !exactDate(family.marriageText)) {
      warnings.push(
        `Family ${family.pointer || "record"}: marriage date “${family.marriageText}” was preserved as source text but not used as an exact legal date.`,
      );
    }
    if (family.divorceText && !exactDate(family.divorceText)) {
      warnings.push(
        `Family ${family.pointer || "record"}: divorce date “${family.divorceText}” was preserved as source text but not used as an exact legal date.`,
      );
    }
  });
  return {
    people,
    individualCount: people.length,
    familyCount: families.length,
    warnings: [...new Set(warnings)],
  };
}
