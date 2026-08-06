import { describe, expect, it } from "vitest";
import {
  DECEASED_STATUS_FIELDS,
  beginStatusToggleSession,
  endStatusToggleSession,
  statusToggleSession,
  tagStatusCreatedRecord,
} from "../../src/domain/statusToggleSessions.js";

const caseFixture = () => ({
  id: "case",
  title: "Borg family",
  activeFamilyGroupId: "family",
  people: [
    {
      id: "owner",
      fullName: "Joseph Borg",
      designations: ["Owner"],
      isDeceased: false,
      dateOfDeath: "",
      inheritanceBasis: "will",
      wills: [],
    },
    { id: "relative", fullName: "Maria Borg" },
  ],
  familyGroups: [
    {
      id: "family",
      title: "Borg family",
      rootPersonId: "owner",
      personIds: ["owner", "relative"],
    },
  ],
  properties: [
    {
      id: "property",
      transfers: [],
    },
  ],
  outsideParties: [],
});

describe("status toggle sessions", () => {
  it("captures exact deceased-field presence and starts only one session", () => {
    const input = caseFixture();
    const snapshot = structuredClone(input);

    const started = beginStatusToggleSession(input, {
      type: "deceased",
      personId: "owner",
      propertyId: "property",
    });
    const session = statusToggleSession(started, "deceased", "owner");
    const repeated = beginStatusToggleSession(started, {
      type: "deceased",
      personId: "owner",
      propertyId: "property",
    });

    expect(input).toEqual(snapshot);
    expect(repeated.statusToggleSessions).toHaveLength(1);
    expect(session).toMatchObject({
      type: "deceased",
      personId: "owner",
      propertyId: "property",
      activeFamilyGroupId: "family",
    });
    expect(Object.keys(session.personFields)).toEqual([...DECEASED_STATUS_FIELDS]);
    expect(session.personFields.isDeceased).toEqual({ present: true, value: false });
    expect(session.personFields.willNotes).toEqual({ present: false });
  });

  it("restores the exact pre-deceased state and removes safe session-created identities", () => {
    let current = beginStatusToggleSession(caseFixture(), {
      type: "deceased",
      personId: "owner",
      propertyId: "property",
    });
    const session = statusToggleSession(current, "deceased", "owner");
    const beneficiary = tagStatusCreatedRecord(
      { id: "beneficiary", name: "Legacy Holdings", type: "company" },
      session,
      { role: "beneficiary" },
    );
    const createdPerson = tagStatusCreatedRecord(
      { id: "created-person", fullName: "Outside Beneficiary" },
      session,
      { role: "beneficiary" },
    );
    current = {
      ...current,
      outsideParties: [beneficiary],
      people: [
        ...current.people.map((person) =>
          person.id === "owner"
            ? {
                ...person,
                isDeceased: true,
                designations: ["Deceased", "Owner"],
                dateOfDeath: "2020-01-01",
                unmarriedOrWidowedAtDeath: true,
                inheritanceBasis: "will",
                willNotes: "Created after the click",
                willHeirs: [
                  { id: "heir-1", personId: "beneficiary" },
                  { id: "heir-2", personId: "created-person" },
                ],
                causaMortisDeclarations: [{ id: "cm" }],
              }
            : person,
        ),
        createdPerson,
      ],
      familyGroups: current.familyGroups.map((group) => ({
        ...group,
        personIds: [...group.personIds, "created-person"],
      })),
    };

    const ended = endStatusToggleSession(current, {
      type: "deceased",
      personId: "owner",
      propertyId: "property",
      activeFamilyGroupId: "family",
    });
    const owner = ended.people.find((person) => person.id === "owner");

    expect(owner).toMatchObject({
      isDeceased: false,
      designations: ["Owner"],
      dateOfDeath: "",
      inheritanceBasis: "will",
      wills: [],
    });
    expect(Object.hasOwn(owner, "willNotes")).toBe(false);
    expect(Object.hasOwn(owner, "willHeirs")).toBe(false);
    expect(Object.hasOwn(owner, "causaMortisDeclarations")).toBe(false);
    expect(ended.outsideParties).toEqual([]);
    expect(ended.people.some((person) => person.id === "created-person")).toBe(false);
    expect(ended.familyGroups[0].personIds).toEqual(["owner", "relative"]);
    expect(statusToggleSession(ended, "deceased", "owner")).toBeNull();
  });

  it("deletes session-created identities and every later reference on exact rollback", () => {
    let current = beginStatusToggleSession(caseFixture(), {
      type: "deceased",
      personId: "owner",
    });
    const session = statusToggleSession(current, "deceased", "owner");
    const outsideParty = tagStatusCreatedRecord(
      { id: "company", name: "Buyer Limited", type: "company" },
      session,
    );
    const child = tagStatusCreatedRecord(
      { id: "child", fullName: "New Child", fatherId: "relative" },
      session,
    );
    current = {
      ...current,
      outsideParties: [outsideParty],
      familyGroups: current.familyGroups.map((group) => ({
        ...group,
        personIds: [...group.personIds, "child"],
      })),
      properties: current.properties.map((property) => ({
        ...property,
        owners: [{ id: "company-owner", personId: "company" }],
        transfers: [{ id: "company-transfer", sellerId: "relative", buyerId: "company" }],
      })),
      people: [...current.people, child].map((person) =>
        person.id === "relative"
          ? {
              ...person,
              spouseIds: ["child"],
              willHeirs: [{ id: "company-heir", personId: "company" }],
            }
          : person,
      ),
    };

    const ended = endStatusToggleSession(current, {
      type: "deceased",
      personId: "owner",
      activeFamilyGroupId: "family",
    });

    expect(ended.outsideParties).toEqual([]);
    expect(ended.people.some((person) => person.id === "child")).toBe(false);
    expect(ended.people.find((person) => person.id === "relative")).toMatchObject({
      spouseIds: [],
      willHeirs: [],
    });
    expect(ended.properties[0].owners).toEqual([]);
    expect(ended.properties[0].transfers).toEqual([]);
  });

  it("detaches and removes a session-created potential parent without changing other links", () => {
    let current = beginStatusToggleSession(caseFixture(), {
      type: "deceased",
      personId: "owner",
    });
    const session = statusToggleSession(current, "deceased", "owner");
    const parent = tagStatusCreatedRecord(
      {
        id: "potential-parent",
        fullName: "Mother of Joseph",
        isPotentialIntestateParent: true,
        potentialParentAddedExplicitly: true,
        survivalStatusRequired: true,
        survivalStatusReferencePersonId: "owner",
        spouseIds: ["existing-parent"],
      },
      session,
      { role: "potential-parent" },
    );
    current = {
      ...current,
      people: [
        ...current.people.map((person) =>
          person.id === "owner"
            ? { ...person, motherId: "potential-parent", fatherId: "existing-parent" }
            : person,
        ),
        { id: "existing-parent", fullName: "Existing Father", spouseIds: ["potential-parent"] },
        parent,
      ],
      familyGroups: current.familyGroups.map((group) => ({
        ...group,
        personIds: [...group.personIds, "existing-parent", "potential-parent"],
      })),
    };

    const ended = endStatusToggleSession(current, {
      type: "deceased",
      personId: "owner",
      activeFamilyGroupId: "family",
    });

    expect(ended.people.some((person) => person.id === "potential-parent")).toBe(false);
    expect(ended.people.find((person) => person.id === "owner")).toMatchObject({
      fatherId: "existing-parent",
      motherId: "",
    });
    expect(ended.people.find((person) => person.id === "existing-parent").spouseIds).toEqual([]);
  });

  it("removes only session-created inter-vivos transfers and restores tracked fields", () => {
    const base = caseFixture();
    delete base.people[0].inheritanceBasis;
    let current = beginStatusToggleSession(base, {
      type: "inter-vivos",
      personId: "owner",
      propertyId: "property",
    });
    const session = statusToggleSession(current, "inter-vivos", "owner");
    const buyer = tagStatusCreatedRecord({ id: "buyer", fullName: "Session Buyer" }, session, {
      role: "buyer",
    });
    const createdTransfer = tagStatusCreatedRecord(
      { id: "created", sellerId: "owner", buyerId: "buyer" },
      session,
      { role: "transfer" },
    );
    current = {
      ...current,
      people: [
        ...current.people.map((person) =>
          person.id === "owner" ? { ...person, inheritanceBasis: "lifetime-disposal" } : person,
        ),
        buyer,
      ],
      familyGroups: current.familyGroups.map((group) => ({
        ...group,
        personIds: [...group.personIds, "buyer"],
      })),
      properties: current.properties.map((property) => ({
        ...property,
        transfers: [{ id: "existing", sellerId: "owner", buyerId: "relative" }, createdTransfer],
      })),
    };

    const ended = endStatusToggleSession(current, {
      type: "inter-vivos",
      personId: "owner",
      propertyId: "property",
      activeFamilyGroupId: "family",
    });

    expect(ended.properties[0].transfers.map((transfer) => transfer.id)).toEqual(["existing"]);
    expect(
      Object.hasOwn(
        ended.people.find((person) => person.id === "owner"),
        "inheritanceBasis",
      ),
    ).toBe(false);
    expect(ended.people.some((person) => person.id === "buyer")).toBe(false);
  });

  it("keeps the lifetime-transfer disclosure independent from deceased status", () => {
    let current = beginStatusToggleSession(caseFixture(), {
      type: "inter-vivos",
      personId: "owner",
      propertyId: "property",
    });
    const transferSession = statusToggleSession(current, "inter-vivos", "owner", "property");
    current = beginStatusToggleSession(current, {
      type: "deceased",
      personId: "owner",
    });
    const transfer = tagStatusCreatedRecord(
      { id: "transfer", sellerId: "owner", buyerId: "relative" },
      transferSession,
      { role: "transfer" },
    );
    current = {
      ...current,
      people: current.people.map((person) =>
        person.id === "owner"
          ? {
              ...person,
              isDeceased: true,
              designations: ["Deceased", "Owner"],
              dateOfDeath: "2020-01-01",
            }
          : person,
      ),
      properties: current.properties.map((property) => ({
        ...property,
        transfers: [transfer],
      })),
    };

    const aliveAgain = endStatusToggleSession(current, {
      type: "deceased",
      personId: "owner",
    });

    expect(statusToggleSession(aliveAgain, "deceased", "owner")).toBeNull();
    expect(statusToggleSession(aliveAgain, "inter-vivos", "owner", "property")).not.toBeNull();
    expect(aliveAgain.properties[0].transfers).toEqual([transfer]);
    expect(aliveAgain.people.find((person) => person.id === "owner")).toMatchObject({
      isDeceased: false,
      designations: ["Owner"],
      dateOfDeath: "",
    });
  });

  it("performs explicit legacy cleanup when no reversible session exists", () => {
    const legacy = caseFixture();
    legacy.people[0] = {
      ...legacy.people[0],
      isDeceased: true,
      designations: ["Owner", "Deceased"],
      dateOfDeath: "2020-01-01",
      unmarriedOrWidowedAtDeath: true,
      inheritanceBasis: "will",
      wills: [{ id: "will", date: "2019-01-01" }],
      willHeirs: [{ id: "heir", personId: "relative" }],
      intestateHeirs: [{ id: "intestate", personId: "relative" }],
      causaMortisDeclarations: [{ id: "cm" }],
    };

    const alive = endStatusToggleSession(legacy, {
      type: "deceased",
      personId: "owner",
    });
    const owner = alive.people.find((person) => person.id === "owner");

    expect(owner).toMatchObject({
      isDeceased: false,
      designations: ["Owner"],
      dateOfDeath: "",
      unmarriedOrWidowedAtDeath: false,
    });
    expect(Object.hasOwn(owner, "inheritanceBasis")).toBe(false);
    expect(Object.hasOwn(owner, "wills")).toBe(false);
    expect(Object.hasOwn(owner, "willHeirs")).toBe(false);
    expect(Object.hasOwn(owner, "intestateHeirs")).toBe(false);
    expect(Object.hasOwn(owner, "causaMortisDeclarations")).toBe(false);

    const withTransfers = caseFixture();
    withTransfers.people[0].inheritanceBasis = "lifetime-disposal";
    withTransfers.properties[0].transfers = [
      { id: "outgoing-1", sellerId: "owner", buyerId: "relative" },
      { id: "incoming", sellerId: "relative", buyerId: "owner" },
    ];
    withTransfers.properties.push({
      id: "other-property",
      transfers: [{ id: "outgoing-2", sellerId: "owner", buyerId: "relative" }],
    });

    const withoutTargetTransfers = endStatusToggleSession(withTransfers, {
      type: "inter-vivos",
      personId: "owner",
      propertyId: "property",
    });

    expect(withoutTargetTransfers.properties[0].transfers.map((transfer) => transfer.id)).toEqual([
      "incoming",
    ]);
    expect(withoutTargetTransfers.properties[1].transfers.map((transfer) => transfer.id)).toEqual([
      "outgoing-2",
    ]);
    expect(withoutTargetTransfers.people[0].inheritanceBasis).toBe("intestacy");
  });

  it("tags records without mutating the input", () => {
    const started = beginStatusToggleSession(caseFixture(), {
      type: "deceased",
      personId: "owner",
    });
    const session = statusToggleSession(started, "deceased", "owner");
    const record = { id: "record", nested: { retained: true } };
    const tagged = tagStatusCreatedRecord(record, session, { role: "beneficiary" });

    expect(record).toEqual({ id: "record", nested: { retained: true } });
    expect(tagged).toMatchObject({
      id: "record",
      statusToggleSessionId: session.id,
      statusToggleSessionType: "deceased",
      statusToggleSessionRole: "beneficiary",
    });
    expect(tagged.nested).not.toBe(record.nested);
  });
});
