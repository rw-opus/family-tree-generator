const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

function exactDate(value = "") {
  const match = String(value).trim().toUpperCase().match(/^(\d{1,2})\s+([A-Z]{3})\s+(\d{4})$/);
  if (!match || !MONTHS[match[2]]) return "";
  return `${match[3]}-${MONTHS[match[2]]}-${match[1].padStart(2, "0")}`;
}

function cleanName(value = "") {
  return value.replace(/\//g, " ").replace(/\s+/g, " ").trim();
}

export function parseGedcom(text, idFactory = () => crypto.randomUUID()) {
  const individuals = new Map();
  const families = [];
  let record = null;
  let event = "";
  String(text || "").split(/\r?\n/).forEach((rawLine) => {
    const match = rawLine.match(/^(\d+)\s+(?:(@\S+@)\s+)?(\S+)(?:\s+(.*))?$/);
    if (!match) return;
    const level = Number(match[1]);
    const pointer = match[2] || "";
    const tag = match[3];
    const value = match[4] || "";
    if (level === 0) {
      event = "";
      if (tag === "INDI") {
        record = { type: "INDI", pointer, name: "", sex: "", birthText: "", deathText: "", isDeceased: false };
        individuals.set(pointer, record);
      } else if (tag === "FAM") {
        record = { type: "FAM", pointer, husband: "", wife: "", children: [] };
        families.push(record);
      } else record = null;
      return;
    }
    if (!record) return;
    if (record.type === "INDI") {
      if (level === 1 && tag === "NAME") record.name = cleanName(value);
      else if (level === 1 && tag === "SEX") record.sex = value === "M" ? "Male" : value === "F" ? "Female" : value || "Other";
      else if (level === 1 && ["BIRT", "DEAT"].includes(tag)) {
        event = tag;
        if (tag === "DEAT") record.isDeceased = true;
      } else if (level === 2 && tag === "DATE" && event === "BIRT") record.birthText = value.trim();
      else if (level === 2 && tag === "DATE" && event === "DEAT") record.deathText = value.trim();
    } else if (record.type === "FAM" && level === 1) {
      if (tag === "HUSB") record.husband = value.trim();
      else if (tag === "WIFE") record.wife = value.trim();
      else if (tag === "CHIL") record.children.push(value.trim());
    }
  });
  const idMap = new Map([...individuals.keys()].map((pointer) => [pointer, idFactory()]));
  const people = [...individuals.values()].map((person) => ({
    id: idMap.get(person.pointer),
    gedcomId: person.pointer,
    fullName: person.name,
    sex: person.sex,
    dateOfBirth: exactDate(person.birthText),
    dateOfDeath: exactDate(person.deathText),
    gedcomBirthDate: person.birthText,
    gedcomDeathDate: person.deathText,
    isDeceased: person.isDeceased,
    fatherId: "",
    motherId: "",
    spouseIds: [],
    designations: [],
    notes: "",
  }));
  const peopleById = new Map(people.map((person) => [person.id, person]));
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
    if (fatherId && motherId) {
      const father = peopleById.get(fatherId);
      const mother = peopleById.get(motherId);
      father.spouseIds = [...new Set([...father.spouseIds, motherId])];
      mother.spouseIds = [...new Set([...mother.spouseIds, fatherId])];
    }
  });
  return { people, individualCount: people.length, familyCount: families.length };
}

