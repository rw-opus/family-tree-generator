import { describe, expect, it } from "vitest";
import { reconcilePeopleUpdate, removePersonFromFamilyGroup } from "../../src/domain/caseModel.js";

const groupedCase = () => ({
  schemaVersion: 2,
  id: "case",
  title: "Two families",
  people: [
    { id: "root-a", fullName: "Root A" },
    { id: "owner-a", fullName: "Owner A" },
    { id: "root-b", fullName: "Root B" },
  ],
  familyGroups: [
    {
      id: "family-a",
      title: "Family A",
      rootPersonId: "root-a",
      personIds: ["root-a", "owner-a"],
    },
    {
      id: "family-b",
      title: "Family B",
      rootPersonId: "root-b",
      personIds: ["root-b"],
    },
  ],
  activeFamilyGroupId: "family-a",
  properties: [
    {
      id: "property",
      owners: [{ id: "initial-owner", personId: "owner-a", sharePercent: 100 }],
      transfers: [],
      saleLots: [],
      declarations: [],
    },
  ],
});

describe("case-wide people updates", () => {
  it("replaces only the active GEDCOM group and preserves other groups and property identities", () => {
    const importedPeople = [
      { id: "gedcom-parent", fullName: "Imported Parent" },
      {
        id: "gedcom-child",
        fullName: "Imported Child",
        fatherId: "gedcom-parent",
      },
    ];

    const result = reconcilePeopleUpdate(groupedCase(), "family-a", importedPeople);

    expect(result.familyGroups.find((group) => group.id === "family-a")).toMatchObject({
      rootPersonId: "gedcom-parent",
      personIds: ["gedcom-parent", "gedcom-child"],
    });
    expect(result.familyGroups.find((group) => group.id === "family-b").personIds).toEqual([
      "root-b",
    ]);
    expect(result.people.map((person) => person.id)).toEqual(
      expect.arrayContaining(["gedcom-parent", "gedcom-child", "root-b", "root-a", "owner-a"]),
    );
    expect(result.properties[0].owners[0].personId).toBe("owner-a");
  });

  it("honours an explicit GEDCOM replacement even when imported IDs already exist", () => {
    const result = reconcilePeopleUpdate(
      groupedCase(),
      "family-a",
      [{ id: "root-a", fullName: "Updated Root A" }],
      { replaceFamilyGroup: true },
    );

    expect(result.familyGroups.find((group) => group.id === "family-a")).toMatchObject({
      rootPersonId: "root-a",
      personIds: ["root-a"],
    });
    expect(result.familyGroups.find((group) => group.id === "family-b").personIds).toEqual([
      "root-b",
    ]);
    expect(result.people.find((person) => person.id === "root-a").fullName).toBe("Updated Root A");
    expect(result.people.some((person) => person.id === "root-b")).toBe(true);
    expect(result.people.some((person) => person.id === "owner-a")).toBe(true);
  });

  it("adds existing parents and partners to the active family group when linked", () => {
    const input = groupedCase();
    input.people.push(
      { id: "mother-b", fullName: "Mother B" },
      { id: "partner-b", fullName: "Partner B", spouseIds: [] },
    );
    input.familyGroups[1].personIds.push("mother-b", "partner-b");
    const updatedPeople = input.people.map((person) =>
      person.id === "root-a"
        ? {
            ...person,
            fatherId: "root-b",
            motherId: "mother-b",
            spouseIds: ["partner-b"],
          }
        : person,
    );

    const result = reconcilePeopleUpdate(input, "family-a", updatedPeople);
    const activeGroup = result.familyGroups.find((group) => group.id === "family-a");

    expect(activeGroup.personIds).toEqual(
      expect.arrayContaining(["root-a", "owner-a", "root-b", "mother-b", "partner-b"]),
    );
    expect(result.people.filter((person) => person.id === "root-b")).toHaveLength(1);
    expect(result.people.filter((person) => person.id === "mother-b")).toHaveLength(1);
    expect(result.people.filter((person) => person.id === "partner-b")).toHaveLength(1);
  });

  it("does not restore a shared relative removed from the active family on an unrelated add", () => {
    const input = groupedCase();
    input.people = input.people.map((person) =>
      person.id === "owner-a" ? { ...person, fatherId: "root-a" } : person,
    );
    input.familyGroups[1].personIds.push("root-a");

    const removed = removePersonFromFamilyGroup(input, "family-a", "root-a");
    const result = reconcilePeopleUpdate(removed, "family-a", [
      ...removed.people,
      { id: "new-person", fullName: "New Person" },
    ]);

    expect(result.familyGroups.find((group) => group.id === "family-a").personIds).toEqual([
      "owner-a",
      "new-person",
    ]);
    expect(result.familyGroups.find((group) => group.id === "family-b").personIds).toEqual([
      "root-b",
      "root-a",
    ]);
    expect(result.people.some((person) => person.id === "root-a")).toBe(true);
  });
});
