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

  it("packs the account summary and actions without shrinking touch targets", () => {
    expect(blockFor(mobileRules, ".account-summary-list")).toMatch(
      /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(blockFor(mobileRules, ".library-account-actions")).toMatch(
      /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(5\.3rem,\s*1fr\)\)/,
    );
    expect(mobileRules).toMatch(/\.library-account-action\s*{[^}]*min-height:\s*2\.75rem/s);
    expect(blockFor(mobileRules, ".library-action-label-short")).toMatch(/display:\s*inline/);
  });

  it("keeps each family row compact with accessible icon actions", () => {
    expect(blockFor(mobileRules, ".family-library-row")).toMatch(
      /"family actions"\s*"added actions"/,
    );
    expect(blockFor(mobileRules, ".family-row-actions .library-row-action")).toMatch(
      /width:\s*2\.75rem/,
    );
    expect(blockFor(mobileRules, ".family-row-actions .library-row-action-label")).toMatch(
      /display:\s*none/,
    );
    expect(blockFor(mobileRules, ".family-library-page input,")).toMatch(/font-size:\s*16px/);
  });
});
