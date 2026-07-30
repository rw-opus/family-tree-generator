import { describe, expect, it } from "vitest";
import {
  applyParentSuggestions,
  solePartnerParentSuggestions,
} from "../../src/domain/parentSuggestions.js";

describe("parent suggestions", () => {
  it("suggests a sole partner without mutating the child", () => {
    const people = [
      { id: "father", spouseIds: ["partner"] },
      { id: "partner", spouseIds: ["father"] },
      { id: "child", fatherId: "father", motherId: "" },
    ];

    expect(solePartnerParentSuggestions(people)).toEqual([
      {
        personId: "child",
        field: "motherId",
        suggestedPersonId: "partner",
        viaParentId: "father",
      },
    ]);
    expect(people[2].motherId).toBe("");
  });

  it("does not suggest an ambiguous partner or a dismissed parent field", () => {
    expect(
      solePartnerParentSuggestions([
        { id: "father", spouseIds: ["one", "two"] },
        { id: "one" },
        { id: "two" },
        { id: "child", fatherId: "father" },
      ]),
    ).toEqual([]);
    expect(
      solePartnerParentSuggestions([
        { id: "father", spouseIds: ["partner"] },
        { id: "partner" },
        {
          id: "child",
          fatherId: "father",
          motherExplicitlyUnassigned: true,
        },
      ]),
    ).toEqual([]);
  });

  it("finds reverse partner links and applies only accepted suggestions", () => {
    const people = [
      { id: "mother" },
      { id: "partner", spouseIds: ["mother"] },
      { id: "child", motherId: "mother" },
    ];
    const [suggestion] = solePartnerParentSuggestions(people);

    expect(suggestion).toEqual({
      personId: "child",
      field: "fatherId",
      suggestedPersonId: "partner",
      viaParentId: "mother",
    });
    expect(applyParentSuggestions(people, [])).toBe(people);
    expect(applyParentSuggestions(people, [suggestion])[2].fatherId).toBe("partner");
  });
});
