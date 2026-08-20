import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/domain/deceasedStatus.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    effectiveDateOfDeath: vi.fn(actual.effectiveDateOfDeath),
    peopleWithEffectiveDeathDates: vi.fn(actual.peopleWithEffectiveDeathDates),
  };
});

vi.mock("../../src/domain/partnerRelationships.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    findPartnerRelationship: vi.fn(actual.findPartnerRelationship),
    normalizePartnerRelationships: vi.fn(actual.normalizePartnerRelationships),
    partnerIdsForPerson: vi.fn(actual.partnerIdsForPerson),
  };
});

import {
  applyOlderGenerationDeathAssumptions,
  effectiveDateOfDeath,
  isMarkedDeceased,
  isRecordedDeceased,
  peopleWithEffectiveDeathDates,
} from "../../src/domain/deceasedStatus.js";
import { isValidIsoDate } from "../../src/domain/dateFormat.js";
import {
  deriveNoSurvivingSpouseAtDeath,
  MARITAL_STATUS_AT_DEATH_SOURCES,
  synchroniseMaritalStatusAtDeath,
} from "../../src/domain/maritalStatusAtDeath.js";
import {
  findPartnerRelationship,
  normalizePartnerRelationships,
  PARTNER_RELATIONSHIP_TYPES,
  partnerIdsForPerson,
} from "../../src/domain/partnerRelationships.js";
import { isPotentialParentSurvivalUnresolved } from "../../src/domain/potentialParentSurvival.js";

const person = (id, patch = {}) => ({
  id,
  fullName: id,
  spouseIds: [],
  partnerRelationships: [],
  designations: [],
  ...patch,
});

// This is the pre-index implementation retained as an executable specification
// for the optimization. It deliberately uses the public whole-family helpers
// on every lookup, exactly as synchroniseMaritalStatusAtDeath used to do.
function referenceDeriveNoSurvivingSpouseAtDeath(people = [], personId) {
  const peopleById = new Map(people.map((candidate) => [candidate.id, candidate]));
  const subject = peopleById.get(personId);
  if (!subject || !isMarkedDeceased(subject)) return null;

  const deathDate = effectiveDateOfDeath(people, personId);
  let hasMarriage = false;
  let survivalUnresolved = false;

  for (const spouseId of partnerIdsForPerson(people, personId)) {
    const spouse = peopleById.get(spouseId);
    const relationship = findPartnerRelationship(people, personId, spouseId);
    if (!spouse || relationship?.type !== PARTNER_RELATIONSHIP_TYPES.MARRIAGE) continue;
    hasMarriage = true;

    const relationshipEndDate = isValidIsoDate(relationship.endDate) ? relationship.endDate : "";
    if (relationship.endReason && !relationshipEndDate) {
      survivalUnresolved = true;
      continue;
    }
    if (relationshipEndDate) {
      if (!deathDate) {
        survivalUnresolved = true;
        continue;
      }
      if (relationshipEndDate <= deathDate) continue;
    }

    if (isPotentialParentSurvivalUnresolved(spouse)) {
      survivalUnresolved = true;
      continue;
    }
    if (!isRecordedDeceased(spouse)) return false;
    const spouseDeathDate = effectiveDateOfDeath(people, spouse.id);
    if (!deathDate || !isValidIsoDate(spouseDeathDate)) {
      survivalUnresolved = true;
      continue;
    }
    if (spouseDeathDate > deathDate) return false;
  }

  if (!hasMarriage) return true;
  return survivalUnresolved ? null : true;
}

function referenceSynchroniseMaritalStatusAtDeath(people = []) {
  return people.map((candidate) => {
    const derived = referenceDeriveNoSurvivingSpouseAtDeath(people, candidate.id);
    if (derived !== null) {
      if (
        candidate.unmarriedOrWidowedAtDeath === derived &&
        candidate.unmarriedOrWidowedAtDeathSource === MARITAL_STATUS_AT_DEATH_SOURCES.AUTOMATIC
      ) {
        return candidate;
      }
      return {
        ...candidate,
        unmarriedOrWidowedAtDeath: derived,
        unmarriedOrWidowedAtDeathSource: MARITAL_STATUS_AT_DEATH_SOURCES.AUTOMATIC,
      };
    }

    if (candidate.unmarriedOrWidowedAtDeathSource === MARITAL_STATUS_AT_DEATH_SOURCES.MANUAL) {
      return candidate;
    }
    if (
      candidate.unmarriedOrWidowedAtDeath === true &&
      !candidate.unmarriedOrWidowedAtDeathSource
    ) {
      return {
        ...candidate,
        unmarriedOrWidowedAtDeathSource: MARITAL_STATUS_AT_DEATH_SOURCES.MANUAL,
      };
    }
    if (candidate.unmarriedOrWidowedAtDeathSource !== MARITAL_STATUS_AT_DEATH_SOURCES.AUTOMATIC) {
      return candidate;
    }
    if (candidate.unmarriedOrWidowedAtDeath === false) return candidate;
    return { ...candidate, unmarriedOrWidowedAtDeath: false };
  });
}

