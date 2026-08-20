import { describe, expect, it } from "vitest";
import {
  deriveNoSurvivingSpouseAtDeath,
  MARITAL_STATUS_AT_DEATH_SOURCES,
  synchroniseMaritalStatusAtDeath,
} from "../../src/domain/maritalStatusAtDeath.js";
import { normalizeCase } from "../../src/domain/caseModel.js";

const person = (id, patch = {}) => ({
  id,
  fullName: id,
  spouseIds: [],
  partnerRelationships: [],
  designations: [],
  ...patch,
});

const marriedPeople = ({ subject = {}, spouse = {}, relationship = {} } = {}) => [
  person("subject", {
    isDeceased: true,
    dateOfDeath: "2020-01-01",
    spouseIds: ["spouse"],
    partnerRelationships: [
      {
        id: "marriage",
        personIds: ["subject", "spouse"],
        personId: "spouse",
        type: "marriage",
        ...relationship,
      },
    ],
    ...subject,
  }),
  person("spouse", { spouseIds: ["subject"], ...spouse }),
];

describe("marital status at death", () => {
  it("finds no surviving spouse when no legal spouse is recorded", () => {
    expect(
      deriveNoSurvivingSpouseAtDeath(
        [person("subject", { isDeceased: true, dateOfDeath: "2020-01-01" })],
        "subject",
      ),
    ).toBe(true);
  });

  it("treats a spouse who died before or on the same day as not surviving", () => {
    expect(
      deriveNoSurvivingSpouseAtDeath(
        marriedPeople({ spouse: { isDeceased: true, dateOfDeath: "2019-12-31" } }),
        "subject",
      ),
    ).toBe(true);
    expect(
      deriveNoSurvivingSpouseAtDeath(
        marriedPeople({ spouse: { isDeceased: true, dateOfDeath: "2020-01-01" } }),
        "subject",
      ),
    ).toBe(true);
  });

  it("uses the known spouse's date when the linked spouse's death date is unknown", () => {
    expect(
      deriveNoSurvivingSpouseAtDeath(
        marriedPeople({ spouse: { isDeceased: true, dateOfDeathUnknown: true } }),
        "subject",
      ),
    ).toBe(true);
  });

  it("keeps the status off when a spouse lived beyond the subject or remains alive", () => {
    expect(
      deriveNoSurvivingSpouseAtDeath(
        marriedPeople({ spouse: { isDeceased: true, dateOfDeath: "2021-01-01" } }),
        "subject",
      ),
    ).toBe(false);
    expect(deriveNoSurvivingSpouseAtDeath(marriedPeople(), "subject")).toBe(false);
  });

  it("does not guess when either required death date is missing", () => {
    expect(
      deriveNoSurvivingSpouseAtDeath(
        marriedPeople({ spouse: { isDeceased: true, dateOfDeath: "" } }),
        "subject",
      ),
    ).toBeNull();
    expect(
      deriveNoSurvivingSpouseAtDeath(
        marriedPeople({
          subject: { dateOfDeath: "" },
          spouse: { isDeceased: true, dateOfDeath: "2019-01-01" },
        }),
        "subject",
      ),
    ).toBeNull();
  });

  it("handles several marriages conservatively", () => {
    const people = [
      person("subject", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        spouseIds: ["first", "second"],
      }),
      person("first", {
        isDeceased: true,
        dateOfDeath: "2010-01-01",
        spouseIds: ["subject"],
      }),
      person("second", {
        isDeceased: true,
        dateOfDeath: "2015-01-01",
        spouseIds: ["subject"],
      }),
    ];

    expect(deriveNoSurvivingSpouseAtDeath(people, "subject")).toBe(true);
    expect(
      deriveNoSurvivingSpouseAtDeath(
        people.map((candidate) =>
          candidate.id === "second" ? { ...candidate, dateOfDeath: "2025-01-01" } : candidate,
        ),
        "subject",
      ),
    ).toBe(false);
    expect(
      deriveNoSurvivingSpouseAtDeath(
        people.map((candidate) =>
          candidate.id === "second" ? { ...candidate, dateOfDeath: "" } : candidate,
        ),
        "subject",
      ),
    ).toBeNull();
  });

  it("ignores partnerships and marriages that ended before death", () => {
    expect(
      deriveNoSurvivingSpouseAtDeath(
        marriedPeople({ relationship: { type: "partnership" } }),
        "subject",
      ),
    ).toBe(true);
    expect(
      deriveNoSurvivingSpouseAtDeath(
        marriedPeople({ relationship: { endDate: "2018-01-01", endReason: "divorce" } }),
        "subject",
      ),
    ).toBe(true);
  });

  it("synchronises conclusive facts and clears a stale automatic answer when unresolved", () => {
    const withoutSpouse = [person("subject", { isDeceased: true, dateOfDeath: "2020-01-01" })];
    const checked = synchroniseMaritalStatusAtDeath(withoutSpouse);
    expect(checked[0]).toMatchObject({
      unmarriedOrWidowedAtDeath: true,
      unmarriedOrWidowedAtDeathSource: MARITAL_STATUS_AT_DEATH_SOURCES.AUTOMATIC,
    });

    const unresolved = synchroniseMaritalStatusAtDeath(
      marriedPeople({
        subject: checked[0],
        spouse: { isDeceased: true, dateOfDeath: "" },
      }),
    );
    expect(unresolved[0]).toMatchObject({
      unmarriedOrWidowedAtDeath: false,
      unmarriedOrWidowedAtDeathSource: MARITAL_STATUS_AT_DEATH_SOURCES.AUTOMATIC,
    });
  });

  it("recalculates automatically through the canonical case normalizer", () => {
    const initial = normalizeCase({
      id: "case",
      people: marriedPeople({
        spouse: { isDeceased: true, dateOfDeath: "2025-01-01" },
      }),
    });
    expect(initial.people.find((candidate) => candidate.id === "subject")).toMatchObject({
      unmarriedOrWidowedAtDeath: false,
      unmarriedOrWidowedAtDeathSource: MARITAL_STATUS_AT_DEATH_SOURCES.AUTOMATIC,
    });

    const changed = normalizeCase({
      ...initial,
      people: initial.people.map((candidate) =>
        candidate.id === "spouse" ? { ...candidate, dateOfDeath: "2015-01-01" } : candidate,
      ),
    });
    expect(changed.people.find((candidate) => candidate.id === "subject")).toMatchObject({
      unmarriedOrWidowedAtDeath: true,
      unmarriedOrWidowedAtDeathSource: MARITAL_STATUS_AT_DEATH_SOURCES.AUTOMATIC,
    });
  });

  it("does not alter an alive person's dormant marital-status field", () => {
    const people = [
      person("subject", {
        isDeceased: false,
        dateOfDeath: "2020-01-01",
        unmarriedOrWidowedAtDeath: false,
      }),
    ];

    expect(synchroniseMaritalStatusAtDeath(people)).toEqual(people);
  });

  it("lets conclusive spouse facts override a stale manual no-spouse answer", () => {
    const [subject, spouse] = marriedPeople({
      subject: {
        unmarriedOrWidowedAtDeath: true,
        unmarriedOrWidowedAtDeathSource: MARITAL_STATUS_AT_DEATH_SOURCES.MANUAL,
      },
    });

    expect(synchroniseMaritalStatusAtDeath([subject, spouse])[0]).toMatchObject({
      unmarriedOrWidowedAtDeath: false,
      unmarriedOrWidowedAtDeathSource: MARITAL_STATUS_AT_DEATH_SOURCES.AUTOMATIC,
    });
  });

  it("also repairs a stale legacy answer once spouse survival is conclusive", () => {
    const [subject, spouse] = marriedPeople({
      subject: { unmarriedOrWidowedAtDeath: true },
    });

    expect(synchroniseMaritalStatusAtDeath([subject, spouse])[0]).toMatchObject({
      unmarriedOrWidowedAtDeath: false,
      unmarriedOrWidowedAtDeathSource: MARITAL_STATUS_AT_DEATH_SOURCES.AUTOMATIC,
    });
  });

  it("preserves a manual answer only while spouse survival is unresolved", () => {
    const [subject, spouse] = marriedPeople({
      subject: {
        unmarriedOrWidowedAtDeath: true,
        unmarriedOrWidowedAtDeathSource: MARITAL_STATUS_AT_DEATH_SOURCES.MANUAL,
      },
      spouse: { isDeceased: true, dateOfDeath: "" },
    });

    expect(synchroniseMaritalStatusAtDeath([subject, spouse])[0]).toMatchObject({
      unmarriedOrWidowedAtDeath: true,
      unmarriedOrWidowedAtDeathSource: MARITAL_STATUS_AT_DEATH_SOURCES.MANUAL,
    });
  });
});
