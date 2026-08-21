import { isoDateToDisplay, isValidIsoDate } from "./dateFormat.js";
import { peopleWithEffectiveDeathDates, isRecordedDeceased } from "./deceasedStatus.js";
import {
  personDesignations,
  personDisplayName,
  personGivenNames,
  personSurname,
} from "./people.js";
import { findPartnerRelationship, partnerIdsForPerson } from "./partnerRelationships.js";
import { fractionForShare } from "./shares.js";
import { buildTaxReadinessIssues } from "./taxReadinessGuide.js";
import { operativeWill, personWills } from "./wills.js";

const text = (value) => String(value ?? "").trim();

const joinValues = (values, separator = "; ") => values.map(text).filter(Boolean).join(separator);

const shareLabel = (record = {}) => {
  const storedFraction = record.shareFraction || record.declaredShareFraction;
  if (storedFraction?.denominator) {
    return `${storedFraction.numerator}/${storedFraction.denominator}`;
  }
  if (
    record.declaredShareDenominator !== undefined ||
    record.declaredShareNumerator !== undefined
  ) {
    const numerator = Number(record.declaredShareNumerator);
    const denominator = Number(record.declaredShareDenominator);
    return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
      ? `${numerator}/${denominator}`
      : "";
  }
  if (record.denominator !== undefined || record.numerator !== undefined) {
    const numerator = Number(record.numerator);
    const denominator = Number(record.denominator);
    return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
      ? `${numerator}/${denominator}`
      : "";
  }
  const fraction = fractionForShare(record);
  return fraction.denominator ? `${fraction.numerator}/${fraction.denominator}` : "";
};

const actualName = (person = {}) =>
  joinValues([personGivenNames(person), personSurname(person)], " ") || text(person.fullName);

const partyName = (party, people) =>
  party ? actualName(party) || personDisplayName(party, people) : "Unknown person";

const relationshipSummary = (people, person, otherPerson) => {
  const relationship = findPartnerRelationship(people, person.id, otherPerson.id);
  const details = [
    relationship?.type === "partnership" ? "partnership" : "marriage",
    relationship?.startDate
      ? `from ${isoDateToDisplay(relationship.startDate)}`
      : relationship?.startYear
        ? `from ${relationship.startYear}`
        : "",
    relationship?.endDate ? `ended ${isoDateToDisplay(relationship.endDate)}` : "",
    relationship?.endReason ? relationship.endReason : "",
  ];
  const metadata = joinValues(details, ", ");
  return `${partyName(otherPerson, people)}${metadata ? ` (${metadata})` : ""}`;
};

const beneficiarySummary = (rows, partiesById) =>
  joinValues(
    (Array.isArray(rows) ? rows : []).map((row) => {
      const beneficiary = partiesById.get(text(row?.personId));
      return `${beneficiary ? beneficiary.name : "Beneficiary not selected"} ${shareLabel(row)}`.trim();
    }),
  );

const willSummary = (wills, applicableWill) =>
  joinValues(
    wills
      .filter((will) => will.id !== applicableWill?.id)
      .map((will) =>
        joinValues(
          [
            isoDateToDisplay(will.date) || will.date || "Undated will",
            will.notaryName ? `Not. ${will.notaryName}` : "Notary not recorded",
            will.description,
          ],
          " · ",
        ),
      ),
  );

const causaMortisSummary = (person, partiesById, property = {}) =>
  joinValues(
    (person.causaMortisDeclarations || []).map((declaration) => {
      const declarants = (declaration.declarantPersonIds || [])
        .map((id) => partiesById.get(text(id))?.name || "Unknown declarant")
        .join(", ");
      const value = text(declaration.immovablePropertyValue);
      const propertyLabel =
        declaration.propertyId === property.id
          ? property.address || "Current property"
          : declaration.propertyId || "Property not selected";
      return joinValues(
        [
          declaration.status === "complete" ? "Complete" : "Draft",
          propertyLabel,
          isoDateToDisplay(declaration.date) || declaration.date || "Date not recorded",
          declaration.notaryName ? `Not. ${declaration.notaryName}` : "Notary not recorded",
          `share ${shareLabel(declaration) || "not recorded"}`,
          value ? `EUR ${value}` : "value not recorded",
          declarants ? `declarants: ${declarants}` : "declarants not recorded",
        ],
        " · ",
      );
    }),
  );

