import { describe, expect, it } from "vitest";
import { declarationCoverage, validateDeclaration } from "../../src/domain/declarations.js";

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
      publishedCount: 1,
      publishedFraction: 1 / 6,
      publishedValue: 100000,
    });
    expect(coverage.find((item) => item.heirId === "c")).toMatchObject({
      declarationCount: 1,
      publishedCount: 1,
    });
  });
  it("requires a date and notary only when marked published", () => {
    const participants = [{ heirId: "a", numerator: 1, denominator: 2, declaredValue: 50000 }];
    expect(validateDeclaration({ status: "draft", participants })).toBe("");
    expect(validateDeclaration({ status: "published", participants, notaryName: "" })).toContain(
      "publication date",
    );
    expect(
      validateDeclaration({
        status: "published",
        participants,
        date: "2026-01-01",
        notaryName: "",
      }),
    ).toContain("notary");
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
      publishedCount: 1,
      publishedFraction: 0,
      publishedValue: 0,
      status: "invalid",
      unusablePublishedCount: 1,
      hasUsablePublishedValues: false,
    });
    expect(validateDeclaration({ status: "published", heirIds: ["a"] })).toContain(
      "legacy declaration",
    );
  });

  it("rejects malformed published fractions and zero published values", () => {
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

    expect(validateDeclaration(malformed)).toContain("ownership fraction");
    expect(validateDeclaration(zeroValue)).toContain("positive declared value");
    const [coverage] = declarationCoverage([{ id: "a", share: 0.5 }], [malformed]);
    expect(coverage).toMatchObject({
      publishedFraction: 0,
      status: "invalid",
      hasUsablePublishedValues: false,
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
      hasUsablePublishedValues: false,
    });
  });
});
