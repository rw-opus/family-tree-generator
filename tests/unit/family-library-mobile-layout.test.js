import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(new URL("../../src/workbench.css", import.meta.url), "utf8");

function blockFor(source, selector) {
  const selectorIndex = source.indexOf(selector);
  if (selectorIndex < 0) return "";
  const openingBrace = source.indexOf("{", selectorIndex + selector.length);
  if (openingBrace < 0) return "";

  let depth = 1;
  for (let index = openingBrace + 1; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }
  return "";
}

describe("mobile family library layout", () => {
  const mobileRules = blockFor(stylesheet, "@media (max-width: 520px)");

  it("packs the account summary and keeps Tree Tools reachable", () => {
    expect(blockFor(mobileRules, ".account-summary-list")).toMatch(
      /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(blockFor(mobileRules, ".tree-tools-trigger")).toMatch(/min-height:\s*2\.75rem/);
    expect(blockFor(mobileRules, ".tree-tools-list")).toMatch(/position:\s*fixed/);
    expect(stylesheet).toMatch(/\.tree-tools-list\s*>\s*button,[\s\S]*?min-height:\s*2\.75rem/);
  });

  it("keeps each family row compact without hiding action labels", () => {
    expect(blockFor(mobileRules, ".family-library-row")).toMatch(
      /"family family"\s*"added actions"/,
    );
    expect(blockFor(mobileRules, ".family-row-actions .library-row-action")).toMatch(
      /width:\s*auto/,
    );
    expect(blockFor(mobileRules, ".family-row-actions .library-row-action-label")).toMatch(
      /display:\s*inline/,
    );
    expect(blockFor(mobileRules, ".family-library-page input,")).toMatch(/font-size:\s*16px/);
  });
});

describe("desktop family library symmetry", () => {
  it("gives the two family creation actions equal columns and widths", () => {
    expect(blockFor(stylesheet, ".library-create-actions")).toMatch(
      /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(blockFor(stylesheet, ".library-primary-button,")).toMatch(
      /width:\s*100%/,
    );
  });
});

/**
 * Between the phone layout and a comfortable desktop there was a band — small
 * tablets, and any phone in landscape — where the page had already split into
 * two columns but neither column could afford it. The account column will not
 * go below 15rem, so the families table was left about 270px wide: narrower
 * than the same table gets on a phone. The name column collapsed to zero and
 * the only control that opens a family disappeared from the row.
 */
describe("the family row survives a narrow families card", () => {
  it("keeps the page in one column until two will fit", () => {
    const split = blockFor(stylesheet, ".family-library-content");
    expect(split).toMatch(/grid-template-columns:\s*minmax\(15rem,/);

    // A breakpoint above the phone layout has to undo the split, or the 15rem
    // floor squeezes the families card below its phone width.
    const singleColumn = [...stylesheet.matchAll(/@media \(max-width: (\d+)px\)/g)]
      .map((match) => ({ width: Number(match[1]), index: match.index }))
      .filter(({ index }) => {
        const rules = blockFor(stylesheet.slice(index), "@media");
        return /\.family-library-content\s*{[^}]*grid-template-columns:\s*1fr/s.test(rules);
      })
      .map(({ width }) => width);

    expect(Math.max(...singleColumn)).toBeGreaterThanOrEqual(700);
  });

  it("never lets the family name column collapse to nothing", () => {
    const row = blockFor(stylesheet, ".family-library-row");
    const columns = row.match(/grid-template-columns:([^;]+);/)[1];

    // The name comes first and keeps a floor; the date yields its width first.
    expect(columns).toMatch(/minmax\(\s*[1-9][\d.]*rem,\s*1fr\s*\)/);
    expect(columns).not.toMatch(/^\s*minmax\(\s*0/);
  });
});
