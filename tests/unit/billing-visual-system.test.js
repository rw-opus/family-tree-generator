import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../src/workbench.css", import.meta.url), "utf8");
const vendorCss = readFileSync(
  new URL("../../src/components/VendorSettlementStatement.css", import.meta.url),
  "utf8",
);

function ruleFor(source, selector) {
  const start = source.indexOf(`${selector} {`);
  expect(start, `Missing CSS rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("}", start);
  return source.slice(start, end + 1);
}

function rulesFor(source, selector) {
  const rules = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf(`${selector} {`, cursor);
    if (start < 0) break;
    const end = source.indexOf("}", start);
    rules.push(source.slice(start, end + 1));
    cursor = end + 1;
  }
  return rules;
}

describe("Billing Calculator visual system", () => {
  it("uses the shared warm palette and restrained page-chrome type scale", () => {
    const root = ruleFor(css, ":root");

    expect(root).toContain("--ink: #0f1b2d");
    expect(root).toContain("--paper: #f7f5f0");
    expect(root).toContain("--line: #e3e0d6");
    expect(root).toContain("--field: #c9c4b8");
    expect(root).toContain("--accent: #004225");
    expect(root).toContain("--type-control: 0.875rem");
    expect(root).toContain("--type-title: clamp(1.5rem, 3vw, 2rem)");
  });

  it("gives the live Property and Tax tabs the Billing tile treatment", () => {
    const tabs = rulesFor(css, ".property-workspace-menu button").find((rule) =>
      rule.includes("border-radius: 14px"),
    );
    const activeTab = ruleFor(css, ".property-workspace-menu button.active");

    expect(tabs).toBeDefined();
    expect(tabs).toContain("min-height: 3.5rem");
    expect(tabs).toContain("border-radius: 14px");
    expect(tabs).toContain("font-size: var(--type-control)");
    expect(tabs).toContain("font-weight: 600");
    expect(activeTab).toContain("background: var(--accent)");
    expect(activeTab).toContain("color: #fff");
  });

  it("caps oversized application and printable headings", () => {
    const authTitle = ruleFor(css, ".commercial-auth-intro h1");
    const historyTitle = ruleFor(css, ".succession-history-header h2");
    const vendorTitle = ruleFor(vendorCss, ".vendor-settlement-header h2");

    expect(authTitle).toContain("font-size: var(--type-title)");
    expect(authTitle).not.toContain("4.5rem");
    expect(historyTitle).toContain("1.75rem");
    expect(vendorTitle).toContain("1.75rem");
  });
});
