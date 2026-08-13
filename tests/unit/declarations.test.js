import { describe, expect, it } from "vitest";
import {
  declarationAssessmentFactor,
  declarationCoverage,
  validateDeclaration,
} from "../../src/domain/declarations.js";

describe("succession declarations", () => {
  it("allows separate and additional declarations by different heirs", () => {
    const heirs = [
      { id: "a", name: "Anna" },
      { id: "b", name: "Beppe" },
      { id: "c", name: "Claire" },
    ];
    const coverage = declarationCoverage(heirs, [
      {
        id: "one",
        type: "original",
        status: "published",
        participants: [
          { heirId: "a", numerator: 1, denominator: 6, declaredValue: 100000 },
          { heirId: "b", numerator: 1, denominator: 6, declaredValue: 100000 },
        ],
      },
      {
        id: "two",
        type: "original",
        status: "published",
        participants: [{ heirId: "c", numerator: 1, denominator: 3, declaredValue: 200000 }],
      },
      {
        id: "three",
        type: "additional",
        status: "draft",
        participants: [{ heirId: "a", numerator: 1, denominator: 12, declaredValue: 50000 }],
      },
    ]);
    expect(coverage.find((item) => item.heirId === "a")).toMatchObject({
      declarationCount: 2,
      declaredFraction: 1 / 4,
      declaredValue: 150000,
    });
    expect(coverage.find((item) => item.heirId === "c")).toMatchObject({
      declarationCount: 1,
      declaredFraction: 1 / 3,
    });
  });
  it("ignores draft or published status and requires the DCM details", () => {
    const participants = [{ heirId: "a", numerator: 1, denominator: 2, declaredValue: 50000 }];
    expect(validateDeclaration({ status: "draft", participants })).toContain(
      "date of the Declaration Causa Mortis",
    );
    expect(
      validateDeclaration({
        status: "draft",
        participants,
        date: "2026-01-01",
        notaryName: "",
      }),
    ).toContain("notary");
    expect(
      validateDeclaration({
        status: "published",
        participants,
        date: "2026-01-01",
        notaryName: "Dr Vella",
      }),
    ).toBe("");
  });

  it("keeps unquantified legacy declarations visible but unusable for tax values", () => {
    const [coverage] = declarationCoverage(
      [{ id: "a", name: "Anna", share: 0.5 }],
      [
        {
          id: "legacy",
          status: "published",
          heirIds: ["a"],
        },
      ],
    );

    expect(coverage).toMatchObject({
      declarationCount: 1,
      declaredFraction: 0,
      declaredValue: "",
      status: "invalid",
      unusableDeclarationCount: 1,
      hasUsableDeclaredValues: false,
    });
    expect(validateDeclaration({ status: "published", heirIds: ["a"] })).toContain(
      "legacy declaration",
    );
  });

  it("rejects malformed fractions but accepts blank or explicit zero declared values", () => {
    const malformed = {
      status: "published",
      date: "2026-01-01",
      notaryName: "Dr Vella",
      participants: [{ heirId: "a", numerator: 5, denominator: 0, declaredValue: 100 }],
    };
    const zeroValue = {
      ...malformed,
      participants: [{ heirId: "a", numerator: 1, denominator: 2, declaredValue: 0 }],
    };
    const blankValue = {
      ...malformed,
      participants: [{ heirId: "a", numerator: 1, denominator: 2, declaredValue: "" }],
    };

    expect(validateDeclaration(malformed)).toContain("ownership fraction");
    expect(validateDeclaration(zeroValue)).toBe("");
    expect(validateDeclaration(blankValue)).toBe("");
    expect(declarationCoverage([{ id: "a", share: 0.5 }], [zeroValue])[0]).toMatchObject({
      status: "complete",
      declaredValue: 0,
      hasUsableDeclaredValues: true,
    });
    expect(declarationCoverage([{ id: "a", share: 0.5 }], [blankValue])[0]).toMatchObject({
      status: "complete",
      declaredValue: "",
      hasUsableDeclaredValues: false,
    });
    const [coverage] = declarationCoverage([{ id: "a", share: 0.5 }], [malformed]);
    expect(coverage).toMatchObject({
      declaredFraction: 0,
      status: "invalid",
      hasUsableDeclaredValues: false,
    });
  });

  it("reports under, complete, and over declaration coverage against the actual share", () => {
    const heir = { id: "a", share: 0.5 };
    const declaration = (id, numerator) => ({
      id,
      status: "published",
      participants: [{ heirId: "a", numerator, denominator: 4, declaredValue: 100 }],
    });

    expect(declarationCoverage([heir], [declaration("under", 1)])[0].status).toBe("under");
    expect(declarationCoverage([heir], [declaration("complete", 2)])[0].status).toBe("complete");
    expect(declarationCoverage([heir], [declaration("over", 3)])[0]).toMatchObject({
      status: "over",
      hasUsableDeclaredValues: true,
    });
  });

  it("provides one proportional tax factor for an excess fraction and its value", () => {
    expect(
      declarationAssessmentFactor(
        { numerator: 3, denominator: 4 },
        { numerator: 1, denominator: 2 },
      ),
    ).toEqual({
      fraction: { numerator: 2, denominator: 3 },
      value: 2 / 3,
      isCapped: true,
    });
    expect(
      declarationAssessmentFactor(
        { numerator: 1, denominator: 4 },
        { numerator: 1, denominator: 2 },
      ),
    ).toEqual({
      fraction: { numerator: 1, denominator: 1 },
      value: 1,
      isCapped: false,
    });
  });
});
