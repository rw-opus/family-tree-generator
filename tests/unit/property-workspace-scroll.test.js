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

describe("property workspace scrolling", () => {
  it("provides its own touch-scroll container while the tree keeps body scrolling locked", () => {
    const workspaceRule = blockFor(stylesheet, ".property-workspace-page");

    expect(workspaceRule).toMatch(/height:\s*100dvh/);
    expect(workspaceRule).toMatch(/overflow-x:\s*hidden/);
    expect(workspaceRule).toMatch(/overflow-y:\s*auto/);
    expect(workspaceRule).toMatch(/-webkit-overflow-scrolling:\s*touch/);
  });

  it("removes the nested history scroller on mobile", () => {
    const mobileRules = blockFor(stylesheet, "@media (max-width: 680px)");
    const historyRule = blockFor(mobileRules, ".tax-calculation-history > ol");

    expect(historyRule).toMatch(/max-height:\s*none/);
    expect(historyRule).toMatch(/overflow-y:\s*visible/);
  });

  it("keeps the unified workspace navigation visible while the page scrolls", () => {
    const navigationRule = blockFor(stylesheet, ".property-workspace-nav-shell");
    const sectionRule = blockFor(stylesheet, ".property-workspace-section");

    expect(navigationRule).toMatch(/position:\s*sticky/);
    expect(navigationRule).toMatch(/top:\s*0/);
    expect(sectionRule).toMatch(/scroll-margin-top:/);
  });

  it("shows every workspace destination without horizontal scrolling on phones", () => {
    const mobileRules = blockFor(stylesheet, "@media (max-width: 520px)");
    const menuRule = blockFor(mobileRules, ".property-workspace-menu");

    expect(menuRule).toMatch(/display:\s*grid/);
    expect(menuRule).toMatch(/grid-template-columns:\s*repeat\([23],/);
    expect(menuRule).toMatch(/overflow:\s*visible/);
  });

  // The sticky header wraps onto extra lines as the screen narrows, so a fixed
  // rem offset left a jumped-to heading hidden underneath the menu.
  it("reserves the measured menu height rather than a fixed offset", () => {
    const sectionRule = blockFor(stylesheet, ".property-workspace-section");

    expect(sectionRule).toMatch(
      /scroll-margin-top:\s*calc\(\s*var\(--property-workspace-nav-height/,
    );

    const fixedOffsets = [...stylesheet.matchAll(/scroll-margin-top:\s*([^;]+);/g)]
      .map((match) => match[1].trim())
      .filter((value) => !value.includes("--property-workspace-nav-height"));

    expect(fixedOffsets.filter((value) => /rem|px/.test(value) && !value.includes("var("))).toEqual(
      ["3.5rem"],
    );
  });

  it("lets the initial-ownership row shrink to a 320px viewport", () => {
    const baseColumns = blockFor(stylesheet, ".initial-owner-columns,\n.initial-owner-row").match(
      /grid-template-columns:([^;]+);/,
    );
    const narrowRules = blockFor(stylesheet, "@media (max-width: 360px)");
    const narrowColumns = blockFor(
      narrowRules,
      ".initial-owner-columns,\n  .initial-owner-row",
    ).match(/grid-template-columns:([^;]+);/);

    // The unconditional grid keeps px minima that add up past a 320px phone.
    expect(baseColumns[1]).toMatch(/minmax\(\s*\d+px/);
    expect(narrowColumns).not.toBeNull();

    const minima = [...narrowColumns[1].matchAll(/minmax\(\s*([^,]+),/g)].map((match) =>
      match[1].trim(),
    );
    expect(minima.length).toBeGreaterThan(0);
    expect(minima.every((value) => value === "0")).toBe(true);
  });
});
