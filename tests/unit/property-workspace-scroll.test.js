import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(
  new URL("../../src/workbench.css", import.meta.url),
  "utf8",
).replace(/\r?\n/g, "\n");

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

  it("keeps the labelled person-card control interactive at the top-left of the tree", () => {
    const navigationRule = blockFor(stylesheet, ".tree-navigation-tools");
    const controlRule = blockFor(stylesheet, ".person-card-display-control");
    const menuRule = blockFor(stylesheet, ".person-card-display-menu");

    expect(navigationRule).toMatch(/top:\s*4\.55rem/);
    expect(navigationRule).toMatch(/left:\s*0\.75rem/);
    expect(controlRule).toMatch(/pointer-events:\s*auto/);
    expect(controlRule).toMatch(/touch-action:\s*auto/);
    expect(menuRule).toMatch(/left:\s*0/);
    expect(stylesheet).not.toMatch(
      /\.person-card-display-control\s+summary\s+span\s*\{[^}]*display:\s*none/s,
    );
  });

  it("places the person-card control below the mobile toolbar with a touch-sized target", () => {
    const mobileRules = blockFor(stylesheet, "@media (max-width: 900px)");
    const navigationRule = blockFor(mobileRules, ".tree-navigation-tools");
    const controlRule = blockFor(
      mobileRules,
      ".tree-navigation-tools .person-card-display-control summary",
    );

    expect(navigationRule).toMatch(/top:\s*7rem/);
    expect(navigationRule).toMatch(/right:\s*auto/);
    expect(navigationRule).toMatch(/left:\s*0\.55rem/);
    expect(controlRule).toMatch(/min-height:\s*2\.75rem/);
  });

  it("keeps the outside-owner hint spaced from the name it follows", () => {
    // The hint sits beside the name on one row. A previous phone override set
    // it to display:block to stack it, but the button is an inline-flex row so
    // it stayed alongside and only lost its margin, welding the two together.
    const button = blockFor(stylesheet, ".ownership-person-link.outside-owner-link");
    const name = blockFor(stylesheet, ".outside-owner-link .outside-owner-name");
    const hint = blockFor(stylesheet, ".outside-owner-link::after");

    expect(button).toMatch(/text-decoration:\s*none/);
    expect(button).toMatch(/flex-wrap:\s*wrap/);
    expect(name).toMatch(/text-decoration:\s*underline/);
    expect(hint).toMatch(/margin-left:/);
    expect(stylesheet).not.toMatch(/\.outside-owner-link::after\s*\{[^}]*display:\s*block/);
  });

  // The share used to sit stacked above its own percentage, spending two lines
  // per owner to say one thing twice.
  it("keeps an owner's share and percentage on one line", () => {
    // The scoping matters: the base sheet stacks this same element as
    // `.owner-row > span:nth-child(2)`, which outranks a two-class selector,
    // so the rule has to go through .owner-row to win.
    const rule = blockFor(stylesheet, ".property-ownership-summary .owner-row > .owner-share");

    expect(rule).toMatch(/display:\s*flex/);
    expect(rule).not.toMatch(/display:\s*grid/);
    expect(rule).toMatch(/align-items:\s*baseline/);
    expect(rule).toMatch(/font-family:\s*var\(--tracker-sans\)/);
    expect(rule).toMatch(/font-size:\s*var\(--type-caption\)/);
    expect(rule).toMatch(/white-space:\s*nowrap/);

    const values = blockFor(
      stylesheet,
      ".property-ownership-summary .owner-row > .owner-share > *",
    );
    const separators = blockFor(
      stylesheet,
      ".property-ownership-summary .owner-row > .owner-share > * + *::before",
    );
    expect(values).toMatch(/font-size:\s*inherit/);
    expect(separators).toMatch(/content:/);
  });

  it("compacts the initial-ownership row across phone widths", () => {
    const baseColumns = blockFor(stylesheet, ".initial-owner-columns,\n.initial-owner-row").match(
      /grid-template-columns:([^;]+);/,
    );
    const phoneRules = blockFor(stylesheet, "@media (max-width: 520px)");
    const phoneColumns = blockFor(
      phoneRules,
      ".initial-owner-columns,\n  .initial-owner-row",
    ).match(/grid-template-columns:([^;]+);/);

    // The unconditional desktop grid keeps px minima that do not belong on a phone.
    expect(baseColumns[1]).toMatch(/minmax\(\s*\d+px/);
    expect(phoneColumns).not.toBeNull();

    const minima = [...phoneColumns[1].matchAll(/minmax\(\s*([^,]+),/g)].map((match) =>
      match[1].trim(),
    );
    expect(minima.length).toBeGreaterThan(0);
    expect(minima.every((value) => value === "0")).toBe(true);

    const compactFields = blockFor(
      phoneRules,
      ".single-property-case .initial-owner-person-control select:not(:focus),\n  .single-property-case .initial-owner-row input:not(:focus)",
    );
    expect(compactFields).toMatch(/font-size:\s*var\(--type-label\)\s*!important/);
    expect(compactFields).toMatch(/font-family:\s*var\(--tracker-sans\)/);
  });

  it("keeps all initial-owner actions in one compact phone row", () => {
    const phoneRules = blockFor(stylesheet, "@media (max-width: 520px)");
    const actions = blockFor(phoneRules, ".initial-owner-actions");
    const buttons = blockFor(phoneRules, ".initial-owner-actions > button");

    expect(actions).toMatch(/display:\s*flex/);
    expect(actions).toMatch(/flex-wrap:\s*nowrap/);
    expect(buttons).toMatch(/flex:\s*1\s+1\s+0/);
    expect(buttons).toMatch(/font-size:\s*var\(--type-label\)/);
  });

  it("keeps trace party routes touch-sized on phones and out of printed history", () => {
    const phoneRules = blockFor(stylesheet, "@media (max-width: 520px)");
    const partyButtons = blockFor(
      phoneRules,
      ".trace-party-link,\n  .history-party-link,\n  .tax-history-party-link",
    );
    expect(partyButtons).toMatch(/min-height:\s*2\.75rem/);

    const printRules = blockFor(stylesheet, "@media print");
    const printedActions = blockFor(
      printRules,
      "body.succession-history-open .succession-history-participants",
    );
    expect(printedActions).toMatch(/display:\s*none\s*!important/);
  });
});
