import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readProjectFile = (relativePath) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

describe("production hardening", () => {
  it("serves strict browser security headers and real error responses", () => {
    const server = readProjectFile("server.mjs");

    expect(server).toContain('"Content-Security-Policy"');
    expect(server).toContain('"Strict-Transport-Security"');
    expect(server).toContain('"Cross-Origin-Opener-Policy"');
    expect(server).toContain("statusCode: 404");
    expect(server).toContain("serverErrorFile, 500");
  });

  it("publishes the expected metadata and crawler assets", () => {
    const index = readProjectFile("index.html");

    expect(index).toContain('name="description"');
    expect(index).toContain('rel="canonical"');
    expect(index).toContain('property="og:title"');
    expect(index).toContain('rel="icon" href="/favicon.svg"');
    expect(readProjectFile("public/robots.txt")).toContain("/sitemap.xml");
    expect(readProjectFile("public/sitemap.xml")).toContain(
      "https://family-tree-generator-production.up.railway.app/",
    );
    expect(readProjectFile("public/404.html")).toContain("Page not found");
    expect(readProjectFile("public/500.html")).toContain("The service needs a moment");
  });

  it("connects Railway deployments to the existing health endpoint", () => {
    const railway = JSON.parse(readProjectFile("railway.json"));

    expect(railway.deploy.healthcheckPath).toBe("/healthz");
    expect(railway.deploy.restartPolicyType).toBe("ON_FAILURE");
  });

  it("announces authentication results and matches the configured password minimum", () => {
    const authScreen = readProjectFile("src/components/AuthScreen.jsx");

    expect(authScreen).toContain('role="alert"');
    expect(authScreen).toContain('role="status"');
    expect(authScreen).toContain("password.length < 10");
    expect(authScreen).toContain("minLength={10}");
  });
});
