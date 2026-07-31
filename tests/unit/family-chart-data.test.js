import { describe, expect, it } from "vitest";
import {
  buildFamilyChartData,
  familyChartRelationship,
} from "../../src/components/familyTree/familyChartData.js";

describe("family-chart data adapter", () => {
  it("creates reciprocal parent, child and spouse relationships", () => {
    const { data } = buildFamilyChartData([
      { id: "father", fullName: "Joseph Borg", sex: "Male", spouseIds: ["mother"] },
      { id: "mother", fullName: "Maria Vella", sex: "Female" },
      {
        id: "child",
        fullName: "Anna Borg",
        sex: "Female",
        fatherId: "father",
        motherId: "mother",
      },
    ]);
    const byId = new Map(data.map((person) => [person.id, person]));

    expect(byId.get("father").rels).toEqual({
      parents: [],
      spouses: ["mother"],
      children: ["child"],
    });
    expect(byId.get("mother").rels).toEqual({
      parents: [],
      spouses: ["father"],
      children: ["child"],
    });
    expect(byId.get("child").rels.parents).toEqual(["father", "mother"]);
    expect(byId.get("child").data.gender).toBe("F");
  });

  it("uses a shared child as a partnership without inventing a marriage", () => {
    const { relationshipByPair } = buildFamilyChartData([
      { id: "first", fullName: "Joseph Borg" },
      { id: "second", fullName: "Maria Vella" },
      { id: "child", fullName: "Anna Borg", fatherId: "first", motherId: "second" },
    ]);

    expect(familyChartRelationship(relationshipByPair, "first", "second").type).toBe("partnership");
  });

  it("starts with the root that covers the largest descendant branch", () => {
    const { rootId, data } = buildFamilyChartData([
      { id: "unrelated", fullName: "Unrelated Person" },
      { id: "root", fullName: "Anthony Borg" },
      { id: "child", fullName: "Joseph Borg", fatherId: "root" },
      { id: "grandchild", fullName: "Anna Borg", fatherId: "child" },
    ]);

    expect(rootId).toBe("root");
    expect(data[0].id).toBe("root");
  });
});
