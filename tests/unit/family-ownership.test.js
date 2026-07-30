import { describe, expect, it } from "vitest";
import {
  buildAutomaticFamilyOwnership,
  buildFamilyPropertyOwnership,
  buildPropertyOwnership,
  intestacyAllocationSignature,
  intestateAllocations,
} from "../../src/domain/familyOwnership.js";

const person = (id, patch = {}) => ({
  id,
  fullName: id,
  fatherId: "",
  motherId: "",
  spouseIds: [],
  siblingIds: [],
  designations: [],
  ...patch,
});

describe("automatic family ownership", () => {
  it("assumes a sole living person owns the whole property", () => {
    const result = buildAutomaticFamilyOwnership([person("owner")]);
    expect(result.ownershipByPerson.owner).toBe(1);
  });

  it("passes a deceased spouse's starting half to the surviving spouse and child", () => {
    const people = [
      person("father", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        spouseIds: ["mother"],
      }),
      person("mother", { spouseIds: ["father"] }),
      person("child", { fatherId: "father", motherId: "mother" }),
    ];

    const result = buildAutomaticFamilyOwnership(people);
    expect(result.ownershipByPerson.mother).toBeCloseTo(0.75);
    expect(result.ownershipByPerson.child).toBeCloseTo(0.25);
    expect(result.ownershipByPerson.father || 0).toBe(0);
  });

  it("treats the other parent of shared children as the spouse when no explicit link exists", () => {
    const people = [
      person("edgar", {
        fullName: "Edgar Wadge",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
      }),
      person("wife", { fullName: "Maria Wadge" }),
      person("son-1", { fatherId: "edgar", motherId: "wife" }),
      person("son-2", { fatherId: "edgar", motherId: "wife" }),
    ];

    const result = buildPropertyOwnership(people, {
      id: "property",
      owners: [{ personId: "edgar", sharePercent: 100 }],
    });

    expect(result.ownershipByPerson.wife).toBeCloseTo(0.5);
    expect(result.ownershipByPerson["son-1"]).toBeCloseTo(0.25);
    expect(result.ownershipByPerson["son-2"]).toBeCloseTo(0.25);
  });

  it("uses confirmed intestate heirs and user-directed shares when they total 100%", () => {
    const people = [
      person("deceased", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        spouseIds: ["spouse"],
      }),
      person("spouse", { spouseIds: ["deceased"] }),
      person("child", { fatherId: "deceased", motherId: "spouse" }),
    ];
    const calculated = intestateAllocations(people, "deceased");
    people[0] = {
      ...people[0],
      intestateHeirs: [
        { id: "spouse-share", personId: "spouse", sharePercent: 60 },
        { id: "child-share", personId: "child", sharePercent: 40 },
      ],
      intestateHeirsConfirmed: true,
      intestateConfirmationBasis: intestacyAllocationSignature(people[0], calculated),
    };

    const result = buildPropertyOwnership(people, {
      id: "property",
      owners: [{ personId: "deceased", sharePercent: 100 }],
    });

    expect(result.ownershipByPerson.spouse).toBeCloseTo(0.6);
    expect(result.ownershipByPerson.child).toBeCloseTo(0.4);
    expect(result.transmissions[0].destination).toBe("confirmed-intestacy");
  });

  it("requires a deceased linked spouse's date of death before calculating survivorship", () => {
    const people = [
      person("deceased", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        spouseIds: ["spouse"],
      }),
      person("spouse", {
        isDeceased: true,
        dateOfDeath: "",
        spouseIds: ["deceased"],
      }),
      person("child", { fatherId: "deceased", motherId: "spouse" }),
    ];

    const allocation = intestateAllocations(people, "deceased");

    expect(allocation.destination).toBe("spouse-survival-unresolved");
    expect(allocation.shares.size).toBe(0);
    expect(allocation.warnings.join(" ")).toContain("Enter the date of death");
  });

  it("does not assume intestate heirs while the deceased's own death date is missing", () => {
    const people = [
      person("edgar", {
        fullName: "Edgar Wadge",
        isDeceased: true,
        dateOfDeath: "",
        spouseIds: ["wife"],
      }),
      person("wife", {
        isDeceased: true,
        dateOfDeath: "2024-01-01",
        spouseIds: ["edgar"],
      }),
      person("son-1", { fatherId: "edgar", motherId: "wife" }),
      person("son-2", { fatherId: "edgar", motherId: "wife" }),
    ];

    const allocation = intestateAllocations(people, "edgar");
    const ownership = buildPropertyOwnership(people, {
      id: "property",
      owners: [{ personId: "edgar", sharePercent: 100 }],
    });

    expect(allocation.destination).toBe("death-date-unresolved");
    expect(allocation.shares.size).toBe(0);
    expect(ownership.ownershipByPerson.edgar).toBe(1);
    expect(ownership.ownershipByPerson["son-1"] || 0).toBe(0);
    expect(ownership.unresolved).toHaveLength(1);
  });

  it("falls back to the statutory proposal when an earlier confirmation becomes stale", () => {
    const people = [
      person("deceased", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        spouseIds: ["spouse"],
      }),
      person("spouse", { spouseIds: ["deceased"] }),
      person("child-1", { fatherId: "deceased", motherId: "spouse" }),
    ];
    const calculated = intestateAllocations(people, "deceased");
    people[0] = {
      ...people[0],
      intestateHeirs: [
        { id: "spouse-share", personId: "spouse", sharePercent: 60 },
        { id: "child-share", personId: "child-1", sharePercent: 40 },
      ],
      intestateHeirsConfirmed: true,
      intestateConfirmationBasis: intestacyAllocationSignature(people[0], calculated),
    };
    people.push(person("child-2", { fatherId: "deceased", motherId: "spouse" }));

    const result = buildPropertyOwnership(people, {
      id: "property",
      owners: [{ personId: "deceased", sharePercent: 100 }],
    });

    expect(result.ownershipByPerson.spouse).toBeCloseTo(0.5);
    expect(result.ownershipByPerson["child-1"]).toBeCloseTo(0.25);
    expect(result.ownershipByPerson["child-2"]).toBeCloseTo(0.25);
    expect(result.transmissions[0].warnings.join(" ")).toContain("need review");
  });

  it("uses will shares instead of intestacy", () => {
    const people = [
      person("father", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        spouseIds: ["mother"],
        inheritanceBasis: "will",
        willHeirs: [{ id: "gift", personId: "child", sharePercent: 100 }],
      }),
      person("mother", { spouseIds: ["father"] }),
      person("child", { fatherId: "father", motherId: "mother" }),
    ];

    const result = buildAutomaticFamilyOwnership(people);
    expect(result.ownershipByPerson.mother).toBeCloseTo(0.5);
    expect(result.ownershipByPerson.child).toBeCloseTo(0.5);
  });

  it("continues representation through successive descendant branches", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        ownershipSharePercent: 100,
      }),
      person("living-child", { fatherId: "owner" }),
      person("predeceased-child", {
        fatherId: "owner",
        isDeceased: true,
        dateOfDeath: "2019-01-01",
      }),
      person("grandchild-1", { fatherId: "predeceased-child" }),
      person("grandchild-2", { fatherId: "predeceased-child" }),
    ];

    const result = buildAutomaticFamilyOwnership(people);
    expect(result.ownershipByPerson["living-child"]).toBeCloseTo(0.5);
    expect(result.ownershipByPerson["grandchild-1"]).toBeCloseTo(0.25);
    expect(result.ownershipByPerson["grandchild-2"]).toBeCloseTo(0.25);
  });

  it("uses sibling branches when living siblings take with a predeceased sibling's children", () => {
    const people = [
      person("deceased", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        fatherId: "father",
      }),
      person("father", { isDeceased: true, dateOfDeath: "2010-01-01" }),
      person("brother-1", { fatherId: "father" }),
      person("brother-2", { fatherId: "father" }),
      person("brother-3", {
        fatherId: "father",
        isDeceased: true,
        dateOfDeath: "2019-01-01",
      }),
      person("niece-1", { fatherId: "brother-3" }),
      person("niece-2", { fatherId: "brother-3" }),
    ];

    const allocation = intestateAllocations(people, "deceased");
    expect(Object.fromEntries(allocation.shares)).toEqual({
      "brother-1": 1 / 3,
      "brother-2": 1 / 3,
      "niece-1": 1 / 6,
      "niece-2": 1 / 6,
    });
  });

  it("divides per capita when all sibling descendants stand in the same degree", () => {
    const people = [
      person("deceased", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        fatherId: "father",
      }),
      person("father", { isDeceased: true, dateOfDeath: "2010-01-01" }),
      person("brother-1", {
        fatherId: "father",
        isDeceased: true,
        dateOfDeath: "2019-01-01",
      }),
      person("brother-2", {
        fatherId: "father",
        isDeceased: true,
        dateOfDeath: "2019-01-01",
      }),
      person("brother-3", {
        fatherId: "father",
        isDeceased: true,
        dateOfDeath: "2019-01-01",
      }),
      person("n1", { fatherId: "brother-1" }),
      person("n2", { fatherId: "brother-2" }),
      person("n3", { fatherId: "brother-3" }),
      person("n4", { fatherId: "brother-3" }),
    ];

    const allocation = intestateAllocations(people, "deceased");
    expect(allocation.shares.size).toBe(4);
    allocation.shares.forEach((share) => expect(share).toBeCloseTo(0.25));
  });

  it("selects the nearest other collaterals and excludes more distant cousins", () => {
    const people = [
      person("deceased", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        fatherId: "parent",
      }),
      person("parent", {
        isDeceased: true,
        dateOfDeath: "2010-01-01",
        fatherId: "grandparent",
      }),
      person("grandparent", {
        isDeceased: true,
        dateOfDeath: "2009-01-01",
      }),
      person("uncle-1", { fatherId: "grandparent" }),
      person("uncle-2", { fatherId: "grandparent" }),
      person("predeceased-uncle", {
        fatherId: "grandparent",
        isDeceased: true,
        dateOfDeath: "2018-01-01",
      }),
      person("cousin-1", { fatherId: "predeceased-uncle" }),
      person("cousin-2", { fatherId: "predeceased-uncle" }),
    ];

    const allocation = intestateAllocations(people, "deceased");
    expect(Object.fromEntries(allocation.shares)).toEqual({
      "uncle-1": 0.5,
      "uncle-2": 0.5,
    });
  });

  it("divides equally per capita when the nearest other collaterals share a degree", () => {
    const people = [
      person("deceased", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        fatherId: "parent",
      }),
      person("parent", {
        isDeceased: true,
        dateOfDeath: "2010-01-01",
        fatherId: "grandparent",
      }),
      person("grandparent", {
        isDeceased: true,
        dateOfDeath: "2009-01-01",
      }),
      ...["uncle-a", "uncle-b", "uncle-c"].map((id) =>
        person(id, {
          fatherId: "grandparent",
          isDeceased: true,
          dateOfDeath: "2018-01-01",
        }),
      ),
      ...["a1", "a2", "a3"].map((id) => person(id, { fatherId: "uncle-a" })),
      ...["b1", "b2", "b3"].map((id) => person(id, { fatherId: "uncle-b" })),
      ...["c1", "c2"].map((id) => person(id, { fatherId: "uncle-c" })),
    ];

    const allocation = intestateAllocations(people, "deceased");
    expect(allocation.shares.size).toBe(8);
    allocation.shares.forEach((share) => expect(share).toBeCloseTo(1 / 8));
  });

  it("leaves pre-1 March 2005 succession unresolved", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2004-12-01",
        ownershipSharePercent: 100,
      }),
      person("child", { fatherId: "owner" }),
    ];

    const allocation = intestateAllocations(people, "owner");
    const result = buildAutomaticFamilyOwnership(people);
    expect(allocation.destination).toBe("historical-unresolved");
    expect(result.ownershipByPerson.owner).toBe(1);
    expect(result.unresolved).toHaveLength(1);
  });
});

