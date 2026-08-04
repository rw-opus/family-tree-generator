import { describe, expect, it } from "vitest";
import {
  displayDateToIso,
  formatDateDraft,
  isValidIsoDate,
  isoDateToDisplay,
} from "../../src/domain/dateFormat.js";

describe("date formatting", () => {
  it("converts between ISO storage and DD/MM/YYYY display values", () => {
    expect(isoDateToDisplay("2026-07-31")).toBe("31/07/2026");
    expect(displayDateToIso("31/07/2026")).toBe("2026-07-31");
    expect(displayDateToIso("31-07-2026")).toBe("2026-07-31");
    expect(isoDateToDisplay("")).toBe("");
    expect(displayDateToIso("")).toBe("");
  });

  it("validates calendar dates, including leap years", () => {
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2025-02-29")).toBe(false);
    expect(displayDateToIso("31-04-2026")).toBeNull();
    expect(displayDateToIso("1-4-2026")).toBeNull();
    expect(isoDateToDisplay("2026-13-01")).toBe("");
  });

  it("formats mobile digit entry and pasted display dates", () => {
    expect(formatDateDraft("3")).toBe("3");
    expect(formatDateDraft("310")).toBe("31/0");
    expect(formatDateDraft("31072026")).toBe("31/07/2026");
    expect(formatDateDraft("31/07/2026")).toBe("31/07/2026");
    expect(formatDateDraft("2026-07-31")).toBe("31/07/2026");
  });
});
