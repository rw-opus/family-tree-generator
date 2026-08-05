import { describe, expect, it } from "vitest";
import {
  validateCausaMortisDateChronology,
  validateRelationshipDateChronology,
  validateTransferDateChronology,
  validateWillDateChronology,
} from "../../src/domain/chronology.js";

describe("chronology validation", () => {
  it("requires a will date strictly before a known death", () => {
    expect(validateWillDateChronology("", "2020-06-10")).toBe("Enter a valid will date.");
    expect(validateWillDateChronology("2020-06-10", "2020-06-10")).toBe(
      "Will date must be before the date of death.",
    );
    expect(validateWillDateChronology("2020-06-11", "2020-06-10")).toBe(
      "Will date must be before the date of death.",
    );
    expect(validateWillDateChronology("2020-06-09", "2020-06-10")).toBe("");
    expect(validateWillDateChronology("2020-06-10", "")).toBe("");
  });

  it("requires a declaration causa mortis strictly after a known death", () => {
    expect(validateCausaMortisDateChronology("not-a-date", "2020-06-10")).toBe(
      "Enter a valid declaration causa mortis date.",
    );
    expect(validateCausaMortisDateChronology("2020-06-10", "2020-06-10")).toBe(
      "Declaration causa mortis date must be after the date of death.",
    );
    expect(validateCausaMortisDateChronology("2020-06-09", "2020-06-10")).toBe(
      "Declaration causa mortis date must be after the date of death.",
    );
    expect(validateCausaMortisDateChronology("2020-06-11", "2020-06-10")).toBe("");
    expect(validateCausaMortisDateChronology("2020-06-11", "unknown")).toBe("");
  });

  it("checks relationship dates against both people and orders start before end", () => {
    expect(
      validateRelationshipDateChronology({
        startDate: "2001-01-02",
        endDate: "2001-01-01",
        personDateOfDeath: "2020-01-01",
      }),
    ).toContain("Marriage or partnership end date cannot be before its start date.");

    expect(
      validateRelationshipDateChronology({
        startDate: "2020-01-02",
        personDateOfDeath: "2020-01-01",
        personLabel: "Edgar",
      }),
    ).toContain("Marriage or partnership start date must be on or before Edgar's date of death.");

    expect(
      validateRelationshipDateChronology({
        startDate: "2020-01-01",
        endDate: "2031-01-01",
        personDateOfDeath: "2040-01-01",
        partnerDateOfDeath: "2030-01-01",
        partnerLabel: "Giovanna",
      }),
    ).toContain("Marriage or partnership end date must be on or before Giovanna's date of death.");
  });

  it("uses a leap-safe 90 calendar year relationship boundary", () => {
    expect(
      validateRelationshipDateChronology({
        startDate: "1910-02-28",
        personDateOfDeath: "2000-02-29",
      }),
    ).toEqual([]);
    expect(
      validateRelationshipDateChronology({
        startDate: "1910-02-27",
        personDateOfDeath: "2000-02-29",
      }),
    ).toContain(
      "Marriage or partnership start date cannot be more than 90 years before the first person's date of death.",
    );
  });

  it("allows optional relationship dates but reports required, malformed dates", () => {
    expect(validateRelationshipDateChronology()).toEqual([]);
    expect(validateRelationshipDateChronology({ startDateRequired: true })).toEqual([
      "Enter a marriage or partnership start date.",
    ]);
    expect(validateRelationshipDateChronology({ endDate: "2024-02-30" })).toEqual([
      "Enter a valid marriage or partnership end date.",
    ]);
  });

  it("requires transfers after all known acquisitions and no later than death", () => {
    expect(validateTransferDateChronology()).toBe("Enter a valid transfer or donation date.");
    expect(
      validateTransferDateChronology({
        transferDate: "2020-05-01",
        acquisitionDates: ["2010-01-01", "2020-05-01", "unknown"],
      }),
    ).toBe("Transfer or donation date must be after every known acquisition date for the share.");
    expect(
      validateTransferDateChronology({
        transferDate: "2020-05-02",
        acquisitionDates: ["2010-01-01", "2020-05-01"],
        sellerDateOfDeath: "2020-05-01",
      }),
    ).toBe("Transfer or donation date must be on or before the seller's date of death.");
    expect(
      validateTransferDateChronology({
        transferDate: "2020-05-02",
        acquisitionDates: ["2010-01-01", "2020-05-01"],
      }),
    ).toBe("");
  });
});
