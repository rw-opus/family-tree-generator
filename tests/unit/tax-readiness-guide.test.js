import { describe, expect, it } from "vitest";
import {
  buildTaxReadinessPersonOrder,
  buildTaxReadinessPlan,
  nextTaxReadinessPerson,
  normaliseTaxReadinessSession,
} from "../../src/domain/taxReadinessGuide.js";
import {
  buildPropertyVendorTaxReport,
  buildTaxCalculationReport,
} from "../../src/domain/propertyVendorTax.js";

const person = (id, patch = {}) => ({
  id,
  givenNames: id,
  surname: "Test",
  fullName: `${id} Test`,
  sex: "Male",
  spouseIds: [],
  designations: [],
  ...patch,
});

const owner = (id, personId, patch = {}) => ({
  id,
  personId,
  shareNumerator: 1,
  shareDenominator: 1,
  ...patch,
});

describe("tax readiness person order", () => {
  it("visits joint initial-owner husband, wife, then their children oldest first", () => {
    const people = [
      person("wife", { sex: "Female", spouseIds: ["husband"] }),
      person("husband", { sex: "Male", spouseIds: ["wife"] }),
      person("younger", { fatherId: "husband", motherId: "wife", dateOfBirth: "1980-01-01" }),
      person("older", { fatherId: "husband", motherId: "wife", dateOfBirth: "1970-01-01" }),
    ];
    const property = {
      owners: [
        owner("wife-owner", "wife", { shareNumerator: 1, shareDenominator: 2 }),
        owner("husband-owner", "husband", { shareNumerator: 1, shareDenominator: 2 }),
      ],
    };

    expect(buildTaxReadinessPersonOrder(property, people)).toEqual([
      "husband",
      "wife",
      "older",
      "younger",
    ]);
  });

  it("keeps a sole female initial owner ahead of her husband", () => {
    const people = [
      person("husband", { spouseIds: ["wife"] }),
      person("wife", { sex: "Female", spouseIds: ["husband"] }),
      person("child", { fatherId: "husband", motherId: "wife" }),
    ];
    expect(buildTaxReadinessPersonOrder({ owners: [owner("o", "wife")] }, people)).toEqual([
      "wife",
      "husband",
      "child",
    ]);
  });

  it("groups joint spouses husband-first even when another owner row separates them", () => {
    const people = [
      person("wife", { sex: "Female", spouseIds: ["husband"] }),
      person("other"),
      person("husband", { spouseIds: ["wife"] }),
    ];
    const property = {
      owners: [owner("wife-o", "wife"), owner("other-o", "other"), owner("husband-o", "husband")],
    };
    expect(buildTaxReadinessPersonOrder(property, people)).toEqual(["husband", "wife", "other"]);
  });

  it("walks each spouse's children before the next spouse branch", () => {
    const people = [
      person("husband", { spouseIds: ["wife-1", "wife-2"] }),
      person("wife-1", { sex: "Female", spouseIds: ["husband"] }),
      person("wife-2", { sex: "Female", spouseIds: ["husband"] }),
      person("child-1", { fatherId: "husband", motherId: "wife-1" }),
      person("child-2", { fatherId: "husband", motherId: "wife-2" }),
    ];
    expect(buildTaxReadinessPersonOrder({ owners: [owner("o", "husband")] }, people)).toEqual([
      "husband",
      "wife-1",
      "child-1",
      "wife-2",
      "child-2",
    ]);
  });

  it("continues through a joint owner's other recorded family branch", () => {
    const people = [
      person("husband", { spouseIds: ["wife"] }),
      person("wife", { sex: "Female", spouseIds: ["husband", "former"] }),
      person("former", { spouseIds: ["wife"] }),
      person("shared", { fatherId: "husband", motherId: "wife" }),
      person("wife-child", { fatherId: "former", motherId: "wife" }),
    ];
    const property = {
      owners: [
        owner("husband-owner", "husband", { shareNumerator: 1, shareDenominator: 2 }),
        owner("wife-owner", "wife", { shareNumerator: 1, shareDenominator: 2 }),
      ],
    };

    expect(buildTaxReadinessPersonOrder(property, people)).toEqual([
      "husband",
      "wife",
      "shared",
      "former",
      "wife-child",
    ]);
  });

  it("uses death chronology between deceased sibling branches when it is known", () => {
    const people = [
      person("parent"),
      person("later", {
        fatherId: "parent",
        dateOfBirth: "1900-01-01",
        dateOfDeath: "1980-01-01",
      }),
      person("earlier", {
        fatherId: "parent",
        dateOfBirth: "1910-01-01",
        dateOfDeath: "1970-01-01",
      }),
    ];
    expect(buildTaxReadinessPersonOrder({ owners: [owner("o", "parent")] }, people)).toEqual([
      "parent",
      "earlier",
      "later",
    ]);
  });

  it("keeps mixed known and unknown death chronology stable across source permutations", () => {
    const parent = person("parent");
    const later = person("later", {
      fatherId: "parent",
      dateOfBirth: "1900-01-01",
      dateOfDeath: "1980-01-01",
    });
    const unknown = person("unknown", {
      fatherId: "parent",
      dateOfBirth: "1905-01-01",
    });
    const earlier = person("earlier", {
      fatherId: "parent",
      dateOfBirth: "1910-01-01",
      dateOfDeath: "1970-01-01",
    });
    const expected = ["parent", "earlier", "later", "unknown"];
    expect(
      buildTaxReadinessPersonOrder({ owners: [owner("o", "parent")] }, [
        parent,
        later,
        unknown,
        earlier,
      ]),
    ).toEqual(expected);
    expect(
      buildTaxReadinessPersonOrder({ owners: [owner("o", "parent")] }, [
        parent,
        earlier,
        later,
        unknown,
      ]),
    ).toEqual(expected);
  });

  it("deduplicates shared descendants and guards relationship cycles", () => {
    const people = [
      person("a", { spouseIds: ["b"], fatherId: "child" }),
      person("b", { sex: "Female", spouseIds: ["a"] }),
      person("child", { fatherId: "a", motherId: "b" }),
    ];
    expect(buildTaxReadinessPersonOrder({ owners: [owner("o", "a")] }, people)).toEqual([
      "a",
      "b",
      "child",
    ]);
  });
});

