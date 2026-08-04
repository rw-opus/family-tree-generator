import { describe, expect, it } from "vitest";
import {
  findPartnerRelationship,
  legalSpouseIdsForPerson,
  linkPartnerRelationship,
  normalizePartnerRelationships,
  partnerIdsForPerson,
  partnerRelationshipAnnotation,
  partnerRelationshipKey,
  partnerLinkEligibility,
  partnerRelationshipStatusAt,
  removePartnerRelationship,
  upsertPartnerRelationship,
} from "../../src/domain/partnerRelationships.js";

describe("partner relationship metadata", () => {
  it("treats existing spouseIds as a marriage and makes the topology reciprocal", () => {
    const normalized = normalizePartnerRelationships([
      { id: "edgar", spouseIds: ["giovanna"] },
      { id: "giovanna", spouseIds: [] },
    ]);

    expect(normalized[1].spouseIds).toEqual(["edgar"]);
    expect(findPartnerRelationship(normalized, "edgar", "giovanna")).toEqual({
      key: "edgar::giovanna",
      personIds: ["edgar", "giovanna"],
      type: "marriage",
      startDate: "",
      startYear: "",
      inferredFromLegacySpouseIds: true,
    });
    expect(legalSpouseIdsForPerson(normalized, "giovanna")).toEqual(["edgar"]);
  });

  it("stores one canonical metadata record and supports lookup from either side", () => {
    const people = upsertPartnerRelationship(
      [
        { id: "zoe", spouseIds: [] },
        { id: "anna", spouseIds: [] },
      ],
      "zoe",
      "anna",
      {
        type: "partnership",
        startDate: "2015-06-12",
      },
    );

    expect(people.find((person) => person.id === "anna").partnerRelationships).toEqual([
      {
        personId: "zoe",
        type: "partnership",
        startDate: "2015-06-12",
      },
    ]);
    expect(people.find((person) => person.id === "zoe").partnerRelationships).toBeUndefined();
    expect(people.find((person) => person.id === "anna").spouseIds).toEqual(["zoe"]);
    expect(people.find((person) => person.id === "zoe").spouseIds).toEqual(["anna"]);
    expect(findPartnerRelationship(people, "anna", "zoe")).toEqual(
      findPartnerRelationship(people, "zoe", "anna"),
    );
    expect(legalSpouseIdsForPerson(people, "anna")).toEqual([]);
    expect(partnerIdsForPerson(people, "anna")).toEqual(["zoe"]);
  });

  it("deduplicates reciprocal metadata and prefers the canonical owner's details", () => {
    const normalized = normalizePartnerRelationships([
      {
        id: "a",
        spouseIds: ["b"],
        partnerRelationships: [
          { personId: "b", type: "partnership", startYear: "2017" },
          { personId: "b", type: "partnership", startYear: "2017" },
        ],
      },
      {
        id: "b",
        spouseIds: ["a"],
        partnerRelationships: [{ personId: "a", type: "marriage", startDate: "2018-04-03" }],
      },
    ]);

    expect(normalized[0].partnerRelationships).toEqual([
      {
        personId: "b",
        type: "partnership",
        startDate: "2018-04-03",
      },
    ]);
    expect(normalized[1].partnerRelationships).toEqual([]);
    expect(findPartnerRelationship(normalized, "b", "a")).toMatchObject({
      type: "partnership",
      startDate: "2018-04-03",
      startYear: "2018",
      inferredFromLegacySpouseIds: false,
    });
  });

  it("supports a year-only marriage and compact line annotations", () => {
    const people = upsertPartnerRelationship(
      [
        { id: "a", spouseIds: ["b"] },
        { id: "b", spouseIds: ["a"] },
      ],
      "a",
      "b",
      { type: "marriage", startDate: "", startYear: 2015 },
    );
    const marriage = findPartnerRelationship(people, "a", "b");

    expect(marriage).toMatchObject({
      type: "marriage",
      startDate: "",
      startYear: "2015",
    });
    expect(partnerRelationshipAnnotation(marriage)).toBe("m. 2015");
    expect(
      partnerRelationshipAnnotation({
        type: "partnership",
        startDate: "2015-06-12",
      }),
    ).toBe("12/06/2015");
    expect(partnerRelationshipAnnotation({ type: "partnership" })).toBe("");
  });

  it("can convert a legacy marriage to an unmarried partnership without losing topology", () => {
    const people = upsertPartnerRelationship(
      [
        { id: "a", spouseIds: ["b"] },
        { id: "b", spouseIds: ["a"] },
      ],
      "b",
      "a",
      { type: "cohabitation", startYear: "2020" },
    );

    expect(findPartnerRelationship(people, "a", "b")).toMatchObject({
      type: "partnership",
      startYear: "2020",
      inferredFromLegacySpouseIds: false,
    });
    expect(people[0].spouseIds).toEqual(["b"]);
    expect(people[1].spouseIds).toEqual(["a"]);
    expect(legalSpouseIdsForPerson(people, "b")).toEqual([]);
  });

  it("tracks when a marriage ended and evaluates whether it was active on a date", () => {
    const people = upsertPartnerRelationship(
      [
        { id: "a", spouseIds: ["b"] },
        { id: "b", spouseIds: ["a"] },
      ],
      "a",
      "b",
      {
        type: "marriage",
        startDate: "2000-01-01",
        endDate: "2015-02-03",
        endReason: "divorce",
      },
    );
    const marriage = findPartnerRelationship(people, "a", "b");

    expect(marriage).toMatchObject({
      startDate: "2000-01-01",
      endDate: "2015-02-03",
      endReason: "divorce",
    });
    expect(partnerRelationshipStatusAt(marriage, "2010-01-01")).toBe("active");
    expect(partnerRelationshipStatusAt(marriage, "2020-01-01")).toBe("ended");
    expect(legalSpouseIdsForPerson(people, "a", "2010-01-01")).toEqual(["b"]);
    expect(legalSpouseIdsForPerson(people, "a", "2020-01-01")).toEqual([]);
    expect(partnerRelationshipAnnotation(marriage)).toBe("m. 2000\u20132015");
  });

  it("removes reciprocal topology and metadata together", () => {
    const linked = upsertPartnerRelationship(
      [
        { id: "a", spouseIds: [] },
        { id: "b", spouseIds: [] },
      ],
      "a",
      "b",
      { type: "partnership", startYear: "2020" },
    );
    const unlinked = removePartnerRelationship(linked, "b", "a");

    expect(unlinked[0].spouseIds).toEqual([]);
    expect(unlinked[1].spouseIds).toEqual([]);
    expect(unlinked[0].partnerRelationships).toEqual([]);
    expect(findPartnerRelationship(unlinked, "a", "b")).toBeNull();
  });

  it("rejects self-links, missing people and invalid dates", () => {
    const people = [
      { id: "a", spouseIds: [] },
      { id: "b", spouseIds: [] },
    ];

    expect(partnerRelationshipKey("a", "a")).toBe("");
    expect(upsertPartnerRelationship(people, "a", "missing", { type: "marriage" })).toBe(people);

    const linked = upsertPartnerRelationship(people, "a", "b", {
      type: "marriage",
      startDate: "31-02-2020",
      startYear: "not-a-year",
    });
    expect(findPartnerRelationship(linked, "a", "b")).toMatchObject({
      startDate: "",
      startYear: "",
    });
  });

  it("allows opposite-sex cousins but blocks closer blood relations and the direct line", () => {
    const people = [
      { id: "grandfather", sex: "Male" },
      { id: "grandmother", sex: "Female" },
      {
        id: "mother",
        sex: "Female",
        fatherId: "grandfather",
        motherId: "grandmother",
      },
      {
        id: "uncle",
        sex: "Male",
        fatherId: "grandfather",
        motherId: "grandmother",
      },
      { id: "father", sex: "Male" },
      { id: "person", sex: "Female", fatherId: "father", motherId: "mother" },
      { id: "brother", sex: "Male", fatherId: "father", motherId: "mother" },
      { id: "recorded-brother", sex: "Male", siblingIds: ["person"] },
      { id: "cousin", sex: "Male", fatherId: "uncle" },
      { id: "unrelated", sex: "Male" },
      { id: "same-sex", sex: "Female" },
      { id: "unknown-sex", sex: "" },
    ];

    expect(partnerLinkEligibility(people, "person", "father").code).toBe("direct-blood-relative");
    expect(partnerLinkEligibility(people, "person", "brother").code).toBe("close-blood-relative");
    expect(partnerLinkEligibility(people, "person", "recorded-brother").code).toBe(
      "close-blood-relative",
    );
    expect(partnerLinkEligibility(people, "person", "uncle").code).toBe("close-blood-relative");
    expect(partnerLinkEligibility(people, "person", "same-sex").code).toBe("same-sex");
    expect(partnerLinkEligibility(people, "person", "unknown-sex").code).toBe("sex-required");
    expect(partnerLinkEligibility(people, "person", "cousin").allowed).toBe(true);
    expect(partnerLinkEligibility(people, "person", "unrelated").allowed).toBe(true);

    expect(linkPartnerRelationship(people, "person", "brother")).toBe(people);
    const linked = linkPartnerRelationship(people, "person", "cousin", {
      type: "marriage",
    });
    expect(partnerIdsForPerson(linked, "person")).toEqual(["cousin"]);
    expect(partnerIdsForPerson(linked, "cousin")).toEqual(["person"]);
  });
});