const ownershipSummary = (person, property = {}) =>
  joinValues(
    (property.owners || [])
      .filter((owner) => text(owner.personId) === text(person.id))
      .map((owner) =>
        joinValues(
          [
            `${shareLabel(owner)} of ${property.address || "property"}`,
            owner.acquisitionDate
              ? `acquired ${isoDateToDisplay(owner.acquisitionDate) || owner.acquisitionDate}`
              : "acquisition date not recorded",
          ],
          " · ",
        ),
      ),
  );

const transferSummary = (person, property, partiesById) =>
  joinValues(
    (property.transfers || [])
      .filter(
        (transfer) =>
          text(transfer.sellerId) === text(person.id) || text(transfer.buyerId) === text(person.id),
      )
      .map((transfer) => {
        const outgoing = text(transfer.sellerId) === text(person.id);
        const counterpartyId = outgoing ? transfer.buyerId : transfer.sellerId;
        const counterparty = partiesById.get(text(counterpartyId))?.name || "party not selected";
        return joinValues(
          [
            `${outgoing ? "Transferred to" : "Acquired from"} ${counterparty}`,
            transfer.kind || "transfer",
            shareLabel(transfer),
            isoDateToDisplay(transfer.date) || transfer.date || "date not recorded",
          ],
          " · ",
        );
      }),
  );

const taxPositionSummary = (person, taxCalculationReport = {}) => {
  const vendor = (taxCalculationReport.vendors || []).find(
    (candidate) => text(candidate.id) === text(person.id),
  );
  if (!vendor) return "";
  const state = vendor.incompleteSourceCount > 0 ? "Tax data incomplete" : "Tax data calculated";
  return `${state} · current share ${shareLabel(vendor)}`;
};

const deathDisplay = (person, effectivePerson) => {
  if (isValidIsoDate(person.dateOfDeath)) return isoDateToDisplay(person.dateOfDeath);
  if (person.dateOfDeathUnknown === true) {
    return effectivePerson?.effectiveDateOfDeathAssumedFromSpouse && effectivePerson.dateOfDeath
      ? `Unknown (calculator assumes ${isoDateToDisplay(effectivePerson.dateOfDeath)} from spouse)`
      : "Unknown";
  }
  return "";
};

const addGap = (gaps, field, category, detail) => {
  const key = `${field}|${detail}`;
  if (gaps.some((gap) => gap.key === key)) return;
  gaps.push({ key, field, category, detail });
};

const readinessField = (issue = {}) => {
  const byCode = {
    "identity-names": "Name",
    "identity-surname": "Surname",
    "identity-sex": "Sex",
    "identity-surname-at-birth": "Surname at birth",
    "identity-surname-at-birth-review": "Surname at birth",
    "death-date": "Date of death",
    "required-spouse-death-date": "Date of death",
    "operative-will": "Will",
    "will-allocation": "Will beneficiaries",
    "survival-status": "Survival status",
    "initial-acquisition-date": "Original acquisition date",
    "donation-acquisition-value": "Donation Value",
    "donation-date-correction": "Donation date",
    "donor-original-acquisition-date": "Donor acquisition date",
    "causa-mortis-acquisition-value": "Causa Mortis value",
    "ownership-unresolved": "Ownership or succession data",
    "spouse-status-unresolved": "Marriage status",
    "causa-mortis-under": "Declaration Causa Mortis coverage",
    "causa-mortis-mixed": "Declaration Causa Mortis coverage",
    "causa-mortis-allocation-unresolved": "Declaration Causa Mortis declarants",
  };
  return (
    byCode[issue.code] ||
    text(issue.code)
      .split("-")
      .filter(Boolean)
      .map((word, index) =>
        index === 0 ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word,
      )
      .join(" ") ||
    "Legal or tax data"
  );
};