function couple({ subject = {}, spouse = {}, relationship = null } = {}) {
  return [
    person("subject", {
      spouseIds: ["spouse"],
      ...(relationship
        ? {
            partnerRelationships: [
              {
                personId: "spouse",
                type: PARTNER_RELATIONSHIP_TYPES.MARRIAGE,
                ...relationship,
              },
            ],
          }
        : {}),
      ...subject,
    }),
    person("spouse", { spouseIds: ["subject"], ...spouse }),
  ];
}

describe("marital status at death indexing", () => {
  it("is equivalent to the previous derivation across death and relationship states", () => {
    const subjectStates = [
      { label: "alive", patch: {} },
      { label: "exact death", patch: { isDeceased: true, dateOfDeath: "2020-01-01" } },
      { label: "unknown death", patch: { isDeceased: true, dateOfDeathUnknown: true } },
      { label: "undated death", patch: { isDeceased: true } },
    ];
    const spouseStates = [
      { label: "alive", patch: {} },
      { label: "died before", patch: { isDeceased: true, dateOfDeath: "2019-01-01" } },
      { label: "died same day", patch: { isDeceased: true, dateOfDeath: "2020-01-01" } },
      { label: "died after", patch: { isDeceased: true, dateOfDeath: "2021-01-01" } },
      { label: "death unknown", patch: { isDeceased: true, dateOfDeathUnknown: true } },
      { label: "undated death", patch: { isDeceased: true } },
      {
        label: "potential parent unresolved",
        patch: { isDeceased: true, isPotentialIntestateParent: true },
      },
    ];
    const relationships = [
      { label: "legacy marriage", patch: null },
      { label: "recorded marriage", patch: { type: "marriage" } },
      { label: "partnership", patch: { type: "partnership" } },
      {
        label: "ended before death",
        patch: { type: "marriage", endReason: "divorce", endDate: "2018-01-01" },
      },
      {
        label: "ended after death",
        patch: { type: "marriage", endReason: "divorce", endDate: "2022-01-01" },
      },
      { label: "end date unresolved", patch: { type: "marriage", endReason: "divorce" } },
    ];

    subjectStates.forEach((subjectState) => {
      spouseStates.forEach((spouseState) => {
        relationships.forEach((relationship) => {
          const people = couple({
            subject: subjectState.patch,
            spouse: spouseState.patch,
            relationship: relationship.patch,
          });
          const label = `${subjectState.label}; ${spouseState.label}; ${relationship.label}`;

          expect(deriveNoSurvivingSpouseAtDeath(people, "subject"), label).toBe(
            referenceDeriveNoSurvivingSpouseAtDeath(people, "subject"),
          );
          expect(synchroniseMaritalStatusAtDeath(people), label).toEqual(
            referenceSynchroniseMaritalStatusAtDeath(people),
          );
        });
      });
    });
  });

  it("preserves older-generation and spouse-date assumptions", () => {
    const rawPeople = [
      ...couple({
        spouse: { isDeceased: true, dateOfDeath: "1910-03-04" },
      }),
      person("child", { fatherId: "subject" }),
      person("grandchild", { fatherId: "child" }),
    ];
    expect(deriveNoSurvivingSpouseAtDeath(rawPeople, "subject")).toBeNull();

    const people = applyOlderGenerationDeathAssumptions(rawPeople);
    expect(people[0]).toMatchObject({ isDeceased: true, dateOfDeathUnknown: true });
    expect(deriveNoSurvivingSpouseAtDeath(people, "subject")).toBe(true);

    expect(deriveNoSurvivingSpouseAtDeath(people, "subject")).toBe(
      referenceDeriveNoSurvivingSpouseAtDeath(people, "subject"),
    );
    expect(synchroniseMaritalStatusAtDeath(people)).toEqual(
      referenceSynchroniseMaritalStatusAtDeath(people),
    );
  });

  it("builds each whole-family index once regardless of family size", () => {
    [20, 500].forEach((size) => {
      vi.mocked(effectiveDateOfDeath).mockClear();
      vi.mocked(peopleWithEffectiveDeathDates).mockClear();
      vi.mocked(findPartnerRelationship).mockClear();
      vi.mocked(normalizePartnerRelationships).mockClear();
      vi.mocked(partnerIdsForPerson).mockClear();

      const people = Array.from({ length: size }, (_, index) =>
        person(`person-${index}`, {
          isDeceased: true,
          dateOfDeath: "2020-01-01",
          spouseIds: [`person-${index % 2 === 0 ? index + 1 : index - 1}`],
        }),
      );
      synchroniseMaritalStatusAtDeath(people);

      expect(effectiveDateOfDeath).not.toHaveBeenCalled();
      expect(peopleWithEffectiveDeathDates).toHaveBeenCalledTimes(1);
      expect(findPartnerRelationship).not.toHaveBeenCalled();
      expect(normalizePartnerRelationships).toHaveBeenCalledTimes(1);
      expect(partnerIdsForPerson).not.toHaveBeenCalled();
    });
  });
});
