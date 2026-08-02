import { describe, expect, it } from "vitest";
import {
  applyLegacyArticle616ToWill,
  buildLegacyArticle616ChildBranches,
  calculateLegacyArticle616Legitim,
  classifyLegacyArticle616Date,
  compareLegacyArticle616LegitimFloors,
  legacyArticle616EstateBase,
} from "../../src/domain/legacyLegitim.js";

const child = (id, patch = {}) => ({
  id,
  name: id,
  article616Eligibility: "qualifying",
  participation: "participating",
  ...patch,
});

describe("old article 616 legitim", () => {
  it("uses the exact pre-1 March 2005 boundary", () => {
    expect(classifyLegacyArticle616Date("2005-02-28").regime).toBe("legacy");
    expect(classifyLegacyArticle616Date("2005-03-01").regime).toBe("modern");
    expect(classifyLegacyArticle616Date("28-02-2005").regime).toBe("unresolved");
  });

  it.each([
    [1, 1, 3],
    [2, 1, 6],
    [3, 1, 9],
    [4, 1, 12],
    [5, 1, 10],
    [6, 1, 12],
    [7, 1, 14],
  ])("gives each of %i normally participating branches %i/%i", (count, top, bottom) => {
    const result = calculateLegacyArticle616Legitim({
      childBranches: Array.from({ length: count }, (_, index) => child(`child-${index + 1}`)),
    });
    expect(result.collectiveFraction).toMatchObject({
      numerator: count <= 4 ? 1 : 1,
      denominator: count <= 4 ? 3 : 2,
    });
    expect(result.branchFloors[0].fraction).toMatchObject({ numerator: top, denominator: bottom });
  });

  it("counts a represented child as one branch and divides that branch per stirpes", () => {
    const result = calculateLegacyArticle616Legitim({
      childBranches: [
        child("a"),
        child("b", {
          participation: "predeceased",
          children: [child("b1"), child("b2")],
        }),
      ],
    });
    const floors = Object.fromEntries(
      result.beneficiaryFloors.map((row) => [row.beneficiaryId, row.fraction]),
    );
    expect(result.countedBranchCount).toBe(2);
    expect(floors.a).toMatchObject({ numerator: 1, denominator: 6 });
    expect(floors.b1).toMatchObject({ numerator: 1, denominator: 12 });
    expect(floors.b2).toMatchObject({ numerator: 1, denominator: 12 });
  });

  it("does not count a predeceased child who left no represented branch", () => {
    const result = calculateLegacyArticle616Legitim({
      childBranches: [
        child("living"),
        child("predeceased-without-issue", { participation: "predeceased", children: [] }),
      ],
    });

    expect(result.countedBranchCount).toBe(1);
    expect(result.beneficiaryFloors).toHaveLength(1);
    expect(result.beneficiaryFloors[0].fraction).toMatchObject({ numerator: 1, denominator: 3 });
  });

  it("keeps a renouncing branch in N but redistributes the collective legitim", () => {
    const result = calculateLegacyArticle616Legitim({
      childBranches: [child("a"), child("b"), child("c", { participation: "renounced" })],
    });
    expect(result.countedBranchCount).toBe(3);
    expect(result.takingBranchCount).toBe(2);
    expect(result.normalPerCountedBranchFraction).toMatchObject({ numerator: 1, denominator: 9 });
    expect(result.branchFloors.find((row) => row.branchId === "a").fraction).toMatchObject({
      numerator: 1,
      denominator: 6,
    });
  });

  it("leaves incapable, unworthy and disinherited routing unresolved pending old articles 608 and 626", () => {
    for (const participation of ["incapable", "unworthy", "disinherited"]) {
      const result = calculateLegacyArticle616Legitim({
        childBranches: [
          child("a"),
          child("b", { participation, children: [child("b1"), child("b2")] }),
        ],
      });
      expect(result.unresolved).toBe(true);
      expect(result.beneficiaryFloors.map((row) => row.beneficiaryId)).toEqual(["a"]);
      expect(result.beneficiaryFloors.some((row) => row.beneficiaryId === "b1")).toBe(false);
      expect(result.beneficiaryFloors.some((row) => row.beneficiaryId === "b2")).toBe(false);
      expect(result.diagnostics.join(" ")).toContain("old articles 608 and 626");
      expect(result.diagnostics.join(" ")).toContain("no automatic descendant routing");
    }
  });

  it("retains an exact fraction when a represented branch has a denominator above 100,000", () => {
    const representedChain = (depth) =>
      depth === 0
        ? child("deep-recipient")
        : child(`represented-${depth}`, {
            participation: "predeceased",
            children: [child(`side-${depth}`), representedChain(depth - 1)],
          });

    const result = calculateLegacyArticle616Legitim({
      childBranches: [representedChain(17)],
    });
    const deepRecipient = result.beneficiaryFloors.find(
      (row) => row.beneficiaryId === "deep-recipient",
    );

    expect(result.unresolved).toBe(false);
    expect(deepRecipient.fraction).toMatchObject({ numerator: 1, denominator: 393216 });
  });

  it("does not silently include unconfirmed or separate-old-law branches", () => {
    const unconfirmed = calculateLegacyArticle616Legitim({
      childBranches: [child("a"), child("b", { article616Eligibility: "unconfirmed" })],
    });
    const separate = calculateLegacyArticle616Legitim({
      childBranches: [child("a"), child("b", { article616Eligibility: "separate-old-law" })],
    });
    expect(unconfirmed.unresolved).toBe(true);
    expect(separate.unresolved).toBe(true);
    expect(separate.diagnostics.join(" ")).toContain("separate old-law");
  });

  it("calculates the adjusted estate after debts, funeral expenses and included gifts", () => {
    expect(
      legacyArticle616EstateBase({
        grossEstate: 900000,
        debts: 100000,
        funeralExpenses: 10000,
        gratuitousDispositions: 60000,
      }),
    ).toMatchObject({ adjustedEstate: 850000, amountProvided: true });
    const result = calculateLegacyArticle616Legitim({
      childBranches: [child("only")],
      estate: {
        grossEstate: 900000,
        debts: 100000,
        funeralExpenses: 10000,
        gratuitousDispositions: 60000,
      },
    });
    expect(result.beneficiaryFloors[0].amount).toBeCloseTo(850000 / 3);
  });

  it("does not calculate a monetary floor until the gross estate is entered", () => {
    const estateBase = legacyArticle616EstateBase({ debts: 10000, funeralExpenses: 5000 });
    const result = calculateLegacyArticle616Legitim({
      childBranches: [child("only")],
      estate: { debts: 10000, funeralExpenses: 5000 },
    });

    expect(estateBase.amountProvided).toBe(false);
    expect(estateBase.deductionsExceedAssets).toBe(true);
    expect(result.beneficiaryFloors[0].amount).toBeNull();
  });

  it("treats a larger inheritance as absorbing the floor rather than adding to it", () => {
    const calculation = calculateLegacyArticle616Legitim({
      childBranches: [child("a"), child("b"), child("c")],
    });
    const comparison = compareLegacyArticle616LegitimFloors(calculation, [
      { beneficiaryId: "a", sharePercent: 100 / 3 },
      { beneficiaryId: "b", sharePercent: 100 / 3 },
      { beneficiaryId: "c", sharePercent: 100 / 3 },
    ]);
    expect(comparison.status).toBe("compliant");
    expect(comparison.rows.every((row) => row.absorbed)).toBe(true);
    expect(comparison.rows[0].actualShare).toBeCloseTo(1 / 3);
    expect(comparison.rows[0].requiredShare).toBeCloseTo(1 / 9);
  });

  it("reports the personal shortfall when a will leaves the estate elsewhere", () => {
    const calculation = calculateLegacyArticle616Legitim({
      childBranches: [child("a"), child("b")],
    });
    const comparison = compareLegacyArticle616LegitimFloors(calculation, [
      { beneficiaryId: "outsider", sharePercent: 100 },
    ]);
    expect(comparison.status).toBe("shortfall");
    expect(comparison.rows.map((row) => row.shortfall)).toEqual([1 / 6, 1 / 6]);
    expect(comparison.totalShortfall).toBeCloseTo(1 / 3);
  });

  it("automatically protects children's personal minimums when a legacy will names a niece", () => {
    const deceased = {
      id: "edgar",
      fullName: "Edgar Wadge",
      isDeceased: true,
      dateOfDeath: "1990-04-02",
      willHeirs: [{ personId: "niece", sharePercent: 100 }],
    };
    const people = [
      deceased,
      { id: "child-a", fullName: "Eric Wadge", fatherId: "edgar" },
      { id: "child-b", fullName: "Harvey Wadge", fatherId: "edgar" },
      { id: "niece", fullName: "Anna Wadge" },
    ];

    const result = applyLegacyArticle616ToWill({ people, deceased });

    expect(result).toMatchObject({ applies: true, adjusted: true, resolved: true });
    expect(result.shares.get("child-a")).toBeCloseTo(1 / 6);
    expect(result.shares.get("child-b")).toBeCloseTo(1 / 6);
    expect(result.shares.get("niece")).toBeCloseTo(2 / 3);
  });

  it("treats a larger testamentary share as absorbing the legitim", () => {
    const deceased = {
      id: "testator",
      isDeceased: true,
      dateOfDeath: "1990-01-01",
      willHeirs: [
        { personId: "child-a", sharePercent: 50 },
        { personId: "child-b", sharePercent: 50 },
      ],
    };
    const people = [
      deceased,
      { id: "child-a", fatherId: "testator" },
      { id: "child-b", fatherId: "testator" },
    ];

    const result = applyLegacyArticle616ToWill({ people, deceased });

    expect(result).toMatchObject({ applies: true, adjusted: false, resolved: true });
    expect(result.shares.get("child-a")).toBeCloseTo(0.5);
    expect(result.shares.get("child-b")).toBeCloseTo(0.5);
  });

  it("passes a predeceased child's protected branch to their descendants", () => {
    const deceased = {
      id: "testator",
      isDeceased: true,
      dateOfDeath: "1990-01-01",
      willHeirs: [{ personId: "niece", sharePercent: 100 }],
    };
    const people = [
      deceased,
      { id: "living-child", fatherId: "testator" },
      {
        id: "predeceased-child",
        fatherId: "testator",
        isDeceased: true,
        dateOfDeath: "1980-01-01",
        inheritanceBasis: "will",
        willHeirs: [{ personId: "child-will-beneficiary", sharePercent: 100 }],
      },
      { id: "grandchild-a", fatherId: "predeceased-child" },
      { id: "grandchild-b", fatherId: "predeceased-child" },
      { id: "child-will-beneficiary" },
      { id: "niece" },
    ];

    const result = applyLegacyArticle616ToWill({ people, deceased });

    expect(result.shares.get("living-child")).toBeCloseTo(1 / 6);
    expect(result.shares.get("grandchild-a")).toBeCloseTo(1 / 12);
    expect(result.shares.get("grandchild-b")).toBeCloseTo(1 / 12);
    expect(result.shares.get("niece")).toBeCloseTo(2 / 3);
    expect(result.shares.has("child-will-beneficiary")).toBe(false);
  });

  it("continues representation through successive predeceased generations without using their wills", () => {
    const deceased = {
      id: "testator",
      isDeceased: true,
      dateOfDeath: "1990-01-01",
      willHeirs: [{ personId: "niece", sharePercent: 100 }],
    };
    const people = [
      deceased,
      {
        id: "child",
        fatherId: "testator",
        isDeceased: true,
        dateOfDeath: "1970-01-01",
        inheritanceBasis: "will",
        willHeirs: [{ personId: "child-outsider", sharePercent: 100 }],
      },
      {
        id: "grandchild",
        fatherId: "child",
        isDeceased: true,
        dateOfDeath: "1980-01-01",
        inheritanceBasis: "will",
        willHeirs: [{ personId: "grandchild-outsider", sharePercent: 100 }],
      },
      { id: "great-grandchild-a", fatherId: "grandchild" },
      { id: "great-grandchild-b", fatherId: "grandchild" },
      { id: "child-outsider" },
      { id: "grandchild-outsider" },
      { id: "niece" },
    ];

    const result = applyLegacyArticle616ToWill({ people, deceased });

    expect(result.shares.get("great-grandchild-a")).toBeCloseTo(1 / 6);
    expect(result.shares.get("great-grandchild-b")).toBeCloseTo(1 / 6);
    expect(result.shares.get("niece")).toBeCloseTo(2 / 3);
    expect(result.shares.has("child-outsider")).toBe(false);
    expect(result.shares.has("grandchild-outsider")).toBe(false);
  });

  it("assumes every recorded child qualifies unless the user records an exception", () => {
    const deceased = {
      id: "testator",
      isDeceased: true,
      dateOfDeath: "1990-01-01",
      spouseIds: ["partner"],
      partnerRelationships: [{ personId: "partner", type: "partnership" }],
      willHeirs: [{ personId: "niece", sharePercent: 100 }],
      legacyArticle616Statuses: [
        {
          personId: "child",
          article616Eligibility: "unconfirmed",
          participation: "unconfirmed",
        },
      ],
    };
    const people = [
      deceased,
      { id: "partner", spouseIds: ["testator"] },
      { id: "child", fatherId: "testator", motherId: "partner" },
      { id: "niece" },
    ];

    const branches = buildLegacyArticle616ChildBranches(people, deceased);
    const result = applyLegacyArticle616ToWill({ people, deceased });

    expect(branches[0].article616Eligibility).toBe("qualifying");
    expect(branches[0].participation).toBe("participating");
    expect(result.resolved).toBe(true);
    expect(result.shares.get("child")).toBeCloseTo(1 / 3);
    expect(result.shares.get("niece")).toBeCloseTo(2 / 3);
  });

  it("does not alter a will when death occurred on the modern-law boundary", () => {
    const deceased = {
      id: "testator",
      isDeceased: true,
      dateOfDeath: "2005-03-01",
      willHeirs: [{ personId: "niece", sharePercent: 100 }],
    };
    const people = [deceased, { id: "child", fatherId: "testator" }, { id: "niece" }];

    const result = applyLegacyArticle616ToWill({ people, deceased });

    expect(result).toMatchObject({ applies: false, adjusted: false, resolved: true });
    expect(result.shares.get("niece")).toBe(1);
    expect(result.shares.has("child")).toBe(false);
  });
});
