import { describe, expect, it } from "vitest";

import { fractionToNumber, normaliseFraction } from "../../src/domain/fractions.js";
import {
  applyPortions,
  buildTaxLots,
  createTranche,
  selectTranchePortions,
  totalHolding,
} from "../../src/domain/trancheOwnership.js";

const frac = (numerator, denominator) => normaliseFraction(numerator, denominator);

// The worked case: a quarter inherited in 1998 (pre-2004, 10%) and another quarter inherited
// in 2015 (8%), so the seller holds a half made of two differently taxed acquisitions.
function twoInheritedQuarters() {
  return [
    createTranche({
      trancheId: "a",
      personId: "joseph",
      fraction: frac(1, 4),
      acquiredOn: "1998-03-02",
      cause: "inheritance",
      provenance: "father",
    }),
    createTranche({
      trancheId: "b",
      personId: "joseph",
      fraction: frac(1, 4),
      acquiredOn: "2015-07-19",
      cause: "inheritance",
      provenance: "aunt",
    }),
  ];
}

const RATES = { a: 0.1, b: 0.08 };
const rateFor = (tranche) => RATES[tranche.trancheId];

const taxOf = (portions, propertyValue) =>
  buildTaxLots(portions, { propertyValue }).reduce(
    (total, lot) => total + lot.transferValue * RATES[lot.trancheId],
    0,
  );

describe("tranche holdings", () => {
  it("adds tranches into a single holding", () => {
    expect(fractionToNumber(totalHolding(twoInheritedQuarters()))).toBe(0.5);
  });

  it("rejects a transfer larger than the holding", () => {
    const result = selectTranchePortions(twoInheritedQuarters(), frac(2, 3), { rateFor });
    expect(result.error).toBe("The seller does not own enough to complete this transfer.");
  });

  it("rejects a zero transfer", () => {
    const result = selectTranchePortions(twoInheritedQuarters(), frac(0, 1), { rateFor });
    expect(result.error).toBe("The transferred fraction must be greater than zero.");
  });
});

describe("selling a third of the property", () => {
  it("splits pro-rata across both acquisitions", () => {
    const result = selectTranchePortions(twoInheritedQuarters(), frac(1, 3), {
      strategy: "pro-rata",
    });
    expect(result.portions.map((portion) => fractionToNumber(portion.fraction))).toEqual([
      1 / 6,
      1 / 6,
    ]);
    expect(taxOf(result.portions, 300000)).toBe(9000);
  });

  it("takes the cheapest acquisition first and pays less", () => {
    const result = selectTranchePortions(twoInheritedQuarters(), frac(1, 3), {
      strategy: "cheapest-first",
      rateFor,
    });
    const byTranche = Object.fromEntries(
      result.portions.map((portion) => [
        portion.tranche.trancheId,
        fractionToNumber(portion.fraction),
      ]),
    );
    // The 8% tranche is exhausted first, the 10% tranche covers only the remaining twelfth.
    expect(byTranche).toEqual({ b: 1 / 4, a: 1 / 12 });
    expect(taxOf(result.portions, 300000)).toBe(8500);
  });

  it("leaves a sixth either way, but of different provenance", () => {
    const tranches = twoInheritedQuarters();
    const proRata = selectTranchePortions(tranches, frac(1, 3), { strategy: "pro-rata" });
    const cheapest = selectTranchePortions(tranches, frac(1, 3), {
      strategy: "cheapest-first",
      rateFor,
    });

    const afterProRata = applyPortions(tranches, proRata.portions).retained;
    const afterCheapest = applyPortions(tranches, cheapest.portions).retained;

    expect(fractionToNumber(totalHolding(afterProRata))).toBeCloseTo(1 / 6, 12);
    expect(fractionToNumber(totalHolding(afterCheapest))).toBeCloseTo(1 / 6, 12);

    // Cheapest-first consumes the 2015 acquisition entirely, so only the 1998 one remains.
    expect(afterCheapest.map((tranche) => tranche.trancheId)).toEqual(["a"]);
    expect(afterProRata.map((tranche) => tranche.trancheId)).toEqual(["a", "b"]);
  });
});

describe("selling the whole holding", () => {
  it("needs no selection rule, and every strategy agrees", () => {
    const tranches = twoInheritedQuarters();
    const strategies = ["cheapest-first", "pro-rata"];
    for (const strategy of strategies) {
      const result = selectTranchePortions(tranches, frac(1, 2), { strategy, rateFor });
      expect(result.wholeHolding).toBe(true);
      expect(result.strategy).toBe("whole-holding");
      expect(taxOf(result.portions, 300000)).toBe(75000 * 0.1 + 75000 * 0.08);
    }
  });

  it("carries each acquisition date into its own tax lot", () => {
    const result = selectTranchePortions(twoInheritedQuarters(), frac(1, 2), { rateFor });
    const lots = buildTaxLots(result.portions, {
      propertyValue: 300000,
      transferDate: "2026-08-03",
    });
    expect(lots.map((lot) => lot.acquisitionDate)).toEqual(["1998-03-02", "2015-07-19"]);
    expect(lots.every((lot) => lot.transferDate === "2026-08-03")).toBe(true);
  });
});

describe("designated transfers", () => {
  it("honours an explicit designation on the deed", () => {
    const result = selectTranchePortions(twoInheritedQuarters(), frac(1, 3), {
      strategy: "designated",
      designation: [
        { trancheId: "a", fraction: frac(1, 4) },
        { trancheId: "b", fraction: frac(1, 12) },
      ],
    });
    expect(result.strategy).toBe("designated");
    expect(taxOf(result.portions, 300000)).toBe(75000 * 0.1 + 25000 * 0.08);
  });

  it("refuses a designation that does not add up to the transfer", () => {
    const result = selectTranchePortions(twoInheritedQuarters(), frac(1, 3), {
      strategy: "designated",
      designation: [{ trancheId: "a", fraction: frac(1, 4) }],
    });
    expect(result.error).toBe("Designated fractions must add up to the transferred share.");
  });

  it("refuses to take more from a tranche than it holds", () => {
    const result = selectTranchePortions(twoInheritedQuarters(), frac(1, 3), {
      strategy: "designated",
      designation: [{ trancheId: "a", fraction: frac(1, 3) }],
    });
    expect(result.error).toBe("A designated fraction exceeds what that tranche holds.");
  });
});

describe("selling then inheriting again", () => {
  it("gives the later inheritance its own acquisition date", () => {
    const tranches = [
      createTranche({
        trancheId: "a",
        personId: "joseph",
        fraction: frac(1, 4),
        acquiredOn: "1998-03-02",
      }),
    ];
    const sale = selectTranchePortions(tranches, frac(1, 4), { rateFor });
    const { retained } = applyPortions(tranches, sale.portions);
    expect(retained).toEqual([]);

    const afterSecondInheritance = [
      ...retained,
      createTranche({
        trancheId: "c",
        personId: "joseph",
        fraction: frac(1, 8),
        acquiredOn: "2022-01-11",
      }),
    ];
    const lots = buildTaxLots(
      selectTranchePortions(afterSecondInheritance, frac(1, 8), { rateFor }).portions,
      { propertyValue: 300000 },
    );
    expect(lots).toHaveLength(1);
    expect(lots[0].acquisitionDate).toBe("2022-01-11");
  });
});
