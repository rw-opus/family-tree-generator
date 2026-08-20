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
  intestacyLegalContextSignature,
  intestacyShareTotalIsComplete,
  intestateAllocations,
  missingPotentialIntestateParents,
  willAllocationReadiness,
} from "../../src/domain/familyOwnership.js";

const person = (id, patch = {}) => {
  const result = {
    id,
    fullName: id,
    fatherId: "",
    motherId: "",
    spouseIds: [],
    siblingIds: [],
    designations: [],
    ...patch,
  };
  if (result.inheritanceBasis === "will" && !Array.isArray(result.wills) && !result.willDate) {
    result.willDate = "1900-01-01";
  }
  return result;
};

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
        spouseIds: ["giovanna"],
      }),
      person("giovanna", { fullName: "Giovanna Wadge", spouseIds: ["edgar"] }),
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
    expect(allocation.shares.has("giovanna")).toBe(false);
    expect(allocation.warnings.join(" ")).toContain("provisionally treated as surviving");
  });

  it("does not let a stale potential-parent flag make a same-day deceased parent inherit", () => {
    const people = [
      person("child", {
        isDeceased: true,
        dateOfDeath: "2020-04-12",
        inheritanceBasis: "intestacy",
        motherId: "mother",
      }),
      person("mother", {
        isPotentialIntestateParent: true,
        survivalStatusRequired: true,
        survivalStatusReferencePersonId: "child",
        isDeceased: true,
        dateOfDeath: "2020-04-12",
      }),
    ];

    const allocation = intestateAllocations(people, "child");

    expect(allocation.destination).toBe("government");
    expect(allocation.shares.has("mother")).toBe(false);
    expect(allocation.warnings.join(" ")).not.toContain("provisionally treated as surviving");
  });

  it("lets a potential parent who died later inherit despite a stale warning flag", () => {
    const people = [
      person("child", {
        isDeceased: true,
        dateOfDeath: "2020-04-12",
        inheritanceBasis: "intestacy",
        motherId: "mother",
      }),
      person("mother", {
        isPotentialIntestateParent: true,
        survivalStatusRequired: true,
        survivalStatusReferencePersonId: "child",
        isDeceased: true,
        dateOfDeath: "2020-04-13",
      }),
    ];

    const allocation = intestateAllocations(people, "child");

    expect(allocation.destination).toBe("ascendants");
    expect(allocation.shares.get("mother")).toBe(1);
    expect(allocation.warnings.join(" ")).not.toContain("provisionally treated as surviving");
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
        willDate: "2010-01-01",
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
        willDate: "2010-01-01",
        willHeirs: [{ personId: "deleted", sharePercent: 100 }],
      },
      new Set(["child", "company"]),
    );
    const self = willAllocationReadiness(
      {
        id: "testator",
        willDate: "2010-01-01",
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
    expect(result.transmissions[0].warnings.join(" ")).toContain(
      "was excluded because deceased is marked as having no surviving spouse",
    );
  });

  it("treats shared parenthood as a marriage by default", () => {
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

  it("uses the recorded will shares without an automatic protected-portion adjustment", () => {
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

    expect(result.ownershipByPerson["child-a"] || 0).toBe(0);
    expect(result.ownershipByPerson["child-b"] || 0).toBe(0);
    expect(result.ownershipByPerson.niece).toBeCloseTo(1);
    expect(result.transmissions[0].destination).toBe("will");
    expect(result.unresolved).toEqual([]);
  });

  it("does not create descendant branches outside the recorded will", () => {
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

    expect(result.ownershipByPerson["living-child"] || 0).toBe(0);
    expect(result.ownershipByPerson.grandchild || 0).toBe(0);
    expect(result.ownershipByPerson.niece).toBeCloseTo(1);
    expect(result.ownershipByPerson["child-will-beneficiary"] || 0).toBe(0);
  });

  it("does not require or use a marriage start date to identify the legal spouse", () => {
    const people = [
      person("deceased", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        spouseIds: ["former", "current"],
        partnerRelationships: [
          {
            personId: "former",
            type: "marriage",
            startDate: "2000-01-01",
            endDate: "2010-01-01",
            endReason: "divorce",
          },
          { personId: "current", type: "marriage", startDate: "2025-01-01" },
        ],
      }),
      person("former", { spouseIds: ["deceased"] }),
      person("current", { spouseIds: ["deceased"] }),
      person("child", { fatherId: "deceased", motherId: "current" }),
    ];

    const result = buildPropertyOwnership(people, {
      id: "property",
      owners: [{ personId: "deceased", sharePercent: 100 }],
    });

    expect(result.ownershipByPerson.former || 0).toBe(0);
    expect(result.ownershipByPerson.current).toBeCloseTo(0.5);
    expect(result.ownershipByPerson.child).toBeCloseTo(0.5);
    expect(result.transmissions[0].destination).toBe("spouse-and-descendants");
    expect(result.transmissions[0].warnings.join(" ")).not.toContain("starts after");
  });

  it("defaults co-parents to marriage and ignores unsigned children-only overrides", () => {
    const people = [
      person("edgar", {
        fullName: "Edgar Wadge",
        isDeceased: true,
        dateOfDeath: "2005-05-20",
        intestateHeirs: [
          { id: "roland-share", personId: "roland", sharePercent: 25 },
          { id: "harvey-share", personId: "harvey", sharePercent: 25 },
          { id: "eric-share", personId: "eric", sharePercent: 25 },
          { id: "fourth-share", personId: "fourth-child", sharePercent: 25 },
        ],
      }),
      person("giovanna", {
        fullName: "Giovanna Wadge",
      }),
      person("roland", { fatherId: "edgar", motherId: "giovanna" }),
      person("harvey", { fatherId: "edgar", motherId: "giovanna" }),
      person("eric", { fatherId: "edgar", motherId: "giovanna" }),
      person("fourth-child", { fatherId: "edgar", motherId: "giovanna" }),
    ];

    const result = buildPropertyOwnership(people, {
      id: "property",
      owners: [
        { personId: "edgar", shareNumerator: 1, shareDenominator: 2 },
        { personId: "giovanna", shareNumerator: 1, shareDenominator: 2 },
      ],
    });

    expect(result.ownershipByPerson.giovanna).toBeCloseTo(3 / 4);
    expect(result.ownershipByPerson.roland).toBeCloseTo(1 / 16);
    expect(result.ownershipByPerson.harvey).toBeCloseTo(1 / 16);
    expect(result.ownershipByPerson.eric).toBeCloseTo(1 / 16);
    expect(result.ownershipByPerson["fourth-child"]).toBeCloseTo(1 / 16);
    expect(result.transmissions[0].destination).toBe("spouse-and-descendants");
    expect(result.transmissions[0].warnings.join(" ")).toContain(
      "saved without a death-date and family-context record",
    );
  });

  it("ignores an old imported marriage start date", () => {
    const people = [
      person("deceased", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        spouseIds: ["spouse"],
        partnerRelationships: [{ personId: "spouse", type: "marriage", startDate: "1929-12-31" }],
      }),
      person("spouse", { spouseIds: ["deceased"] }),
      person("child", { fatherId: "deceased", motherId: "spouse" }),
    ];

    const allocation = intestateAllocations(people, "deceased");
    expect(allocation.destination).toBe("spouse-and-descendants");
    expect(allocation.shares.get("spouse")).toBeCloseTo(0.5);
    expect(allocation.shares.get("child")).toBeCloseTo(0.5);
    expect(allocation.warnings.join(" ")).not.toContain("more than 90 years before");
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
    expect(missingEndResult).toMatchObject({
      relationshipPersonIds: ["former"],
      relationshipIssueField: "partner-marriage-end-date",
    });

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
    expect(overlappingResult).toMatchObject({
      relationshipPersonIds: ["former", "current"],
      relationshipIssueField: "partner-relationship",
    });
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

  it("stops edited heir rows overriding the calculation when family topology changes", () => {
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

    expect(result.ownershipByPerson.spouse).toBeCloseTo(0.5);
    expect(result.ownershipByPerson["child-1"]).toBeCloseTo(0.25);
    expect(result.ownershipByPerson["child-2"]).toBeCloseTo(0.25);
    expect(result.transmissions[0].warnings.join(" ")).toContain("automatic calculation applies");
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

  it("does not distribute a will recorded on or after death", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        willDate: "2020-01-01",
        willHeirs: [{ personId: "beneficiary", sharePercent: 100 }],
      }),
      person("beneficiary"),
    ];
    const result = buildPropertyOwnership(people, {
      id: "property",
      owners: [{ personId: "owner", sharePercent: 100 }],
    });

    expect(result.ownershipByPerson.beneficiary || 0).toBe(0);
    expect(result.transmissions[0].destination).toBe("will-unresolved");
    expect(result.transmissions[0].warnings.join(" ")).toContain("before the date of death");
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

  it("ignores a stale no-surviving-spouse setting when legacy descendants control ownership", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2005-02-28",
        unmarriedOrWidowedAtDeath: true,
        spouseIds: ["spouse"],
      }),
      person("spouse", { spouseIds: ["owner"] }),
      person("child", { fatherId: "owner", motherId: "spouse" }),
    ];

    const allocation = intestateAllocations(people, "owner");

    expect(allocation.destination).toBe("legacy-descendants");
    expect(Object.fromEntries(allocation.shares)).toEqual({ child: 1 });
    expect(allocation.warnings.join(" ")).not.toContain("was excluded because");
    expect(allocation.warnings.join(" ")).not.toContain("Clear that setting");
  });

  it("ignores incomplete former-marriage details in a resolved legacy descendant estate", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2005-02-28",
        spouseIds: ["former"],
        partnerRelationships: [{ personId: "former", type: "marriage", endReason: "divorce" }],
      }),
      person("former", { spouseIds: ["owner"] }),
      person("child", { fatherId: "owner" }),
    ];

    const allocation = intestateAllocations(people, "owner");

    expect(allocation.destination).toBe("legacy-descendants");
    expect(Object.fromEntries(allocation.shares)).toEqual({ child: 1 });
    expect(allocation.warnings.join(" ")).not.toContain("marriage to former");
  });

  it("does not require a spouse death date for a resolved pre-2005 descendant estate", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2004-12-01",
        spouseIds: ["spouse"],
      }),
      person("spouse", { isDeceased: true, spouseIds: ["owner"] }),
      person("child-a", { fatherId: "owner", motherId: "spouse" }),
      person("child-b", { fatherId: "owner", motherId: "spouse" }),
    ];

    const allocation = intestateAllocations(people, "owner");

    expect(allocation.destination).toBe("legacy-descendants");
    expect(allocation.shares.get("child-a")).toBeCloseTo(1 / 2);
    expect(allocation.shares.get("child-b")).toBeCloseTo(1 / 2);
    expect(allocation.warnings.join(" ")).not.toContain("Enter the date of death for spouse");
  });

  it("requires the spouse death date from the 1 March 2005 boundary", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2005-03-01",
        spouseIds: ["spouse"],
      }),
      person("spouse", { isDeceased: true, spouseIds: ["owner"] }),
      person("child", { fatherId: "owner", motherId: "spouse" }),
    ];

    const allocation = intestateAllocations(people, "owner");

    expect(allocation.destination).toBe("spouse-survival-unresolved");
    expect(allocation.shares.size).toBe(0);
    expect(allocation.warnings.join(" ")).toContain("Enter the date of death for spouse");
  });

  it("gives a childless pre-2005 spouse the whole estate when no nearer class exists", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2004-12-01",
        spouseIds: ["spouse"],
      }),
      person("spouse", { spouseIds: ["owner"] }),
    ];

    const allocation = intestateAllocations(people, "owner");

    expect(allocation.destination).toBe("legacy-spouse");
    expect(Object.fromEntries(allocation.shares)).toEqual({ spouse: 1 });
    expect(allocation.warnings).toEqual([]);
  });

  it("applies the old-law equal-head rule to a spouse, parent and sibling branches", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2004-12-01",
        fatherId: "parent",
        spouseIds: ["spouse"],
        siblingIds: ["sibling-a", "sibling-b", "sibling-c"],
      }),
      person("spouse", { spouseIds: ["owner"] }),
      person("parent"),
      person("sibling-a", { siblingIds: ["owner"] }),
      person("sibling-b", { siblingIds: ["owner"] }),
      person("sibling-c", {
        siblingIds: ["owner"],
        isDeceased: true,
        dateOfDeath: "2000-01-01",
      }),
      person("niece-a", { fatherId: "sibling-c" }),
      person("niece-b", { fatherId: "sibling-c" }),
    ];

    const allocation = intestateAllocations(people, "owner");

    expect(allocation.destination).toBe("legacy-ascendants-and-sibling-branches");
    expect(allocation.shares.get("spouse")).toBeCloseTo(1 / 2);
    expect(allocation.shares.get("parent")).toBeCloseTo(1 / 8);
    expect(allocation.shares.get("sibling-a")).toBeCloseTo(1 / 8);
    expect(allocation.shares.get("sibling-b")).toBeCloseTo(1 / 8);
    expect(allocation.shares.get("niece-a")).toBeCloseTo(1 / 16);
    expect(allocation.shares.get("niece-b")).toBeCloseTo(1 / 16);
  });

  it("splits same-degree remoter ascendants by paternal and maternal lines", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2004-12-01",
        fatherId: "father",
        motherId: "mother",
      }),
      person("father", {
        isDeceased: true,
        dateOfDeath: "2000-01-01",
        fatherId: "paternal-grandfather",
        motherId: "paternal-grandmother",
      }),
      person("mother", {
        isDeceased: true,
        dateOfDeath: "2000-01-01",
        fatherId: "maternal-grandfather",
      }),
      person("paternal-grandfather", { isDeceased: true, dateOfDeath: "2010-01-01" }),
      person("paternal-grandmother", { isDeceased: true, dateOfDeath: "2011-01-01" }),
      person("maternal-grandfather", { isDeceased: true, dateOfDeath: "2012-01-01" }),
    ];

    const allocation = intestateAllocations(people, "owner");

    expect(allocation.destination).toBe("legacy-ascendants");
    expect(allocation.shares.get("paternal-grandfather")).toBeCloseTo(1 / 4);
    expect(allocation.shares.get("paternal-grandmother")).toBeCloseTo(1 / 4);
    expect(allocation.shares.get("maternal-grandfather")).toBeCloseTo(1 / 2);
  });

  it("lets a pre-2005 spouse exclude remoter collateral relatives", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2004-12-01",
        fatherId: "father",
        spouseIds: ["spouse"],
      }),
      person("spouse", { spouseIds: ["owner"] }),
      person("father", {
        isDeceased: true,
        dateOfDeath: "2000-01-01",
        fatherId: "grandfather",
      }),
      person("grandfather", { isDeceased: true, dateOfDeath: "1999-01-01" }),
      person("uncle", { fatherId: "grandfather" }),
    ];

    const allocation = intestateAllocations(people, "owner");

    expect(allocation.destination).toBe("legacy-spouse");
    expect(Object.fromEntries(allocation.shares)).toEqual({ spouse: 1 });
  });

  it("includes a recorded co-parent as a post-2005 spouse without a marriage date", () => {
    const people = [
      person("edgar", {
        isDeceased: true,
        dateOfDeath: "2005-06-20",
      }),
      person("giovanna"),
      ...["wallace", "harvey", "roland", "eric"].map((id) =>
        person(id, { fatherId: "edgar", motherId: "giovanna" }),
      ),
    ];

    const allocation = intestateAllocations(people, "edgar");

    expect(allocation.shares.get("giovanna")).toBeCloseTo(1 / 2);
    ["wallace", "harvey", "roland", "eric"].forEach((id) =>
      expect(allocation.shares.get(id)).toBeCloseTo(1 / 8),
    );
    expect(allocation.destination).toBe("spouse-and-descendants");
  });

  it("gives a pre-1993 intestate estate to descendants without an article 825 warning", () => {
    const people = [
      person("edgar", {
        isDeceased: true,
        dateOfDeath: "1990-04-02",
        spouseIds: ["giovanna"],
      }),
      person("giovanna", { isDeceased: true, spouseIds: ["edgar"] }),
      ...["wallace", "harvey", "roland", "eric"].map((id) =>
        person(id, { fatherId: "edgar", motherId: "giovanna" }),
      ),
    ];

    const allocation = intestateAllocations(people, "edgar");

    expect(allocation.destination).toBe("legacy-descendants");
    ["wallace", "harvey", "roland", "eric"].forEach((id) =>
      expect(allocation.shares.get(id)).toBeCloseTo(1 / 4),
    );
    expect(allocation.shares.has("giovanna")).toBe(false);
    expect(allocation.warnings.join(" ")).not.toContain("article 825");
    expect(allocation.warnings.join(" ")).not.toContain("Historical law must be checked");
    expect(allocation.warnings.join(" ")).not.toContain("808");
    expect(allocation.warnings.join(" ")).not.toContain("Enter the date of death for giovanna");
  });

  it("uses a linked spouse's exact death date when the other spouse's date is unknown", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "1990-04-02",
        spouseIds: ["spouse"],
      }),
      person("spouse", {
        isDeceased: true,
        dateOfDeathUnknown: true,
        spouseIds: ["owner"],
      }),
      person("child", { fatherId: "owner", motherId: "spouse" }),
    ];

    const allocation = intestateAllocations(people, "owner");

    expect(allocation.destination).toBe("legacy-descendants");
    expect(allocation.shares.get("child")).toBe(1);
    expect(allocation.shares.has("spouse")).toBe(false);
    expect(allocation.warnings.join(" ")).not.toContain("Enter the date of death for spouse");
  });

  it("uses the spouse-assumed date in property succession history", () => {
    const people = [
      person("known-spouse", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        spouseIds: ["owner"],
      }),
      person("owner", {
        isDeceased: true,
        dateOfDeathUnknown: true,
        spouseIds: ["known-spouse"],
      }),
      person("child", { fatherId: "owner", motherId: "known-spouse" }),
    ];

    const result = buildPropertyOwnership(people, {
      id: "home",
      owners: [
        {
          id: "initial-owner",
          personId: "owner",
          shareNumerator: 1,
          shareDenominator: 1,
        },
      ],
      transfers: [],
    });

    expect(result.ownershipByPerson.child).toBe(1);
    expect(result.transmissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          deceasedId: "owner",
          dateOfDeath: "2020-01-01",
          dateOfDeathAssumedFromSpouse: true,
        }),
      ]),
    );
  });

  it("treats an undated grandparent as deceased when determining representation", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        fatherId: "parent",
      }),
      person("parent", {
        isDeceased: true,
        dateOfDeath: "2010-01-01",
        fatherId: "grandparent",
      }),
      person("grandparent"),
      person("uncle", { fatherId: "grandparent" }),
    ];

    const allocation = intestateAllocations(people, "owner");

    expect(allocation.shares.has("grandparent")).toBe(false);
    expect(allocation.warnings.join(" ")).not.toContain("grandparent");
  });

  it("waits to identify an applicable changed section while spouse survival is unresolved", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "1990-04-02",
        spouseIds: ["spouse"],
      }),
      person("spouse", { isDeceased: true, spouseIds: ["owner"] }),
    ];

    const allocation = intestateAllocations(people, "owner");

    expect(allocation.destination).toBe("spouse-survival-unresolved");
    expect(allocation.warnings.join(" ")).toContain("Enter the date of death for spouse");
    expect(allocation.warnings.join(" ")).not.toContain("Historical law must be checked");
  });

  it("does not warn merely because an otherwise settled succession predates 1993", () => {
    const descendantsOnly = [
      person("parent", { isDeceased: true, dateOfDeath: "1990-04-02" }),
      person("child", { fatherId: "parent" }),
    ];
    const spouseOnly = [
      person("deceased", {
        isDeceased: true,
        dateOfDeath: "1990-04-02",
        spouseIds: ["surviving-spouse"],
      }),
      person("surviving-spouse", { spouseIds: ["deceased"] }),
    ];

    expect(intestateAllocations(descendantsOnly, "parent").warnings.join(" ")).not.toContain(
      "Historical law must be checked",
    );
    expect(intestateAllocations(spouseOnly, "deceased").warnings.join(" ")).not.toContain(
      "Historical law must be checked",
    );
  });

  it("identifies former article 826 only when a surviving spouse shares with nearer relatives", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "1990-04-02",
        fatherId: "father",
        spouseIds: ["spouse"],
      }),
      person("spouse", { spouseIds: ["owner"] }),
      person("father"),
    ];

    const allocation = intestateAllocations(people, "owner");

    expect(allocation.destination).toBe("legacy-ascendants");
    expect(allocation.warnings.join(" ")).toContain("article 826");
    expect(allocation.warnings.join(" ")).not.toContain("829");
  });

  it("does not show the earlier-law caveat at the verified 1 December 1993 boundary", () => {
    const people = [
      person("owner", { isDeceased: true, dateOfDeath: "1993-12-01" }),
      person("child", { fatherId: "owner" }),
    ];

    const allocation = intestateAllocations(people, "owner");

    expect(allocation.shares.get("child")).toBe(1);
    expect(allocation.warnings.join(" ")).not.toContain("Historical law must be checked");
  });

  it("does not flag an ordinary pre-1993 will without an applicable changed section", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "1990-04-02",
        inheritanceBasis: "will",
        ownershipSharePercent: 100,
        willHeirs: [{ id: "will-share", personId: "beneficiary", sharePercent: 100 }],
      }),
      person("beneficiary"),
    ];

    const result = buildAutomaticFamilyOwnership(people);
    const transmission = result.transmissions.find(
      (entry) => entry.deceasedId === "owner" && entry.basis === "will",
    );

    expect(result.ownershipByPerson.beneficiary).toBeCloseTo(1);
    expect(transmission.warnings.join(" ")).not.toContain("Historical law must be checked");
  });

  it("does not override a recorded pre-2005 will with a spouse floor", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2004-06-01",
        inheritanceBasis: "will",
        ownershipSharePercent: 100,
        spouseIds: ["spouse"],
        willHeirs: [{ id: "niece-share", personId: "niece", sharePercent: 100 }],
      }),
      person("spouse", { spouseIds: ["owner"] }),
      person("niece"),
    ];

    const result = buildAutomaticFamilyOwnership(people);
    const transmission = result.transmissions.find((entry) => entry.deceasedId === "owner");

    expect(transmission.destination).toBe("will");
    expect(result.ownershipByPerson.spouse || 0).toBe(0);
    expect(result.ownershipByPerson.niece).toBeCloseTo(1);
    expect(transmission.warnings).toEqual([]);
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
    people[0] = {
      ...people[0],
      intestateHeirsConfirmed: true,
      intestateConfirmationBasis: intestacyLegalContextSignature(people[0], allocation),
    };
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
    expect(allocation.warnings).toContain(
      "Note: Shares can be adjusted — e.g., if a child was born outside marriage. Former Civil Code article 815 was in force at the date of succession.",
    );
  });

  it("keeps a signed but unapplied edit inactive until it is deliberately applied", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2020-12-01",
        ownershipSharePercent: 100,
      }),
      person("child", { fatherId: "owner" }),
      person("outsider"),
    ];
    const ownerWithRows = {
      ...people[0],
      intestateHeirs: [{ id: "outsider-share", personId: "outsider", sharePercent: 100 }],
    };
    const allocation = intestateAllocations([ownerWithRows, ...people.slice(1)], "owner");
    people[0] = {
      ...ownerWithRows,
      intestateHeirsConfirmed: false,
      intestateConfirmationBasis: intestacyLegalContextSignature(ownerWithRows, allocation),
    };

    const result = buildAutomaticFamilyOwnership(people);
    const edited = editedIntestacyAllocations(people, "owner", allocation);

    expect(edited.valid).toBe(false);
    expect(edited.reviewRequired).toBe(true);
    expect(edited.warnings.join(" ")).toContain("not been deliberately applied");
    expect(result.ownershipByPerson.child).toBeCloseTo(1);
    expect(result.ownershipByPerson.outsider || 0).toBe(0);
    expect(result.ownershipByPerson.owner || 0).toBe(0);
    expect(result.unresolved).toEqual([]);
  });

  it("keeps signed pre-2005 edits active only while their legal context matches", () => {
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
    const originalAllocation = intestateAllocations([ownerWithRows, ...people.slice(1)], "owner");
    const editedOwner = {
      ...ownerWithRows,
      intestateHeirsConfirmed: true,
      intestateConfirmationBasis: intestacyLegalContextSignature(ownerWithRows, originalAllocation),
    };

    let changedRows = [
      {
        ...editedOwner,
        intestateHeirs: [{ id: "changed-share", personId: "outsider", sharePercent: 100 }],
      },
      ...people.slice(1),
    ];
    changedRows = changedRows.map((entry) =>
      entry.id === "owner"
        ? {
            ...entry,
            intestateConfirmationBasis: intestacyLegalContextSignature(
              entry,
              intestateAllocations(changedRows, "owner"),
            ),
          }
        : entry,
    );
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
    expect(changedTopologyResult.ownershipByPerson.child).toBeCloseTo(0.5);
    expect(changedTopologyResult.ownershipByPerson["second-child"]).toBeCloseTo(0.5);
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

  it("stops edited rows overriding the calculation when the death date crosses the 1 March 2005 boundary", () => {
    const originalPeople = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2005-02-28",
        ownershipSharePercent: 100,
        intestateHeirs: [{ id: "outsider-share", personId: "outsider", sharePercent: 100 }],
      }),
      person("child", { fatherId: "owner" }),
      person("outsider"),
    ];
    const originalAllocation = intestateAllocations(originalPeople, "owner");
    const signedOwner = {
      ...originalPeople[0],
      intestateHeirsConfirmed: true,
      intestateConfirmationBasis: intestacyLegalContextSignature(
        originalPeople[0],
        originalAllocation,
      ),
    };
    const people = [
      { ...signedOwner, fullName: "Owner renamed", dateOfDeath: "2005-03-01" },
      ...originalPeople.slice(1),
    ];

    const result = buildAutomaticFamilyOwnership(people);
    const edited = editedIntestacyAllocations(people, "owner");

    expect(edited.valid).toBe(false);
    expect(edited.stale).toBe(true);
    expect(edited.warnings.join(" ")).toContain("earlier death date or family context");
    expect(result.ownershipByPerson.child).toBeCloseTo(1);
    expect(result.ownershipByPerson.outsider || 0).toBe(0);
    expect(result.transmissions[0].warnings.join(" ")).toContain("automatic calculation applies");
  });

  it("reactivates edited rows after they are saved against the new legal context", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2005-03-01",
        ownershipSharePercent: 100,
        intestateHeirs: [{ id: "outsider-share", personId: "outsider", sharePercent: 100 }],
      }),
      person("child", { fatherId: "owner" }),
      person("outsider"),
    ];
    const allocation = intestateAllocations(people, "owner");
    people[0] = {
      ...people[0],
      intestateHeirsConfirmed: true,
      intestateConfirmationBasis: intestacyLegalContextSignature(people[0], allocation),
    };

    const result = buildAutomaticFamilyOwnership(people);

    expect(result.ownershipByPerson.outsider).toBeCloseTo(1);
    expect(result.ownershipByPerson.child || 0).toBe(0);
    expect(result.transmissions[0].destination).toBe("edited-intestacy");
  });

  it("keeps a signed edited allocation active across cosmetic person changes", () => {
    const people = [
      person("owner", {
        fullName: "Original name",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        ownershipSharePercent: 100,
        intestateHeirs: [{ id: "outsider-share", personId: "outsider", sharePercent: 100 }],
      }),
      person("child", { fatherId: "owner" }),
      person("outsider"),
    ];
    const allocation = intestateAllocations(people, "owner");
    people[0] = {
      ...people[0],
      intestateHeirsConfirmed: true,
      intestateConfirmationBasis: intestacyAllocationSignature(people[0], allocation),
      fullName: "Corrected display name",
      notes: "A cosmetic note",
    };

    const result = buildAutomaticFamilyOwnership(people);

    expect(result.ownershipByPerson.outsider).toBeCloseTo(1);
    expect(result.ownershipByPerson.child || 0).toBe(0);
    expect(result.transmissions[0].destination).toBe("edited-intestacy");
  });

  it("keeps a legacy v2 edited allocation active when its legal context still matches", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        ownershipSharePercent: 100,
        intestateHeirs: [{ id: "outsider-share", personId: "outsider", sharePercent: 100 }],
      }),
      person("child", { fatherId: "owner" }),
      person("outsider"),
    ];
    const allocation = intestateAllocations(people, "owner");
    const v2Context = intestacyLegalContextSignature(people[0], allocation).replace(
      /^v3::/,
      "v2::",
    );
    people[0] = {
      ...people[0],
      intestateHeirsConfirmed: true,
      intestateConfirmationBasis: `${v2Context}::outsider:1/1`,
    };

    const result = buildAutomaticFamilyOwnership(people);

    expect(result.ownershipByPerson.outsider).toBeCloseTo(1);
    expect(result.ownershipByPerson.child || 0).toBe(0);
    expect(result.transmissions[0].destination).toBe("edited-intestacy");
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

  it("does not let a legacy lifetime-disposal marker suppress succession without a transfer", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "lifetime-disposal",
      }),
      person("child", { fatherId: "owner" }),
    ];
    const property = { id: "flat-1", owners: [{ personId: "owner", sharePercent: 100 }] };

    const result = buildPropertyOwnership(people, property);
    expect(result.ownershipByPerson.owner).toBeUndefined();
    expect(result.ownershipByPerson.child).toBeCloseTo(1);
    expect(result.transmissions).toHaveLength(1);
  });

  it("reserves a deceased owner's partial lifetime transfer before distributing the balance", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2022-01-01",
        inheritanceBasis: "intestacy",
      }),
      person("child", { fatherId: "owner" }),
      person("buyer"),
    ];
    const property = {
      id: "flat-1",
      owners: [{ id: "initial", personId: "owner", sharePercent: 100 }],
      transfers: [
        {
          id: "gift",
          kind: "donation",
          sellerId: "owner",
          buyerId: "buyer",
          numerator: 1,
          denominator: 4,
          amountType: "whole-property",
          date: "2021-01-01",
          provenance: [{ trancheId: "initial-initial", numerator: 1, denominator: 4 }],
        },
      ],
    };

    const result = buildPropertyOwnership(people, property);

    expect(result.ownershipFractionsByPerson.owner).toBeUndefined();
    expect(result.ownershipFractionsByPerson.buyer).toEqual({ numerator: 1, denominator: 4 });
    expect(result.ownershipFractionsByPerson.child).toEqual({ numerator: 3, denominator: 4 });
    expect(result.transmissions).toHaveLength(1);
    expect(result.transmissions[0].amountFraction).toEqual({ numerator: 3, denominator: 4 });
    expect(result.lifetimeTransferFractionsById.gift).toEqual({ numerator: 1, denominator: 4 });
  });

  it("passes only the post-transfer balance to will beneficiaries", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2022-01-01",
        inheritanceBasis: "will",
        willDate: "2020-01-01",
        willHeirs: [{ id: "legacy", personId: "friend", sharePercent: 100 }],
      }),
      person("friend"),
      person("buyer"),
    ];
    const property = {
      id: "flat-1",
      owners: [{ id: "initial", personId: "owner", sharePercent: 100 }],
      transfers: [
        {
          id: "sale",
          kind: "sale",
          sellerId: "owner",
          buyerId: "buyer",
          numerator: 1,
          denominator: 4,
          amountType: "whole-property",
          date: "2021-01-01",
          provenance: [{ trancheId: "initial-initial", numerator: 1, denominator: 4 }],
        },
      ],
    };

    const result = buildPropertyOwnership(people, property);

    expect(result.ownershipFractionsByPerson.owner).toBeUndefined();
    expect(result.ownershipFractionsByPerson.buyer).toEqual({ numerator: 1, denominator: 4 });
    expect(result.ownershipFractionsByPerson.friend).toEqual({ numerator: 3, denominator: 4 });
    expect(result.transmissions[0]).toMatchObject({ deceasedId: "owner", basis: "will" });
    expect(result.transmissions[0].amountFraction).toEqual({ numerator: 3, denominator: 4 });
  });

  it("omits succession after a valid full lifetime transfer", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2022-01-01",
        inheritanceBasis: "intestacy",
      }),
      person("child", { fatherId: "owner" }),
      person("buyer"),
    ];
    const property = {
      id: "flat-1",
      owners: [{ id: "initial", personId: "owner", sharePercent: 100 }],
      transfers: [
        {
          id: "sale",
          kind: "sale",
          sellerId: "owner",
          buyerId: "buyer",
          numerator: 1,
          denominator: 1,
          amountType: "whole-property",
          date: "2021-01-01",
        },
      ],
    };

    const result = buildPropertyOwnership(people, property);

    expect(result.ownershipFractionsByPerson.owner).toBeUndefined();
    expect(result.ownershipFractionsByPerson.buyer).toEqual({ numerator: 1, denominator: 1 });
    expect(result.ownershipFractionsByPerson.child).toBeUndefined();
    expect(result.transmissions).toEqual([]);
  });

  it("does not reduce the estate for a transfer dated after death", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2022-01-01",
        inheritanceBasis: "intestacy",
      }),
      person("child", { fatherId: "owner" }),
      person("buyer"),
    ];
    const property = {
      id: "flat-1",
      owners: [{ id: "initial", personId: "owner", sharePercent: 100 }],
      transfers: [
        {
          id: "late-sale",
          kind: "sale",
          sellerId: "owner",
          buyerId: "buyer",
          numerator: 1,
          denominator: 4,
          amountType: "whole-property",
          date: "2023-01-01",
        },
      ],
    };

    const result = buildPropertyOwnership(people, property);

    expect(result.ownershipFractionsByPerson.owner).toBeUndefined();
    expect(result.ownershipFractionsByPerson.child).toEqual({ numerator: 1, denominator: 1 });
    expect(result.transmissions[0].amountFraction).toEqual({ numerator: 1, denominator: 1 });
    expect(result.lifetimeTransferFractionsById["late-sale"]).toBeUndefined();
  });

  it.each([
    {
      label: "date",
      patch: { date: "" },
      targetField: "donation-date",
    },
    {
      label: "acquirer",
      patch: { buyerId: "" },
      targetField: "donation-acquirer",
    },
    {
      label: "share",
      patch: { denominator: 0 },
      targetField: "donation-share",
    },
    {
      label: "provenance",
      patch: {
        provenance: [{ trancheId: "initial-initial", numerator: "invalid", denominator: 2 }],
      },
      targetField: "donation-provenance",
    },
  ])("routes an invalid lifetime transfer's $label error to its exact editor field", (scenario) => {
    const people = [person("owner"), person("buyer")];
    const transfer = {
      id: `invalid-${scenario.label}`,
      kind: "donation",
      sellerId: "owner",
      buyerId: "buyer",
      numerator: 1,
      denominator: 2,
      amountType: "whole-property",
      date: "2021-01-01",
      ...scenario.patch,
    };
    const result = buildPropertyOwnership(people, {
      id: "flat-1",
      owners: [{ id: "initial", personId: "owner", sharePercent: 100 }],
      transfers: [transfer],
    });

    expect(result.unresolved).toContainEqual(
      expect.objectContaining({
        personId: "owner",
        transferId: transfer.id,
        targetField: scenario.targetField,
      }),
    );
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

  it.each([
    {
      label: "under",
      firstShare: { numerator: 3333, denominator: 10000 },
      expected: "99.99%",
    },
    {
      label: "over",
      firstShare: { numerator: 6667, denominator: 20000 },
      expected: "100.01%",
    },
  ])("keeps a near-whole $label-allocation will warning truthful", ({ firstShare, expected }) => {
    const beneficiaries = ["first", "second", "third"].map((id) => person(id));
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        willHeirs: [
          {
            id: "gift-first",
            personId: "first",
            shareNumerator: firstShare.numerator,
            shareDenominator: firstShare.denominator,
          },
          {
            id: "gift-second",
            personId: "second",
            shareNumerator: 1,
            shareDenominator: 3,
          },
          {
            id: "gift-third",
            personId: "third",
            shareNumerator: 1,
            shareDenominator: 3,
          },
        ],
      }),
      ...beneficiaries,
    ];
    const result = buildPropertyOwnership(people, {
      id: "flat-1",
      owners: [{ personId: "owner", sharePercent: 100 }],
    });

    expect(result.transmissions[0].warnings).toContain(
      `Will beneficiary shares total ${expected}, not 100%.`,
    );
    expect(result.transmissions[0].warnings.join(" ")).not.toContain("shares total 100%, not 100%");
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

  it("preserves an exact tiny property share without pruning it", () => {
    const property = {
      id: "tiny-share",
      owners: [
        {
          personId: "owner",
          shareNumerator: 1,
          shareDenominator: 999999999999,
        },
      ],
    };
    const result = buildPropertyOwnership([person("owner")], property);
    expect(result.ownershipFractionsByPerson.owner).toEqual({
      numerator: 1,
      denominator: 999999999999,
    });
    expect(result.breakdown).toHaveLength(1);
  });

  it("does not treat a person born after the succession as alive at that succession", () => {
    const people = [
      person("deceased", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "intestacy",
      }),
      person("later-child", {
        fatherId: "deceased",
        dateOfBirth: "2021-01-01",
      }),
    ];
    const result = intestateAllocations(people, "deceased");
    expect(result.shares.has("later-child")).toBe(false);
  });
});