describe("tax readiness issues and progress", () => {
  it("targets the actual missing spouse and respects the legacy descendant exception", () => {
    const modernPeople = [
      person("deceased", {
        isDeceased: true,
        dateOfDeath: "2005-03-01",
        spouseIds: ["spouse"],
      }),
      person("spouse", {
        sex: "Female",
        surnameAtBirth: "Test",
        isDeceased: true,
        spouseIds: ["deceased"],
      }),
      person("child", { fatherId: "deceased", motherId: "spouse" }),
    ];
    const modern = buildTaxReadinessPlan({
      property: { owners: [owner("o", "deceased", { acquisitionDate: "1990-01-01" })] },
      people: modernPeople,
      propertyReport: {
        ownership: {
          transmissions: [{ deceasedId: "deceased", allocations: { child: 1 } }],
          unresolved: [],
        },
      },
    });
    expect(modern.issuesByPerson.spouse.map((issue) => issue.code)).toEqual([
      "required-spouse-death-date",
    ]);

    const legacy = buildTaxReadinessPlan({
      property: { owners: [owner("o", "deceased", { acquisitionDate: "1990-01-01" })] },
      people: modernPeople.map((candidate) =>
        candidate.id === "deceased" ? { ...candidate, dateOfDeath: "2005-02-28" } : candidate,
      ),
      propertyReport: {
        ownership: {
          transmissions: [{ deceasedId: "deceased", allocations: { child: 1 } }],
          unresolved: [],
        },
      },
    });
    const legacySpouseCodes = legacy.issuesByPerson.spouse?.map((issue) => issue.code) || [];
    expect(legacySpouseCodes).not.toContain("required-spouse-death-date");
    expect(legacySpouseCodes).not.toContain("death-date");
  });

  it("does not request succession facts for descendants whose estates never held this property", () => {
    const people = [
      person("owner"),
      person("child", {
        fatherId: "owner",
        isDeceased: true,
        dateOfDeath: "2010-01-01",
        inheritanceBasis: "will",
        spouseIds: ["child-spouse"],
      }),
      person("child-spouse", {
        sex: "Female",
        surnameAtBirth: "Test",
        isDeceased: true,
        spouseIds: ["child"],
      }),
    ];
    const plan = buildTaxReadinessPlan({
      property: { id: "p", owners: [owner("o", "owner", { acquisitionDate: "1990-01-01" })] },
      people,
      propertyReport: {
        ownership: { transmissions: [], unresolved: [] },
      },
    });

    expect(plan.issuesByPerson.child?.map((issue) => issue.code) || []).not.toContain(
      "operative-will",
    );
    expect(plan.issuesByPerson["child-spouse"]?.map((issue) => issue.code) || []).not.toContain(
      "required-spouse-death-date",
    );
    expect(plan.issuesByPerson["child-spouse"]?.map((issue) => issue.code) || []).not.toContain(
      "death-date",
    );
  });

  it("reports acquisition, death, unresolved succession, CM and tax source work", () => {
    const people = [person("owner", { isDeceased: true }), person("living-owner")];
    const plan = buildTaxReadinessPlan({
      property: {
        id: "p",
        owners: [
          owner("o", "owner", { shareNumerator: 1, shareDenominator: 2 }),
          owner("living-o", "living-owner", { shareNumerator: 1, shareDenominator: 2 }),
        ],
      },
      people,
      propertyReport: {
        ownership: {
          transmissions: [],
          unresolved: [{ personId: "owner", warnings: ["Enter an heir date."] }],
        },
      },
      causaMortisCoverage: { rows: [{ personId: "owner", propertyId: "p", status: "under" }] },
      taxCalculationReport: {
        vendors: [
          {
            id: "owner",
            rows: [{ id: "donation-row", requiresDonationAcquisitionValue: true }],
          },
          {
            id: "living-owner",
            rows: [
              {
                id: "initial-row",
                originalOwnerId: "living-owner",
                requiresOriginalAcquisitionDate: true,
              },
            ],
          },
        ],
      },
    });
    expect(plan.issuesByPerson.owner.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "death-date",
        "ownership-unresolved",
        "causa-mortis-under",
        "donation-acquisition-value",
      ]),
    );
    expect(plan.issuesByPerson["living-owner"].map((issue) => issue.code)).toContain(
      "initial-acquisition-date",
    );
  });

  it("puts a missing descendant death date on that descendant's card", () => {
    const people = [
      person("owner", { isDeceased: true, dateOfDeath: "2020-01-01" }),
      person("child", { isDeceased: true, fatherId: "owner" }),
      person("grandchild", { fatherId: "child" }),
    ];
    const plan = buildTaxReadinessPlan({
      property: { id: "p", owners: [owner("o", "owner", { acquisitionDate: "1990-01-01" })] },
      people,
      propertyReport: {
        ownership: {
          transmissions: [],
          unresolved: [
            {
              personId: "owner",
              warnings: ["Enter the date of death for child."],
              missingDeathDatePersonIds: ["child"],
            },
          ],
        },
      },
    });
    expect(plan.issuesByPerson.child.map((issue) => issue.code)).toContain("death-date");
    expect(plan.issuesByPerson.owner?.map((issue) => issue.code) || []).not.toContain(
      "ownership-unresolved",
    );
  });

  it("does not treat an excess-only CM declaration as missing", () => {
    const plan = buildTaxReadinessPlan({
      property: { id: "p", owners: [owner("o", "owner", { acquisitionDate: "1990-01-01" })] },
      people: [person("owner")],
      causaMortisCoverage: { rows: [{ personId: "owner", propertyId: "p", status: "over" }] },
    });
    expect(plan.issuesByPerson.owner?.map((issue) => issue.code) || []).not.toContain(
      "causa-mortis-over",
    );
  });

  it("routes transfer and relationship problems to their editable card sections", () => {
    const plan = buildTaxReadinessPlan({
      property: { id: "p", owners: [owner("o", "owner", { acquisitionDate: "1990-01-01" })] },
      people: [person("owner"), person("spouse", { sex: "Female", surnameAtBirth: "Test" })],
      propertyReport: {
        ownership: {
          transmissions: [],
          unresolved: [
            {
              personId: "owner",
              transferId: "gift",
              targetField: "donation-date",
              warnings: ["The transfer date is invalid."],
            },
            {
              personId: "spouse",
              destination: "spouse-status-unresolved",
              relationshipPersonIds: ["former"],
              relationshipIssueField: "partner-marriage-end-date",
              warnings: ["Enter the marriage end date."],
            },
          ],
        },
      },
    });
    expect(plan.issuesByPerson.owner).toContainEqual(
      expect.objectContaining({
        code: "ownership-unresolved",
        section: "donation",
        targetId: "gift",
        targetField: "donation-date",
      }),
    );
    expect(plan.issuesByPerson.spouse).toContainEqual(
      expect.objectContaining({
        code: "ownership-unresolved",
        section: "partner-details",
        targetId: "former",
        targetField: "partner-marriage-end-date",
      }),
    );
  });

  it("prompts the deceased source when completed CM shares still need a tax value", () => {
    const plan = buildTaxReadinessPlan({
      property: { id: "p", owners: [owner("o", "deceased", { acquisitionDate: "1990-01-01" })] },
      people: [
        person("deceased", { isDeceased: true, dateOfDeath: "2020-01-01" }),
        person("vendor", { fatherId: "deceased" }),
      ],
      propertyReport: {
        ownership: {
          transmissions: [{ deceasedId: "deceased", allocations: { vendor: 1 } }],
          unresolved: [],
        },
      },
      taxCalculationReport: {
        vendors: [
          {
            id: "vendor",
            rows: [
              {
                id: "inheritance-row",
                sourceKind: "inheritance",
                provenancePersonId: "deceased",
                requiresCausaMortisAcquisitionValue: true,
              },
            ],
          },
        ],
      },
    });
    expect(plan.issuesByPerson.deceased).toContainEqual(
      expect.objectContaining({
        code: "causa-mortis-acquisition-value",
        section: "causa-mortis",
      }),
    );
  });

  it("keeps an inevitably viable legacy descendant branch independent of the spouse date", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2005-02-28",
        spouseIds: ["spouse"],
      }),
      person("spouse", {
        sex: "Female",
        surnameAtBirth: "Test",
        isDeceased: true,
        spouseIds: ["owner"],
      }),
      person("child", {
        isDeceased: true,
        fatherId: "owner",
        motherId: "spouse",
      }),
      person("grandchild", { fatherId: "child" }),
    ];
    const property = { id: "p", owners: [owner("o", "owner")] };
    const unresolved = [
      {
        personId: "owner",
        destination: "survival-date-unresolved",
        missingDeathDatePersonIds: ["child"],
        warnings: ["Enter the date of death for child."],
      },
    ];

    const legacy = buildTaxReadinessPlan({
      property,
      people,
      propertyReport: { ownership: { transmissions: [], unresolved } },
    });
    expect(legacy.issuesByPerson.child.map((issue) => issue.code)).toContain("death-date");
    expect(legacy.issuesByPerson.spouse?.map((issue) => issue.code) || []).not.toContain(
      "required-spouse-death-date",
    );

    const modern = buildTaxReadinessPlan({
      property,
      people: people.map((candidate) =>
        candidate.id === "owner" ? { ...candidate, dateOfDeath: "2005-03-01" } : candidate,
      ),
      propertyReport: { ownership: { transmissions: [], unresolved } },
    });
    expect(modern.issuesByPerson.spouse.map((issue) => issue.code)).toContain(
      "required-spouse-death-date",
    );
  });

  it("keeps the spouse material when an undated child has no viable lower descendant", () => {
    const people = [
      person("owner", {
        isDeceased: true,
        dateOfDeath: "2005-02-28",
        spouseIds: ["spouse"],
      }),
      person("spouse", {
        sex: "Female",
        surnameAtBirth: "Test",
        isDeceased: true,
        spouseIds: ["owner"],
      }),
      person("child", { isDeceased: true, fatherId: "owner", motherId: "spouse" }),
    ];
    const plan = buildTaxReadinessPlan({
      property: { id: "p", owners: [owner("o", "owner")] },
      people,
      propertyReport: {
        ownership: {
          transmissions: [],
          unresolved: [
            {
              personId: "owner",
              missingDeathDatePersonIds: ["child"],
              warnings: ["Enter the date of death for child."],
            },
          ],
        },
      },
    });
    expect(plan.issuesByPerson.spouse.map((issue) => issue.code)).toContain(
      "required-spouse-death-date",
    );
  });

  it("counts editable facts once when several calculated rows depend on the same field", () => {
    const plan = buildTaxReadinessPlan({
      property: { id: "p", owners: [owner("o", "deceased")] },
      people: [
        person("deceased", { isDeceased: true, dateOfDeath: "2020-01-01" }),
        person("vendor", { fatherId: "deceased" }),
      ],
      propertyReport: {
        ownership: {
          transmissions: [{ deceasedId: "deceased", allocations: { vendor: 1 } }],
          unresolved: [
            { personId: "deceased", warnings: ["Enter the marriage end date."] },
            { personId: "deceased", warnings: ["Enter the marriage end date."] },
          ],
        },
      },
      taxCalculationReport: {
        vendors: [
          {
            id: "vendor",
            rows: [
              {
                id: "gift-half-a",
                sourceTransferId: "gift",
                requiresDonationAcquisitionValue: true,
              },
              {
                id: "gift-half-b",
                sourceTransferId: "gift",
                requiresDonationAcquisitionValue: true,
              },
              {
                id: "cm-half-a",
                provenancePersonId: "deceased",
                declarations: [{ id: "cm" }],
                requiresCausaMortisAcquisitionValue: true,
              },
              {
                id: "cm-half-b",
                provenancePersonId: "deceased",
                declarations: [{ id: "cm" }],
                requiresCausaMortisAcquisitionValue: true,
              },
            ],
          },
        ],
      },
    });

    expect(
      plan.issuesByPerson.deceased.filter((issue) => issue.code === "ownership-unresolved"),
    ).toHaveLength(1);
    expect(
      plan.issuesByPerson.deceased.filter(
        (issue) => issue.code === "causa-mortis-acquisition-value",
      ),
    ).toHaveLength(1);
    expect(
      plan.issuesByPerson.vendor.filter((issue) => issue.code === "donation-acquisition-value"),
    ).toHaveLength(1);
  });

  it("does not duplicate one missing identity, death, or will fact", () => {
    const people = [
      person("testator", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
      }),
      person("parent", {
        sex: "Female",
        surnameAtBirth: "",
        surnameAtBirthReviewRequired: true,
        isDeceased: true,
        survivalStatusRequired: true,
        survivalStatusReferencePersonId: "testator",
      }),
    ];
    const plan = buildTaxReadinessPlan({
      property: { id: "p", owners: [owner("o", "testator")] },
      people,
      propertyReport: {
        ownership: {
          transmissions: [],
          unresolved: [
            {
              personId: "testator",
              destination: "will-unresolved",
              warnings: ["Add the will and its date."],
              missingDeathDatePersonIds: ["parent"],
            },
          ],
        },
      },
    });

    expect(plan.issuesByPerson.testator.map((issue) => issue.code)).toContain("operative-will");
    expect(plan.issuesByPerson.testator.map((issue) => issue.code)).not.toContain(
      "ownership-unresolved",
    );
    expect(
      plan.issuesByPerson.parent.filter((issue) => issue.code === "identity-surname-at-birth"),
    ).toHaveLength(1);
    expect(plan.issuesByPerson.parent.map((issue) => issue.code)).not.toContain(
      "identity-surname-at-birth-review",
    );
    expect(plan.issuesByPerson.parent.map((issue) => issue.code)).toContain("death-date");
    expect(plan.issuesByPerson.parent.map((issue) => issue.code)).not.toContain("survival-status");
  });

  it("routes a required donor look-through date to the donor and ignores complete older gifts", () => {
    const people = [person("donor"), person("vendor")];
    const property = {
      id: "p",
      owners: [owner("outside-o", "outside")],
      transfers: [{ id: "gift", sellerId: "donor", buyerId: "vendor", date: "2025-01-01" }],
    };
    const pending = buildTaxReadinessPlan({
      property,
      people,
      taxCalculationReport: {
        vendors: [
          {
            id: "vendor",
            rows: [
              {
                id: "gift-row",
                sourceKind: "donation",
                provenancePersonId: "donor",
                originalOwnerRecordId: "donor-title",
                requiresDonorAcquisitionDate: true,
              },
            ],
          },
        ],
      },
    });
    expect(pending.order).toEqual(["donor", "vendor"]);
    expect(pending.issuesByPerson.donor.map((issue) => issue.code)).toContain(
      "donor-original-acquisition-date",
    );
    expect(
      pending.issuesByPerson.donor.find(
        (issue) => issue.code === "donor-original-acquisition-date",
      ),
    ).toMatchObject({ targetId: "donor-title" });

    const complete = buildTaxReadinessPlan({
      property,
      people,
      taxCalculationReport: {
        vendors: [
          {
            id: "vendor",
            rows: [
              {
                id: "old-gift-row",
                sourceKind: "donation",
                provenancePersonId: "donor",
                requiresDonorAcquisitionDate: false,
              },
            ],
          },
        ],
      },
    });
    expect(complete.issuesByPerson.donor?.map((issue) => issue.code) || []).not.toContain(
      "donor-original-acquisition-date",
    );
  });

  it("guides missing gift facts even before a selling value is entered", () => {
    const people = [person("donor"), person("donee")];
    const property = {
      id: "p",
      saleDate: "2026-08-13",
      saleValue: "",
      owners: [
        {
          id: "donor-title",
          personId: "donor",
          shareNumerator: 1,
          shareDenominator: 1,
          acquisitionDate: "2000-01-01",
        },
      ],
      transfers: [
        {
          id: "gift",
          kind: "donation",
          sellerId: "donor",
          buyerId: "donee",
          numerator: 1,
          denominator: 1,
          amountType: "seller-holding",
          date: "2020-01-01",
          acquisitionValue: "",
          acquisitionValueBasis: "",
        },
      ],
      declarations: [],
      saleLots: [],
    };
    const propertyReport = buildPropertyVendorTaxReport(property, people, []);
    const taxCalculationReport = buildTaxCalculationReport(property, people, [], propertyReport);
    const plan = buildTaxReadinessPlan({
      property,
      people,
      propertyReport,
      taxCalculationReport,
    });

    expect(taxCalculationReport.vendors[0].rows[0].warning).toMatch(
      /consideration or market value/i,
    );
    expect(plan.issuesByPerson.donee.map((issue) => issue.code)).toContain(
      "donation-acquisition-value",
    );
  });

  it("guides correction of future initial-title and donation dates", () => {
    const initialPeople = [person("owner")];
    const initialProperty = {
      id: "initial-property",
      saleDate: "2026-08-13",
      saleValue: "",
      owners: [
        {
          id: "title",
          personId: "owner",
          shareNumerator: 1,
          shareDenominator: 1,
          acquisitionDate: "2027-01-01",
        },
      ],
      transfers: [],
      declarations: [],
      saleLots: [],
    };
    const initialReport = buildPropertyVendorTaxReport(initialProperty, initialPeople, []);
    const initialTax = buildTaxCalculationReport(initialProperty, initialPeople, [], initialReport);
    const initialPlan = buildTaxReadinessPlan({
      property: initialProperty,
      people: initialPeople,
      propertyReport: initialReport,
      taxCalculationReport: initialTax,
    });
    expect(initialPlan.issuesByPerson.owner.map((issue) => issue.code)).toContain(
      "initial-acquisition-date",
    );

    const giftPeople = [person("donor"), person("donee")];
    const giftProperty = {
      id: "gift-property",
      saleDate: "2026-08-13",
      saleValue: "",
      owners: [
        {
          id: "donor-title",
          personId: "donor",
          shareNumerator: 1,
          shareDenominator: 1,
          acquisitionDate: "2000-01-01",
        },
      ],
      transfers: [
        {
          id: "future-gift",
          kind: "donation",
          sellerId: "donor",
          buyerId: "donee",
          numerator: 1,
          denominator: 1,
          amountType: "seller-holding",
          date: "2027-01-01",
          acquisitionValue: 100000,
          acquisitionValueBasis: "deed-value",
        },
      ],
      declarations: [],
      saleLots: [],
    };
    const giftReport = buildPropertyVendorTaxReport(giftProperty, giftPeople, []);
    const giftTax = buildTaxCalculationReport(giftProperty, giftPeople, [], giftReport);
    const giftPlan = buildTaxReadinessPlan({
      property: giftProperty,
      people: giftPeople,
      propertyReport: giftReport,
      taxCalculationReport: giftTax,
    });
    expect(giftPlan.issuesByPerson.donor.map((issue) => issue.code)).toContain(
      "donation-date-correction",
    );
    expect(
      giftPlan.issuesByPerson.donor.find((issue) => issue.code === "donation-date-correction"),
    ).toMatchObject({ targetId: "future-gift" });
  });

  it("keeps each repeated tax source prompt tied to its exact editable record", () => {
    const people = [
      person("owner"),
      person("deceased", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        wills: [{ id: "undated-will", date: "" }],
      }),
    ];
    const plan = buildTaxReadinessPlan({
      property: {
        id: "property",
        owners: [owner("owner-title", "owner", { acquisitionDate: "" })],
      },
      people,
      propertyReport: {
        ownership: {
          transmissions: [{ deceasedId: "deceased", allocations: {} }],
          unresolved: [],
        },
      },
      taxCalculationReport: {
        vendors: [
          {
            id: "owner",
            rows: [
              {
                id: "title-row",
                originalOwnerId: "owner",
                originalOwnerRecordId: "owner-title",
                requiresOriginalAcquisitionDate: true,
              },
              {
                id: "gift-one-row",
                sourceTransferId: "gift-one",
                requiresDonationAcquisitionValue: true,
              },
              {
                id: "gift-two-row",
                sourceTransferId: "gift-two",
                requiresDonationAcquisitionValue: true,
              },
              {
                id: "inheritance-row",
                provenancePersonId: "deceased",
                requiresCausaMortisAcquisitionValue: true,
                declarations: [
                  { id: "cm-complete", hasDeclaredValue: true },
                  { id: "cm-missing-one", hasDeclaredValue: false },
                  { id: "cm-missing-two", hasDeclaredValue: false },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(
      plan.issuesByPerson.owner
        .filter((issue) => issue.code === "donation-acquisition-value")
        .map((issue) => issue.targetId),
    ).toEqual(["gift-one", "gift-two"]);
    expect(
      plan.issuesByPerson.owner.find((issue) => issue.code === "initial-acquisition-date"),
    ).toMatchObject({ targetId: "owner-title" });
    expect(
      plan.issuesByPerson.deceased
        .filter((issue) => issue.code === "causa-mortis-acquisition-value")
        .map((issue) => issue.targetId),
    ).toEqual(["cm-missing-one", "cm-missing-two"]);
    expect(
      plan.issuesByPerson.deceased.find((issue) => issue.code === "operative-will"),
    ).toMatchObject({ targetId: "undated-will" });
  });

  it("routes an incomplete valid will to its beneficiary share instead of completed death data", () => {
    const testator = person("testator", {
      isDeceased: true,
      dateOfDeath: "2020-01-01",
      inheritanceBasis: "will",
      wills: [{ id: "will", date: "2019-01-01" }],
      willHeirs: [
        {
          id: "half-share",
          personId: "beneficiary",
          shareNumerator: 1,
          shareDenominator: 2,
        },
      ],
    });
    const plan = buildTaxReadinessPlan({
      property: { owners: [owner("title", "testator", { acquisitionDate: "2000-01-01" })] },
      people: [testator, person("beneficiary")],
      propertyReport: {
        ownership: {
          transmissions: [{ deceasedId: "testator", allocations: { beneficiary: 0.5 } }],
          unresolved: [
            {
              personId: "testator",
              destination: "will-unresolved",
              warnings: ["Will beneficiary shares total 50%, not 100%."],
            },
          ],
        },
      },
    });

    expect(plan.issuesByPerson.testator).toEqual([
      expect.objectContaining({
        code: "will-allocation",
        targetId: "half-share",
        targetField: "will-beneficiary-share",
      }),
    ]);
  });

  it("routes a beneficiary that no longer exists to that exact will row", () => {
    const testator = person("testator", {
      isDeceased: true,
      dateOfDeath: "2020-01-01",
      inheritanceBasis: "will",
      wills: [{ id: "will", date: "2019-01-01" }],
      willHeirs: [
        {
          id: "missing-beneficiary",
          personId: "deleted-person",
          shareNumerator: 1,
          shareDenominator: 1,
        },
      ],
    });
    const plan = buildTaxReadinessPlan({
      property: { owners: [owner("title", "testator", { acquisitionDate: "2000-01-01" })] },
      people: [testator],
      propertyReport: {
        ownership: {
          transmissions: [{ deceasedId: "testator", allocations: {} }],
          unresolved: [
            {
              personId: "testator",
              destination: "will-unresolved",
              warnings: ["Remove or replace beneficiaries who are no longer in this case."],
            },
          ],
        },
      },
    });

    expect(plan.issuesByPerson.testator).toEqual([
      expect.objectContaining({
        code: "will-allocation",
        targetId: "missing-beneficiary",
        targetField: "will-beneficiary",
        prompt: expect.stringMatching(/no longer in this case/i),
      }),
    ]);
  });

  it("routes a prohibited self-beneficiary to that exact beneficiary selector", () => {
    const testator = person("testator", {
      isDeceased: true,
      dateOfDeath: "2020-01-01",
      inheritanceBasis: "will",
      wills: [{ id: "will", date: "2019-01-01" }],
      willHeirs: [
        {
          id: "good-first",
          personId: "beneficiary",
          shareNumerator: 1,
          shareDenominator: 2,
        },
        {
          id: "self-second",
          personId: "testator",
          shareNumerator: 1,
          shareDenominator: 2,
        },
      ],
    });
    const plan = buildTaxReadinessPlan({
      property: { owners: [owner("title", "testator", { acquisitionDate: "2000-01-01" })] },
      people: [testator, person("beneficiary")],
      propertyReport: {
        ownership: {
          transmissions: [{ deceasedId: "testator", allocations: {} }],
          unresolved: [
            {
              personId: "testator",
              destination: "will-unresolved",
              warnings: ["The deceased cannot be selected as their own beneficiary."],
            },
          ],
        },
      },
    });

    expect(plan.issuesByPerson.testator).toEqual([
      expect.objectContaining({
        code: "will-allocation",
        targetId: "self-second",
        targetField: "will-beneficiary",
        prompt: expect.stringMatching(/own beneficiary/i),
      }),
    ]);
  });

  it("targets the first will error in the same order as the readiness prompt", () => {
    const testator = person("testator", {
      isDeceased: true,
      dateOfDeath: "2020-01-01",
      inheritanceBasis: "will",
      wills: [{ id: "will", date: "2019-01-01" }],
      willHeirs: [
        {
          id: "bad-share",
          personId: "beneficiary",
          shareNumerator: 0,
          shareDenominator: 1,
        },
        {
          id: "dangling",
          personId: "deleted-person",
          shareNumerator: 1,
          shareDenominator: 1,
        },
      ],
    });
    const plan = buildTaxReadinessPlan({
      property: { owners: [owner("title", "testator", { acquisitionDate: "2000-01-01" })] },
      people: [testator, person("beneficiary")],
      propertyReport: {
        ownership: {
          transmissions: [{ deceasedId: "testator", allocations: {} }],
          unresolved: [
            {
              personId: "testator",
              destination: "will-unresolved",
              warnings: ["Enter a positive share for every beneficiary."],
            },
          ],
        },
      },
    });

    expect(plan.issuesByPerson.testator).toEqual([
      expect.objectContaining({
        code: "will-allocation",
        targetId: "bad-share",
        targetField: "will-beneficiary-share",
        prompt: expect.stringMatching(/positive share/i),
      }),
    ]);
  });

  it("routes under-declared causa mortis coverage to inserting the next declaration", () => {
    const plan = buildTaxReadinessPlan({
      property: { id: "property", owners: [owner("title", "deceased")] },
      people: [person("deceased", { isDeceased: true, dateOfDeath: "2020-01-01" })],
      propertyReport: {
        ownership: {
          transmissions: [{ deceasedId: "deceased", allocations: {} }],
          unresolved: [],
        },
      },
      causaMortisCoverage: {
        rows: [{ propertyId: "property", personId: "deceased", status: "under" }],
      },
    });
    expect(
      plan.issuesByPerson.deceased.find((issue) => issue.code === "causa-mortis-under"),
    ).toMatchObject({ targetField: "add-causa-mortis" });
  });

  it("routes an unresolved CM allocation to the exact declaration's declarants", () => {
    const plan = buildTaxReadinessPlan({
      property: { id: "property", owners: [owner("title", "deceased")] },
      people: [person("deceased", { isDeceased: true, dateOfDeath: "2020-01-01" })],
      propertyReport: {
        ownership: {
          transmissions: [{ deceasedId: "deceased", allocations: {} }],
          unresolved: [],
        },
      },
      causaMortisCoverage: {
        rows: [
          {
            propertyId: "property",
            personId: "deceased",
            status: "allocation-unresolved",
            unresolvedDeclarationIds: ["wrong-cm"],
          },
        ],
      },
    });

    expect(
      plan.issuesByPerson.deceased.find(
        (issue) => issue.code === "causa-mortis-allocation-unresolved",
      ),
    ).toMatchObject({
      targetId: "wrong-cm",
      targetField: "causa-mortis-declarants",
    });
  });

  it("keeps each unresolved marriage prompt tied to its own partner row", () => {
    const plan = buildTaxReadinessPlan({
      property: { owners: [owner("title", "deceased")] },
      people: [
        person("deceased", { isDeceased: true, dateOfDeath: "2020-01-01" }),
        person("first-spouse", { sex: "Female" }),
        person("second-spouse", { sex: "Female" }),
      ],
      propertyReport: {
        ownership: {
          transmissions: [{ deceasedId: "deceased", allocations: {} }],
          unresolved: [
            {
              personId: "deceased",
              destination: "spouse-status-unresolved",
              relationshipPersonIds: ["first-spouse", "second-spouse"],
              relationshipIssueField: "partner-relationship",
              warnings: ["Record the end date of every former marriage."],
            },
          ],
        },
      },
    });

    expect(
      plan.issuesByPerson.deceased
        .filter((issue) => issue.code === "ownership-unresolved")
        .map((issue) => ({ targetId: issue.targetId, targetField: issue.targetField })),
    ).toEqual([
      { targetId: "first-spouse", targetField: "partner-relationship" },
      { targetId: "second-spouse", targetField: "partner-relationship" },
    ]);
  });

  it("keeps Skip for now progress stable and prunes deleted or resolved people", () => {
    const plan = {
      order: ["a", "b"],
      pendingPersonIds: ["a", "b"],
      issuesByPerson: { a: [{ key: "one" }], b: [{ key: "two" }] },
    };
    const session = normaliseTaxReadinessSession(
      {
        status: "active",
        currentPersonId: "a",
        skippedPersonIds: ["a", "missing"],
        reviewedPersonIds: [],
        historyPersonIds: ["missing", "a"],
      },
      plan,
      "property",
    );
    expect(session.skippedPersonIds).toEqual(["a"]);
    expect(session.historyPersonIds).toEqual(["a"]);
    expect(nextTaxReadinessPerson(plan, session)).toBe("b");
    expect(nextTaxReadinessPerson(plan, session, { includeSkipped: true })).toBe("a");
  });

  it("reopens a reviewed card or skipped card when its missing facts change", () => {
    const plan = {
      order: ["a"],
      pendingPersonIds: ["a"],
      issuesByPerson: { a: [{ key: "new-death-date-reason" }] },
    };
    const session = normaliseTaxReadinessSession(
      {
        reviewedPersonIds: ["a"],
        skippedPersonIds: ["a"],
        skippedIssueKeys: { a: ["old-reason"] },
      },
      plan,
      "property",
    );
    expect(session.reviewedPersonIds).toEqual([]);
    expect(session.skippedPersonIds).toEqual([]);
    expect(nextTaxReadinessPerson(plan, session)).toBe("a");
  });

  it("reopens a skipped will card when the missing detail moves to another beneficiary row", () => {
    const property = { owners: [owner("title", "testator")] };
    const propertyReport = {
      ownership: {
        transmissions: [{ deceasedId: "testator", allocations: {} }],
        unresolved: [
          {
            personId: "testator",
            destination: "will-unresolved",
            warnings: ["Choose a person for every beneficiary row."],
          },
        ],
      },
    };
    const testator = (willHeirs) =>
      person("testator", {
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        wills: [{ id: "will", date: "2019-01-01" }],
        willHeirs,
      });
    const share = (id, personId) => ({
      id,
      personId,
      shareNumerator: 1,
      shareDenominator: 2,
    });
    const beneficiaryA = person("beneficiary-a");
    const beneficiaryB = person("beneficiary-b");
    const firstPlan = buildTaxReadinessPlan({
      property,
      people: [
        testator([share("heir-a", ""), share("heir-b", "beneficiary-b")]),
        beneficiaryA,
        beneficiaryB,
      ],
      propertyReport,
    });
    const firstIssue = firstPlan.issuesByPerson.testator.find(
      (issue) => issue.code === "will-allocation",
    );
    const secondPlan = buildTaxReadinessPlan({
      property,
      people: [
        testator([share("heir-a", "beneficiary-a"), share("heir-b", "")]),
        beneficiaryA,
        beneficiaryB,
      ],
      propertyReport,
    });
    const secondIssue = secondPlan.issuesByPerson.testator.find(
      (issue) => issue.code === "will-allocation",
    );
    const session = normaliseTaxReadinessSession(
      {
        skippedPersonIds: ["testator"],
        skippedIssueKeys: { testator: [firstIssue.key] },
      },
      secondPlan,
      "property",
    );

    expect(firstIssue).toMatchObject({ targetId: "heir-a", targetField: "will-beneficiary" });
    expect(secondIssue).toMatchObject({ targetId: "heir-b", targetField: "will-beneficiary" });
    expect(secondIssue.key).not.toBe(firstIssue.key);
    expect(session.skippedPersonIds).toEqual([]);
    expect(nextTaxReadinessPerson(secondPlan, session)).toBe("testator");
  });
});
