import { describe, expect, it } from "vitest";
import { publicFamilyTreeErrorReference, sanitiseTelemetryEvent } from "../../src/safetyUtils.js";

describe("privacy-safe error handling", () => {
  it("does not expose a runtime error message", () => {
    expect(publicFamilyTreeErrorReference(new TypeError("Borg, 24 High Street"))).toBe(
      "Error reference: TypeError",
    );
  });

  it("strips family and browser context before monitoring", () => {
    const event = sanitiseTelemetryEvent({
      message: "Borg at 24 High Street",
      user: { email: "person@example.com" },
      request: { url: "https://example.test/?person=Borg" },
      breadcrumbs: [{ message: "Opened Borg" }],
      contexts: { family: { name: "Borg" } },
      exception: { values: [{ type: "TypeError", value: "Borg failed", stacktrace: {} }] },
    });

    expect(event).not.toHaveProperty("message");
    expect(event).not.toHaveProperty("user");
    expect(event).not.toHaveProperty("request");
    expect(event).not.toHaveProperty("breadcrumbs");
    expect(event).not.toHaveProperty("contexts");
    expect(event.exception.values[0]).toEqual({ type: "TypeError", stacktrace: {} });
  });
});
