import { describe, expect, it } from "vitest";
import {
  displayWillDate,
  operativeWill,
  operativeWillFromRecords,
  personWills,
  personWithWills,
} from "../../src/domain/wills.js";

describe("multiple wills", () => {
  it("migrates the legacy one-will fields without losing them", () => {
    const person = {
      id: "paul",
      willDate: "1997-01-27",
      willNotaryName: "Paul Pullicino",
    };

    expect(personWills(person)).toEqual([
      {
        id: "paul:legacy-will",
        date: "1997-01-27",
        notaryName: "Paul Pullicino",
        description: "",
      },
    ]);
  });

  it("selects the most recent valid dated will regardless of entry order", () => {
    const wills = [
      { id: "later", date: "1997-01-27", notaryName: "Paul Pullicino" },
      { id: "earlier", date: "1981-10-15", notaryName: "" },
    ];

    expect(operativeWillFromRecords(wills)?.id).toBe("later");
    expect(operativeWill({ id: "paul", wills })?.notaryName).toBe("Paul Pullicino");
  });

  it("formats will dates with dots for family-tree cards", () => {
    expect(displayWillDate("2012-07-18")).toBe("18.07.2012");
  });

  it("mirrors the operative will into the legacy compatibility fields", () => {
    const result = personWithWills({ id: "paul" }, [
      { id: "english", date: "1981-10-15", notaryName: "" },
      { id: "maltese", date: "1997-01-27", notaryName: "Paul Pullicino" },
    ]);

    expect(result).toMatchObject({
      willDate: "1997-01-27",
      willNotaryName: "Paul Pullicino",
    });
    expect(result.wills).toHaveLength(2);
  });

  it("keeps an explicit empty array authoritative after every will is removed", () => {
    expect(
      personWills({
        id: "paul",
        wills: [],
        willDate: "1997-01-27",
        willNotaryName: "Paul Pullicino",
      }),
    ).toEqual([]);
  });
});
