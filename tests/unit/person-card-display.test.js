import { describe, expect, it } from "vitest";
import {
  buildTreeCardOwnershipByPerson,
  DEFAULT_PERSON_CARD_FIELDS,
  normalisePersonCardFields,
} from "../../src/domain/personCardDisplay.js";

describe("person card display settings", () => {
  it("shows fraction and percentage by default", () => {
    expect(normalisePersonCardFields()).toEqual(DEFAULT_PERSON_CARD_FIELDS);
  });

  it("migrates the previous share display settings", () => {
    expect(
      normalisePersonCardFields({
        shareDisplay: "fraction",
        showOwnershipOnTree: true,
      }),
    ).toMatchObject({
      ownershipFraction: true,
      ownershipPercentage: false,
    });
    expect(normalisePersonCardFields({ showOwnershipOnTree: false })).toMatchObject({
      ownershipFraction: false,
      ownershipPercentage: false,
    });
  });

  it("preserves every explicitly saved checkbox", () => {
    const fields = Object.fromEntries(
      Object.keys(DEFAULT_PERSON_CARD_FIELDS).map((key, index) => [key, index % 2 === 0]),
    );
    expect(normalisePersonCardFields({ personCardFields: fields })).toEqual(fields);
  });
});

describe("person-card ownership display", () => {
  it("combines current ownership with each deceased person's share at death", () => {
    const ownership = buildTreeCardOwnershipByPerson(
      [
        { personId: "living-owner", share: 0.5 },
        { personId: "unresolved-deceased", share: 0.1 },
      ],
      [
        { deceasedId: "first-deceased", amount: 0.5 },
        { deceasedId: "first-deceased", amount: 0.25 },
        { deceasedId: "unresolved-deceased", amount: 0.5 },
      ],
    );

    expect(ownership).toEqual({
      "living-owner": 0.5,
      "unresolved-deceased": 0.5,
      "first-deceased": 0.75,
    });
  });
});
