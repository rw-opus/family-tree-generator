import { describe, expect, it } from "vitest";
import {
  buildAutomaticFamilyOwnership,
  buildFamilyOwnershipFromExplicitShares,
  buildFamilyPropertyOwnership,
  buildPropertyOwnership,
  descendantsMissingDeathDates,
  editedIntestacyAllocations,
  intestacyAllocationSignature,
  intestacyConfirmationReadiness,
  intestacyShareTotalIsComplete,
  intestateAllocations,
  missingPotentialIntestateParents,
  willAllocationReadiness,
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
  it("identifies and provisionally allocates a missing post-2005 parent", () => {
    const people = [
      person("michael", {
        fullName: "Michael Wadge",
        isDeceased: true,
        dateOfDeath: "2020-04-12",
        fatherId: "edgar",
      }),
      person("edgar", {
        fullName: "Edgar Wadge",
        isDeceased: true,
        dateOfDeath: "1990-01-01",
      }),
    ];

    expect(missingPotentialIntestateParents(people, "michael")).toEqual(["mother"]);

    const withPlaceholder = [
      { ...people[0], motherId: "mother-placeholder" },
      people[1],
      person("mother-placeholder", {
        fullName: "Mother of Michael",
        sex: "Female",
        isPotentialIntestateParent: true,
        survivalStatusRequired: true,
        survivalStatusReferencePersonId: "michael",
      }),
    ];
    const allocation = intestateAllocations(withPlaceholder, "michael");

    expect(allocation.destination).toBe("ascendants");
    expect(allocation.shares.get("mother-placeholder")).toBe(1);
    expect(allocation.warnings.join(" ")).toContain("provisionally treated as surviving");
  });

  it("does not create parent placeholders ahead of descendants or a surviving spouse", () => {
    const base = person("owner", {
      isDeceased: true,
      dateOfDeath: "2020-04-12",
    });
    expect(
      missingPotentialIntestateParents([base, person("child", { fatherId: "owner" })], "owner"),
    ).toEqual([]);
    expect(
      missingPotentialIntestateParents(
        [{ ...base, spouseIds: ["spouse"] }, person("spouse", { spouseIds: ["owner"] })],
        "owner",
      ),
    ).toEqual([]);
  });

  it("validates complete will beneficiary rows against current case parties", () => {
    const valid = willAllocationReadiness(
      {
        id: "testator",
        willHeirs: [
          { personId: "child", sharePercent: 50 },
          { personId: "child", sharePercent: 50 },
        ],
      },
      new Set(["child", "company"]),
    );
    const unknown = willAllocationReadiness(
      {
        id: "testator",
        willHeirs: [{ personId: "deleted", sharePercent: 100 }],
      },
      new Set(["child", "company"]),
    );
    const self = willAllocationReadiness(
      {
        id: "testator",
        willHeirs: [{ personId: "testator", sharePercent: 100 }],
      },
      new Set(["testator", "child"]),
    );

    expect(valid.valid).toBe(true);
    expect(unknown.valid).toBe(false);
    expect(unknown.issues.join(" ")).toContain("no longer in this case");
    expect(self.valid).toBe(false);
    expect(self.issues.join(" ")).toContain("cannot be selected");
  });

  it("does not assume a sole living person owns the whole property", () => {
    const result = buildFamilyOwnershipFromExplicitShares([person("owner")]);
    expect(result.ownershipByPerson).toEqual({});
  });

  it("passes an explicitly entered starting half to the surviving spouse and child", () => {
    const people = [
      person("father", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        spouseIds: ["mother"],
        ownershipSharePercent: 50,
      }),
      person("mother", { spouseIds: ["father"], ownershipSharePercent: 50 }),
      person("child", { fatherId: "father", motherId: "mother" }),
    ];

    const result = buildAutomaticFamilyOwnership(people);
    expect(result.ownershipByPerson.mother).toBeCloseTo(0.75);
    expect(result.ownershipByPerson.child).toBeCloseTo(0.25);
    expect(result.ownershipByPerson.father || 0).toBe(0);
  });

  it("excludes linked spouses when the deceased was unmarried or widowed at death", () => {
    const people = [
      person("deceased", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        unmarriedOrWidowedAtDeath: true,
        spouseIds: ["former-spouse"],
      }),
      person("former-spouse", {
        spouseIds: ["deceased"],
        isDeceased: true,
        dateOfDeath: "",
      }),
      person("child", { fatherId: "deceased", motherId: "former-spouse" }),
    ];

    const result = buildPropertyOwnership(people, {
      id: "property",
      owners: [{ personId: "deceased", sharePercent: 100 }],
    });

    expect(result.ownershipByPerson["former-spouse"] || 0).toBe(0);
    expect(result.ownershipByPerson.child).toBeCloseTo(1);
    expect(result.transmissions[0].destination).toBe("descendants");
  });

  it("does not treat shared parenthood alone as a legal spouse link", () => {
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

    expect(result.ownershipByPerson.wife || 0).toBe(0);
    expect(result.ownershipByPerson["son-1"]).toBeCloseTo(0.5);
    expect(result.ownershipByPerson["son-2"]).toBeCloseTo(0.5);
  });

  it("does not give an explicitly unmarried partner a spouse share", () => {
    const people = [
      person("edgar", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        spouseIds: ["partner"],
        partnerRelationships: [{ personId: "partner", type: "partnership" }],
      }),
      person("partner", { spouseIds: ["edgar"], isDeceased: true, dateOfDeath: "" }),
      person("child", { fatherId: "edgar", motherId: "partner" }),
    ];

    const result = buildPropertyOwnership(people, {
      id: "property",
      owners: [{ personId: "edgar", sharePercent: 100 }],
    });

    expect(result.ownershipByPerson.partner || 0).toBe(0);
    expect(result.ownershipByPerson.child).toBeCloseTo(1);
    expect(result.transmissions[0].destination).toBe("descendants");
  });

  it("cascades a pre-2005 testate property share through children's legitim", () => {
    const people = [
      person("edgar", {
        fullName: "Edgar Wadge",
        isDeceased: true,
        dateOfDeath: "1990-04-02",
        inheritanceBasis: "will",
        willHeirs: [{ personId: "niece", sharePercent: 100 }],
      }),
      person("child-a", { fatherId: "edgar" }),
      person("child-b", { fatherId: "edgar" }),
      person("niece"),
    ];

    const result = buildPropertyOwnership(people, {
      id: "property",
      owners: [{ personId: "edgar", sharePercent: 100 }],
    });

    expect(result.ownershipByPerson["child-a"]).toBeCloseTo(1 / 6);
    expect(result.ownershipByPerson["child-b"]).toBeCloseTo(1 / 6);
    expect(result.ownershipByPerson.niece).toBeCloseTo(2 / 3);
    expect(result.transmissions[0].destination).toBe("will-with-legacy-legitim");
    expect(result.unresolved).toEqual([]);
  });

  it("ignores a predeceased child's will and gives that branch to their descendants", () => {
    const people = [
      person("testator", {
        isDeceased: true,
        dateOfDeath: "1990-01-01",
        inheritanceBasis: "will",
        willHeirs: [{ personId: "niece", sharePercent: 100 }],
      }),
      person("living-child", { fatherId: "testator" }),
      person("predeceased-child", {
        fatherId: "testator",
        isDeceased: true,
        dateOfDeath: "1980-01-01",
        inheritanceBasis: "will",
        willHeirs: [{ personId: "child-will-beneficiary", sharePercent: 100 }],
      }),
      person("grandchild", { fatherId: "predeceased-child" }),
      person("child-will-beneficiary"),
      person("niece"),
    ];

    const result = buildPropertyOwnership(people, {
      id: "property",
      owners: [{ personId: "testator", sharePercent: 100 }],
    });

    expect(result.ownershipByPerson["living-child"]).toBeCloseTo(1 / 6);
    expect(result.ownershipByPerson.grandchild).toBeCloseTo(1 / 6);
    expect(result.ownershipByPerson.niece).toBeCloseTo(2 / 3);
    expect(result.ownershipByPerson["child-will-beneficiary"] || 0).toBe(0);
  });

  it("uses marriage dates to identify the legal spouse at the date of death", () => {
    const people = [
      person("deceased", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        spouseIds: ["former", "current", "future"],
        partnerRelationships: [
          {
            personId: "former",
            type: "marriage",
            startDate: "2000-01-01",
            endDate: "2010-01-01",
            endReason: "divorce",
          },
          { personId: "current", type: "marriage", startDate: "2015-01-01" },
          { personId: "future", type: "marriage", startDate: "2025-01-01" },
        ],
      }),
      person("former", { spouseIds: ["deceased"] }),
      person("current", { spouseIds: ["deceased"] }),
      person("future", { spouseIds: ["deceased"] }),
      person("child", { fatherId: "deceased", motherId: "current" }),
    ];

    const result = buildPropertyOwnership(people, {
      id: "property",
      owners: [{ personId: "deceased", sharePercent: 100 }],
    });

    expect(result.ownershipByPerson.former || 0).toBe(0);
    expect(result.ownershipByPerson.future || 0).toBe(0);
    expect(result.ownershipByPerson.current).toBeCloseTo(0.5);
    expect(result.ownershipByPerson.child).toBeCloseTo(0.5);
    expect(result.transmissions[0].destination).toBe("spouse-and-descendants");
    expect(result.transmissions[0].warnings.join(" ")).toContain("starts after the date of death");
  });

  it("stops intestacy when former or overlapping marriages are ambiguous", () => {
    const missingEndDate = [
      person("deceased", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        spouseIds: ["former", "current"],
        partnerRelationships: [
          { personId: "former", type: "marriage", endReason: "divorce" },
          { personId: "current", type: "marriage", startDate: "2015-01-01" },
        ],
      }),
      person("former", { spouseIds: ["deceased"] }),
      person("current", { spouseIds: ["deceased"] }),
      person("child", { fatherId: "deceased", motherId: "current" }),
    ];
    const missingEndResult = intestateAllocations(missingEndDate, "deceased");

    expect(missingEndResult.destination).toBe("spouse-status-unresolved");
    expect(missingEndResult.warnings.join(" ")).toContain("marriage to former ended");

    const overlapping = missingEndDate.map((candidate) =>
      candidate.id === "deceased"
        ? {
            ...candidate,
            partnerRelationships: [
              { personId: "former", type: "marriage", startDate: "2000-01-01" },
              { personId: "current", type: "marriage", startDate: "2015-01-01" },
            ],
          }
        : candidate,
    );
    const overlappingResult = intestateAllocations(overlapping, "deceased");
    expect(overlappingResult.destination).toBe("spouse-status-unresolved");
    expect(overlappingResult.warnings.join(" ")).toContain("More than one marriage appears active");
  });

  it("uses edited intestate heirs and user-directed shares when they total 100%", () => {
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
    const deceasedWithRows = {
      ...people[0],
      intestateHeirs: [
        { id: "spouse-share", personId: "spouse", sharePercent: 60 },
        { id: "child-share", personId: "child", sharePercent: 40 },
      ],
    };
    people[0] = {
      ...deceasedWithRows,
      intestateHeirsConfirmed: true,
      intestateConfirmationBasis: intestacyAllocationSignature(deceasedWithRows, calculated),
    };

    const result = buildPropertyOwnership(people, {
      id: "property",
      owners: [{ personId: "deceased", sharePercent: 100 }],
    });

    expect(result.ownershipByPerson.spouse).toBeCloseTo(0.6);
    expect(result.ownershipByPerson.child).toBeCloseTo(0.4);
    expect(result.transmissions[0].destination).toBe("edited-intestacy");
  });

  it("uses changed current-law heir rows as soon as they total 100%", () => {
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
    const deceasedWithRows = {
      ...people[0],
      intestateHeirs: [
        { id: "spouse-share", personId: "spouse", sharePercent: 60 },
        { id: "child-share", personId: "child", sharePercent: 40 },
      ],
    };
    people[0] = {
      ...deceasedWithRows,
      intestateHeirsConfirmed: true,
      intestateConfirmationBasis: intestacyAllocationSignature(deceasedWithRows, calculated),
      intestateHeirs: [
        { id: "spouse-share", personId: "spouse", sharePercent: 90 },
        { id: "child-share", personId: "child", sharePercent: 10 },
      ],
    };

    const result = buildPropertyOwnership(people, {
      id: "property",
      owners: [{ personId: "deceased", sharePercent: 100 }],
    });

    expect(result.ownershipByPerson.spouse).toBeCloseTo(0.9);
    expect(result.ownershipByPerson.child).toBeCloseTo(0.1);
    expect(result.transmissions[0].destination).toBe("edited-intestacy");
    expect(result.transmissions[0].warnings.join(" ")).not.toContain("need review");
  });

  it("can confirm an unconnected person or company as a terminal heir", () => {
    const outsideParties = [{ id: "company", name: "Legacy Holdings Ltd", type: "company" }];
    const people = [
      person("deceased", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
      }),
      person("statutory-child", { fatherId: "deceased" }),
    ];
    const calculated = intestateAllocations(people, "deceased");
    const deceasedWithRows = {
      ...people[0],
      intestateHeirs: [{ id: "company-share", personId: "company", sharePercent: 100 }],
    };
    people[0] = {
      ...deceasedWithRows,
      intestateHeirsConfirmed: true,
      intestateConfirmationBasis: intestacyAllocationSignature(deceasedWithRows, calculated),
    };

    const readiness = intestacyConfirmationReadiness(
      people,
      "deceased",
      calculated,
      outsideParties,
    );
    const result = buildPropertyOwnership(
      people,
      {
        id: "property",
        owners: [{ personId: "deceased", sharePercent: 100 }],
      },
      outsideParties,
    );

    expect(readiness.valid).toBe(true);
    expect(result.ownershipByPerson.company).toBeCloseTo(1);
    expect(result.ownershipByParty.company).toBeCloseTo(1);
    expect(result.unresolved).toEqual([]);
  });

  it("uses one readiness check for dangling, duplicate, and self-heir rows", () => {
    const people = [
      person("deceased", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        intestateHeirs: [
          { id: "missing-row", personId: "missing", sharePercent: 50 },
          { id: "self-row", personId: "deceased", sharePercent: 50 },
        ],
      }),
      person("child", { fatherId: "deceased" }),
    ];
    const calculated = intestateAllocations(people, "deceased");
    const readiness = intestacyConfirmationReadiness(people, "deceased", calculated);

    expect(readiness.valid).toBe(false);
    expect(readiness.totalComplete).toBe(true);
    expect(readiness.issues).toContain("The deceased cannot be selected as their own heir.");
    expect(readiness.issues).toContain(
      "Remove or replace heirs who are no longer on the family tree.",
    );
  });

  it("uses the same tolerance for validating and displaying a 100% total", () => {
    expect(intestacyShareTotalIsComplete(100)).toBe(true);
    expect(intestacyShareTotalIsComplete(99.999999)).toBe(true);
    expect(intestacyShareTotalIsComplete(99.9999)).toBe(false);
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

  it("blocks allocation when a descendant's survival date is unknown", () => {
    const people = [
      person("deceased", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
      }),
      person("child", {
        fatherId: "deceased",
        isDeceased: true,
        dateOfDeath: "",
      }),
      person("grandchild", { fatherId: "child" }),
    ];

    expect(descendantsMissingDeathDates(people, "deceased").map(({ id }) => id)).toEqual(["child"]);
    const allocation = intestateAllocations(people, "deceased");
    expect(allocation.destination).toBe("survival-date-unresolved");
    expect(allocation.shares.size).toBe(0);
    expect(allocation.warnings.join(" ")).toContain("child");
  });

  it("blocks allocation when a material ascendant's survival date is unknown", () => {
    const people = [
      person("deceased", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        fatherId: "father",
      }),
      person("father", {
        isDeceased: true,
        dateOfDeath: "",
      }),
    ];

    const allocation = intestateAllocations(people, "deceased");
    expect(allocation.destination).toBe("survival-date-unresolved");
    expect(allocation.shares.size).toBe(0);
    expect(allocation.warnings.join(" ")).toContain("father");
  });

  it("keeps edited heir rows active when family topology changes", () => {
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
    const deceasedWithRows = {
      ...people[0],
      intestateHeirs: [
        { id: "spouse-share", personId: "spouse", sharePercent: 60 },
        { id: "child-share", personId: "child-1", sharePercent: 40 },
      ],
    };
    people[0] = {
      ...deceasedWithRows,
      intestateHeirsConfirmed: true,
      intestateConfirmationBasis: intestacyAllocationSignature(deceasedWithRows, calculated),
    };
    people.push(person("child-2", { fatherId: "deceased", motherId: "spouse" }));

    const result = buildPropertyOwnership(people, {
      id: "property",
      owners: [{ personId: "deceased", sharePercent: 100 }],
    });

    expect(result.ownershipByPerson.spouse).toBeCloseTo(0.6);
    expect(result.ownershipByPerson["child-1"]).toBeCloseTo(0.4);
    expect(result.ownershipByPerson["child-2"] || 0).toBe(0);
    expect(result.transmissions[0].warnings.join(" ")).not.toContain("need review");
  });

  it("uses will shares instead of intestacy", () => {
    const people = [
      person("father", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        spouseIds: ["mother"],
        ownershipSharePercent: 50,
        inheritanceBasis: "will",
        willHeirs: [{ id: "gift", personId: "child", sharePercent: 100 }],
      }),
      person("mother", { spouseIds: ["father"], ownershipSharePercent: 50 }),
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

  it("calculates pre-1 March 2005 succession automatically", () => {
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
    expect(allocation.destination).toBe("legacy-descendants");
    expect(allocation.shares.get("child")).toBeCloseTo(1);
    expect(result.ownershipByPerson.child).toBeCloseTo(1);
    expect(result.ownershipByPerson.owner || 0).toBe(0);
    expect(result.unresolved).toEqual([]);
  });

  it("does not give a pre-2005 surviving spouse the modern ownership half", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2004-12-01",
        spouseIds: ["spouse"],
      }),
      person("spouse", { spouseIds: ["owner"] }),
      person("child-a", { fatherId: "owner", motherId: "spouse" }),
      person("child-b", { fatherId: "owner", motherId: "spouse" }),
    ];

    const allocation = intestateAllocations(people, "owner");

    expect(allocation.destination).toBe("legacy-descendants");
    expect(Object.fromEntries(allocation.shares)).toEqual({
      "child-a": 0.5,
      "child-b": 0.5,
    });
    expect(allocation.warnings).toEqual([]);
  });

  it("requires edited heirs for an unresolved childless pre-2005 spouse succession", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2004-12-01",
        spouseIds: ["spouse"],
      }),
      person("spouse", { spouseIds: ["owner"] }),
    ];

    const allocation = intestateAllocations(people, "owner");

    expect(allocation.destination).toBe("legacy-spouse-law-unresolved");
    expect(allocation.shares.size).toBe(0);
    expect(allocation.warnings.join(" ")).toContain("825, 826, 827, 828, 829");
  });

  it("allows a complete manual allocation for an unresolved pre-2005 succession", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2004-12-01",
        spouseIds: ["spouse"],
        intestateHeirs: [
          { id: "spouse-share", personId: "spouse", sharePercent: 50 },
          { id: "sibling-share", personId: "sibling", sharePercent: 50 },
        ],
      }),
      person("spouse", { spouseIds: ["owner"] }),
      person("sibling", { siblingIds: ["owner"] }),
    ];
    const allocation = intestateAllocations(people, "owner");
    const edited = editedIntestacyAllocations(people, "owner", allocation);

    expect(edited.valid).toBe(true);
    expect(Object.fromEntries(edited.shares)).toEqual({ spouse: 0.5, sibling: 0.5 });
  });

  it("flags the former article 815 period without silently changing historic status", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2010-01-01",
      }),
      person("child", { fatherId: "owner" }),
    ];

    const allocation = intestateAllocations(people, "owner");

    expect(allocation.shares.get("child")).toBe(1);
    expect(allocation.warnings.join(" ")).toContain("former Civil Code article 815");
  });

  it("cascades an edited pre-2005 inheritance without confirmation", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2004-12-01",
        ownershipSharePercent: 100,
      }),
      person("child", { fatherId: "owner" }),
    ];
    const ownerWithRows = {
      ...people[0],
      intestateHeirs: [{ id: "child-share", personId: "child", sharePercent: 100 }],
    };
    people[0] = ownerWithRows;

    const result = buildAutomaticFamilyOwnership(people);
    expect(result.ownershipByPerson.child).toBeCloseTo(1);
    expect(result.ownershipByPerson.owner || 0).toBe(0);
    expect(result.unresolved).toEqual([]);
  });

  it("lets edited pre-2005 rows override later family topology changes", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2004-12-01",
        ownershipSharePercent: 100,
      }),
      person("child", { fatherId: "owner" }),
      person("outsider"),
    ];
    const ownerWithRows = {
      ...people[0],
      intestateHeirs: [{ id: "child-share", personId: "child", sharePercent: 100 }],
    };
    const editedOwner = ownerWithRows;

    const changedRows = [
      {
        ...editedOwner,
        intestateHeirs: [{ id: "changed-share", personId: "outsider", sharePercent: 100 }],
      },
      ...people.slice(1),
    ];
    const changedRowsResult = buildAutomaticFamilyOwnership(changedRows);
    expect(changedRowsResult.ownershipByPerson.outsider).toBeCloseTo(1);
    expect(changedRowsResult.ownershipByPerson.owner || 0).toBe(0);
    expect(changedRowsResult.unresolved).toEqual([]);

    const changedTopology = [
      editedOwner,
      ...people.slice(1),
      person("second-child", { fatherId: "owner" }),
    ];
    const changedTopologyResult = buildAutomaticFamilyOwnership(changedTopology);
    expect(changedTopologyResult.ownershipByPerson.child).toBeCloseTo(1);
    expect(changedTopologyResult.ownershipByPerson["second-child"] || 0).toBe(0);
    expect(changedTopologyResult.ownershipByPerson.owner || 0).toBe(0);
    expect(changedTopologyResult.unresolved).toEqual([]);

    const unrelatedEdit = [
      editedOwner,
      people[1],
      { ...people[2], isDeceased: true, dateOfDeath: "1990-01-01" },
      person("unrelated-child", { fatherId: "outsider" }),
    ];
    const unrelatedEditResult = buildAutomaticFamilyOwnership(unrelatedEdit);
    expect(unrelatedEditResult.ownershipByPerson.child).toBeCloseTo(1);
    expect(unrelatedEditResult.unresolved).toEqual([]);

    const changedSiblingEdge = [
      editedOwner,
      ...people.slice(1),
      person("new-sibling", { siblingIds: ["owner"] }),
    ];
    const changedSiblingResult = buildAutomaticFamilyOwnership(changedSiblingEdge);
    expect(changedSiblingResult.ownershipByPerson.child).toBeCloseTo(1);
    expect(changedSiblingResult.ownershipByPerson.owner || 0).toBe(0);
    expect(changedSiblingResult.unresolved).toEqual([]);
  });

  it("keeps edited rows active when the death date crosses the 1 March 2005 boundary", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2005-02-28",
        ownershipSharePercent: 100,
      }),
      person("child", { fatherId: "owner" }),
      person("outsider"),
    ];
    const ownerWithRows = {
      ...people[0],
      intestateHeirs: [{ id: "outsider-share", personId: "outsider", sharePercent: 100 }],
    };
    people[0] = {
      ...ownerWithRows,
      dateOfDeath: "2005-03-01",
    };

    const result = buildAutomaticFamilyOwnership(people);
    expect(result.ownershipByPerson.outsider).toBeCloseTo(1);
    expect(result.ownershipByPerson.child || 0).toBe(0);
  });

  it("uses the exact 1 March 2005 boundary in the live ownership cascade", () => {
    const before = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2005-02-28",
        ownershipSharePercent: 100,
      }),
      person("child", { fatherId: "owner" }),
    ];
    const fromBoundary = before.map((entry) =>
      entry.id === "owner" ? { ...entry, dateOfDeath: "2005-03-01" } : entry,
    );

    expect(intestateAllocations(before, "owner").shares.get("child")).toBe(1);
    expect(intestateAllocations(fromBoundary, "owner").shares.get("child")).toBe(1);
  });

  it("does not infer a succession regime from a malformed stored death date", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "28-02-2005",
      }),
      person("child", { fatherId: "owner" }),
    ];

    const allocation = intestateAllocations(people, "owner");
    expect(allocation.destination).toBe("death-date-unresolved");
    expect(allocation.shares.size).toBe(0);
    expect(allocation.warnings.join(" ")).toContain("valid date of death");
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

  it("records a circular inheritance path as unresolved instead of losing the share", () => {
    const people = [
      person("owner", {
        fullName: "Owner Person",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        willHeirs: [{ id: "owner-to-heir", personId: "heir", sharePercent: 100 }],
      }),
      person("heir", {
        fullName: "Heir Person",
        isDeceased: true,
        dateOfDeath: "2021-01-01",
        inheritanceBasis: "will",
        willHeirs: [{ id: "heir-to-owner", personId: "owner", sharePercent: 100 }],
      }),
    ];
    const property = { id: "flat-1", owners: [{ personId: "owner", sharePercent: 100 }] };

    const result = buildPropertyOwnership(people, property);
    expect(result.ownershipByPerson.owner).toBeCloseTo(1);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].warnings.join(" ")).toContain(
      "Owner Person → Heir Person → Owner Person",
    );
  });
});
