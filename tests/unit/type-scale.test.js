import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../src/workbench.css", import.meta.url), "utf8");

/** Everything before the print block; print sizes are physical and use px. */
const screenCss = css.slice(0, css.indexOf("@media print") + 1 || css.length);

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

/**
 * The label layer used to sit below the type scale rather than inside it: 144
 * declarations spread over seventeen values between 0.52rem and 0.69rem, steps
 * of well under a pixel. Two named steps replaced the lot.
 */
describe("type scale", () => {
  const root = blockFor(css, ":root");

  it("names every step it uses, smallest to largest", () => {
    const steps = ["--type-micro", "--type-label", "--type-caption", "--type-control"];
    const sizes = steps.map((step) => {
      const match = root.match(new RegExp(`${step}:\\s*([\\d.]+)rem`));
      expect(match, `${step} is not defined`).not.toBeNull();
      return Number(match[1]);
    });

    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(new Set(sizes).size).toBe(sizes.length);
  });

  it("routes every small rule through a token instead of a loose value", () => {
    // Micro, label and caption cover everything under control size. A raw value
    // here is how two dozen near-identical ones accumulated in the first place.
    const loose = [...screenCss.matchAll(/font-size:\s*(0\.\d+)rem/g)]
      .map((match) => Number(match[1]))
      .filter((size) => size < 0.8);

    expect(loose).toEqual([]);
  });

  it("still uses both label steps, so the collapse did not flatten them into one", () => {
    expect(screenCss).toMatch(/font-size:\s*var\(--type-micro\)/);
    expect(screenCss).toMatch(/font-size:\s*var\(--type-label\)/);
  });
});

/**
 * The Property workspace opens with four uppercase kickers, each stacked above
 * its own title. That is eight rows to say four things before any content.
 */
describe("section headings", () => {
  it("sets an uppercase kicker on the same baseline as its title", () => {
    const heading = blockFor(css, ".property-workspace-section-heading,\n.section-heading > div");

    expect(heading).toMatch(/display:\s*flex/);
    expect(heading).toMatch(/align-items:\s*baseline/);
    // It has to be free to fall onto a second row when the column is narrow.
    expect(heading).toMatch(/flex-wrap:\s*wrap/);
  });

  it("drops the kicker's stacking margin so it does not sit off the baseline", () => {
    const kicker = blockFor(
      css,
      ".property-workspace-section-heading > .eyebrow,\n.section-heading > div > .eyebrow",
    );

    expect(kicker).toMatch(/margin:\s*0/);
    expect(kicker).toMatch(/font-size:\s*var\(--type-micro\)/);
  });
});