describe("per-property ownership", () => {
  it("uses a property's explicit owners as the starting point, not the person's own record", () => {
    const people = [
      person("owner", { isDeceased: true, dateOfDeath: "2020-01-01" }),
      person("child", { fatherId: "owner" }),
      person("outsider"),
    ];
    const property = {
      id: "flat-1",
      owners: [{ personId: "owner", sharePercent: 100 }],
    };

    const result = buildPropertyOwnership(people, property);
    expect(result.propertyId).toBe("flat-1");
    expect(result.ownershipByPerson.child).toBeCloseTo(1);
    expect(result.ownershipByPerson.outsider || 0).toBe(0);
  });

  it("reports a per-owner breakdown with fractions, percentages and provenance", () => {
    const people = [
      person("owner", { isDeceased: true, dateOfDeath: "2020-01-01" }),
      person("child-a", { fatherId: "owner" }),
      person("child-b", { fatherId: "owner" }),
    ];
    const property = {
      id: "flat-1",
      owners: [{ personId: "owner", sharePercent: 100 }],
    };

    const { breakdown } = buildPropertyOwnership(people, property);
    expect(breakdown).toHaveLength(2);
    const byOwner = Object.fromEntries(breakdown.map((row) => [row.ownerId, row]));
    expect(byOwner["child-a"]).toMatchObject({
      propertyId: "flat-1",
      numerator: 1,
      denominator: 2,
      via: "intestacy",
    });
    expect(byOwner["child-a"].sharePercent).toBeCloseTo(50);
    expect(byOwner["child-b"].via).toBe("intestacy");
  });

  it("tags a living starting owner's own share as starting, not a transmission", () => {
    const people = [person("owner")];
    const property = { id: "flat-1", owners: [{ personId: "owner", sharePercent: 100 }] };

    const { breakdown } = buildPropertyOwnership(people, property);
    expect(breakdown).toEqual([
      {
        propertyId: "flat-1",
        ownerId: "owner",
        numerator: 1,
        denominator: 1,
        sharePercent: 100,
        via: "starting",
      },
    ]);
  });

  it("tags a will-based transmission distinctly from intestacy", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        willHeirs: [{ id: "gift", personId: "friend", sharePercent: 100 }],
      }),
      person("friend"),
    ];
    const property = { id: "flat-1", owners: [{ personId: "owner", sharePercent: 100 }] };

    const { breakdown } = buildPropertyOwnership(people, property);
    expect(breakdown).toEqual([
      {
        propertyId: "flat-1",
        ownerId: "friend",
        numerator: 1,
        denominator: 1,
        sharePercent: 100,
        via: "will",
      },
    ]);
  });

  it("keeps two properties' cascades fully independent", () => {
    const people = [
      person("mother", { isDeceased: true, dateOfDeath: "2020-01-01", spouseIds: ["father"] }),
      person("father", { spouseIds: ["mother"] }),
      person("child", { fatherId: "father", motherId: "mother" }),
    ];
    const properties = [
      { id: "house", owners: [{ personId: "mother", sharePercent: 100 }] },
      { id: "garage", owners: [{ personId: "father", sharePercent: 100 }] },
    ];

    const { byProperty, breakdown } = buildFamilyPropertyOwnership(people, properties);
    expect(byProperty.house.ownershipByPerson.father).toBeCloseTo(0.5);
    expect(byProperty.house.ownershipByPerson.child).toBeCloseTo(0.5);
    expect(byProperty.garage.ownershipByPerson.father).toBeCloseTo(1);
    expect(breakdown).toHaveLength(3);
  });

  it("leaves an unresolved remainder tagged instead of silently dropping it", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        willHeirs: [{ id: "gift", personId: "friend", sharePercent: 40 }],
      }),
      person("friend"),
    ];
    const property = { id: "flat-1", owners: [{ personId: "owner", sharePercent: 100 }] };

    const { breakdown, unresolved } = buildPropertyOwnership(people, property);
    const ownerRow = breakdown.find((row) => row.ownerId === "owner");
    expect(ownerRow.via).toBe("unresolved");
    expect(ownerRow.sharePercent).toBeCloseTo(60);
    expect(unresolved).toHaveLength(1);
  });
});