export function buildPersonDataExport({
  people = [],
  outsideParties = [],
  property = {},
  propertyReport = null,
  taxCalculationReport = null,
  readinessIssuesByPerson = null,
  familyPersonIds = null,
} = {}) {
  const normalizedPeople = Array.isArray(people) ? people : [];
  const effectivePeople = peopleWithEffectiveDeathDates(normalizedPeople);
  const effectivePeopleById = new Map(effectivePeople.map((person) => [text(person.id), person]));
  const activeFamilyPersonIds = Array.isArray(familyPersonIds)
    ? new Set(familyPersonIds.map(text).filter(Boolean))
    : null;
  const peopleById = new Map(normalizedPeople.map((person) => [text(person.id), person]));
  const partiesById = new Map([
    ...normalizedPeople.map((person) => [text(person.id), { ...person, name: actualName(person) }]),
    ...(outsideParties || []).map((party) => [
      text(party.id),
      { ...party, name: text(party.fullName || party.name) || "Unnamed outside party" },
    ]),
  ]);
  const legalAndTaxIssues =
    readinessIssuesByPerson ||
    buildTaxReadinessIssues({
      people: normalizedPeople,
      outsideParties,
      propertyReport,
      taxCalculationReport,
    });

  const rows = normalizedPeople.map((person) => {
    const surname = personSurname(person).trim();
    const name = personGivenNames(person).trim();
    const father = peopleById.get(text(person.fatherId));
    const mother = peopleById.get(text(person.motherId));
    const fatherName = father ? partyName(father, normalizedPeople) : "";
    const motherName = mother ? partyName(mother, normalizedPeople) : "";
    const parents = joinValues([
      fatherName && `Father: ${fatherName}`,
      motherName && `Mother: ${motherName}`,
    ]);
    const deceased = isRecordedDeceased(person);
    const wills = personWills(person);
    const applicableWill = operativeWill(person);
    const succession = deceased
      ? person.inheritanceBasis === "will"
        ? "Testate"
        : "Intestate"
      : "Not applicable (living)";
    const spouseIds = partnerIdsForPerson(normalizedPeople, person.id);
    const spouses = joinValues(
      spouseIds
        .map((id) => peopleById.get(text(id)))
        .filter(Boolean)
        .map((other) => relationshipSummary(normalizedPeople, person, other)),
    );
    const children = joinValues(
      normalizedPeople
        .filter((candidate) => candidate.fatherId === person.id || candidate.motherId === person.id)
        .map((candidate) => partyName(candidate, normalizedPeople)),
    );
    const siblingIds = new Set(person.siblingIds || []);
    normalizedPeople.forEach((candidate) => {
      if (candidate.id === person.id) return;
      if ((candidate.siblingIds || []).includes(person.id)) siblingIds.add(candidate.id);
      if (person.fatherId && candidate.fatherId === person.fatherId) siblingIds.add(candidate.id);
      if (person.motherId && candidate.motherId === person.motherId) siblingIds.add(candidate.id);
    });
    siblingIds.delete(person.id);
    const siblings = joinValues(
      [...siblingIds]
        .map((id) => peopleById.get(text(id)))
        .filter(Boolean)
        .map((candidate) => partyName(candidate, normalizedPeople)),
    );
    const gaps = [];
    if (!name) addGap(gaps, "Name", "Identity", "Enter the person's given name or names.");
    if (!surname) addGap(gaps, "Surname", "Identity", "Enter the person's surname.");
    if (!text(person.sex)) addGap(gaps, "Sex", "Identity", "Record the person's sex.");
    if (text(person.sex).toLowerCase() === "female" && !text(person.surnameAtBirth)) {
      addGap(gaps, "Surname at birth", "Identity", "Enter the woman's surname at birth.");
    }
    if (!fatherName) addGap(gaps, "Father", "Family details", "Father's name is not recorded.");
    if (!motherName) addGap(gaps, "Mother", "Family details", "Mother's name is not recorded.");
    // The date of birth is deliberately not a gap. It drives no succession or
    // tax outcome -- it is only a sanity check on ownership dates, a tie-break
    // when ordering people, and a column on the person sheet -- and a genealogy
    // routinely has no exact birth date for most of the family. Listing it made
    // the missing-data list mostly birth dates and buried the gaps that stop a
    // deed from being drawn. It is still carried as recorded data below, exactly
    // or as the source text the GEDCOM gave. The date of DEATH is a real gap and
    // is reported immediately below.
    if (deceased && !isValidIsoDate(person.dateOfDeath) && person.dateOfDeathUnknown !== true) {
      addGap(gaps, "Date of death", "Succession", "Enter the date of death or mark it unknown.");
    }
    if (deceased && person.inheritanceBasis === "will") {
      if (!applicableWill) {
        addGap(gaps, "Will date", "Succession", "Enter a valid operative will date.");
      } else if (!text(applicableWill.notaryName)) {
        addGap(gaps, "Will notary", "Succession", "Record the notary for the operative will.");
      }
    }
    (person.causaMortisDeclarations || []).forEach((declaration) => {
      if (declaration.status !== "complete") {
        addGap(
          gaps,
          "Declaration Causa Mortis",
          "Succession",
          "Complete the draft Declaration Causa Mortis record.",
        );
      }
    });
    (legalAndTaxIssues[person.id] || []).forEach((issue) => {
      const field = readinessField(issue);
      const alreadyCoveredIdentityOrDeath =
        ["Name", "Surname", "Sex", "Surname at birth", "Date of death"].includes(field) &&
        gaps.some((gap) => gap.field === field);
      if (!alreadyCoveredIdentityOrDeath) {
        addGap(gaps, field, "Legal / tax calculation", issue.prompt);
      }
    });

    const initialOwnership = ownershipSummary(person, property);
    const transfers = transferSummary(person, property, partiesById);
    const taxPosition = taxPositionSummary(person, taxCalculationReport || {});
    const available = [
      surname && "Surname",
      name && "Name",
      parents && "Parents",
      isValidIsoDate(person.dateOfBirth) && "Date of birth",
      !isValidIsoDate(person.dateOfBirth) &&
        text(person.gedcomBirthDate) &&
        `Date of birth as recorded (${text(person.gedcomBirthDate)})`,
      text(person.sex) && "Sex",
      text(person.surnameAtBirth) && "Surname at birth",
      deceased && "Death status",
      deceased && (person.dateOfDeath || person.dateOfDeathUnknown) && "Date of death status",
      deceased && "Succession basis",
      wills.length && "Will records",
      person.willHeirs?.length && "Will beneficiaries",
      person.intestateHeirs?.length && "Recorded intestate heirs",
      person.causaMortisDeclarations?.length && "Declaration Causa Mortis",
      spouses && "Spouse / partner details",
      children && "Children",
      siblings && "Siblings",
      initialOwnership && "Initial ownership",
      transfers && "Lifetime property transfers",
      taxPosition && "Tax position",
      text(person.notes) && "Notes",
    ].filter(Boolean);

    return {
      personId: text(person.id),
      surname,
      name,
      parents,
      dateOfDeath: deathDisplay(person, effectivePeopleById.get(text(person.id))),
      succession,
      willDate: applicableWill ? isoDateToDisplay(applicableWill.date) : "",
      willNotary: text(applicableWill?.notaryName),
      willDescription: text(applicableWill?.description),
      dataStatus: gaps.length ? "Missing data" : "Available data complete",
      familyTreeStatus:
        activeFamilyPersonIds && !activeFamilyPersonIds.has(text(person.id))
          ? "Retained legal / tax identity (not shown in current family tree)"
          : "Shown in current family tree",
      missingData: gaps.map((gap) => gap.field).join("; "),
      availableData: available.join("; "),
      surnameAtBirth: text(person.surnameAtBirth),
      sex: text(person.sex),
      dateOfBirth: isoDateToDisplay(person.dateOfBirth),
      father: fatherName,
      mother: motherName,
      spouses,
      children,
      siblings,
      designations: personDesignations(person).join("; "),
      maritalStatusAtDeath: deceased
        ? person.unmarriedOrWidowedAtDeath === true
          ? "Confirmed no spouse survived"
          : "Not confirmed"
        : "Not applicable",
      otherWills: willSummary(wills, applicableWill),
      willBeneficiaries: beneficiarySummary(person.willHeirs, partiesById),
      willBeneficiariesConfirmed:
        person.inheritanceBasis === "will"
          ? person.willHeirsConfirmed === true
            ? "Yes"
            : "No"
          : "Not applicable",
      intestateHeirs: beneficiarySummary(person.intestateHeirs, partiesById),
      intestateHeirsConfirmed:
        deceased && person.inheritanceBasis !== "will"
          ? person.intestateHeirsConfirmed === true
            ? "Yes"
            : "No"
          : "Not applicable",
      survivalStatus: person.survivalStatusRequired
        ? person.survivalStatusConfirmed || "Not confirmed"
        : "Not applicable",
      causaMortis: causaMortisSummary(person, partiesById, property),
      initialOwnership,
      transfers,
      taxPosition,
      gedcomBirthDate: text(person.gedcomBirthDate),
      gedcomDeathDate: text(person.gedcomDeathDate),
      gedcomId: text(person.gedcomId),
      notes: text(person.notes),
      gaps,
    };
  });

  rows.sort(
    (left, right) =>
      left.surname.localeCompare(right.surname, "en-MT", { sensitivity: "base", numeric: true }) ||
      left.name.localeCompare(right.name, "en-MT", { sensitivity: "base", numeric: true }) ||
      left.personId.localeCompare(right.personId),
  );

  const missingRows = rows.flatMap((row) =>
    row.gaps.map((gap) => ({
      personId: row.personId,
      surname: row.surname,
      name: row.name,
      parents: row.parents,
      familyTreeStatus: row.familyTreeStatus,
      field: gap.field,
      category: gap.category,
      detail: gap.detail,
    })),
  );

  return { rows, missingRows };
}
