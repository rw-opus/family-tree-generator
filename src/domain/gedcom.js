import {
  composeFullName,
  fatherSurnameDefaultPatch,
  givenNamesFromFullName,
  personGivenNames,
  personSurname,
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

function normalizedRelationshipDescriptor(value = "") {
  return String(value).trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function isExplicitlyUnmarriedDescriptor(value = "") {
  const descriptor = normalizedRelationshipDescriptor(value);
  return (
    descriptor === "childbirth unmarried" ||
    descriptor === "unmarried" ||
    descriptor === "not married" ||
    descriptor === "never married" ||
    descriptor === "partnership" ||
    descriptor === "partner" ||
    descriptor === "cohabitation" ||
    descriptor === "cohabiting"
  );
}

function isNegativeGedcomBoolean(value = "") {
  return ["n", "no", "false"].includes(String(value).trim().toLowerCase());
}

function importedRelationshipType(relationship = {}) {
  return relationship.hasExplicitMarriage || !relationship.hasExplicitPartnership
    ? PARTNER_RELATIONSHIP_TYPES.MARRIAGE
    : PARTNER_RELATIONSHIP_TYPES.PARTNERSHIP;
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
            surname: "",
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
            marriageRecorded: false,
            divorceRecorded: false,
            explicitlyUnmarried: false,
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
          record.surname = surnameFromGedcomName(value);
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
          event = ["MARR", "DIV", "EVEN"].includes(tag) ? tag : "";
          if (tag === "HUSB") record.husband = value.trim();
          else if (tag === "WIFE") record.wife = value.trim();
          else if (tag === "CHIL") record.children.push(value.trim());
          else if (tag === "NO" && normalizedRelationshipDescriptor(value) === "marr") {
            record.explicitlyUnmarried = true;
          } else if (tag === "MARR") {
            if (isNegativeGedcomBoolean(value)) record.explicitlyUnmarried = true;
            else record.marriageRecorded = true;
          } else if (tag === "DIV") {
            record.divorceRecorded = !isNegativeGedcomBoolean(value);
          } else if (
            tag.startsWith("_") &&
            isExplicitlyUnmarriedDescriptor(value || tag.slice(1))
          ) {
            record.explicitlyUnmarried = true;
          }
        } else if (level === 2 && tag === "DATE" && event === "MARR") {
          record.marriageText = value.trim();
        } else if (level === 2 && tag === "DATE" && event === "DIV") {
          record.divorceText = value.trim();
          record.divorceRecorded = true;
        } else if (
          level === 2 &&
          tag === "TYPE" &&
          ["MARR", "EVEN"].includes(event) &&
          isExplicitlyUnmarriedDescriptor(value)
        ) {
          record.explicitlyUnmarried = true;
        }
      }
    });
  const idMap = new Map([...individuals.keys()].map((pointer) => [pointer, idFactory()]));
  const people = [...individuals.values()].map((person) => ({
    id: idMap.get(person.pointer),
    gedcomId: person.pointer,
    fullName: person.name,
    givenNames: person.givenNames || givenNamesFromFullName(person.name),
    surname: person.surname || surnameFromFullName(person.name),
    sex: person.sex,
    surnameAtBirth: "",
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
  const relationshipsByKey = new Map();
  families.forEach((family, familyIndex) => {
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
        if (family.explicitlyUnmarried) {
          child.surnameAtBirthReviewRequired = true;
          child.gedcomUnmarriedParents = true;
        }
      } else {
        warnings.push(`Family ${family.pointer || "record"} refers to a child that was not found.`);
      }
    });
    const relationshipKey = partnerRelationshipKey(fatherId, motherId);
    if (relationshipKey) {
      spouseIdsByPerson.get(fatherId)?.add(motherId);
      spouseIdsByPerson.get(motherId)?.add(fatherId);

      const existing = relationshipsByKey.get(relationshipKey);
      const startDate = exactDate(family.marriageText);
      const endDate = exactDate(family.divorceText);
      const hasExplicitMarriage =
        Boolean(existing?.hasExplicitMarriage) ||
        (family.marriageRecorded && !family.explicitlyUnmarried);
      const hasExplicitPartnership =
        Boolean(existing?.hasExplicitPartnership) || family.explicitlyUnmarried;
      if (hasExplicitMarriage && hasExplicitPartnership && !existing?.relationshipConflictWarned) {
        warnings.push(
          `Family ${family.pointer || "record"} contains conflicting married and unmarried relationship records; the marriage record was retained for the couple link.`,
        );
      }
      relationshipsByKey.set(relationshipKey, {
        personIds: relationshipKey.split("::"),
        startDate: existing?.startDate || startDate,
        endDate: existing?.endDate || endDate,
        divorceRecorded: existing?.divorceRecorded || family.divorceRecorded,
        hasExplicitMarriage,
        hasExplicitPartnership,
        relationshipConflictWarned: hasExplicitMarriage && hasExplicitPartnership,
        husbandId: existing?.husbandId || fatherId,
        wifeId: existing?.wifeId || motherId,
        familyIndex: Math.max(existing?.familyIndex ?? -1, familyIndex),
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

  relationshipsByKey.forEach(
    ({
      personIds,
      startDate,
      endDate,
      divorceRecorded,
      hasExplicitMarriage,
      hasExplicitPartnership,
    }) => {
      const [ownerId, partnerId] = personIds;
      const owner = peopleById.get(ownerId);
      if (!owner) return;
      const type = importedRelationshipType({ hasExplicitMarriage, hasExplicitPartnership });
      owner.partnerRelationships = [
        ...(owner.partnerRelationships || []),
        {
          personId: partnerId,
          type,
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
          ...(divorceRecorded ? { endReason: "divorce" } : {}),
        },
      ];
    },
  );

  people.forEach((person) => {
    if (!person.fatherId) return;
    const father = peopleById.get(person.fatherId);
    Object.assign(person, fatherSurnameDefaultPatch(person, father));
    const paternalSurname = personSurname(father).trim();
    if (person.surnameAtBirthReviewRequired) {
      person.surnameAtBirth = "";
      warnings.push(
        `${person.fullName || person.gedcomId}: the parents are explicitly recorded as unmarried; confirm the surname at birth in the person card.`,
      );
    } else if (paternalSurname) {
      person.surnameAtBirth = paternalSurname;
    }
  });

  const activeMarriageByWife = new Map();
  relationshipsByKey.forEach((relationship) => {
    if (
      importedRelationshipType(relationship) !== PARTNER_RELATIONSHIP_TYPES.MARRIAGE ||
      relationship.divorceRecorded ||
      !relationship.husbandId ||
      !relationship.wifeId
    ) {
      return;
    }
    const current = activeMarriageByWife.get(relationship.wifeId);
    const currentDate = current?.startDate || "";
    const relationshipDate = relationship.startDate || "";
    if (
      !current ||
      relationshipDate > currentDate ||
      (relationshipDate === currentDate && relationship.familyIndex > current.familyIndex)
    ) {
      activeMarriageByWife.set(relationship.wifeId, relationship);
    }
  });

  activeMarriageByWife.forEach((relationship, wifeId) => {
    const wife = peopleById.get(wifeId);
    const husband = peopleById.get(relationship.husbandId);
    const marriedSurname = personSurname(husband).trim();
    if (!wife || wife.sex !== "Female" || !marriedSurname) return;
    wife.surname = marriedSurname;
    wife.fullName = composeFullName(personGivenNames(wife), marriedSurname);
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
