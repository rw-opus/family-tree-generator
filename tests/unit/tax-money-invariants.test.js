import { describe, expect, it } from "vitest";
import {
  buildPropertyVendorTaxReport,
  buildTaxCalculationReport,
} from "../../src/domain/propertyVendorTax.js";
import { toCents } from "../../src/domain/money.js";

/**
 * D5 — invariants that must hold for every estate, whatever the fractions.
 *
 * The figures here are read off a printed settlement statement, so the only
 * thing that matters is what a notary sees: every amount is a whole cent, and
 * each column adds up to the total beneath it.
 */

const person = (id) => ({
  id,
  fullName: id,
  designations: [],
  fatherId: "",
  motherId: "",
  spouseIds: [],
  siblingIds: [],
});

const people = "abcdefghijk".split("").map(person);

const owner = (id, personId, numerator, denominator, acquisitionDate = "2010-01-01") => ({
  id,
  personId,
  shareNumerator: numerator,
  shareDenominator: denominator,
  sharePercent: (numerator * 100) / denominator,
  acquisitionDate,
});

const equalOwners = (count, acquisitionDate) =>
  "abcdefghijk"
    .slice(0, count)
    .split("")
    .map((letter, index) => owner(String(index), letter, 1, count, acquisitionDate));

const buildReport = (property) => {
  const vendorReport = buildPropertyVendorTaxReport(property, people, []);
  return buildTaxCalculationReport(property, people, [], vendorReport);
};

const estates = [
  {
    label: "two halves",
    saleValue: "400000",
    owners: [owner("1", "a", 1, 2, "1990-05-01"), owner("2", "b", 1, 2)],
  },
  { label: "three thirds of a round million", saleValue: "1000000", owners: equalOwners(3) },
  { label: "three thirds of an awkward price", saleValue: "333333.33", owners: equalOwners(3) },
  { label: "seven sevenths", saleValue: "100000", owners: equalOwners(7) },
  { label: "nine ninths", saleValue: "250000", owners: equalOwners(9) },
  { label: "eleven elevenths", saleValue: "725000", owners: equalOwners(11) },
  {
    label: "sixths and a half at mixed rates",
    saleValue: "725000",
    owners: [
      owner("1", "a", 1, 6),
      owner("2", "b", 1, 6),
      owner("3", "c", 1, 6, "1999-01-01"),
      owner("4", "d", 1, 2),
    ],
  },
  { label: "a one-euro estate split eleven ways", saleValue: "1", owners: equalOwners(11) },
  { label: "a large estate in thirds", saleValue: "9999999.99", owners: equalOwners(3) },
];

describe.each(estates)("$label", ({ saleValue, owners }) => {
  const property = {
    id: "property",
    saleValue,
    owners,
    declarations: [],
    transfers: [],
    saleLots: [],
  };

  it("shows every amount as a whole number of cents", () => {
    const report = buildReport(property);

    report.vendors.forEach((vendor) => {
      expect(vendor.attributedSaleValue * 100).toBeCloseTo(
        Math.round(vendor.attributedSaleValue * 100),
        6,
      );
      vendor.rows.forEach((row) => {
        if (row.attributedSaleValue !== null) {
          expect(toCents(row.attributedSaleValue)).toBe(Math.round(row.attributedSaleValue * 100));
        }
      });
    });
  });

  it("adds each vendor's rows up to that vendor's subtotal", () => {
    const report = buildReport(property);

    report.vendors.forEach((vendor) => {
      const rowPrice = vendor.rows.reduce((sum, row) => sum + toCents(row.attributedSaleValue), 0);
      expect(toCents(vendor.attributedSaleValue)).toBe(rowPrice);

      if (vendor.tax !== null) {
        const rowTax = vendor.rows.reduce((sum, row) => sum + toCents(row.tax), 0);
        expect(toCents(vendor.tax)).toBe(rowTax);
      }
    });
  });

  it("adds the vendor column up to the printed total", () => {
    const report = buildReport(property);
    const sum = (pick) =>
      report.vendors.reduce((total, vendor) => total + toCents(pick(vendor)), 0);

    expect(toCents(report.totalSaleValue)).toBe(sum((vendor) => vendor.attributedSaleValue));
    expect(toCents(report.totalTax)).toBe(sum((vendor) => vendor.tax));
    expect(toCents(report.totalNet)).toBe(sum((vendor) => vendor.net));
  });

  it("attributes the whole selling price and no more", () => {
    const report = buildReport(property);

    expect(toCents(report.totalSaleValue)).toBe(toCents(saleValue));
  });

  it("leaves each vendor a net balance of exactly price less tax", () => {
    const report = buildReport(property);

    report.vendors.forEach((vendor) => {
      expect(toCents(vendor.net)).toBe(toCents(vendor.attributedSaleValue) - toCents(vendor.tax));
    });
  });

  it("never charges tax above the attributed price, or below zero", () => {
    const report = buildReport(property);

    report.vendors.forEach((vendor) => {
      expect(vendor.tax).toBeGreaterThanOrEqual(0);
      expect(vendor.tax).toBeLessThanOrEqual(vendor.attributedSaleValue);
    });
  });

  it("gives the same figures every time it is calculated", () => {
    const first = buildReport(property);
    const second = buildReport(property);

    expect(second.vendors.map((vendor) => [vendor.id, vendor.tax, vendor.net])).toEqual(
      first.vendors.map((vendor) => [vendor.id, vendor.tax, vendor.net]),
    );
  });
});

describe("partial sales", () => {
  it("does not inflate a half-share sale to the whole selling price", () => {
    // Only one of the two owners is a living vendor here, so the deed covers
    // half the property and must attribute half the price.
    const property = {
      id: "property",
      saleValue: "2000",
      owners: [owner("1", "a", 1, 2), owner("2", "b", 1, 2)],
      declarations: [],
      transfers: [],
      saleLots: [],
    };
    const vendorReport = buildPropertyVendorTaxReport(property, people, []);
    const halfReport = buildTaxCalculationReport(property, people, [], {
      ...vendorReport,
      livingVendors: vendorReport.livingVendors.slice(0, 1),
    });

    expect(halfReport.totalSaleValue).toBe(1000);
  });
});
