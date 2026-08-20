// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDENTITY_DRAFT_COMMIT_DELAY_MS,
  PERSON_RECORD_DRAFT_COMMIT_DELAY_MS,
  PersonInspector,
} from "../../src/components/PersonInspector.jsx";
import { normaliseCase } from "../../src/domain/caseModel.js";
import { findPartnerRelationship } from "../../src/domain/partnerRelationships.js";
import {
  buildPropertyVendorTaxReport,
  setDonationAcquisitionValue,
  setLivingInitialOwnerAcquisitionDate,
} from "../../src/domain/propertyVendorTax.js";
import {
  beginStatusToggleSession,
  endStatusToggleSession,
  statusToggleSession,
} from "../../src/domain/statusToggleSessions.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("PersonInspector", () => {
  let container;
  let root;

  const beginEditing = () => {
    const editButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Edit identity",
    );
    if (editButton) act(() => editButton.click());
  };

  const setInputValue = (selector, value) => {
    const input = container.querySelector(selector);
    expect(input).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  const leaveInput = (input) => {
    act(() => {
      input.focus();
      input.blur();
    });
  };

  const willSharePeople = () => [
    {
      id: "deceased",
      givenNames: "Joseph",
      surname: "Borg",
      fullName: "Joseph Borg",
      sex: "Male",
      isDeceased: true,
      dateOfDeath: "2020-01-01",
      inheritanceBasis: "will",
      wills: [{ id: "will", date: "2019-01-01", notaryName: "", description: "" }],
      willHeirs: [
        {
          id: "share",
          personId: "beneficiary",
          shareNumerator: 1,
          shareDenominator: 2,
          sharePercent: 50,
        },
      ],
      spouseIds: [],
      designations: ["Deceased"],
    },
    {
      id: "beneficiary",
      givenNames: "Maria",
      surname: "Borg",
      fullName: "Maria Borg",
      sex: "Female",
      spouseIds: [],
      designations: [],
    },
  ];

  const completedCausaMortisShare = (person) =>
    (person.causaMortisDeclarations || [])
      .filter((declaration) => declaration.status === "complete")
      .reduce(
        (total, declaration) =>
          total +
          Number(declaration.declaredShareNumerator) / Number(declaration.declaredShareDenominator),
        0,
      );

  const causaMortisCoverageStatus = (declaredShare, requiredShare) => {
    const difference = declaredShare - requiredShare;
    if (Math.abs(difference) < 1e-10) return "complete";
    return difference < 0 ? "under" : "over";
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    vi.useRealTimers();
    container.remove();
    vi.restoreAllMocks();
  });

  it("opens an unnamed person's fields for editing immediately", () => {
    act(() =>
      root.render(
        <PersonInspector
          people={[
            {
              id: "unnamed",
              fullName: "",
              givenNames: "",
              surname: "",
              sex: "",
              spouseIds: [],
            },
          ]}
          selectedPersonId="unnamed"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector(".person-edit-fields").disabled).toBe(false);
    expect(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent.trim() === "Done",
      ),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("GEDCOM");
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  it("keeps rapid identity typing local and flushes one final patch", () => {
    const onChange = vi.fn();
    let controller;
    const people = Array.from({ length: 202 }, (_, index) => ({
      id: `person-${index + 1}`,
      givenNames: `Person ${index + 1}`,
      surname: "Example",
      fullName: `Person ${index + 1} Example`,
      sex: "Other",
      spouseIds: [],
    }));

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="person-1"
          onChange={onChange}
          onSelectPerson={vi.fn()}
          onRegisterPendingEditFlush={(nextController) => {
            controller = nextController;
            return () => undefined;
          }}
        />,
      ),
    );
    beginEditing();
    const namesInput = container.querySelector('[data-person-field="given-names"]');

    ["M", "Ma", "Mar", "Mari", "Maria"].forEach((value) => {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
          namesInput,
          value,
        );
        namesInput.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });

    expect(namesInput.value).toBe("Maria");
    expect(onChange).not.toHaveBeenCalled();
    expect(controller.hasPending()).toBe(true);

    act(() => expect(controller.flush()).toBe(true));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0]).toMatchObject({
      givenNames: "Maria",
      fullName: "Maria Example",
    });
    expect(controller.hasPending()).toBe(false);
  });

  it("retains a pending identity draft when durable commit is rejected", () => {
    let rejectCommit = true;
    const onChange = vi.fn(() => (rejectCommit ? null : {}));
    let controller;
    act(() =>
      root.render(
        <PersonInspector
          people={[
            {
              id: "person",
              givenNames: "Maria",
              surname: "Borg",
              fullName: "Maria Borg",
              sex: "Female",
              spouseIds: [],
            },
          ]}
          selectedPersonId="person"
          onChange={onChange}
          onSelectPerson={vi.fn()}
          onRegisterPendingEditFlush={(nextController) => {
            controller = nextController;
            return () => undefined;
          }}
        />,
      ),
    );
    beginEditing();
    const surnameInput = container.querySelector('[data-person-field="surname"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        surnameInput,
        "Vella",
      );
      surnameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    act(() => expect(controller.flush()).toBe(false));
    expect(controller.hasPending()).toBe(true);
    expect(surnameInput.value).toBe("Vella");

    rejectCommit = false;
    act(() => expect(controller.flush()).toBe(true));
    expect(controller.hasPending()).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ surname: "Vella", fullName: "Maria Vella" }),
    ]);
  });

  it("keeps will text and share typing local, then commits the latest combined draft once", () => {
    const onChange = vi.fn((nextPeople) => ({ people: nextPeople }));
    let controller;
    const deceased = {
      id: "deceased",
      fullName: "Joseph Borg",
      sex: "Male",
      isDeceased: true,
      dateOfDeath: "2020-01-01",
      inheritanceBasis: "will",
      wills: [{ id: "will", date: "2019-01-01", notaryName: "", description: "" }],
      willHeirs: [
        {
          id: "share",
          personId: "beneficiary",
          shareNumerator: 1,
          shareDenominator: 2,
          sharePercent: 50,
        },
        {
          id: "share-2",
          personId: "beneficiary-2",
          shareNumerator: 1,
          shareDenominator: 2,
          sharePercent: 50,
        },
      ],
      spouseIds: [],
      siblingIds: [],
      designations: ["Deceased"],
    };
    const beneficiary = {
      id: "beneficiary",
      fullName: "Maria Borg",
      sex: "Female",
      spouseIds: [],
      designations: [],
    };
    const secondBeneficiary = {
      ...beneficiary,
      id: "beneficiary-2",
      fullName: "Paul Borg",
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[deceased, beneficiary, secondBeneficiary]}
          selectedPersonId="deceased"
          shareDisplay="both"
          onChange={onChange}
          onSelectPerson={vi.fn()}
          onRegisterPendingEditFlush={(nextController) => {
            controller = nextController;
            return () => undefined;
          }}
        />,
      ),
    );

    const type = (selector, values, index = 0) => {
      const input = container.querySelectorAll(selector)[index];
      values.forEach((nextValue) => {
        act(() => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
            input,
            nextValue,
          );
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
      });
      return input;
    };

    type('input[aria-label="Notary for will 1"]', ["N", "No", "Notary Vella"]);
    const description = type('input[aria-label="Description for will 1"]', ["U", "UK", "UK will"]);
    // Exercise two share formats without a browser focus transition. The most
    // recently edited numerator must apply after the earlier percentage draft.
    type('input[aria-label="Will share percentage"]', ["3", "30"]);
    type('input[aria-label="Will share numerator"]', ["", "1"]);
    type('input[aria-label="Will share denominator"]', ["4"], 1);
    type('input[aria-label="Will share percentage"]', ["5", "50"], 1);

    expect(onChange).not.toHaveBeenCalled();
    expect(controller.hasPending()).toBe(true);

    leaveInput(description);

    expect(onChange).toHaveBeenCalledTimes(1);
    const committed = onChange.mock.calls[0][0][0];
    expect(committed.wills[0]).toMatchObject({
      notaryName: "Notary Vella",
      description: "UK will",
    });
    expect(committed.willHeirs[0]).toMatchObject({
      shareNumerator: "1",
      shareDenominator: 10,
      sharePercent: 10,
    });
    expect(committed.willHeirs[1]).toMatchObject({
      shareNumerator: 1,
      shareDenominator: 2,
      sharePercent: 50,
    });
    expect(controller.hasPending()).toBe(false);
  });

  it("retains a buffered will draft after a rejected durable commit", () => {
    let rejectCommit = true;
    const onChange = vi.fn((nextPeople) => (rejectCommit ? null : { people: nextPeople }));
    let controller;
    act(() =>
      root.render(
        <PersonInspector
          people={[
            {
              id: "deceased",
              fullName: "Joseph Borg",
              sex: "Male",
              isDeceased: true,
              dateOfDeath: "2020-01-01",
              inheritanceBasis: "will",
              wills: [{ id: "will", date: "2019-01-01", notaryName: "", description: "" }],
              willHeirs: [],
              spouseIds: [],
              designations: ["Deceased"],
            },
          ]}
          selectedPersonId="deceased"
          onChange={onChange}
          onSelectPerson={vi.fn()}
          onRegisterPendingEditFlush={(nextController) => {
            controller = nextController;
            return () => undefined;
          }}
        />,
      ),
    );
    const notary = container.querySelector('input[aria-label="Notary for will 1"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        notary,
        "Notary Vella",
      );
      notary.dispatchEvent(new Event("input", { bubbles: true }));
    });

    act(() => expect(controller.flush()).toBe(false));
    expect(controller.hasPending()).toBe(true);
    expect(notary.value).toBe("Notary Vella");

    rejectCommit = false;
    act(() => expect(controller.flush()).toBeTruthy());
    expect(controller.hasPending()).toBe(false);
    expect(onChange.mock.calls.at(-1)[0][0].wills[0].notaryName).toBe("Notary Vella");
  });

  it("preserves a pending will field when a same-event action adds another will", () => {
    let latestPeople;
    function Harness() {
      const [people, setPeople] = useState([
        {
          id: "deceased",
          fullName: "Joseph Borg",
          sex: "Male",
          isDeceased: true,
          dateOfDeath: "2020-01-01",
          inheritanceBasis: "will",
          wills: [{ id: "will", date: "2019-01-01", notaryName: "", description: "" }],
          willHeirs: [],
          spouseIds: [],
          designations: ["Deceased"],
        },
      ]);
      latestPeople = people;
      return (
        <PersonInspector
          people={people}
          selectedPersonId="deceased"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));
    const description = container.querySelector('input[aria-label="Description for will 1"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        description,
        "Retained wording",
      );
      description.dispatchEvent(new Event("input", { bubbles: true }));
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.trim() === "Add will")
        .click();
    });

    expect(latestPeople[0].wills).toHaveLength(2);
    expect(latestPeople[0].wills[0].description).toBe("Retained wording");
  });

  it("flushes an outgoing GEDCOM death-date draft against its own person after a direct switch", () => {
    let latestPeople = [
      {
        id: "first",
        fullName: "First Person",
        sex: "Other",
        isDeceased: true,
        spouseIds: [],
        designations: ["Deceased"],
      },
      {
        id: "second",
        fullName: "Second Person",
        sex: "Other",
        isDeceased: true,
        spouseIds: [],
        designations: ["Deceased"],
      },
    ];
    const onChange = vi.fn((nextPeople) => {
      latestPeople = nextPeople;
      return { people: nextPeople };
    });
    let controller;
    const renderSelected = (selectedPersonId) =>
      root.render(
        <PersonInspector
          people={latestPeople}
          legalWorkspaceEnabled={false}
          selectedPersonId={selectedPersonId}
          onChange={onChange}
          onSelectPerson={vi.fn()}
          onRegisterPendingEditFlush={(nextController) => {
            controller = nextController;
            return () => undefined;
          }}
        />,
      );

    act(() => renderSelected("first"));
    const firstDeathDate = container.querySelector('input[aria-label="Date of death (optional)"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        firstDeathDate,
        "about 1858",
      );
      firstDeathDate.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).not.toHaveBeenCalled();

    act(() => renderSelected("second"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(latestPeople.find((person) => person.id === "first")).toMatchObject({
      deathDateText: "about 1858",
      dateOfDeathUnknown: false,
    });

    const secondDeathDate = container.querySelector('input[aria-label="Date of death (optional)"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        secondDeathDate,
        "circa 1900",
      );
      secondDeathDate.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    act(() => expect(controller.flush()).toBeTruthy());
    expect(latestPeople.find((person) => person.id === "second")).toMatchObject({
      deathDateText: "circa 1900",
      dateOfDeathUnknown: false,
    });
  });

  it("commits combined identity and record drafts once when switching people directly", () => {
    let latestPeople = [
      {
        id: "first",
        givenNames: "First",
        surname: "Person",
        fullName: "First Person",
        sex: "Other",
        isDeceased: true,
        spouseIds: [],
        designations: ["Deceased"],
      },
      {
        id: "second",
        givenNames: "Second",
        surname: "Person",
        fullName: "Second Person",
        sex: "Other",
        isDeceased: true,
        spouseIds: [],
        designations: ["Deceased"],
      },
    ];
    const onChange = vi.fn((nextPeople) => {
      latestPeople = nextPeople;
      return { people: nextPeople };
    });
    let controller;
    const renderSelected = (selectedPersonId) =>
      root.render(
        <PersonInspector
          people={latestPeople}
          legalWorkspaceEnabled={false}
          selectedPersonId={selectedPersonId}
          onChange={onChange}
          onSelectPerson={vi.fn()}
          onRegisterPendingEditFlush={(nextController) => {
            controller = nextController;
            return () => undefined;
          }}
        />,
      );

    act(() => renderSelected("first"));
    beginEditing();
    setInputValue('[data-person-field="surname"]', "Updated");
    setInputValue('input[aria-label="Date of death (optional)"]', "about 1858");

    act(() => renderSelected("second"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(latestPeople.find((person) => person.id === "first")).toMatchObject({
      surname: "Updated",
      fullName: "First Updated",
      deathDateText: "about 1858",
    });
    expect(controller.hasPending()).toBe(false);
  });

  it("flushes a pending person-record draft before the inspector unmounts", () => {
    const onChange = vi.fn((nextPeople) => ({ people: nextPeople }));
    act(() =>
      root.render(
        <PersonInspector
          people={[
            {
              id: "person",
              fullName: "Historic Person",
              sex: "Other",
              isDeceased: true,
              spouseIds: [],
              designations: ["Deceased"],
            },
          ]}
          legalWorkspaceEnabled={false}
          selectedPersonId="person"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    const deathDate = container.querySelector('input[aria-label="Date of death (optional)"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        deathDate,
        "circa 1750",
      );
      deathDate.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).not.toHaveBeenCalled();

    act(() => root.unmount());
    root = null;

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0]).toMatchObject({
      deathDateText: "circa 1750",
      dateOfDeathUnknown: false,
    });
  });

  it("flushes one combined record patch when several buffered inputs unmount", () => {
    const onChange = vi.fn((nextPeople) => ({ people: nextPeople }));
    act(() =>
      root.render(
        <PersonInspector
          people={[
            {
              id: "deceased",
              fullName: "Joseph Borg",
              sex: "Male",
              isDeceased: true,
              dateOfDeath: "2020-01-01",
              inheritanceBasis: "will",
              wills: [{ id: "will", date: "2019-01-01", notaryName: "", description: "" }],
              willHeirs: [
                {
                  id: "share",
                  personId: "beneficiary",
                  shareNumerator: 1,
                  shareDenominator: 1,
                  sharePercent: 100,
                },
              ],
              spouseIds: [],
              designations: ["Deceased"],
            },
            {
              id: "beneficiary",
              fullName: "Maria Borg",
              sex: "Female",
              spouseIds: [],
              designations: [],
            },
          ]}
          selectedPersonId="deceased"
          shareDisplay="both"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    setInputValue('input[aria-label="Description for will 1"]', "Retained on teardown");
    expect(onChange).not.toHaveBeenCalled();

    act(() => root.unmount());
    root = null;

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0].wills[0].description).toBe("Retained on teardown");
  });

  it("acknowledges a record draft included by the earlier identity idle commit", () => {
    vi.useFakeTimers();
    const onChange = vi.fn((nextPeople) => ({ people: nextPeople }));
    let controller;
    act(() =>
      root.render(
        <PersonInspector
          people={[
            {
              id: "person",
              givenNames: "Maria",
              surname: "Borg",
              fullName: "Maria Borg",
              sex: "Female",
              isDeceased: true,
              spouseIds: [],
              designations: ["Deceased"],
            },
          ]}
          legalWorkspaceEnabled={false}
          selectedPersonId="person"
          onChange={onChange}
          onSelectPerson={vi.fn()}
          onRegisterPendingEditFlush={(nextController) => {
            controller = nextController;
            return () => undefined;
          }}
        />,
      ),
    );
    beginEditing();
    setInputValue('[data-person-field="surname"]', "Vella");
    act(() => vi.advanceTimersByTime(100));
    setInputValue('input[aria-label="Date of death (optional)"]', "about 1858");

    act(() => vi.advanceTimersByTime(IDENTITY_DRAFT_COMMIT_DELAY_MS - 100));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0]).toMatchObject({
      surname: "Vella",
      fullName: "Maria Vella",
      deathDateText: "about 1858",
    });
    expect(controller.hasPending()).toBe(false);

    act(() => vi.advanceTimersByTime(200));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("retains a committed record overlay for an earlier person while canonical props lag", () => {
    const canonicalPeople = [
      {
        id: "first",
        fullName: "First Person",
        sex: "Other",
        isDeceased: true,
        spouseIds: [],
        designations: ["Deceased"],
      },
      {
        id: "second",
        fullName: "Second Person",
        sex: "Other",
        isDeceased: true,
        spouseIds: [],
        designations: ["Deceased"],
      },
    ];
    const onChange = vi.fn((nextPeople) => ({ people: nextPeople }));
    let controller;
    const renderSelected = (selectedPersonId) =>
      root.render(
        <PersonInspector
          people={canonicalPeople}
          legalWorkspaceEnabled={false}
          selectedPersonId={selectedPersonId}
          onChange={onChange}
          onSelectPerson={vi.fn()}
          onRegisterPendingEditFlush={(nextController) => {
            controller = nextController;
            return () => undefined;
          }}
        />,
      );

    act(() => renderSelected("first"));
    setInputValue('input[aria-label="Date of death (optional)"]', "about 1800");
    act(() => expect(controller.flush()).toBe(true));

    act(() => renderSelected("second"));
    setInputValue('input[aria-label="Date of death (optional)"]', "about 1900");
    act(() => expect(controller.flush()).toBe(true));

    expect(onChange).toHaveBeenCalledTimes(2);
    const latestSnapshot = onChange.mock.calls[1][0];
    expect(latestSnapshot.find((person) => person.id === "first").deathDateText).toBe("about 1800");
    expect(latestSnapshot.find((person) => person.id === "second").deathDateText).toBe(
      "about 1900",
    );
  });

  it("keeps a rejected share draft visible when changing the share display", () => {
    const onChange = vi.fn(() => null);
    let controller;
    act(() =>
      root.render(
        <PersonInspector
          people={[
            {
              id: "deceased",
              fullName: "Joseph Borg",
              sex: "Male",
              isDeceased: true,
              dateOfDeath: "2020-01-01",
              inheritanceBasis: "will",
              wills: [{ id: "will", date: "2019-01-01", notaryName: "", description: "" }],
              willHeirs: [
                {
                  id: "share",
                  personId: "beneficiary",
                  shareNumerator: 1,
                  shareDenominator: 1,
                  sharePercent: 100,
                },
              ],
              spouseIds: [],
              designations: ["Deceased"],
            },
            {
              id: "beneficiary",
              fullName: "Maria Borg",
              sex: "Female",
              spouseIds: [],
              designations: [],
            },
          ]}
          selectedPersonId="deceased"
          shareDisplay="both"
          onChange={onChange}
          onSelectPerson={vi.fn()}
          onRegisterPendingEditFlush={(nextController) => {
            controller = nextController;
            return () => undefined;
          }}
        />,
      ),
    );
    setInputValue('input[aria-label="Will share numerator"]', "2");

    const percentageButton = [...container.querySelectorAll(".person-share-toggle button")].find(
      (button) => button.textContent.trim() === "Percentage",
    );
    act(() => percentageButton.click());

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(controller.hasPending()).toBe(true);
    expect(container.querySelector('input[aria-label="Will share numerator"]').value).toBe("2");
    expect(percentageButton.getAttribute("aria-pressed")).toBe("false");
  });

  it("commits a buffered person-record draft only after 700 milliseconds idle", () => {
    vi.useFakeTimers();
    const onChange = vi.fn((nextPeople) => ({ people: nextPeople }));
    act(() =>
      root.render(
        <PersonInspector
          people={[
            {
              id: "person",
              fullName: "Historic Person",
              sex: "Other",
              isDeceased: true,
              spouseIds: [],
              designations: ["Deceased"],
            },
          ]}
          legalWorkspaceEnabled={false}
          selectedPersonId="person"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    setInputValue('input[aria-label="Date of death (optional)"]', "b");
    setInputValue('input[aria-label="Date of death (optional)"]', "before");
    setInputValue('input[aria-label="Date of death (optional)"]', "before 1800");

    act(() => vi.advanceTimersByTime(PERSON_RECORD_DRAFT_COMMIT_DELAY_MS - 1));
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0]).toMatchObject({
      deathDateText: "before 1800",
      dateOfDeathUnknown: false,
    });
  });

  it("commits a percentage on its own idle timer after an earlier record commit rerenders", () => {
    vi.useFakeTimers();
    let latestPeople;
    const onChange = vi.fn();
    let controller;
    function Harness() {
      const [people, setPeople] = useState(willSharePeople);
      latestPeople = people;
      return (
        <PersonInspector
          people={people}
          selectedPersonId="deceased"
          shareDisplay="both"
          onChange={(nextPeople) => {
            onChange(nextPeople);
            setPeople(nextPeople);
            return { people: nextPeople };
          }}
          onSelectPerson={vi.fn()}
          onRegisterPendingEditFlush={(nextController) => {
            controller = nextController;
            return () => undefined;
          }}
        />
      );
    }

    act(() => root.render(<Harness />));
    setInputValue('input[aria-label="Notary for will 1"]', "Notary Vella");
    const description = container.querySelector('input[aria-label="Description for will 1"]');
    act(() => description.focus());
    setInputValue('input[aria-label="Description for will 1"]', "UK historic will");
    act(() => container.querySelector('input[aria-label="Will share percentage"]').focus());

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(latestPeople[0].wills[0]).toMatchObject({
      notaryName: "Notary Vella",
      description: "UK historic will",
    });

    setInputValue('input[aria-label="Will share percentage"]', "33.335");
    act(() => vi.advanceTimersByTime(PERSON_RECORD_DRAFT_COMMIT_DELAY_MS - 1));
    expect(onChange).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1));

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(latestPeople[0].willHeirs[0]).toMatchObject({
      shareNumerator: 6667,
      shareDenominator: 20000,
      sharePercent: 33.335,
    });
    expect(controller.hasPending()).toBe(false);
  });

  it("acknowledges a touched share draft that returns to its canonical value", () => {
    const onChange = vi.fn((nextPeople) => ({ people: nextPeople }));
    let controller;
    act(() =>
      root.render(
        <PersonInspector
          people={willSharePeople()}
          selectedPersonId="deceased"
          shareDisplay="both"
          onChange={onChange}
          onSelectPerson={vi.fn()}
          onRegisterPendingEditFlush={(nextController) => {
            controller = nextController;
            return () => undefined;
          }}
        />,
      ),
    );
    setInputValue('input[aria-label="Will share percentage"]', "60");
    setInputValue('input[aria-label="Will share percentage"]', "50");
    expect(controller.hasPending()).toBe(true);

    act(() => expect(controller.flush()).toBe(true));

    expect(onChange).not.toHaveBeenCalled();
    expect(controller.hasPending()).toBe(false);
    expect(container.querySelector('input[aria-label="Will share percentage"]').value).toBe("50");
  });

  it("commits identity while acknowledging a reverted share in the same aggregate flush", () => {
    const onChange = vi.fn((nextPeople) => ({ people: nextPeople }));
    let controller;
    act(() =>
      root.render(
        <PersonInspector
          people={willSharePeople()}
          selectedPersonId="deceased"
          shareDisplay="both"
          onChange={onChange}
          onSelectPerson={vi.fn()}
          onRegisterPendingEditFlush={(nextController) => {
            controller = nextController;
            return () => undefined;
          }}
        />,
      ),
    );
    beginEditing();
    setInputValue('[data-person-field="surname"]', "Vella");
    setInputValue('input[aria-label="Will share percentage"]', "60");
    setInputValue('input[aria-label="Will share percentage"]', "50");

    act(() => expect(controller.flush()).toBe(true));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0]).toMatchObject({
      surname: "Vella",
      fullName: "Joseph Vella",
    });
    expect(onChange.mock.calls[0][0][0].willHeirs[0]).toMatchObject({
      shareNumerator: 1,
      shareDenominator: 2,
      sharePercent: 50,
    });
    expect(controller.hasPending()).toBe(false);
  });

  it("commits an identity draft after typing becomes idle", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    act(() =>
      root.render(
        <PersonInspector
          people={[
            {
              id: "person",
              givenNames: "Maria",
              surname: "Borg",
              fullName: "Maria Borg",
              sex: "Female",
              spouseIds: [],
            },
          ]}
          selectedPersonId="person"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    beginEditing();
    const surnameInput = container.querySelector('[data-person-field="surname"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        surnameInput,
        "Vella",
      );
      surnameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(IDENTITY_DRAFT_COMMIT_DELAY_MS));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0]).toMatchObject({
      surname: "Vella",
      fullName: "Maria Vella",
    });
  });

  it("commits the pending identity before Done closes the editor", () => {
    let latestPerson;
    function Harness() {
      const [people, setPeople] = useState([
        {
          id: "person",
          givenNames: "Maria",
          surname: "Borg",
          fullName: "Maria Borg",
          sex: "Female",
          spouseIds: [],
        },
      ]);
      latestPerson = people[0];
      return (
        <PersonInspector
          people={people}
          selectedPersonId="person"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }
    act(() => root.render(<Harness />));
    beginEditing();
    const surnameInput = container.querySelector('[data-person-field="surname"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        surnameInput,
        "Vella",
      );
      surnameInput.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelector('[data-person-action="done-editing"]').click();
    });

    expect(latestPerson).toMatchObject({ surname: "Vella", fullName: "Maria Vella" });
    expect(container.querySelector(".person-edit-fields").disabled).toBe(true);
  });

  it("merges a pending identity draft with a same-event status update", () => {
    let latestPerson;
    function Harness() {
      const [people, setPeople] = useState([
        {
          id: "person",
          givenNames: "Maria",
          surname: "Borg",
          fullName: "Maria Borg",
          sex: "Female",
          spouseIds: [],
        },
      ]);
      latestPerson = people[0];
      return (
        <PersonInspector
          people={people}
          selectedPersonId="person"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }
    act(() => root.render(<Harness />));
    beginEditing();
    const surnameInput = container.querySelector('[data-person-field="surname"]');
    const maleRadio = [...container.querySelectorAll('input[type="radio"]')].find(
      (input) => input.parentElement.textContent.trim() === "Male",
    );
    act(() => {
      surnameInput.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        surnameInput,
        "Vella",
      );
      surnameInput.dispatchEvent(new Event("input", { bubbles: true }));
      maleRadio.focus();
      maleRadio.click();
    });

    expect(latestPerson).toMatchObject({
      surname: "Vella",
      surnameAtBirth: "Vella",
      fullName: "Maria Vella",
      sex: "Male",
    });
  });

  it("preserves pending identity text through the custom deceased-status callback", () => {
    let latestPeople;
    function Harness() {
      const [people, setPeople] = useState([
        {
          id: "person",
          givenNames: "Maria",
          surname: "Borg",
          surnameAtBirth: "Borg",
          fullName: "Maria Borg",
          sex: "Female",
          spouseIds: [],
        },
      ]);
      latestPeople = people;
      return (
        <PersonInspector
          people={people}
          selectedPersonId="person"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
          onDeceasedStatusChange={({ people: sourcePeople, personId, patch }) =>
            setPeople(
              sourcePeople.map((person) =>
                person.id === personId ? { ...person, ...patch } : person,
              ),
            )
          }
        />
      );
    }
    act(() => root.render(<Harness />));
    beginEditing();
    const surnameInput = container.querySelector('[data-person-field="surname"]');
    const deceasedInput = container.querySelector(".deceased-status-control input");
    act(() => {
      surnameInput.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        surnameInput,
        "Vella",
      );
      surnameInput.dispatchEvent(new Event("input", { bubbles: true }));
      deceasedInput.click();
    });

    expect(latestPeople[0]).toMatchObject({
      surname: "Vella",
      fullName: "Maria Vella",
      isDeceased: true,
    });
  });

  it("preserves pending identity text when adding a relative in the same event", () => {
    let latestPeople;
    function Harness() {
      const [people, setPeople] = useState([
        {
          id: "person",
          givenNames: "Maria",
          surname: "Borg",
          surnameAtBirth: "Borg",
          fullName: "Maria Borg",
          sex: "Female",
          spouseIds: [],
        },
      ]);
      latestPeople = people;
      return (
        <PersonInspector
          people={people}
          selectedPersonId="person"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }
    act(() => root.render(<Harness />));
    beginEditing();
    const surnameInput = container.querySelector('[data-person-field="surname"]');
    const addFatherButton = container.querySelector('button[title="Add father"]');
    act(() => {
      surnameInput.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        surnameInput,
        "Vella",
      );
      surnameInput.dispatchEvent(new Event("input", { bubbles: true }));
      addFatherButton.click();
    });

    expect(latestPeople).toHaveLength(2);
    expect(latestPeople[0]).toMatchObject({ surname: "Vella", fullName: "Maria Vella" });
    expect(latestPeople[0].fatherId).toBe(latestPeople[1].id);
  });

  it("uses a pending father's surname when creating his child in the same event", () => {
    let latestPeople;
    function Harness() {
      const [people, setPeople] = useState([
        {
          id: "person",
          givenNames: "Mario",
          surname: "Borg",
          surnameAtBirth: "Borg",
          fullName: "Mario Borg",
          sex: "Male",
          spouseIds: [],
        },
      ]);
      latestPeople = people;
      return (
        <PersonInspector
          people={people}
          selectedPersonId="person"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }
    act(() => root.render(<Harness />));
    beginEditing();
    const surnameInput = container.querySelector('[data-person-field="surname"]');
    const addChildButton = container.querySelector('button[title="Add child"]');
    act(() => {
      surnameInput.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        surnameInput,
        "Vella",
      );
      surnameInput.dispatchEvent(new Event("input", { bubbles: true }));
      addChildButton.click();
    });

    expect(latestPeople).toHaveLength(2);
    expect(latestPeople[0]).toMatchObject({
      surname: "Vella",
      surnameAtBirth: "Vella",
      fullName: "Mario Vella",
    });
    expect(latestPeople[1]).toMatchObject({
      fatherId: "person",
      surname: "Vella",
      surnameAtBirth: "Vella",
    });
  });

  it("places Done immediately after Delete person at the bottom", () => {
    act(() =>
      root.render(
        <PersonInspector
          people={[
            { id: "person", fullName: "Maria Borg", spouseIds: [] },
            { id: "other", fullName: "Paul Borg", spouseIds: [] },
          ]}
          selectedPersonId="person"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    beginEditing();
    const actionButtons = [...container.querySelectorAll(".person-delete-control > button")];
    expect(actionButtons.map((button) => button.textContent.trim())).toEqual([
      "Delete person",
      "Done",
    ]);
    expect(container.querySelector(".inspector-profile").textContent).not.toContain("Done");

    act(() => actionButtons[1].click());

    expect(container.querySelector(".person-edit-fields").disabled).toBe(true);
    expect(container.querySelector(".inspector-profile").textContent).toContain("Edit identity");
  });

  it("does not duplicate the surrounding drawer's Back to Tree navigation", () => {
    act(() =>
      root.render(
        <PersonInspector
          people={[
            {
              id: "person",
              fullName: "Maria Borg",
              sex: "Female",
              spouseIds: [],
            },
          ]}
          selectedPersonId="person"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).not.toContain("Back to Tree");
  });

  it("keeps pure family-tree editing free of legal and tax requirements", () => {
    let latestPeople;
    function Harness() {
      const [people, setPeople] = useState([
        {
          id: "person",
          fullName: "Maria Borg",
          givenNames: "Maria",
          surname: "Borg",
          sex: "Female",
          spouseIds: [],
          isPotentialIntestateParent: true,
          survivalStatusRequired: false,
          survivalStatusConfirmed: "alive",
          causaMortisDeclarations: [{ id: "hidden-cm", status: "draft" }],
        },
      ]);
      latestPeople = people;
      return (
        <PersonInspector
          people={people}
          legalWorkspaceEnabled={false}
          selectedPersonId="person"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
          causaMortisCoverage={[{ status: "missing" }]}
        />
      );
    }

    act(() => root.render(<Harness />));

    expect(container.textContent).toContain("Family tree only");
    expect(container.textContent).toContain("the tree can be printed at any time");
    expect(container.querySelector('button[title="Add father"]')?.disabled).toBe(false);
    expect(container.querySelector('button[title="Add child"]')?.disabled).toBe(false);
    act(() => container.querySelector('button[title="Add father"]').click());
    expect(latestPeople).toHaveLength(2);
    expect(latestPeople[0].fatherId).toBe(latestPeople[1].id);
    expect(container.textContent).not.toContain("Sold/Donated Property Share");
    expect(container.textContent).not.toContain("Possible parent inheritance");
    expect(container.textContent).not.toContain("Succession");
    expect(container.textContent).not.toContain("Causa Mortis");
    expect(container.textContent).not.toContain("Final Withholding Tax");

    const deceased = container.querySelector('.deceased-status-control input[type="checkbox"]');
    act(() => deceased.click());

    expect(latestPeople[0]).toMatchObject({ isDeceased: true, dateOfDeath: "" });
    expect(latestPeople[0]).not.toHaveProperty("inheritanceBasis");
    expect(latestPeople[0]).not.toHaveProperty("unmarriedOrWidowedAtDeath");
    expect(latestPeople[0].causaMortisDeclarations).toEqual([{ id: "hidden-cm", status: "draft" }]);
    expect(latestPeople[0]).toMatchObject({
      survivalStatusRequired: false,
      survivalStatusConfirmed: "alive",
    });
    expect(container.textContent).toContain("Date of death");
    expect(container.textContent).toContain("optional");
    expect(container.textContent).toContain("a year, or an approximate date");
    const deathDate = container.querySelector('input[aria-label="Date of death (optional)"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        deathDate,
        "about 1858",
      );
      deathDate.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(latestPeople[0]).not.toHaveProperty("deathDateText");
    leaveInput(deathDate);
    expect(latestPeople[0]).toMatchObject({
      dateOfDeath: "",
      deathDateText: "about 1858",
      survivalStatusRequired: false,
      survivalStatusConfirmed: "alive",
    });
    const unknownDate = container.querySelector('input[aria-label="Date of death unknown"]');
    act(() => unknownDate.click());
    expect(latestPeople[0]).toMatchObject({
      isDeceased: true,
      dateOfDeath: "",
      deathDateText: "",
      dateOfDeathUnknown: true,
    });
    expect(deathDate.disabled).toBe(true);
    expect(deathDate.value).toBe("Date of death unknown");
    expect(container.querySelector(".date-input-warning")).toBeNull();
    expect(container.textContent).not.toContain("Inheritance basis");
    expect(container.textContent).not.toContain("Marital status at death");
  });

  it("records an unknown legal death date without inventing an exact date", () => {
    let latestPeople;
    function Harness() {
      const [people, setPeople] = useState([
        {
          id: "person",
          fullName: "Maria Borg",
          givenNames: "Maria",
          surname: "Borg",
          surnameAtBirth: "Borg",
          sex: "Female",
          spouseIds: [],
          designations: ["Deceased"],
          isDeceased: true,
          dateOfDeath: "1900-01-01",
          inheritanceBasis: "intestacy",
        },
      ]);
      latestPeople = people;
      return (
        <PersonInspector
          people={people}
          legalWorkspaceEnabled
          selectedPersonId="person"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));

    const unknownDate = container.querySelector('input[aria-label="Date of death unknown"]');
    const exactDate = container.querySelector('[data-person-field="date-of-death"]');
    act(() => unknownDate.click());

    expect(latestPeople[0]).toMatchObject({
      dateOfDeath: "",
      dateOfDeathUnknown: true,
    });
    expect(exactDate.disabled).toBe(true);
  });

  it("does not guess a father or mother role for an Other-sex parent's child", () => {
    act(() =>
      root.render(
        <PersonInspector
          people={[
            {
              id: "person",
              fullName: "Alex Borg",
              givenNames: "Alex",
              surname: "Borg",
              sex: "Other",
              spouseIds: [],
            },
          ]}
          legalWorkspaceEnabled={false}
          selectedPersonId="person"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    ["Wife / husband", "Partner", "Child"].forEach((label) => {
      const action = [...container.querySelectorAll(".relationship-actions button")].find(
        (button) => button.textContent.trim() === label,
      );
      expect(action.disabled).toBe(true);
      expect(action.title).toContain("Choose Male or Female");
    });
    expect(container.querySelector('button[title="Add father"]')?.disabled).toBe(false);
  });

  it("uses a later exact legal death date when returning to pure-tree display", () => {
    let latestPeople;
    function Harness({ legalWorkspaceEnabled }) {
      const [people, setPeople] = useState([
        {
          id: "person",
          fullName: "Maria Borg",
          givenNames: "Maria",
          surname: "Borg",
          surnameAtBirth: "Borg",
          sex: "Female",
          spouseIds: [],
          isDeceased: true,
          designations: ["Deceased"],
          dateOfDeath: "",
          deathDateText: "about 1858",
          inheritanceBasis: "intestacy",
        },
      ]);
      latestPeople = people;
      return (
        <PersonInspector
          people={people}
          legalWorkspaceEnabled={legalWorkspaceEnabled}
          selectedPersonId="person"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness legalWorkspaceEnabled />));
    setInputValue(".succession-death-date input", "11/02/1859");
    expect(latestPeople[0]).toMatchObject({
      dateOfDeath: "1859-02-11",
      deathDateText: "11/02/1859",
    });

    act(() => root.render(<Harness legalWorkspaceEnabled={false} />));
    expect(container.querySelector('input[aria-label="Date of death (optional)"]').value).toBe(
      "11/02/1859",
    );
  });

  it("allows tree removal while pure mode hides retained legal editors", () => {
    const people = [
      {
        id: "person",
        fullName: "Maria Borg",
        givenNames: "Maria",
        surname: "Borg",
        surnameAtBirth: "Borg",
        sex: "Female",
        spouseIds: [],
      },
      {
        id: "other",
        fullName: "Joseph Vella",
        givenNames: "Joseph",
        surname: "Vella",
        surnameAtBirth: "Vella",
        sex: "Male",
        spouseIds: [],
      },
    ];
    act(() =>
      root.render(
        <PersonInspector
          people={people}
          familyPersonIds={people.map((person) => person.id)}
          legalWorkspaceEnabled={false}
          selectedPersonId="person"
          retainedIdentityLabels={["an initial property ownership record"]}
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onDeletePerson={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector("button.danger-button").disabled).toBe(false);
    expect(container.textContent).not.toContain("Switch to Property, succession & tax");
    expect(container.textContent).toContain(
      "existing succession, legal and tax records will be retained outside the family tree",
    );
  });

  it("does not offer a second tree deletion for an already hidden retained identity", () => {
    act(() =>
      root.render(
        <PersonInspector
          people={[
            { id: "retained", fullName: "Retained Owner", spouseIds: [] },
            { id: "visible", fullName: "Visible Person", spouseIds: [] },
          ]}
          familyPersonIds={["visible"]}
          selectedPersonId="retained"
          retainedIdentityLabels={["an initial property ownership record"]}
          onChange={vi.fn()}
          onDeletePerson={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector('[data-person-action="delete"]').disabled).toBe(true);
    expect(container.textContent).toContain(
      "This retained identity is already outside the current family tree.",
    );
  });

  it("creates an editable missing mother only after explicit confirmation", () => {
    let latestPeople = [];
    const initialPeople = [
      {
        id: "michael",
        givenNames: "Michael",
        surname: "Wadge",
        fullName: "Michael Wadge",
        sex: "Male",
        isDeceased: true,
        dateOfDeath: "2020-04-12",
        inheritanceBasis: "intestacy",
        fatherId: "edgar",
        motherId: "",
        spouseIds: [],
        designations: ["Deceased"],
      },
      {
        id: "edgar",
        givenNames: "Edgar",
        surname: "Wadge",
        fullName: "Edgar Wadge",
        sex: "Male",
        isDeceased: true,
        dateOfDeath: "1990-01-01",
        spouseIds: [],
        designations: ["Deceased"],
      },
    ];

    function Harness() {
      const [people, setPeople] = useState(initialPeople);
      latestPeople = people;
      return (
        <PersonInspector
          people={people}
          selectedPersonId="michael"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));

    expect(latestPeople.find((person) => person.id === "michael").motherId).toBe("");
    const addMissingParent = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Add missing parent"),
    );
    expect(addMissingParent).not.toBeNull();
    act(() => addMissingParent.click());

    const michael = latestPeople.find((person) => person.id === "michael");
    const mother = latestPeople.find((person) => person.id === michael.motherId);
    expect(mother).toMatchObject({
      fullName: "Mother of Michael",
      sex: "Female",
      isPotentialIntestateParent: true,
      potentialParentAddedExplicitly: true,
      survivalStatusRequired: true,
      survivalStatusReferencePersonId: "michael",
    });
  });

  it("does not show an unresolved-survival alert for a potential parent with a valid death date", () => {
    let latestPeople = [];
    const initialPeople = [
      {
        id: "child",
        fullName: "Michael Borg",
        givenNames: "Michael",
        surname: "Borg",
        sex: "Male",
        isDeceased: true,
        dateOfDeath: "2020-04-12",
        fatherId: "father",
        designations: ["Deceased"],
        spouseIds: [],
      },
      {
        id: "father",
        fullName: "Father of Michael",
        givenNames: "Father of Michael",
        sex: "Male",
        isDeceased: true,
        dateOfDeath: "2020-04-12",
        designations: ["Parent", "Deceased"],
        spouseIds: [],
        isPotentialIntestateParent: true,
        potentialParentAddedExplicitly: true,
        survivalStatusRequired: true,
        survivalStatusConfirmed: "",
        survivalStatusReferencePersonId: "child",
      },
    ];

    function Harness() {
      const [people, setPeople] = useState(initialPeople);
      latestPeople = people;
      return (
        <PersonInspector
          people={people}
          selectedPersonId="father"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));

    expect(container.textContent).not.toContain("Establish whether this parent survived");

    const deathDate = container.querySelector(".succession-death-date input");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        deathDate,
        "11/04/2020",
      );
      deathDate.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(latestPeople.find((person) => person.id === "father")).toMatchObject({
      dateOfDeath: "2020-04-11",
      survivalStatusRequired: false,
      survivalStatusConfirmed: "death-date-recorded",
    });
    expect(container.textContent).not.toContain("Establish whether this parent survived");
  });

  it("adds a father around the selected person without moving the selection", () => {
    const onChange = vi.fn();
    const onSelectPerson = vi.fn();
    const child = {
      id: "child",
      fullName: "Maria Example",
      sex: "Female",
      surnameAtBirth: "Example",
      designations: [],
      spouseIds: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[child]}
          selectedPersonId="child"
          onChange={onChange}
          onSelectPerson={onSelectPerson}
        />,
      ),
    );

    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Father"))
        .click(),
    );

    const updatedPeople = onChange.mock.calls[0][0];
    expect(updatedPeople).toHaveLength(2);
    expect(updatedPeople[1]).toMatchObject({
      sex: "Male",
      designations: ["Parent"],
    });
    expect(updatedPeople[0].fatherId).toBe(updatedPeople[1].id);
    expect(onSelectPerson).not.toHaveBeenCalled();
  });

  it("adds several children while keeping the relationship controls on the same person", () => {
    let currentPeople = [
      {
        id: "parent",
        fullName: "Maria Example",
        sex: "Female",
        surnameAtBirth: "Example",
        designations: [],
        spouseIds: [],
        siblingIds: [],
      },
    ];
    const onChange = vi.fn((nextPeople) => {
      currentPeople = nextPeople;
      act(() =>
        root.render(
          <PersonInspector
            people={currentPeople}
            selectedPersonId="parent"
            onChange={onChange}
            onSelectPerson={vi.fn()}
          />,
        ),
      );
    });

    act(() =>
      root.render(
        <PersonInspector
          people={currentPeople}
          selectedPersonId="parent"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const clickChild = () => {
      const childButton = [...container.querySelectorAll("button")].find((button) =>
        button.textContent.includes("Child"),
      );
      act(() => childButton.click());
    };
    clickChild();
    clickChild();
    clickChild();

    expect(currentPeople).toHaveLength(4);
    expect(currentPeople.slice(1).every((person) => person.motherId === "parent")).toBe(true);
    const childButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Child"),
    );
    expect(childButton.querySelector(".relationship-count").textContent).toBe("3");
  });

  it("requires confirmation before assigning a sole partner as the other parent", () => {
    const onChange = vi.fn();
    const people = [
      {
        id: "parent-a",
        fullName: "Mark Borg",
        sex: "Male",
        spouseIds: [],
        designations: [],
      },
      {
        id: "parent-b",
        fullName: "Elena Borg",
        sex: "Female",
        spouseIds: ["parent-a"],
        designations: [],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="parent-a"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Child"))
        .click(),
    );

    expect(onChange).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Choose the other parent for this child");
    const partnerSelect = container.querySelector(`select[aria-label="Child's other parent"]`);
    expect(partnerSelect.value).toBe("parent-b");
    act(() =>
      [...container.querySelectorAll(".child-partner-chooser button")]
        .find((button) => button.textContent.includes("Add child"))
        .click(),
    );

    expect(onChange.mock.calls[0][0].at(-1)).toMatchObject({
      fatherId: "parent-a",
      motherId: "parent-b",
      designations: ["Child"],
      surname: "Borg",
      surnameAtBirth: "Borg",
    });
  });

  it("uses the recorded father's surname when a mother creates a child", () => {
    const onChange = vi.fn();
    const people = [
      {
        id: "mother",
        givenNames: "Maria",
        surname: "Vella",
        fullName: "Maria Vella",
        surnameAtBirth: "Borg",
        sex: "Female",
        spouseIds: ["father"],
      },
      {
        id: "father",
        givenNames: "Joseph",
        surname: "Testaferrata de Noto",
        fullName: "Joseph Testaferrata de Noto",
        sex: "Male",
        spouseIds: ["mother"],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="mother"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Child"))
        .click(),
    );
    act(() =>
      [...container.querySelectorAll(".child-partner-chooser button")]
        .find((button) => button.textContent.includes("Add child"))
        .click(),
    );

    expect(onChange.mock.calls[0][0].at(-1)).toMatchObject({
      fatherId: "father",
      motherId: "mother",
      surname: "Testaferrata de Noto",
      surnameAtBirth: "Testaferrata de Noto",
      fullName: "",
    });
  });

  it("uses the common recorded father's surname for a newly created sibling", () => {
    const onChange = vi.fn();
    const people = [
      {
        id: "father",
        givenNames: "Joseph",
        surname: "Borg",
        fullName: "Joseph Borg",
        sex: "Male",
        spouseIds: [],
      },
      {
        id: "person",
        givenNames: "Maria",
        surname: "Borg",
        fullName: "Maria Borg",
        surnameAtBirth: "Borg",
        sex: "Female",
        fatherId: "father",
        spouseIds: [],
        siblingIds: [],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="person"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Brother / sister"))
        .click(),
    );

    expect(onChange.mock.calls[0][0].at(-1)).toMatchObject({
      fatherId: "father",
      surname: "Borg",
      surnameAtBirth: "Borg",
      fullName: "",
    });
  });

  it("keeps inherited current and birth surnames independently editable", () => {
    let latestPerson;

    function Harness() {
      const [people, setPeople] = useState([
        {
          id: "child",
          givenNames: "Anna",
          surname: "Borg",
          fullName: "Anna Borg",
          surnameAtBirth: "Borg",
          sex: "Female",
          fatherId: "father",
          spouseIds: [],
        },
        { id: "father", fullName: "Joseph Borg", spouseIds: [] },
      ]);
      latestPerson = people[0];
      return (
        <PersonInspector
          people={people}
          selectedPersonId="child"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));
    beginEditing();

    const fieldInput = (label) =>
      [...container.querySelectorAll(".person-edit-fields label")]
        .find((element) => element.querySelector(":scope > span")?.textContent === label)
        .querySelector("input");
    act(() => {
      const surnameInput = fieldInput("Surname");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        surnameInput,
        "Vella",
      );
      surnameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    leaveInput(fieldInput("Surname"));
    expect(latestPerson).toMatchObject({
      surname: "Vella",
      fullName: "Anna Vella",
      surnameAtBirth: "Borg",
    });

    act(() => {
      const birthSurnameInput = fieldInput("Surname at birth");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        birthSurnameInput,
        "Camilleri",
      );
      birthSurnameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    leaveInput(fieldInput("Surname at birth"));
    expect(latestPerson.surnameAtBirth).toBe("Camilleri");
  });

  it("clears the GEDCOM surname review warning after the birth surname is confirmed", () => {
    let latestPerson;

    function Harness() {
      const [people, setPeople] = useState([
        {
          id: "child",
          givenNames: "Anna",
          surname: "Borg",
          fullName: "Anna Borg",
          surnameAtBirth: "",
          surnameAtBirthReviewRequired: true,
          gedcomUnmarriedParents: true,
          sex: "Female",
          spouseIds: [],
        },
      ]);
      latestPerson = people[0];
      return (
        <PersonInspector
          people={people}
          selectedPersonId="child"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));
    expect(container.textContent).toContain("The imported parents are recorded as unmarried");
    beginEditing();

    const birthSurnameInput = [...container.querySelectorAll(".person-edit-fields label")]
      .find((element) => element.querySelector(":scope > span")?.textContent === "Surname at birth")
      .querySelector("input");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        birthSurnameInput,
        "Vella",
      );
      birthSurnameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    leaveInput(birthSurnameInput);

    expect(latestPerson).toMatchObject({
      surnameAtBirth: "Vella",
      surnameAtBirthReviewRequired: false,
      gedcomUnmarriedParents: true,
    });
    expect(container.textContent).not.toContain("The imported parents are recorded as unmarried");

    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        birthSurnameInput,
        "",
      );
      birthSurnameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    leaveInput(birthSurnameInput);

    expect(latestPerson).toMatchObject({
      surnameAtBirth: "",
      surnameAtBirthReviewRequired: true,
      gedcomUnmarriedParents: true,
    });
    expect(container.textContent).toContain("The imported parents are recorded as unmarried");
  });

  it("resolves an ordinary blank birth surname when sex changes from Other to Female to Male", () => {
    let latestPerson;

    function Harness() {
      const [people, setPeople] = useState([
        {
          id: "person",
          givenNames: "Joseph",
          surname: "Borg",
          fullName: "Joseph Borg",
          surnameAtBirth: "",
          surnameAtBirthReviewRequired: false,
          sex: "Other",
          spouseIds: [],
        },
      ]);
      latestPerson = people[0];
      return (
        <PersonInspector
          people={people}
          selectedPersonId="person"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));
    const sexRadio = (label) =>
      [...container.querySelectorAll('[role="group"][aria-label="Sex"] label')]
        .find((element) => element.textContent.includes(label))
        .querySelector('input[type="radio"]');

    act(() => sexRadio("Female").click());
    expect(latestPerson).toMatchObject({
      sex: "Female",
      surnameAtBirth: "",
      surnameAtBirthReviewRequired: true,
    });

    act(() => sexRadio("Male").click());
    expect(latestPerson).toMatchObject({
      sex: "Male",
      surnameAtBirth: "Borg",
      surnameAtBirthReviewRequired: false,
    });
    expect(container.textContent).not.toContain("The imported parents are recorded as unmarried");
  });

  it("keeps a GEDCOM-unmarried birth surname review unresolved after changing sex to Male", () => {
    let latestPerson;

    function Harness() {
      const [people, setPeople] = useState([
        {
          id: "person",
          givenNames: "Joseph",
          surname: "Borg",
          fullName: "Joseph Borg",
          surnameAtBirth: "",
          surnameAtBirthReviewRequired: false,
          gedcomUnmarriedParents: true,
          sex: "Other",
          spouseIds: [],
        },
      ]);
      latestPerson = people[0];
      return (
        <PersonInspector
          people={people}
          selectedPersonId="person"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));
    const sexRadio = (label) =>
      [...container.querySelectorAll('[role="group"][aria-label="Sex"] label')]
        .find((element) => element.textContent.includes(label))
        .querySelector('input[type="radio"]');

    act(() => sexRadio("Female").click());
    act(() => sexRadio("Male").click());

    expect(latestPerson).toMatchObject({
      sex: "Male",
      surnameAtBirth: "",
      surnameAtBirthReviewRequired: true,
      gedcomUnmarriedParents: true,
    });
    expect(container.textContent).toContain("The imported parents are recorded as unmarried");
  });

  it("asks which partnership applies when a person has several partners", () => {
    const onChange = vi.fn();
    const people = [
      {
        id: "parent",
        fullName: "Roland Wadge",
        sex: "Male",
        spouseIds: ["partner-a", "partner-b"],
        designations: [],
      },
      {
        id: "partner-a",
        fullName: "Anna Borg",
        sex: "Female",
        spouseIds: ["parent"],
      },
      {
        id: "partner-b",
        fullName: "Maria Vella",
        sex: "Female",
        spouseIds: ["parent"],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="parent"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Child"))
        .click(),
    );
    const partnerSelect = container.querySelector(`select[aria-label="Child's other parent"]`);
    expect(partnerSelect).not.toBeNull();
    expect(partnerSelect.value).toBe("partner-b");
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      partnerSelect.value = "partner-a";
      partnerSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() =>
      [...container.querySelectorAll(".child-partner-chooser button")]
        .find((button) => button.textContent.includes("Add child"))
        .click(),
    );

    expect(onChange.mock.calls[0][0].at(-1)).toMatchObject({
      fatherId: "parent",
      motherId: "partner-a",
    });
  });

  it("defaults to the most recently linked valid partner whenever the child chooser reopens", () => {
    const onChange = vi.fn();
    const people = [
      {
        id: "parent",
        fullName: "Roland Wadge",
        sex: "Male",
        spouseIds: ["partner-a", "missing-a", "partner-b", "missing-b"],
        designations: [],
      },
      {
        id: "partner-a",
        fullName: "Anna Borg",
        sex: "Female",
        spouseIds: ["parent"],
      },
      {
        id: "partner-b",
        fullName: "Maria Vella",
        sex: "Female",
        spouseIds: ["parent"],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="parent"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const childButton = [...container.querySelectorAll(".relationship-actions button")].find(
      (button) => button.textContent.includes("Child"),
    );
    act(() => childButton.click());

    let partnerSelect = container.querySelector(`select[aria-label="Child's other parent"]`);
    expect(partnerSelect.value).toBe("partner-b");
    expect([...partnerSelect.options].some((option) => option.value === "")).toBe(true);

    act(() => {
      partnerSelect.value = "";
      partnerSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(partnerSelect.value).toBe("");

    act(() => childButton.click());
    expect(container.querySelector(`select[aria-label="Child's other parent"]`)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();

    act(() => childButton.click());
    partnerSelect = container.querySelector(`select[aria-label="Child's other parent"]`);
    expect(partnerSelect.value).toBe("partner-b");

    act(() =>
      [...container.querySelectorAll(".child-partner-chooser button")]
        .find((button) => button.textContent.includes("Add child"))
        .click(),
    );
    expect(onChange.mock.calls[0][0].at(-1)).toMatchObject({
      fatherId: "parent",
      motherId: "partner-b",
    });
  });

  it("suggests a new partner as a missing parent and applies only confirmed links", () => {
    const onSelectPerson = vi.fn();
    let latestPeople = [];
    const people = [
      {
        id: "parent",
        fullName: "Roland Wadge",
        sex: "Male",
        surnameAtBirth: "Wadge",
        spouseIds: [],
        designations: [],
      },
      {
        id: "child-1",
        fullName: "Child One",
        fatherId: "parent",
        spouseIds: [],
        designations: [],
      },
      {
        id: "child-2",
        fullName: "Child Two",
        fatherId: "parent",
        spouseIds: [],
        designations: [],
      },
    ];

    function Harness() {
      const [currentPeople, setCurrentPeople] = useState(people);
      latestPeople = currentPeople;
      return (
        <PersonInspector
          people={currentPeople}
          selectedPersonId="parent"
          onChange={setCurrentPeople}
          onSelectPerson={onSelectPerson}
        />
      );
    }

    act(() => root.render(<Harness />));
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Partner"))
        .click(),
    );
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Create new partner"))
        .click(),
    );

    const partner = latestPeople.at(-1);
    expect(latestPeople[0].spouseIds).toEqual([partner.id]);
    expect(latestPeople.find((person) => person.id === "child-1").motherId).toBeUndefined();
    expect(latestPeople.find((person) => person.id === "child-2").motherId).toBeUndefined();
    expect(container.querySelectorAll(".parent-suggestion")).toHaveLength(2);
    expect(container.textContent).toContain("Parent links to confirm");

    act(() => container.querySelector(".parent-suggestion .primary-button").click());
    expect(latestPeople.find((person) => person.id === "child-1").motherId).toBe(partner.id);
    expect(latestPeople.find((person) => person.id === "child-2").motherId).toBeUndefined();

    act(() => container.querySelector(".parent-suggestion .secondary-button").click());
    expect(latestPeople.find((person) => person.id === "child-2").motherExplicitlyUnassigned).toBe(
      true,
    );
    expect(container.querySelectorAll(".parent-suggestion")).toHaveLength(0);
    expect(onSelectPerson).not.toHaveBeenCalled();
  });

  it("locks a parent to one father and blocks deleting someone with a descendant", () => {
    const people = [
      {
        id: "parent",
        fullName: "Joseph Example",
        sex: "Male",
        designations: [],
        spouseIds: [],
      },
      {
        id: "child",
        fullName: "Anna Example",
        designations: [],
        fatherId: "parent",
        spouseIds: [],
      },
      {
        id: "father",
        fullName: "Paul Example",
        designations: [],
        spouseIds: [],
      },
    ];
    people[0].fatherId = "father";

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="parent"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const fatherButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Father"),
    );
    const deleteButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Delete person"),
    );
    expect(fatherButton.disabled).toBe(true);
    expect(fatherButton.querySelector(".relationship-count").textContent).toBe("1");
    expect(deleteButton.disabled).toBe(true);
    // Joseph stands between his own father and his child, so removing him would
    // leave those two with no way back to each other.
    expect(container.textContent).toContain("a family branch still depends on this person");
  });

  it("shows existing parents as one read-only italic relationship", () => {
    const people = [
      {
        id: "child",
        fullName: "Joseph Wadge",
        sex: "Male",
        fatherId: "father",
        motherId: "mother",
        spouseIds: [],
      },
      { id: "father", fullName: "Roland Wadge", spouseIds: [] },
      {
        id: "mother",
        fullName: "Alison Wadge",
        surnameAtBirth: "Buttigieg",
        spouseIds: [],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="child"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector(".person-parentage").textContent).toBe(
      "son of Roland Wadge & Alison Wadge nee Buttigieg",
    );
    expect(container.querySelector('[data-parent-link="father"]')).toBeNull();
    expect(container.querySelector('select[aria-label="Change father"]')).toBeNull();
    expect(container.querySelector('button[aria-label^="Remove father link"]')).toBeNull();
  });

  it("allows deletion of a partner with no descendants, and can still unlink", () => {
    const onChange = vi.fn();
    const people = [
      {
        id: "person",
        fullName: "Maria Borg",
        spouseIds: ["partner"],
      },
      {
        id: "partner",
        fullName: "Joseph Borg",
        spouseIds: ["person"],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="person"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    beginEditing();

    const deleteButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Delete person"),
    );
    const unlinkButton = container.querySelector(
      'button[aria-label="Remove partner link to Joseph Borg"]',
    );
    // A partner added by mistake has to be removable without first unpicking
    // the marriage. Only descendants stand in the way of a deletion.
    expect(deleteButton.disabled).toBe(false);
    expect(container.textContent).not.toContain("Remove 1 partner link first.");

    act(() => unlinkButton.click());

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: "person", spouseIds: [] }),
      expect.objectContaining({ id: "partner", spouseIds: [] }),
    ]);
  });

  it("can unlink siblings without making either person undeletable", () => {
    const onChange = vi.fn();
    const people = [
      { id: "person", fullName: "Maria Borg", siblingIds: ["sibling"], spouseIds: [] },
      { id: "sibling", fullName: "Paul Borg", siblingIds: ["person"], spouseIds: [] },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="person"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    beginEditing();

    const deleteButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Delete person"),
    );
    const unlinkButton = container.querySelector(
      'button[aria-label="Remove sibling link to Paul Borg"]',
    );
    expect(deleteButton.disabled).toBe(false);
    expect(unlinkButton).not.toBeNull();

    act(() => unlinkButton.click());

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: "person", siblingIds: [] }),
      expect.objectContaining({ id: "sibling", siblingIds: [] }),
    ]);
  });

  it("hides redundant sibling unlinking when the people already share a parent", () => {
    const people = [
      { id: "father", fullName: "Joseph Borg", spouseIds: [] },
      {
        id: "person",
        fullName: "Maria Borg",
        fatherId: "father",
        siblingIds: ["sibling"],
        spouseIds: [],
      },
      {
        id: "sibling",
        fullName: "Paul Borg",
        fatherId: "father",
        siblingIds: ["person"],
        spouseIds: [],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="person"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    beginEditing();

    expect(
      container.querySelector('button[aria-label="Remove sibling link to Paul Borg"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("Sibling links");
  });

  it("keeps a shared-parent partnership linked until the child is reassigned", () => {
    const onChange = vi.fn();
    const people = [
      { id: "person", fullName: "Maria Borg", spouseIds: ["partner"] },
      { id: "partner", fullName: "Joseph Borg", spouseIds: ["person"] },
      {
        id: "child",
        fullName: "Anna Borg",
        fatherId: "partner",
        motherId: "person",
        spouseIds: [],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="person"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    beginEditing();

    const unlinkButton = container.querySelector(
      'button[aria-label="Remove partner link to Joseph Borg"]',
    );
    expect(unlinkButton.disabled).toBe(true);
    expect(unlinkButton.title).toContain("Reassign");
    act(() => unlinkButton.click());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not delete the sole person from one family tab because another tab has people", () => {
    act(() =>
      root.render(
        <PersonInspector
          people={[
            { id: "person", fullName: "Maria Borg", spouseIds: [] },
            { id: "other-family", fullName: "Paul Vella", spouseIds: [] },
          ]}
          familyPersonIds={["person"]}
          selectedPersonId="person"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    beginEditing();

    const deleteButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Delete person"),
    );
    expect(deleteButton.disabled).toBe(true);
    expect(container.textContent).toContain("A tree must contain at least one person.");
  });

  it("asks for confirmation before deleting a person without dependencies", () => {
    const onChange = vi.fn();
    const onSelectPerson = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const people = [
      { id: "parent", fullName: "Joseph Borg", spouseIds: [] },
      {
        id: "person",
        fullName: "Maria Borg",
        fatherId: "parent",
        spouseIds: [],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="person"
          onChange={onChange}
          onSelectPerson={onSelectPerson}
        />,
      ),
    );
    beginEditing();
    const deleteButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Delete person"),
    );

    expect(deleteButton.disabled).toBe(false);
    act(() => deleteButton.click());
    expect(confirm).toHaveBeenCalledWith(
      "Are you sure you want to delete Maria Borg from the family tree? This cannot be undone.",
    );
    expect(onChange).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    act(() => deleteButton.click());
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: "parent" })]);
    expect(onSelectPerson).toHaveBeenCalledWith("parent");
  });

  it("allows tree deletion while ownership in another property is retained", () => {
    const people = [
      { id: "parent", fullName: "Joseph Borg", spouseIds: [] },
      { id: "person", fullName: "Maria Borg", fatherId: "parent", spouseIds: [] },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[{ id: "property-1" }, { id: "property-2" }]}
          selectedPersonId="person"
          ownershipByPerson={{ person: 0.5 }}
          retainedIdentityLabels={["an initial property ownership record"]}
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    beginEditing();

    const deleteButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Delete person"),
    );
    expect(deleteButton.disabled).toBe(false);
    expect(container.textContent).toContain(
      "existing succession, legal and tax records will be retained outside the family tree",
    );
  });

  it("removes a shared canonical person from only the current family", () => {
    const onChange = vi.fn();
    const onDeletePerson = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    act(() =>
      root.render(
        <PersonInspector
          people={[
            { id: "person", fullName: "Maria Borg", spouseIds: [] },
            { id: "other", fullName: "Paul Vella", spouseIds: [] },
          ]}
          familyPersonIds={["person", "other"]}
          personFamilyGroupCount={2}
          selectedPersonId="person"
          ownershipByPerson={{ person: 0.5 }}
          retainedIdentityLabels={["an initial property ownership record"]}
          onChange={onChange}
          onDeletePerson={onDeletePerson}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    beginEditing();

    const removeButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Remove from this family"),
    );
    expect(removeButton).not.toBeNull();
    expect(removeButton.disabled).toBe(false);
    expect(container.textContent).toContain(
      "This removes the person from this family only; the shared record remains elsewhere.",
    );

    act(() => removeButton.click());

    expect(confirm).toHaveBeenCalledWith(
      "Remove Maria Borg from this family tree? The person will remain in the other linked family tree.",
    );
    expect(onDeletePerson).toHaveBeenCalledWith("person");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes a CM declarant from the tree while retaining their legal identity", () => {
    const onDeletePerson = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    act(() =>
      root.render(
        <PersonInspector
          people={[
            { id: "person", fullName: "Maria Borg", spouseIds: [] },
            { id: "other", fullName: "Paul Vella", spouseIds: [] },
          ]}
          familyPersonIds={["person", "other"]}
          selectedPersonId="person"
          retainedIdentityLabels={["a causa mortis declarant record"]}
          onChange={vi.fn()}
          onDeletePerson={onDeletePerson}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    beginEditing();

    const deleteButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Delete person"),
    );
    expect(deleteButton.disabled).toBe(false);
    expect(container.textContent).toContain(
      "existing succession, legal and tax records will be retained outside the family tree",
    );

    act(() => deleteButton.click());

    expect(confirm).toHaveBeenCalledWith(
      "Delete Maria Borg from the family tree? Their identity and existing succession, legal and tax records will be retained outside the tree.",
    );
    expect(onDeletePerson).toHaveBeenCalledWith("person");
  });

  it("does not promise family-scoped removal without a scoped delete callback", () => {
    act(() =>
      root.render(
        <PersonInspector
          people={[
            { id: "person", fullName: "Maria Borg", spouseIds: [] },
            { id: "other", fullName: "Paul Vella", spouseIds: [] },
          ]}
          familyPersonIds={["person", "other"]}
          personFamilyGroupCount={2}
          selectedPersonId="person"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    beginEditing();

    const removeButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Remove from this family"),
    );
    expect(removeButton.disabled).toBe(true);
    expect(container.textContent).toContain("Family-scoped removal is unavailable in this view.");
  });

  it("ignores descendants that belong only to another family during scoped removal", () => {
    act(() =>
      root.render(
        <PersonInspector
          people={[
            { id: "person", fullName: "Maria Borg", spouseIds: [] },
            { id: "local", fullName: "Paul Vella", spouseIds: [] },
            { id: "other-child", fullName: "Anna Borg", motherId: "person", spouseIds: [] },
          ]}
          familyPersonIds={["person", "local"]}
          personFamilyGroupCount={2}
          selectedPersonId="person"
          onChange={vi.fn()}
          onDeletePerson={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    beginEditing();

    const removeButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Remove from this family"),
    );
    expect(removeButton.disabled).toBe(false);
    expect(container.textContent).not.toContain("Remove 1 descendant first.");
  });

  it("can link an existing person as a partner in both directions", () => {
    const onChange = vi.fn();
    const people = [
      {
        id: "person-a",
        fullName: "Maria Borg",
        sex: "Female",
        surnameAtBirth: "Borg",
        designations: [],
        spouseIds: [],
      },
      {
        id: "person-b",
        fullName: "Joseph Vella",
        sex: "Male",
        designations: [],
        spouseIds: [],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="person-a"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const partnerButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Partner"),
    );
    act(() => partnerButton.click());

    const spouseSelect = container.querySelector('select[aria-label="Existing partner"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        spouseSelect,
        "person-b",
      );
      spouseSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const linkButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Link partner"),
    );
    act(() => linkButton.click());

    const updatedPeople = onChange.mock.calls.at(-1)[0];
    expect(updatedPeople[0].spouseIds).toEqual(["person-b"]);
    expect(updatedPeople[1].spouseIds).toEqual(["person-a"]);
  });

  it("links an existing partner without silently assigning that person to earlier children", () => {
    const onChange = vi.fn();
    const people = [
      {
        id: "person-a",
        fullName: "Maria Borg",
        sex: "Female",
        surnameAtBirth: "Borg",
        spouseIds: [],
      },
      { id: "person-b", fullName: "Joseph Vella", sex: "Male", spouseIds: [] },
      { id: "child", fullName: "Child Borg", motherId: "person-a", fatherId: "" },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="person-a"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    const partnerButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Partner"),
    );
    act(() => partnerButton.click());
    const spouseSelect = container.querySelector('select[aria-label="Existing partner"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        spouseSelect,
        "person-b",
      );
      spouseSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const linkButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Link partner"),
    );
    act(() => linkButton.click());

    const updatedPeople = onChange.mock.calls.at(-1)[0];
    expect(updatedPeople.find((person) => person.id === "child")).toMatchObject({
      motherId: "person-a",
      fatherId: "",
    });
  });

  it("offers only opposite-sex cousins or more distant people as existing partners", () => {
    const people = [
      {
        id: "grandfather",
        fullName: "Anthony Borg",
        sex: "Male",
        spouseIds: [],
      },
      { id: "grandmother", fullName: "Carmela Borg", sex: "Female", spouseIds: [] },
      {
        id: "mother",
        fullName: "Rita Borg",
        sex: "Female",
        fatherId: "grandfather",
        motherId: "grandmother",
        spouseIds: [],
      },
      {
        id: "uncle",
        fullName: "Paul Borg",
        sex: "Male",
        fatherId: "grandfather",
        motherId: "grandmother",
        spouseIds: [],
      },
      { id: "father", fullName: "Joseph Vella", sex: "Male", spouseIds: [] },
      {
        id: "person",
        fullName: "Maria Vella",
        givenNames: "Maria",
        surname: "Vella",
        surnameAtBirth: "Vella",
        sex: "Female",
        fatherId: "father",
        motherId: "mother",
        spouseIds: [],
      },
      {
        id: "brother",
        fullName: "John Vella",
        sex: "Male",
        fatherId: "father",
        motherId: "mother",
        spouseIds: [],
      },
      { id: "cousin", fullName: "Mark Borg", sex: "Male", fatherId: "uncle", spouseIds: [] },
      { id: "unrelated", fullName: "Luke Galea", sex: "Male", spouseIds: [] },
      { id: "same-sex", fullName: "Anna Mifsud", sex: "Female", spouseIds: [] },
      { id: "unknown-sex", fullName: "Alex Camilleri", sex: "", spouseIds: [] },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="person"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    act(() =>
      [...container.querySelectorAll(".relationship-actions button")]
        .find((button) => button.textContent.includes("Partner"))
        .click(),
    );

    const candidateIds = [
      ...container.querySelector('select[aria-label="Existing partner"]').options,
    ]
      .map((option) => option.value)
      .filter(Boolean);
    expect(candidateIds).toEqual(["unrelated", "cousin"]);
    expect(
      container.querySelector('select[aria-label="Existing partner"] option[value="cousin"]')
        .textContent,
    ).toBe("Mark Borg s/o Paul Borg");
    expect(container.textContent).toContain("cousins and more distant relatives remain available");

    act(() =>
      [...container.querySelectorAll(".relationship-actions button")]
        .find((button) => button.textContent.includes("Wife / husband"))
        .click(),
    );
    const marriageCandidateIds = [
      ...container.querySelector('select[aria-label="Existing partner"]').options,
    ]
      .map((option) => option.value)
      .filter(Boolean);
    expect(marriageCandidateIds).toEqual(["unrelated", "cousin"]);
    expect(container.textContent).toContain("Add a wife or husband");
  });

  it("keeps parent creation buttons but omits father and mother detail selectors", () => {
    const person = {
      id: "person",
      fullName: "Joseph Borg",
      givenNames: "Joseph",
      surname: "Borg",
      surnameAtBirth: "Borg",
      sex: "Male",
      designations: [],
      spouseIds: [],
      siblingIds: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[person]}
          selectedPersonId="person"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const relationshipButtons = [...container.querySelectorAll(".relationship-actions button")].map(
      (button) => button.textContent,
    );
    expect(relationshipButtons.some((text) => text.includes("Father"))).toBe(true);
    expect(relationshipButtons.some((text) => text.includes("Mother"))).toBe(true);
    expect(container.textContent).not.toContain("Succession labels");
    const detailLabels = [
      ...container.querySelectorAll(".inspector-fields > label > span:first-child"),
    ].map((span) => span.textContent);
    expect(detailLabels).not.toContain("Father");
    expect(detailLabels).not.toContain("Mother");
  });

  it("requires an explicit deceased checkbox and omits date of birth", () => {
    const onChange = vi.fn();
    const person = {
      id: "person",
      fullName: "Maria Example",
      sex: "Female",
      surnameAtBirth: "Example",
      designations: [],
      spouseIds: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[person]}
          selectedPersonId="person"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).not.toContain("Date of birth");
    expect(container.querySelector(".person-succession")).toBeNull();
    expect(container.textContent).not.toContain("Succession on death");
    const deceasedCheckbox = [...container.querySelectorAll('input[type="checkbox"]')].find(
      (input) => input.parentElement.textContent.includes("This person is deceased."),
    );
    expect(deceasedCheckbox.disabled).toBe(false);
    expect(deceasedCheckbox.checked).toBe(false);

    act(() => deceasedCheckbox.click());
    expect(onChange.mock.calls[0][0][0]).toMatchObject({
      isDeceased: true,
      designations: ["Deceased"],
    });
  });

  it("records that a deceased person was unmarried or widowed at death", () => {
    const onChange = vi.fn();
    const deceased = {
      id: "deceased",
      fullName: "Joseph Borg",
      givenNames: "Joseph",
      surname: "Borg",
      sex: "Male",
      isDeceased: true,
      dateOfDeath: "2020-01-01",
      inheritanceBasis: "intestacy",
      spouseIds: ["former-spouse"],
      designations: ["Deceased"],
    };
    const formerSpouse = {
      id: "former-spouse",
      fullName: "Maria Borg",
      sex: "Female",
      spouseIds: ["deceased"],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[deceased, formerSpouse]}
          selectedPersonId="deceased"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const maritalStatus = container.querySelector(
      'input[aria-label="No spouse survived the deceased"]',
    );
    expect(maritalStatus).not.toBeNull();
    expect(maritalStatus.checked).toBe(false);
    expect(container.textContent).not.toContain("Set from recorded spouse and death details.");
    expect(container.textContent).not.toContain("No spouse is included in this succession.");

    act(() => maritalStatus.click());
    expect(onChange.mock.calls.at(-1)[0].find((person) => person.id === "deceased")).toMatchObject({
      unmarriedOrWidowedAtDeath: true,
    });

    act(() =>
      root.render(
        <PersonInspector
          people={[{ ...deceased, unmarriedOrWidowedAtDeath: true }, formerSpouse]}
          selectedPersonId="deceased"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    expect(container.textContent).toContain(
      "Maria Borg is excluded from this succession while this setting is selected",
    );
  });

  it("hides spouse-survival controls only for a pre-2005 intestacy with descendants", () => {
    const spouse = {
      id: "spouse",
      fullName: "Maria Borg",
      sex: "Female",
      spouseIds: ["deceased"],
    };
    const child = {
      id: "child",
      fullName: "Paul Borg",
      sex: "Male",
      fatherId: "deceased",
      motherId: "spouse",
      spouseIds: [],
    };
    const renderFor = (dateOfDeath, children = [child]) => {
      const deceased = {
        id: "deceased",
        fullName: "Joseph Borg",
        givenNames: "Joseph",
        surname: "Borg",
        sex: "Male",
        isDeceased: true,
        dateOfDeath,
        inheritanceBasis: "intestacy",
        spouseIds: ["spouse"],
        designations: ["Deceased"],
      };
      act(() =>
        root.render(
          <PersonInspector
            people={[deceased, spouse, ...children]}
            selectedPersonId="deceased"
            onChange={vi.fn()}
            onSelectPerson={vi.fn()}
          />,
        ),
      );
    };

    renderFor("2005-02-28");
    expect(
      container.querySelector('input[aria-label="No spouse survived the deceased"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("Marital status at death");

    renderFor("2005-03-01");
    expect(
      container.querySelector('input[aria-label="No spouse survived the deceased"]'),
    ).not.toBeNull();

    renderFor("2005-02-28", []);
    expect(
      container.querySelector('input[aria-label="No spouse survived the deceased"]'),
    ).not.toBeNull();

    const undatedOwner = {
      id: "deceased",
      fullName: "Joseph Borg",
      givenNames: "Joseph",
      surname: "Borg",
      sex: "Male",
      isDeceased: true,
      dateOfDeath: "2005-02-28",
      inheritanceBasis: "intestacy",
      spouseIds: ["spouse"],
      designations: ["Deceased"],
    };
    const undatedSpouse = { ...spouse, isDeceased: true };
    const undatedChild = { ...child, isDeceased: true };
    const grandchild = {
      id: "grandchild",
      fullName: "Anna Borg",
      sex: "Female",
      fatherId: "child",
      spouseIds: [],
    };
    act(() =>
      root.render(
        <PersonInspector
          people={[undatedOwner, undatedSpouse, undatedChild, grandchild]}
          selectedPersonId="deceased"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    expect(
      container.querySelector('input[aria-label="No spouse survived the deceased"]'),
    ).toBeNull();

    act(() =>
      root.render(
        <PersonInspector
          people={[undatedOwner, undatedSpouse, undatedChild]}
          selectedPersonId="deceased"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );
    expect(
      container.querySelector('input[aria-label="No spouse survived the deceased"]'),
    ).not.toBeNull();
  });

  it("shows recorded co-parents as married without asking for confirmation or a date", () => {
    const onChange = vi.fn();
    const deceased = {
      id: "deceased",
      fullName: "Edgar Wadge",
      givenNames: "Edgar",
      surname: "Wadge",
      sex: "Male",
      isDeceased: true,
      dateOfDeath: "2005-05-20",
      inheritanceBasis: "intestacy",
      designations: ["Deceased"],
    };
    const coParent = {
      id: "co-parent",
      fullName: "Giovanna Wadge",
      givenNames: "Giovanna",
      surname: "Wadge",
      sex: "Female",
    };
    const child = {
      id: "child",
      fullName: "Roland Wadge",
      sex: "Male",
      fatherId: "deceased",
      motherId: "co-parent",
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[deceased, coParent, child]}
          selectedPersonId="deceased"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).not.toContain("Confirm the co-parent relationship");
    expect(container.textContent).not.toContain("Record marriage");
    expect(container.textContent).not.toContain("Marriage date");
    const relationshipType = container.querySelector(
      'select[aria-label="Relationship type with Giovanna Wadge"]',
    );
    expect(relationshipType).not.toBeNull();
    expect(relationshipType.value).toBe("marriage");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("immediately unlocks every succession field when a person is marked deceased", () => {
    let people = [
      {
        id: "person",
        fullName: "Joseph Borg",
        givenNames: "Joseph",
        surname: "Borg",
        surnameAtBirth: "Borg",
        sex: "Male",
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        willDate: "2019-02-03",
        willNotaryName: "Notary Test",
        willNotes: "Test will",
        willHeirs: [
          {
            id: "heir-record",
            personId: "child",
            sharePercent: 100,
          },
        ],
        causaMortisDeclarations: [
          {
            id: "cm-1",
            propertyId: "property",
            date: "2020-02-01",
            notaryName: "Notary Test",
            immovablePropertyValue: "100000",
            declaredShareNumerator: 1,
            declaredShareDenominator: 1,
            declarantPersonIds: ["child"],
          },
        ],
        designations: [],
        spouseIds: [],
      },
      {
        id: "child",
        fullName: "Maria Borg",
        fatherId: "person",
        spouseIds: [],
      },
    ];
    const onChange = vi.fn((nextPeople) => {
      people = nextPeople;
      act(() =>
        root.render(
          <PersonInspector
            people={people}
            properties={[{ id: "property", address: "1 Republic Street" }]}
            selectedPersonId="person"
            onChange={onChange}
            onSelectPerson={vi.fn()}
          />,
        ),
      );
    });

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[{ id: "property", address: "1 Republic Street" }]}
          selectedPersonId="person"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector(".person-succession")).toBeNull();
    const deceasedCheckbox = [...container.querySelectorAll('input[type="checkbox"]')].find(
      (input) => input.parentElement.textContent.includes("This person is deceased."),
    );
    act(() => deceasedCheckbox.click());

    const succession = container.querySelector(".person-succession");
    expect(succession).not.toBeNull();
    expect(succession.querySelector(".succession-detail-row input").value).toBe("01/01/2020");
    expect(
      [...succession.querySelectorAll("input, select, textarea")].filter(
        (control) => control.disabled,
      ),
    ).toEqual([]);
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent.trim() === "Done",
      ),
    ).toBe(true);
  });

  it("shows only the requested personal fields in the requested order", () => {
    const person = {
      id: "person",
      fullName: "Maria Example",
      givenNames: "Maria",
      surname: "Example",
      surnameAtBirth: "Borg",
      sex: "Female",
      designations: [],
      spouseIds: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[person]}
          selectedPersonId="person"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const labels = [
      ...container.querySelectorAll(".inspector-fields > label > span:first-child"),
    ].map((span) => span.textContent);
    expect(labels).toEqual(["Name", "Surname", "Surname at birth"]);
    const statusRows = [...container.querySelectorAll(".person-status-control")];
    expect(statusRows.map((row) => row.firstElementChild.textContent)).toEqual([
      "Sex",
      "Status",
      "Transfer",
    ]);
    expect(
      [...statusRows[0].querySelectorAll('input[type="radio"]')].map(
        (input) => input.parentElement.textContent,
      ),
    ).toEqual(["Female", "Male", "Other"]);
  });

  it("toggles the estimated share between fraction and percentage and derives its value", () => {
    const onShareDisplayChange = vi.fn();
    act(() =>
      root.render(
        <PersonInspector
          people={[
            {
              id: "person",
              fullName: "Maria Example",
              sex: "Female",
              designations: [],
              spouseIds: [],
            },
          ]}
          properties={[{ id: "property", saleValue: "400000" }]}
          ownershipByPerson={{ person: 0.25 }}
          selectedPersonId="person"
          shareDisplay="fraction"
          onShareDisplayChange={onShareDisplayChange}
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector(".person-share-value strong").textContent).toBe("1/4");
    expect(container.querySelector(".person-share-value small").textContent).toContain(
      "€100,000.00",
    );

    const percentageButton = [...container.querySelectorAll(".person-share-toggle button")].find(
      (button) => button.textContent === "Percentage",
    );
    act(() => percentageButton.click());

    expect(container.querySelector(".person-share-value strong").textContent).toBe("25%");
    expect(onShareDisplayChange).toHaveBeenCalledWith("percentage");

    const bothButton = [...container.querySelectorAll(".person-share-toggle button")].find(
      (button) => button.textContent === "Both",
    );
    act(() => bothButton.click());

    expect(container.querySelector(".person-share-value strong").textContent).toBe("1/4 · 25%");
    expect(onShareDisplayChange).toHaveBeenCalledWith("both");
  });

  it("uses one canonical current-owner presentation for a living person's share and value", () => {
    act(() =>
      root.render(
        <PersonInspector
          people={[
            {
              id: "person",
              fullName: "Maria Example",
              sex: "Female",
              designations: [],
              spouseIds: [],
            },
          ]}
          properties={[{ id: "property", saleValue: "1" }]}
          ownershipByPerson={{ person: 0.5 }}
          ownershipFractionsByPerson={{ person: { numerator: 1, denominator: 2 } }}
          currentOwnerPresentationsByPerson={{
            person: {
              id: "person",
              share: 1 / 3,
              shareFraction: { numerator: 1, denominator: 3 },
              percentage: 100 / 3,
              displayPercentageLabel: "33.34%",
              value: 0.34,
            },
          }}
          selectedPersonId="person"
          shareDisplay="both"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector(".person-share-value strong").textContent).toBe("1/3 · 33.34%");
    expect(container.querySelector(".person-share-value small").textContent).toContain("€0.34");
  });

  it("shows an explicitly recorded zero value for a living current owner", () => {
    act(() =>
      root.render(
        <PersonInspector
          people={[
            {
              id: "person",
              fullName: "Maria Example",
              sex: "Female",
              designations: [],
              spouseIds: [],
            },
          ]}
          properties={[{ id: "property", saleValue: 0 }]}
          ownershipByPerson={{ person: 1 }}
          ownershipFractionsByPerson={{ person: { numerator: 1, denominator: 1 } }}
          selectedPersonId="person"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector(".person-share-value small").textContent).toContain("€0.00");
  });

  it("uses a canonical value only when a deceased share at death is still the current share", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Example",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "intestacy",
        designations: ["Deceased"],
        spouseIds: [],
      },
      { id: "second", fullName: "Second Owner", spouseIds: [], designations: [] },
      { id: "third", fullName: "Third Owner", spouseIds: [], designations: [] },
    ];
    const property = {
      id: "property",
      saleValue: 1,
      owners: people.map((person, index) => ({
        id: `initial-${index}`,
        personId: person.id,
        shareNumerator: 1,
        shareDenominator: 3,
      })),
    };
    const renderWithPresentation = (presentation) =>
      act(() =>
        root.render(
          <PersonInspector
            people={people}
            properties={[property]}
            currentOwnerPresentationsByPerson={{ deceased: presentation }}
            selectedPersonId="deceased"
            shareDisplay="both"
            onChange={vi.fn()}
            onSelectPerson={vi.fn()}
          />,
        ),
      );

    renderWithPresentation({
      id: "deceased",
      share: 1 / 3,
      shareFraction: { numerator: 1, denominator: 3 },
      displayPercentageLabel: "33.34%",
      value: 0.34,
    });

    expect(container.querySelector(".person-share-value strong").textContent).toBe("1/3 · 33.34%");
    expect(container.querySelector(".person-share-value small").textContent).toContain("€0.34");

    renderWithPresentation({
      id: "deceased",
      share: 0.1,
      shareFraction: { numerator: 1, denominator: 10 },
      displayPercentageLabel: "10.01%",
      value: 0.1,
    });

    expect(container.querySelector(".person-share-value strong").textContent).toBe("1/3 · 33.33%");
    expect(container.querySelector(".person-share-value small").textContent).toBe(
      "Current value not shown because this is a historical share.",
    );
  });

  it("shows the selected living vendor's calculated Final Withholding Tax", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        willDate: "2019-12-01",
        willHeirs: [{ id: "share", personId: "child", sharePercent: 100 }],
        spouseIds: [],
        causaMortisDeclarations: [
          {
            id: "cm",
            propertyId: "property",
            status: "complete",
            declaredShareNumerator: 1,
            declaredShareDenominator: 1,
            immovablePropertyValue: "100000",
            date: "2020-04-01",
            notaryName: "Maria Notary",
            declarantPersonIds: ["child"],
          },
        ],
      },
      {
        id: "child",
        fullName: "Maria Borg",
        fatherId: "deceased",
        spouseIds: [],
      },
    ];
    const property = {
      id: "property",
      saleValue: "120000",
      owners: [{ personId: "deceased", sharePercent: 100 }],
      transfers: [],
      declarations: [],
      saleLots: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[property]}
          ownershipByPerson={{ child: 1 }}
          selectedPersonId="child"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const tax = container.querySelector(".final-withholding-tax-section");
    expect(tax.textContent).toContain("Final Withholding Tax");
    expect(tax.querySelector("strong").textContent).toBe("€2,400.00");
    expect(tax.querySelector("small").textContent).toContain("recorded source fractions");
  });

  it("asks only a living original owner for an acquisition date and recalculates immediately", () => {
    const people = [{ id: "owner", fullName: "Maria Borg", spouseIds: [] }];
    const initialProperty = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: "250000",
      owners: [
        {
          id: "original-title",
          personId: "owner",
          shareNumerator: 1,
          shareDenominator: 1,
        },
      ],
      transfers: [],
      declarations: [],
      saleLots: [],
    };
    let savedProperty = initialProperty;

    function Harness() {
      const [property, setProperty] = useState(initialProperty);
      const confirmAcquisition = ({ personId, acquisitionDate }) => {
        const result = setLivingInitialOwnerAcquisitionDate(
          property,
          people,
          personId,
          acquisitionDate,
        );
        expect(result.error).toBe("");
        savedProperty = result.property;
        setProperty(result.property);
      };
      return (
        <PersonInspector
          people={people}
          properties={[property]}
          ownershipByPerson={{ owner: 1 }}
          ownershipFractionsByPerson={{ owner: { numerator: 1, denominator: 1 } }}
          selectedPersonId="owner"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onConfirmInitialAcquisition={confirmAcquisition}
        />
      );
    }

    act(() => root.render(<Harness />));

    const tax = container.querySelector(".final-withholding-tax-section");
    expect(tax.querySelector(".fwt-status-row strong").textContent).toBe("Not calculated");
    setInputValue('input[aria-label="Original acquisition date"]', "01012010");
    const confirmButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Confirm date",
    );
    act(() => confirmButton.click());

    expect(savedProperty.owners[0].acquisitionDate).toBe("2010-01-01");
    expect(tax.querySelector(".fwt-status-row strong").textContent).toBe("€20,000.00");
    expect(container.querySelector('input[aria-label="Original acquisition date"]')).toBeNull();
  });

  it("routes an inherited pending fraction to the deceased owner's CM details", () => {
    const onSelectPerson = vi.fn();
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        willDate: "2019-12-01",
        willHeirs: [{ id: "share", personId: "heir", sharePercent: 100 }],
        spouseIds: [],
      },
      { id: "heir", fullName: "Maria Borg", spouseIds: [] },
    ];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: "250000",
      owners: [{ id: "title", personId: "deceased", sharePercent: 100 }],
      transfers: [],
      declarations: [],
      saleLots: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[property]}
          ownershipByPerson={{ heir: 1 }}
          ownershipFractionsByPerson={{ heir: { numerator: 1, denominator: 1 } }}
          selectedPersonId="heir"
          onChange={vi.fn()}
          onSelectPerson={onSelectPerson}
          onConfirmInitialAcquisition={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector('input[aria-label="Original acquisition date"]')).toBeNull();
    const cmButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Open Joseph Borg CM details"),
    );
    expect(cmButton).not.toBeUndefined();
    act(() => cmButton.click());
    expect(onSelectPerson).toHaveBeenCalledWith("deceased");
  });

  it("routes a family recipient's outside provenance source to its outside-owner card", () => {
    const onSelectPerson = vi.fn();
    const onSelectOutsideOwner = vi.fn();
    const people = [{ id: "donee", fullName: "Maria Borg", spouseIds: [] }];
    const outsideParties = [{ id: "company", name: "Harbour Holdings Limited", type: "company" }];
    const property = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: "250000",
      owners: [
        {
          id: "company-title",
          personId: "company",
          shareNumerator: 1,
          shareDenominator: 1,
        },
      ],
      transfers: [
        {
          id: "company-gift",
          kind: "donation",
          sellerId: "company",
          buyerId: "donee",
          numerator: 1,
          denominator: 1,
          amountType: "whole-property",
          date: "2025-01-01",
        },
      ],
      declarations: [],
      saleLots: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          outsideParties={outsideParties}
          properties={[property]}
          ownershipByPerson={{ donee: 1 }}
          ownershipFractionsByPerson={{ donee: { numerator: 1, denominator: 1 } }}
          selectedPersonId="donee"
          onChange={vi.fn()}
          onSelectPerson={onSelectPerson}
          onSelectOutsideOwner={onSelectOutsideOwner}
        />,
      ),
    );

    const sourceButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Open Harbour Holdings Limited original acquisition details"),
    );
    expect(sourceButton).toBeTruthy();
    act(() => sourceButton.click());

    expect(onSelectOutsideOwner).toHaveBeenCalledWith("company");
    expect(onSelectPerson).not.toHaveBeenCalled();
  });

  it("records a donation-time value and recalculates an older donated share immediately", () => {
    let latestProperty;
    const people = [
      { id: "donor", fullName: "Joseph Borg", spouseIds: [] },
      { id: "donee", fullName: "Maria Vella", spouseIds: [] },
    ];
    const initialProperty = {
      id: "property",
      saleDate: "2026-08-13",
      saleValue: "200000",
      owners: [
        {
          id: "original-title",
          personId: "donor",
          sharePercent: 100,
          acquisitionDate: "2000-01-01",
        },
      ],
      transfers: [
        {
          id: "gift",
          kind: "donation",
          sellerId: "donor",
          buyerId: "donee",
          amountType: "seller-holding",
          numerator: 1,
          denominator: 1,
          date: "2010-01-01",
        },
      ],
      declarations: [],
      saleLots: [],
    };

    function Harness() {
      const [property, setProperty] = useState(initialProperty);
      latestProperty = property;
      const confirmDonationValue = ({ personId, row, acquisitionValue, acquisitionValueBasis }) => {
        const result = setDonationAcquisitionValue(
          property,
          personId,
          row.sourceTransferId,
          acquisitionValue,
          acquisitionValueBasis,
        );
        expect(result.error).toBe("");
        setProperty(result.property);
      };
      return (
        <PersonInspector
          people={people}
          properties={[property]}
          ownershipByPerson={{ donee: 1 }}
          ownershipFractionsByPerson={{ donee: { numerator: 1, denominator: 1 } }}
          selectedPersonId="donee"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onConfirmDonationAcquisitionValue={confirmDonationValue}
        />
      );
    }

    act(() => root.render(<Harness />));

    const tax = container.querySelector(".final-withholding-tax-section");
    expect(tax.querySelector(".fwt-status-row strong").textContent).toBe("Not calculated");
    setInputValue('input[aria-label="Donation Value"]', "100000");
    const confirmButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Confirm value",
    );
    act(() => confirmButton.click());

    expect(tax.querySelector(".fwt-status-row strong").textContent).toBe("€12,000.00");
    expect(container.querySelector('input[aria-label="Donation Value"]')).toBeNull();
    expect(latestProperty.transfers[0]).toMatchObject({
      acquisitionValue: 100000,
      acquisitionValueBasis: "deed-value",
    });
  });

  it("shows succession fields only for a deceased person", () => {
    const person = {
      id: "person",
      fullName: "Maria Example",
      isDeceased: true,
      dateOfDeath: "2024-02-03",
      inheritanceBasis: "intestacy",
      designations: ["Deceased"],
      spouseIds: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[person]}
          selectedPersonId="person"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector(".person-succession")).not.toBeNull();
    expect(container.querySelector(".succession-detail-row input").value).toBe("03/02/2024");
    expect(container.querySelector(".succession-detail-row input").disabled).toBe(false);
    expect(container.querySelector('select[aria-label="Inheritance basis"]').disabled).toBe(false);
    expect(container.textContent).not.toContain("Succession on death");
    expect(container.textContent).toContain("Intestate");
  });

  it("uses proposed intestate heirs automatically and lets edited shares override them", () => {
    let latestPeople = [];
    const initialPeople = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2024-02-03",
        inheritanceBasis: "intestacy",
        designations: ["Deceased"],
        spouseIds: ["spouse"],
      },
      {
        id: "spouse",
        fullName: "Maria Borg",
        spouseIds: ["deceased"],
        designations: [],
      },
      {
        id: "child",
        fullName: "Paul Borg",
        fatherId: "deceased",
        motherId: "spouse",
        spouseIds: [],
        designations: [],
      },
    ];
    function Harness() {
      const [people, setPeople] = useState(initialPeople);
      latestPeople = people;
      return (
        <PersonInspector
          people={people}
          selectedPersonId="deceased"
          shareDisplay="fraction"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));

    expect(container.textContent).toContain("Beneficiaries");
    expect(container.textContent).toContain("Calculated beneficiaries");
    expect(container.textContent).toContain("1/2");

    const editBeneficiaries = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Edit Beneficiaries"),
    );
    act(() => editBeneficiaries.click());

    expect(latestPeople[0].intestateHeirs).toBeUndefined();
    expect(container.querySelectorAll(".confirmed-heir-row")).toHaveLength(2);
    expect(container.querySelectorAll(".confirmed-heir-fraction")).toHaveLength(2);
    expect(container.querySelectorAll(".confirmed-heir-percent")).toHaveLength(0);

    const cancel = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Cancel",
    );
    act(() => cancel.click());
    expect(latestPeople[0].intestateHeirs).toBeUndefined();
    expect(container.querySelectorAll(".confirmed-heir-row")).toHaveLength(0);
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Edit Beneficiaries"))
        .click(),
    );

    const setNumberInput = (input, value) => {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    let childDenominator = container.querySelector(
      'input[aria-label="Share denominator for Paul Borg"]',
    );
    setNumberInput(childDenominator, "");
    childDenominator = container.querySelector(
      'input[aria-label="Share denominator for Paul Borg"]',
    );
    expect(childDenominator.value).toBe("");

    setNumberInput(childDenominator, "4");
    expect(latestPeople[0].intestateHeirs).toBeUndefined();
    expect(
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent.includes("Apply edited beneficiaries"),
      ).disabled,
    ).toBe(true);

    const childNumerator = container.querySelector(
      'input[aria-label="Share numerator for Paul Borg"]',
    );
    setNumberInput(childNumerator, "2");
    expect(latestPeople[0].intestateHeirs).toBeUndefined();

    const percentageButton = [...container.querySelectorAll(".person-share-toggle button")].find(
      (button) => button.textContent === "Percentage",
    );
    act(() => percentageButton.click());
    expect(container.textContent).toContain("50%");
    expect(container.querySelectorAll(".confirmed-heir-fraction")).toHaveLength(0);
    expect(container.querySelectorAll(".confirmed-heir-percent")).toHaveLength(2);

    const childPercentage = container.querySelector(
      'input[aria-label="Share percentage for Paul Borg"]',
    );
    setNumberInput(childPercentage, "45");
    expect(latestPeople[0].intestateHeirs).toBeUndefined();
    setNumberInput(
      container.querySelector('input[aria-label="Share percentage for Paul Borg"]'),
      "50",
    );

    const applyEdited = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Apply edited beneficiaries"),
    );
    expect(applyEdited.disabled).toBe(false);
    act(() => applyEdited.click());

    expect(latestPeople[0].intestateHeirsConfirmed).toBe(true);
    expect(latestPeople[0].intestateConfirmationBasis).toMatch(/^v3::/);
    expect(latestPeople[0].intestateHeirs.map((heir) => heir.sharePercent)).toEqual([50, 50]);
    expect(container.textContent).toContain("Edited beneficiaries active");

    setNumberInput(container.querySelector(".succession-detail-row input"), "04/02/2024");
    expect(latestPeople[0].dateOfDeath).toBe("2024-02-04");
    expect(container.textContent).toContain(
      "saved against an earlier death date or family context",
    );
    expect(container.textContent).toContain("Edited beneficiaries require review");

    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Use automatic calculation")
        .click(),
    );
    expect(latestPeople[0]).toMatchObject({
      intestateHeirs: [],
      intestateHeirsConfirmed: false,
      intestateConfirmationBasis: "",
    });
  });

  it("warns when an edited heir row points to a deleted person", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2024-02-03",
        inheritanceBasis: "intestacy",
        designations: ["Deceased"],
        spouseIds: [],
        intestateHeirs: [{ id: "missing-row", personId: "missing", sharePercent: 100 }],
      },
      {
        id: "child",
        fullName: "Paul Borg",
        fatherId: "deceased",
        spouseIds: [],
        designations: [],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="deceased"
          shareDisplay="percentage"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).toContain("no longer on the family tree");
    expect(container.textContent).toContain("automatic proposal remains in force");
  });

  it("allows a deceased linked partner's death date to be completed in the succession workflow", () => {
    const onChange = vi.fn();
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2024-02-03",
        inheritanceBasis: "intestacy",
        designations: ["Deceased"],
        spouseIds: ["spouse"],
      },
      {
        id: "spouse",
        fullName: "Maria Borg",
        isDeceased: true,
        dateOfDeath: "",
        spouseIds: ["deceased"],
        designations: ["Deceased"],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="deceased"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const spouseDeathDate = container.querySelector(
      'input[aria-label="Date of death for Maria Borg"]',
    );
    expect(spouseDeathDate).not.toBeNull();
    expect(container.textContent).toContain("Enter missing spouse death dates");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        spouseDeathDate,
        "2025-01-01",
      );
      spouseDeathDate.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange.mock.calls.at(-1)[0][1].dateOfDeath).toBe("2025-01-01");
  });

  it("treats an undated spouse as optional for a pre-2005 intestacy with descendants", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2005-02-28",
        inheritanceBasis: "intestacy",
        designations: ["Deceased"],
        spouseIds: ["spouse"],
      },
      {
        id: "spouse",
        fullName: "Maria Borg",
        isDeceased: true,
        dateOfDeath: "",
        spouseIds: ["deceased"],
        designations: ["Deceased"],
      },
      {
        id: "child",
        fullName: "Paul Borg",
        fatherId: "deceased",
        motherId: "spouse",
        spouseIds: [],
        designations: [],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="deceased"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector('input[aria-label="Date of death for Maria Borg"]')).toBeNull();
    expect(container.textContent).not.toContain("Spouses at the date of death");
    expect(container.textContent).not.toContain("Enter missing spouse death dates");
  });

  it("prefills a man's surname at birth from his full name", () => {
    const person = {
      id: "person",
      fullName: "Joseph Borg",
      surnameAtBirth: "",
      sex: "Male",
      designations: [],
      spouseIds: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[person]}
          selectedPersonId="person"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const surnameLabel = [...container.querySelectorAll("label")].find((label) =>
      label.textContent.includes("Surname at birth"),
    );
    expect(surnameLabel.querySelector("input").value).toBe("Borg");
  });

  it("edits names and surname separately while keeping the full display name synchronized", () => {
    const onChange = vi.fn();
    const person = {
      id: "person",
      fullName: "Maria Borg",
      designations: [],
      spouseIds: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[person]}
          selectedPersonId="person"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    beginEditing();
    const namesInput = [...container.querySelectorAll("label")]
      .find((label) => label.querySelector(":scope > span")?.textContent === "Name")
      .querySelector("input");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        namesInput,
        "Maria Anna",
      );
      namesInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    leaveInput(namesInput);
    expect(onChange.mock.calls.at(-1)[0][0]).toMatchObject({
      givenNames: "Maria Anna",
      fullName: "Maria Anna Borg",
    });
  });

  it("blocks adding relatives until the selected person is identified", () => {
    const onChange = vi.fn();
    const person = {
      id: "person",
      givenNames: "",
      surname: "",
      fullName: "",
      surnameAtBirth: "",
      sex: "Female",
      designations: [],
      spouseIds: [],
      siblingIds: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[person]}
          selectedPersonId="person"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const relationshipButtons = [...container.querySelectorAll(".relationship-actions button")];
    expect(relationshipButtons.every((button) => button.disabled)).toBe(true);
    expect(container.textContent).toContain(
      "Identify this person first: Names, Surname, Surname at birth.",
    );
    act(() => relationshipButtons[0].click());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows testate notes and post-1992 causa mortis fields", () => {
    const deceased = {
      id: "deceased",
      fullName: "Joseph Borg",
      sex: "Male",
      isDeceased: true,
      dateOfDeath: "2020-01-01",
      inheritanceBasis: "will",
      willHeirs: [
        {
          id: "heir-record",
          personId: "child",
          sharePercent: 100,
        },
      ],
      causaMortisDeclarations: [
        {
          id: "cm-1",
          status: "draft",
          date: "",
          notaryName: "",
          immovablePropertyValue: "",
          declarantPersonIds: ["child"],
        },
      ],
      designations: ["Deceased"],
      spouseIds: [],
      siblingIds: [],
    };
    const child = {
      id: "child",
      fullName: "Maria Borg",
      sex: "Female",
      surnameAtBirth: "Borg",
      fatherId: "deceased",
      designations: [],
      spouseIds: [],
      siblingIds: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[deceased, child]}
          properties={[
            {
              id: "property-1",
              address: "1 Republic Street",
              saleValue: 240000,
            },
          ]}
          causaMortisCoverage={[
            {
              personId: "deceased",
              propertyId: "property-1",
              propertyAddress: "1 Republic Street",
              requiredShare: 0.5,
              declaredShare: 0,
              difference: -0.5,
              status: "under",
            },
          ]}
          selectedPersonId="deceased"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).toContain("Testate");
    expect(container.textContent).toContain("Add will");
    expect(container.textContent).toContain("The latest dated will applies");
    expect(container.textContent).toContain("Notary (optional)");
    expect(container.textContent).toContain("Description (optional)");
    expect(container.textContent).toContain("Suggested Heirs");
    expect(container.textContent).toContain("Confirm Heirs?");
    expect(container.textContent).not.toContain("Will notes");
    expect(container.textContent).toContain("Causa Mortis");
    expect(container.textContent).toContain("Date of Declaration Causa Mortis");
    expect(container.textContent).toContain("Declarants / heirs");
    expect(container.textContent).toContain("Required 1/2");
    expect(container.textContent).toContain("Required share of selling price €120,000.00");
    expect(container.textContent).toContain("Missing 1/2");
    expect(container.textContent).not.toContain("1 Republic Street");
    expect(container.textContent).toContain("Declaration Causa Mortis 1");
    expect(container.textContent).not.toContain("Draft");
    expect(container.textContent).toContain("Notary");
    expect(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent.trim() === "OK",
      ),
    ).not.toBeNull();
    expect(
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent.includes("Insert CM Declaration"),
      ).disabled,
    ).toBe(false);
    expect(container.querySelector('select[aria-label="Property declared causa mortis 1"]')).toBe(
      null,
    );
    const valueInput = container.querySelector(
      'input[aria-label="Immovable property value declared causa mortis 1"]',
    );
    expect(valueInput.required).toBe(false);
    expect(valueInput.closest("label").textContent).toContain("Value declared (optional)");
    const declarant = [...container.querySelectorAll(".causa-mortis-declarants label")].find(
      (label) => label.textContent.includes("Maria Borg"),
    );
    expect(declarant.querySelector("input").checked).toBe(true);
  });

  it("adds multiple wills and marks the latest dated will as operative", () => {
    let latestPeople = [];
    const initialPeople = [
      {
        id: "paul",
        fullName: "Paul Farrugia",
        sex: "Male",
        isDeceased: true,
        dateOfDeath: "2017-01-04",
        inheritanceBasis: "will",
        wills: [{ id: "english", date: "1981-10-15", notaryName: "" }],
        willHeirs: [],
        designations: ["Deceased"],
        spouseIds: [],
      },
    ];

    function Harness() {
      const [people, setPeople] = useState(initialPeople);
      latestPeople = people;
      return (
        <PersonInspector
          people={people}
          selectedPersonId="paul"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));
    const addWillButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Add will",
    );
    act(() => addWillButton.click());

    expect(latestPeople[0].wills).toHaveLength(2);
    expect(container.querySelectorAll(".will-record")).toHaveLength(2);

    const secondWillDate = container.querySelector('input[aria-label="Will date 2"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        secondWillDate,
        "27/01/1997",
      );
      secondWillDate.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(latestPeople[0].willDate).toBe("1997-01-27");
    expect(container.textContent).toContain("Latest — applies");

    const secondWillDescription = container.querySelector(
      'input[aria-label="Description for will 2"]',
    );
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        secondWillDescription,
        "UK will",
      );
      secondWillDescription.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(latestPeople[0].wills[1].description).toBe("");
    leaveInput(secondWillDescription);
    expect(latestPeople[0].wills[1].description).toBe("UK will");
  });

  it("suppresses causa mortis forms for a death before 25 November 1992", () => {
    const deceased = {
      id: "deceased",
      fullName: "Joseph Borg",
      sex: "Male",
      isDeceased: true,
      dateOfDeath: "1992-11-24",
      inheritanceBasis: "intestacy",
      causaMortisDeclarations: [
        {
          id: "legacy-cm",
          status: "draft",
          declarantPersonIds: ["child"],
        },
      ],
      designations: ["Deceased"],
      spouseIds: [],
      siblingIds: [],
    };
    const child = {
      id: "child",
      fullName: "Maria Borg",
      fatherId: "deceased",
      spouseIds: [],
      siblingIds: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[deceased, child]}
          properties={[{ id: "property-1", address: "1 Republic Street" }]}
          causaMortisCoverage={[]}
          selectedPersonId="deceased"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).toContain(
      "No Causa Mortis declaration: death before 25/11/1992.",
    );
    expect(container.textContent).toContain("taxed at 7%");
    expect(container.querySelector(".causa-mortis-records")).toBeNull();
    expect(
      container.querySelector('input[aria-label="Date of Declaration Causa Mortis 1"]'),
    ).toBeNull();
  });

  it("allows a causa mortis declaration when the death occurred on 25 November 1992", () => {
    const deceased = {
      id: "deceased",
      fullName: "Joseph Borg",
      sex: "Male",
      isDeceased: true,
      dateOfDeath: "1992-11-25",
      inheritanceBasis: "intestacy",
      causaMortisDeclarations: [],
      designations: ["Deceased"],
      spouseIds: [],
      siblingIds: [],
    };
    const child = {
      id: "child",
      fullName: "Maria Borg",
      fatherId: "deceased",
      spouseIds: [],
      siblingIds: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[deceased, child]}
          properties={[{ id: "property-1", address: "1 Republic Street" }]}
          causaMortisCoverage={[
            {
              personId: "deceased",
              propertyId: "property-1",
              propertyAddress: "1 Republic Street",
              requiredShare: 1,
              declaredShare: 0,
              difference: -1,
              status: "under",
            },
          ]}
          selectedPersonId="deceased"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector(".causa-mortis-records")).not.toBeNull();
    expect(container.textContent).toContain("Causa Mortis");
  });

  it("confirms suggested heirs for a testate estate and allows editable will fractions", () => {
    let latestPeople = [];
    const initialPeople = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        sex: "Male",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        willHeirs: [],
        designations: ["Deceased"],
        spouseIds: ["spouse"],
        siblingIds: [],
      },
      {
        id: "spouse",
        fullName: "Maria Borg",
        sex: "Female",
        spouseIds: ["deceased"],
        designations: [],
      },
      {
        id: "child",
        fullName: "Paul Borg",
        sex: "Male",
        fatherId: "deceased",
        motherId: "spouse",
        spouseIds: [],
        designations: [],
      },
    ];

    function Harness() {
      const [people, setPeople] = useState(initialPeople);
      latestPeople = people;
      return (
        <PersonInspector
          people={people}
          selectedPersonId="deceased"
          shareDisplay="fraction"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));

    expect(container.textContent).toContain("Suggested Heirs");
    expect(container.textContent).toContain("Maria Borg");
    expect(container.textContent).toContain("Paul Borg");
    expect(container.textContent).toContain("1/2");

    const confirmHeirs = container.querySelector('input[aria-label="Confirm Heirs?"]');
    expect(confirmHeirs.checked).toBe(false);
    act(() => confirmHeirs.click());

    expect(latestPeople[0].willHeirs).toHaveLength(2);
    expect(latestPeople[0].willHeirs.map((heir) => heir.sharePercent)).toEqual([50, 50]);
    expect(latestPeople[0]).toMatchObject({
      willHeirsConfirmed: true,
      willHeirsConfirmationSource: "suggested",
    });
    expect(container.querySelector('input[aria-label="Confirm Heirs?"]').checked).toBe(true);
    expect(container.querySelectorAll(".will-heir-fraction")).toHaveLength(2);
    expect(container.querySelectorAll(".will-heir-percent")).toHaveLength(0);

    const denominator = container.querySelectorAll('input[aria-label="Will share denominator"]')[1];
    const setNumberInput = (input, value) => {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    setNumberInput(denominator, "");

    const updatedDenominator = container.querySelectorAll(
      'input[aria-label="Will share denominator"]',
    )[1];
    expect(updatedDenominator.value).toBe("");

    setNumberInput(updatedDenominator, "4");
    expect(latestPeople[0].willHeirs[1].sharePercent).toBe(50);
    leaveInput(updatedDenominator);
    expect(latestPeople[0].willHeirs[1].sharePercent).toBe(25);

    act(() => container.querySelector('input[aria-label="Confirm Heirs?"]').click());
    expect(latestPeople[0].willHeirs).toEqual([]);
    expect(latestPeople[0].willHeirsConfirmed).toBe(false);
    expect(latestPeople[0].willHeirsConfirmationSource).toBe("");
  });

  it("shows exact will thirds as reconciled two-decimal percentage boxes", () => {
    let latestPeople = [];
    const heirs = ["first", "second", "third"].map((id) => ({
      id,
      fullName: `${id} heir`,
      sex: "",
      spouseIds: [],
      designations: [],
    }));
    const initialPeople = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        sex: "Male",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        willHeirsConfirmed: true,
        willHeirsConfirmationSource: "manual",
        willHeirs: heirs.map((heir, index) => ({
          id: `will-${index}`,
          personId: heir.id,
          sharePercent: 100 / 3,
          shareNumerator: 1,
          shareDenominator: 3,
          sharePercentInput: "33.3333333333333",
        })),
        designations: ["Deceased"],
        spouseIds: [],
        siblingIds: [],
      },
      ...heirs,
    ];

    function Harness() {
      const [people, setPeople] = useState(initialPeople);
      latestPeople = people;
      return (
        <PersonInspector
          people={people}
          selectedPersonId="deceased"
          shareDisplay="percentage"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));

    let percentageInputs = [
      ...container.querySelectorAll('input[aria-label="Will share percentage"]'),
    ];
    expect(percentageInputs.map((input) => input.value)).toEqual(["33.34", "33.33", "33.33"]);
    expect(percentageInputs.reduce((total, input) => total + Number(input.value), 0)).toBe(100);
    percentageInputs.forEach((input) => {
      expect(input.step).toBe("0.01");
      expect(input.inputMode).toBe("decimal");
    });
    act(() => {
      percentageInputs[0].focus();
      percentageInputs[0].blur();
    });
    expect(
      latestPeople[0].willHeirs.map(({ shareNumerator, shareDenominator }) => ({
        numerator: shareNumerator,
        denominator: shareDenominator,
      })),
    ).toEqual([
      { numerator: 1, denominator: 3 },
      { numerator: 1, denominator: 3 },
      { numerator: 1, denominator: 3 },
    ]);
    expect(latestPeople[0].willHeirs[0].sharePercentInput).toBeUndefined();

    percentageInputs = [...container.querySelectorAll('input[aria-label="Will share percentage"]')];
    const firstPercentage = percentageInputs[0];
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        firstPercentage,
        "33.335",
      );
      firstPercentage.dispatchEvent(new Event("input", { bubbles: true }));
    });
    percentageInputs = [...container.querySelectorAll('input[aria-label="Will share percentage"]')];
    act(() => {
      percentageInputs[0].focus();
      percentageInputs[0].blur();
    });
    expect(container.querySelectorAll('input[aria-label="Will share percentage"]')[0].value).toBe(
      "33.34",
    );
    expect(
      [...container.querySelectorAll(".succession-total")]
        .find((label) => label.textContent.includes("Total:"))
        .textContent.replace(/\s+/g, " "),
    ).toContain("Total: 100.01% — must equal 100%");
  });

  it("selects the calculated heirs when adding a causa mortis declaration", () => {
    const onChange = vi.fn();
    const deceased = {
      id: "deceased",
      fullName: "Joseph Borg",
      sex: "Male",
      isDeceased: true,
      dateOfDeath: "2020-01-01",
      inheritanceBasis: "intestacy",
      designations: ["Deceased"],
      spouseIds: [],
      siblingIds: [],
    };
    const child = {
      id: "child",
      fullName: "Maria Borg",
      fatherId: "deceased",
      designations: [],
      spouseIds: [],
      siblingIds: [],
    };
    const grandchild = {
      id: "grandchild",
      fullName: "Paul Borg",
      motherId: "child",
      designations: [],
      spouseIds: [],
      siblingIds: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[deceased, child, grandchild]}
          properties={[{ id: "property-1", address: "1 Republic Street" }]}
          causaMortisCoverage={[
            {
              personId: "deceased",
              propertyId: "property-1",
              propertyAddress: "1 Republic Street",
              requiredShare: 0.5,
              declaredShare: 0,
              difference: -0.5,
              status: "under",
            },
          ]}
          selectedPersonId="deceased"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const addButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Insert CM Declaration"),
    );
    beginEditing();
    act(() => addButton.click());
    expect(onChange.mock.calls.at(-1)[0][0].causaMortisDeclarations[0]).toMatchObject({
      status: "draft",
      propertyId: "property-1",
      declaredShareNumerator: 1,
      declaredShareDenominator: 2,
      declarantPersonIds: ["child"],
    });
  });

  it("allows a known causa mortis deed to be recorded before ownership is assigned", () => {
    const onChange = vi.fn();
    const deceased = {
      id: "deceased",
      fullName: "Paul Farrugia",
      sex: "Male",
      isDeceased: true,
      dateOfDeath: "2017-01-04",
      inheritanceBasis: "will",
      wills: [{ id: "will", date: "1997-01-27", notaryName: "Paul Pullicino" }],
      willHeirs: [],
      causaMortisDeclarations: [],
      designations: ["Deceased"],
      spouseIds: [],
      siblingIds: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[deceased]}
          properties={[{ id: "property-1", address: "1 Republic Street" }]}
          causaMortisCoverage={[]}
          selectedPersonId="deceased"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const addButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Insert CM Declaration"),
    );
    expect(addButton.disabled).toBe(false);
    expect(addButton.title).toContain("first Declaration Causa Mortis");

    act(() => addButton.click());
    expect(onChange.mock.calls.at(-1)[0][0].causaMortisDeclarations[0]).toMatchObject({
      status: "draft",
      propertyId: "property-1",
      declaredShareNumerator: 0,
      declaredShareDenominator: 1,
      declarantPersonIds: [],
    });
  });

  it("keeps the first CM declaration available after intestate beneficiaries change", () => {
    const onChange = vi.fn();
    const deceased = {
      id: "nathalie",
      fullName: "Nathalie Vella",
      sex: "Female",
      isDeceased: true,
      dateOfDeath: "2020-11-04",
      inheritanceBasis: "intestacy",
      intestateHeirs: [
        {
          id: "edited-heir",
          personId: "beneficiary",
          sharePercent: 100,
          shareNumerator: 1,
          shareDenominator: 1,
        },
      ],
      intestateHeirsConfirmed: false,
      causaMortisDeclarations: [],
      designations: ["Deceased"],
      spouseIds: [],
      siblingIds: [],
    };
    const beneficiary = {
      id: "beneficiary",
      fullName: "Maria Vella",
      sex: "Female",
      spouseIds: [],
      siblingIds: [],
      designations: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[deceased, beneficiary]}
          properties={[{ id: "property-1", address: "1 Republic Street" }]}
          causaMortisCoverage={[
            {
              personId: "nathalie",
              propertyId: "property-1",
              propertyAddress: "1 Republic Street",
              requiredShare: 0,
              declaredShare: 0,
              difference: 0,
              status: "complete",
            },
          ]}
          selectedPersonId="nathalie"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const addButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Insert CM Declaration"),
    );
    expect(addButton.disabled).toBe(false);

    act(() => addButton.click());
    expect(onChange.mock.calls.at(-1)[0][0].causaMortisDeclarations).toHaveLength(1);
  });

  it("counts a declaration only after OK and keeps every additional draft visible", () => {
    const property = { id: "property-1", address: "1 Republic Street" };
    let latestPeople = [];
    const initialPeople = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        sex: "Male",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        willHeirs: [{ id: "heir-record", personId: "child", sharePercent: 100 }],
        causaMortisDeclarations: [],
        designations: ["Deceased"],
        spouseIds: [],
        siblingIds: [],
      },
      {
        id: "child",
        fullName: "Maria Borg",
        sex: "Female",
        surnameAtBirth: "Borg",
        fatherId: "deceased",
        designations: [],
        spouseIds: [],
        siblingIds: [],
      },
    ];

    function Harness() {
      const [people, setPeople] = useState(initialPeople);
      latestPeople = people;
      const completedShare = completedCausaMortisShare(people[0]);
      const requiredShare = 0.5;
      const difference = completedShare - requiredShare;
      return (
        <PersonInspector
          people={people}
          properties={[property]}
          causaMortisCoverage={[
            {
              personId: "deceased",
              propertyId: property.id,
              propertyAddress: property.address,
              requiredShare,
              declaredShare: completedShare,
              difference,
              status: causaMortisCoverageStatus(completedShare, requiredShare),
            },
          ]}
          selectedPersonId="deceased"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));

    const declarationActionButton = () =>
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent.includes("CM Declaration"),
      );
    act(() => declarationActionButton().click());
    expect(declarationActionButton().textContent).toContain("Insert CM Declaration");
    expect(container.textContent).toContain("Required 1/2");
    expect(container.textContent).toContain("Missing 1/2");
    expect(container.textContent).not.toContain("Declared 0/1");
    expect(container.querySelector(".causa-mortis-card")).not.toBeNull();

    setInputValue('input[aria-label="Causa mortis share numerator 1"]', "1");
    setInputValue('input[aria-label="Causa mortis share denominator 1"]', "4");
    setInputValue('input[aria-label="Date of Declaration Causa Mortis 1"]', "2020-01-01");
    setInputValue('input[aria-label="Notary for Declaration Causa Mortis 1"]', "Dr Maria Vella");
    setInputValue('input[aria-label="Immovable property value declared causa mortis 1"]', "100000");

    const okButton = () =>
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent.trim() === "OK" && !button.disabled,
      );
    act(() => okButton().click());
    expect(container.textContent).toContain(
      "Declaration causa mortis date must be after the date of death.",
    );

    setInputValue('input[aria-label="Date of Declaration Causa Mortis 1"]', "2020-06-01");
    act(() => okButton().click());

    expect(container.textContent).toContain("Missing 1/4");
    expect(container.textContent).not.toContain("Declared 1/4");
    expect(declarationActionButton().disabled).toBe(false);
    expect(declarationActionButton().textContent).toContain("Insert CM Declaration");
    expect(container.textContent).not.toContain("Completed");

    act(() => declarationActionButton().click());
    expect(declarationActionButton().textContent).toContain("Insert CM Declaration");

    setInputValue('input[aria-label="Date of Declaration Causa Mortis 2"]', "2021-04-02");
    setInputValue('input[aria-label="Notary for Declaration Causa Mortis 2"]', "Dr Paul Galea");
    setInputValue('input[aria-label="Immovable property value declared causa mortis 2"]', "110000");
    act(() => okButton().click());

    expect(container.textContent).toContain("Declared 1/2");
    expect(declarationActionButton().disabled).toBe(false);
    expect(declarationActionButton().textContent).toContain("Insert CM Declaration");
    expect(declarationActionButton().title).toContain("another Declaration Causa Mortis");

    act(() => declarationActionButton().click());
    expect(declarationActionButton().textContent).toContain("Insert CM Declaration");
    expect(container.textContent).toContain("Declaration Causa Mortis 3");
    expect(latestPeople[0].causaMortisDeclarations).toHaveLength(3);
    expect(container.textContent).toContain("Declaration Causa Mortis 1");
    expect(container.textContent).toContain("Declaration Causa Mortis 2");
  });

  it("edits a completed causa mortis declaration without changing it before Save", () => {
    const onChange = vi.fn();
    const completedDeclaration = {
      id: "cm-1",
      propertyId: "property-1",
      declaredShareNumerator: "1",
      declaredShareDenominator: "2",
      date: "2021-02-03",
      notaryName: "Maria Vella",
      immovablePropertyValue: "",
      declarantPersonIds: ["child"],
      status: "complete",
    };
    const peopleWithDeclaration = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        sex: "Male",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        willHeirs: [{ id: "heir-record", personId: "child", sharePercent: 100 }],
        causaMortisDeclarations: [completedDeclaration],
        designations: ["Deceased"],
        spouseIds: [],
        siblingIds: [],
      },
      {
        id: "child",
        fullName: "Maria Borg",
        sex: "Female",
        surnameAtBirth: "Borg",
        fatherId: "deceased",
        designations: [],
        spouseIds: [],
        siblingIds: [],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={peopleWithDeclaration}
          properties={[{ id: "property-1", address: "1 Republic Street" }]}
          causaMortisCoverage={[
            {
              personId: "deceased",
              propertyId: "property-1",
              requiredShare: 0.5,
              declaredShare: 0.5,
              status: "complete",
            },
          ]}
          selectedPersonId="deceased"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const edit = container.querySelector('button[aria-label="Edit Declaration Causa Mortis 1"]');
    expect(edit).not.toBeNull();
    expect(container.textContent).not.toContain("€0.00");
    expect(
      container.querySelector('input[aria-label="Notary for Declaration Causa Mortis 1"]'),
    ).toBeNull();

    act(() =>
      container.querySelector('button[aria-label="Edit Declaration Causa Mortis 1"]').click(),
    );
    const optionalValue = container.querySelector(
      'input[aria-label="Immovable property value declared causa mortis 1"]',
    );
    expect(optionalValue.required).toBe(false);
    expect(optionalValue.closest("label").textContent).toContain("Value declared (optional)");
    setInputValue('input[aria-label="Notary for Declaration Causa Mortis 1"]', "Paul Galea");
    expect(onChange).not.toHaveBeenCalled();

    const cancel = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Cancel",
    );
    act(() => cancel.click());
    expect(onChange).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Maria Vella");
    expect(container.textContent).not.toContain("Paul Galea");

    act(() =>
      container.querySelector('button[aria-label="Edit Declaration Causa Mortis 1"]').click(),
    );
    setInputValue('input[aria-label="Notary for Declaration Causa Mortis 1"]', "Paul Galea");
    const save = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Save declaration",
    );
    act(() => save.click());

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0].causaMortisDeclarations).toEqual([
      expect.objectContaining({
        id: "cm-1",
        status: "complete",
        notaryName: "Paul Galea",
        declaredShareNumerator: "1",
        declaredShareDenominator: "2",
        declarantPersonIds: ["child"],
      }),
    ]);
  });

  it("keeps a previously saved CM draft when Cancel is pressed", () => {
    const onChange = vi.fn();
    const draftDeclaration = {
      id: "cm-draft",
      propertyId: "property-1",
      declaredShareNumerator: "1",
      declaredShareDenominator: "4",
      date: "",
      notaryName: "Draft Notary",
      immovablePropertyValue: "",
      declarantPersonIds: ["child"],
      status: "draft",
    };
    const draftPeople = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "will",
        willHeirs: [{ id: "heir", personId: "child", sharePercent: 100 }],
        causaMortisDeclarations: [draftDeclaration],
        designations: ["Deceased"],
        spouseIds: [],
      },
      { id: "child", fullName: "Maria Borg", fatherId: "deceased", spouseIds: [] },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={draftPeople}
          properties={[{ id: "property-1", address: "1 Republic Street" }]}
          selectedPersonId="deceased"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    setInputValue('input[aria-label="Notary for Declaration Causa Mortis 1"]', "Changed Notary");
    const cancel = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Cancel",
    );
    act(() => cancel.click());

    expect(onChange).not.toHaveBeenCalled();
    expect(
      container.querySelector('input[aria-label="Notary for Declaration Causa Mortis 1"]').value,
    ).toBe("Draft Notary");
    expect(container.textContent).toContain("Declaration Causa Mortis 1");
  });

  it("keeps excess CM coverage out of the summary while allowing another declaration", () => {
    const property = { id: "property-1", address: "Unnamed property" };
    let latestPeople = [];
    const initialPeople = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        sex: "Male",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "intestacy",
        causaMortisDeclarations: [
          {
            id: "cm-1",
            status: "complete",
            propertyId: property.id,
            declaredShareNumerator: 103,
            declaredShareDenominator: 360,
            date: "2021-01-01",
            notaryName: "Maria Vella",
            immovablePropertyValue: "34000",
            declarantPersonIds: ["child"],
          },
        ],
        designations: ["Deceased"],
        spouseIds: [],
        siblingIds: [],
      },
      {
        id: "child",
        fullName: "Maria Borg",
        sex: "Female",
        fatherId: "deceased",
        designations: [],
        spouseIds: [],
        siblingIds: [],
      },
    ];

    function Harness() {
      const [people, setPeople] = useState(initialPeople);
      latestPeople = people;
      const completedShare = completedCausaMortisShare(people[0]);
      const requiredShare = 11 / 45;
      const difference = completedShare - requiredShare;
      return (
        <PersonInspector
          people={people}
          properties={[property]}
          causaMortisCoverage={[
            {
              personId: "deceased",
              propertyId: property.id,
              propertyAddress: property.address,
              requiredShare,
              declaredShare: completedShare,
              difference,
              status: causaMortisCoverageStatus(completedShare, requiredShare),
            },
          ]}
          selectedPersonId="deceased"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));

    const declarationActionButton = () =>
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent.includes("CM Declaration"),
      );
    expect(container.querySelector(".causa-mortis-coverage-row.over")).toBeNull();
    expect(container.textContent).not.toContain("Excess");
    expect(container.querySelector(".causa-mortis-over-advice").textContent).toContain(
      "reduces the declaration proportionately",
    );
    expect(container.querySelector(".causa-mortis-over-advice").getAttribute("role")).toBeNull();
    expect(declarationActionButton().disabled).toBe(false);

    act(() => declarationActionButton().click());
    expect(latestPeople[0].causaMortisDeclarations).toHaveLength(2);
    expect(container.textContent).toContain("Declaration Causa Mortis 2");

    setInputValue('input[aria-label="Causa mortis share numerator 2"]', "1");
    setInputValue('input[aria-label="Causa mortis share denominator 2"]', "360");
    setInputValue('input[aria-label="Date of Declaration Causa Mortis 2"]', "2022-01-01");
    setInputValue('input[aria-label="Notary for Declaration Causa Mortis 2"]', "Paul Galea");
    setInputValue('input[aria-label="Immovable property value declared causa mortis 2"]', "1000");

    const okButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "OK" && !button.disabled,
    );
    act(() => okButton.click());

    expect(latestPeople[0].causaMortisDeclarations[1].status).toBe("complete");
    expect(container.querySelector(".causa-mortis-coverage-row.over")).toBeNull();
    expect(container.textContent).not.toContain("Excess");
    expect(container.querySelector(".causa-mortis-over-advice")).not.toBeNull();
    expect(declarationActionButton().disabled).toBe(false);
  });

  it("shows only the missing component of mixed CM coverage", () => {
    const deceased = {
      id: "deceased",
      fullName: "Joseph Borg",
      sex: "Male",
      isDeceased: true,
      dateOfDeath: "2020-01-01",
      inheritanceBasis: "intestacy",
      causaMortisDeclarations: [],
      designations: ["Deceased"],
      spouseIds: [],
      siblingIds: [],
    };
    const childA = {
      id: "child-a",
      fullName: "Maria Borg",
      sex: "Female",
      fatherId: "deceased",
      designations: [],
      spouseIds: [],
      siblingIds: [],
    };
    const childB = { ...childA, id: "child-b", fullName: "Paul Borg", sex: "Male" };

    act(() =>
      root.render(
        <PersonInspector
          people={[deceased, childA, childB]}
          properties={[{ id: "property-1", address: "1 Republic Street" }]}
          causaMortisCoverage={[
            {
              personId: "deceased",
              propertyId: "property-1",
              propertyAddress: "1 Republic Street",
              requiredShare: 0.5,
              requiredFraction: { numerator: 1, denominator: 2 },
              declaredShare: 0.5,
              declaredFraction: { numerator: 1, denominator: 2 },
              difference: 0,
              missingFraction: { numerator: 1, denominator: 4 },
              excessFraction: { numerator: 1, denominator: 4 },
              underDeclaredRecipientIds: ["child-b"],
              recipientCoverage: [
                {
                  personId: "child-a",
                  name: "Maria Borg",
                  status: "over",
                  excessFraction: { numerator: 1, denominator: 4 },
                },
                {
                  personId: "child-b",
                  name: "Paul Borg",
                  status: "under",
                  missingFraction: { numerator: 1, denominator: 4 },
                },
              ],
              status: "mixed",
            },
          ]}
          selectedPersonId="deceased"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const coverage = container.querySelector(".causa-mortis-coverage-row.mixed");
    expect(coverage.textContent).toContain("Missing 1/4");
    expect(coverage.textContent).toContain("Paul Borg: missing 1/4");
    expect(coverage.textContent).not.toContain("Excess");
    expect(coverage.textContent).not.toContain("Maria Borg");
    expect(coverage.textContent).not.toContain("Declared 1/2");
    expect(container.querySelector(".causa-mortis-over-advice").textContent).toContain(
      "reduces the declaration proportionately",
    );
  });

  it("starts an additional declaration when the red causa mortis coverage warning is pressed", () => {
    let latestPeople = [];
    const deceased = {
      id: "deceased",
      fullName: "Joseph Borg",
      sex: "Male",
      isDeceased: true,
      dateOfDeath: "2020-01-01",
      inheritanceBasis: "intestacy",
      causaMortisDeclarations: [
        {
          id: "cm-1",
          status: "complete",
          propertyId: "property-1",
          declaredShareNumerator: 1,
          declaredShareDenominator: 4,
          date: "2021-01-01",
          notaryName: "Maria Vella",
          immovablePropertyValue: "100000",
          declarantPersonIds: ["child-a"],
        },
      ],
      designations: ["Deceased"],
      spouseIds: [],
      siblingIds: [],
    };
    const childA = {
      id: "child-a",
      fullName: "Maria Borg",
      sex: "Female",
      fatherId: "deceased",
      designations: [],
      spouseIds: [],
      siblingIds: [],
    };
    const childB = {
      ...childA,
      id: "child-b",
      fullName: "Paul Borg",
      sex: "Male",
    };

    function Harness() {
      const [people, setPeople] = useState([deceased, childA, childB]);
      latestPeople = people;
      return (
        <PersonInspector
          people={people}
          properties={[{ id: "property-1", address: "1 Republic Street" }]}
          causaMortisCoverage={[
            {
              personId: "deceased",
              propertyId: "property-1",
              propertyAddress: "1 Republic Street",
              requiredShare: 0.5,
              declaredShare: 0.25,
              difference: -0.25,
              remainingFraction: { numerator: 1, denominator: 4 },
              underDeclaredRecipientIds: ["child-b"],
              status: "under",
            },
          ]}
          selectedPersonId="deceased"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));

    const warning = () => container.querySelector(".causa-mortis-coverage-row.under");
    const declarationActionButton = () =>
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent.includes("CM Declaration"),
      );
    expect(warning().tagName).toBe("BUTTON");
    expect(warning().type).toBe("button");
    act(() => warning().click());

    expect(latestPeople[0].causaMortisDeclarations).toHaveLength(2);
    expect(latestPeople[0].causaMortisDeclarations[1]).toMatchObject({
      status: "draft",
      propertyId: "property-1",
      declaredShareNumerator: 1,
      declaredShareDenominator: 4,
      declarantPersonIds: ["child-b"],
    });
    expect(container.textContent).toContain("Declaration Causa Mortis 2");

    act(() => declarationActionButton().click());
    expect(latestPeople[0].causaMortisDeclarations).toHaveLength(3);
    expect(container.textContent).toContain("Declaration Causa Mortis 3");
    act(() => warning().click());

    expect(latestPeople[0].causaMortisDeclarations).toHaveLength(4);
    expect(container.textContent).toContain("Declaration Causa Mortis 2");
    expect(container.textContent).toContain("Declaration Causa Mortis 4");
  });

  it.each([
    ["an unfinished draft", "draft"],
    ["a legacy declaration without a status", undefined],
  ])("allows another causa mortis declaration beside %s", (_description, status) => {
    const onChange = vi.fn();
    const existingDeclaration = {
      id: "existing-cm",
      ...(status ? { status } : {}),
      propertyId: "property-1",
      declaredShareNumerator: 1,
      declaredShareDenominator: 4,
      date: "2021-01-01",
      notaryName: "Maria Vella",
      immovablePropertyValue: "100000",
      declarantPersonIds: ["child"],
    };
    const deceased = {
      id: "deceased",
      fullName: "Joseph Borg",
      sex: "Male",
      isDeceased: true,
      dateOfDeath: "2020-01-01",
      inheritanceBasis: "intestacy",
      causaMortisDeclarations: [existingDeclaration],
      designations: ["Deceased"],
      spouseIds: [],
      siblingIds: [],
    };
    const child = {
      id: "child",
      fullName: "Maria Borg",
      sex: "Female",
      fatherId: "deceased",
      designations: [],
      spouseIds: [],
      siblingIds: [],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={[deceased, child]}
          properties={[{ id: "property-1", address: "1 Republic Street" }]}
          causaMortisCoverage={[
            {
              personId: "deceased",
              propertyId: "property-1",
              propertyAddress: "1 Republic Street",
              requiredShare: 0.5,
              declaredShare: 0,
              difference: -0.5,
              status: "under",
            },
          ]}
          selectedPersonId="deceased"
          onChange={onChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const insertButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Insert CM Declaration"),
    );
    expect(insertButton.disabled).toBe(false);
    expect(container.textContent).toContain("Declaration Causa Mortis 1");

    act(() => insertButton.click());

    const updatedDeceased = onChange.mock.calls
      .at(-1)[0]
      .find((person) => person.id === "deceased");
    expect(updatedDeceased.causaMortisDeclarations).toHaveLength(2);
    expect(updatedDeceased.causaMortisDeclarations[0]).toEqual(existingDeclaration);
    expect(updatedDeceased.causaMortisDeclarations[1]).toMatchObject({
      status: "draft",
      propertyId: "property-1",
    });
  });

  it("makes the declared value optional when every identified heir is deceased", () => {
    const people = [
      {
        id: "deceased",
        fullName: "Joseph Borg",
        sex: "Male",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "intestacy",
        causaMortisDeclarations: [
          {
            id: "cm-1",
            declarantPersonIds: ["child"],
          },
        ],
        designations: ["Deceased"],
        spouseIds: [],
        siblingIds: [],
      },
      {
        id: "child",
        fullName: "Maria Borg",
        fatherId: "deceased",
        isDeceased: true,
        dateOfDeath: "2022-01-01",
        designations: ["Deceased"],
        spouseIds: [],
        siblingIds: [],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="deceased"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const valueInput = container.querySelector(
      'input[aria-label="Immovable property value declared causa mortis 1"]',
    );
    expect(valueInput.required).toBe(false);
    expect(valueInput.closest("label").textContent).toContain("Value declared (optional)");
    expect(container.textContent).not.toContain("Value is optional because");
  });

  it("unlocks identity fields with Edit without showing parent-link dropdowns", () => {
    const people = [
      {
        id: "person",
        fullName: "Paul Borg",
        givenNames: "Paul",
        surname: "Borg",
        surnameAtBirth: "Borg",
        sex: "Male",
        fatherId: "father",
        motherId: "mother",
        spouseIds: [],
        designations: [],
      },
      {
        id: "father",
        fullName: "Joseph Borg",
        sex: "Male",
        spouseIds: ["mother"],
        designations: [],
      },
      {
        id: "mother",
        fullName: "Maria Borg",
        sex: "Female",
        spouseIds: ["father"],
        designations: [],
      },
    ];

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="person"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const nameInput = container.querySelector(".inspector-fields input");
    expect(nameInput.matches(":disabled")).toBe(true);
    expect(container.querySelector('select[aria-label="Father"]')).toBeNull();
    expect(container.querySelector('select[aria-label="Mother"]')).toBeNull();

    beginEditing();
    expect(nameInput.matches(":disabled")).toBe(false);
    expect(container.textContent).toContain("Done");
  });

  it("does not show parent-link dropdowns when one parent is assigned", () => {
    act(() =>
      root.render(
        <PersonInspector
          people={[
            {
              id: "child",
              fullName: "Anna Borg",
              motherId: "mother",
              spouseIds: [],
            },
            { id: "mother", fullName: "Maria Borg", spouseIds: [] },
            { id: "father", fullName: "Joseph Borg", spouseIds: [] },
          ]}
          selectedPersonId="child"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector('select[aria-label="Mother"]')).toBeNull();
    expect(container.querySelector('select[aria-label="Father"]')).toBeNull();
  });

  it("creates marriages and unmarried partnerships as distinct relationships", () => {
    let latestPeople;
    function Harness() {
      const [people, setPeople] = useState([
        {
          id: "roland",
          fullName: "Roland Wadge",
          givenNames: "Roland",
          surname: "Wadge",
          surnameAtBirth: "Wadge",
          sex: "Male",
          spouseIds: [],
        },
      ]);
      latestPeople = people;
      return (
        <PersonInspector
          people={people}
          selectedPersonId="roland"
          onChange={setPeople}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));
    act(() =>
      [...container.querySelectorAll(".relationship-actions button")]
        .find((button) => button.textContent.includes("Wife / husband"))
        .click(),
    );
    // No date field is shown until the other person has been created or linked.
    expect(container.querySelector(".partner-date-field input")).toBeNull();
    act(() =>
      [...container.querySelectorAll(".spouse-chooser button")]
        .find((button) => button.textContent.includes("Create new wife / husband"))
        .click(),
    );
    const spouseId = latestPeople.find((person) => person.id !== "roland").id;
    expect(latestPeople.find((person) => person.id === spouseId).sex).toBe("Female");
    expect(findPartnerRelationship(latestPeople, "roland", spouseId)).toMatchObject({
      type: "marriage",
    });
    const relationshipType = container.querySelector(".person-partner-link-row select");
    expect(relationshipType.disabled).toBe(false);
    expect(container.querySelector('input[aria-label^="Marriage start date with"]')).toBeNull();
    expect(container.textContent).not.toContain("Marriage date");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        relationshipType,
        "former-marriage",
      );
      relationshipType.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const marriageEndDate = container.querySelector('input[aria-label^="Marriage end date with"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        marriageEndDate,
        "01/03/2020",
      );
      marriageEndDate.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(findPartnerRelationship(latestPeople, "roland", spouseId)).toMatchObject({
      type: "marriage",
      endDate: "2020-03-01",
      endReason: "divorce",
    });

    act(() =>
      [...container.querySelectorAll(".relationship-actions button")]
        .find((button) => button.textContent.includes("Partner"))
        .click(),
    );
    act(() =>
      [...container.querySelectorAll(".spouse-chooser button")]
        .find((button) => button.textContent.includes("Create new partner"))
        .click(),
    );
    const partnerId = latestPeople.at(-1).id;
    expect(findPartnerRelationship(latestPeople, "roland", partnerId)).toMatchObject({
      type: "partnership",
    });
    const partnershipStartDate = container.querySelector(
      'input[aria-label^="Partnership start date with"]',
    );
    expect(partnershipStartDate).not.toBeNull();
    expect(latestPeople.find((person) => person.id === "roland").spouseIds).toHaveLength(2);
  });

  it("adds another tree person or a new unconnected company directly as an heir", () => {
    let latestPeople;
    let latestOutsideParties;
    function Harness() {
      const [people, setPeople] = useState([
        {
          id: "deceased",
          fullName: "Joseph Borg",
          givenNames: "Joseph",
          surname: "Borg",
          surnameAtBirth: "Borg",
          sex: "Male",
          isDeceased: true,
          designations: ["Deceased"],
          dateOfDeath: "2020-01-01",
          spouseIds: [],
        },
        {
          id: "child",
          fullName: "Maria Borg",
          givenNames: "Maria",
          surname: "Borg",
          surnameAtBirth: "Borg",
          sex: "Female",
          fatherId: "deceased",
          spouseIds: [],
        },
        {
          id: "friend",
          fullName: "Anna Vella",
          givenNames: "Anna",
          surname: "Vella",
          surnameAtBirth: "Vella",
          sex: "Female",
          spouseIds: [],
        },
      ]);
      const [outsideParties, setOutsideParties] = useState([]);
      latestPeople = people;
      latestOutsideParties = outsideParties;
      return (
        <PersonInspector
          people={people}
          outsideParties={outsideParties}
          selectedPersonId="deceased"
          onChange={setPeople}
          onOutsidePartiesChange={setOutsideParties}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));
    const editBeneficiaries = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Edit Beneficiaries"),
    );
    if (editBeneficiaries) act(() => editBeneficiaries.click());
    let heirSelect = container.querySelector(
      'select[aria-label="Add an heir or override the intestacy proposal"]',
    );
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        heirSelect,
        "friend",
      );
      heirSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(latestPeople[0].intestateHeirs).toBeUndefined();
    expect(
      [...container.querySelectorAll(".confirmed-heir-name")].map((node) => node.textContent),
    ).toContain("Anna Vella");

    heirSelect = container.querySelector(
      'select[aria-label="Add an heir or override the intestacy proposal"]',
    );
    const createOption = [...heirSelect.options].find((option) =>
      option.textContent.includes("Create unconnected"),
    );
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        heirSelect,
        createOption.value,
      );
      heirSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const typeSelect = container.querySelector('select[aria-label="Unconnected heir type"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        typeSelect,
        "company",
      );
      typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const nameInput = container.querySelector('input[aria-label="Unconnected heir name"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        nameInput,
        "Legacy Holdings Ltd",
      );
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() =>
      [...container.querySelectorAll(".outside-party-creator button")]
        .find((button) => button.textContent.includes("Add as heir"))
        .click(),
    );

    expect(latestOutsideParties).toHaveLength(1);
    expect(latestOutsideParties[0]).toMatchObject({
      name: "Legacy Holdings Ltd",
      type: "company",
    });
    expect(latestPeople).toHaveLength(3);
    expect(latestPeople[0].intestateHeirs).toBeUndefined();
    expect(
      [...container.querySelectorAll(".confirmed-heir-name")].map((node) => node.textContent),
    ).toContain("Legacy Holdings Ltd");
  });
});

describe("PersonInspector pre-1992 succession note", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const deceasedBefore1992 = (extra = {}) => ({
    id: "ancestor",
    fullName: "Enrico Borg",
    dateOfDeath: "1980-01-01",
    isDeceased: true,
    designations: [],
    spouseIds: [],
    ...extra,
  });

  const renderFor = (people) =>
    act(() =>
      root.render(
        <PersonInspector
          people={people}
          selectedPersonId="ancestor"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

  it("states the 7% sale rate while an heir still holds the share", () => {
    renderFor([
      deceasedBefore1992(),
      { id: "heir", fullName: "Maria Borg", fatherId: "ancestor", spouseIds: [], designations: [] },
    ]);

    expect(container.textContent).toContain("death before 25/11/1992");
    expect(container.textContent).toContain("Article 5A(5)(c)(i)");
  });

  it("drops the rate once every heir has died and the share has passed again", () => {
    renderFor([
      deceasedBefore1992(),
      {
        id: "heir",
        fullName: "Maria Borg",
        fatherId: "ancestor",
        dateOfDeath: "2015-06-01",
        isDeceased: true,
        spouseIds: [],
        designations: [],
      },
    ]);

    // Sales tax looks only at the last passage of title, so this succession's
    // rate says nothing about a later sale.
    expect(container.textContent).toContain("death before 25/11/1992");
    expect(container.textContent).not.toContain("Article 5A(5)(c)(i)");
  });
});

describe("PersonInspector provenance designation", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const people = [
    { id: "seller", fullName: "Joseph Borg", sex: "Male", spouseIds: [], designations: [] },
    { id: "other", fullName: "Maria Vella", sex: "Female", spouseIds: [], designations: [] },
  ];
  const property = {
    id: "prop",
    address: "1 Republic Street",
    owners: [
      { id: "o1", personId: "seller", sharePercent: 50 },
      { id: "o2", personId: "other", sharePercent: 50 },
    ],
    declarations: [],
    transfers: [
      {
        id: "t1",
        sellerId: "other",
        buyerId: "seller",
        numerator: 1,
        denominator: 4,
        amountType: "whole-property",
        date: "2020-01-01",
      },
    ],
    saleLots: [],
  };

  it("keeps death succession and inter vivos transfer details open together", () => {
    const deceasedPeople = people.map((person) =>
      person.id === "seller"
        ? {
            ...person,
            isDeceased: true,
            dateOfDeath: "2022-01-01",
            inheritanceBasis: "intestacy",
            designations: ["Deceased"],
          }
        : person,
    );
    const vendorReport = buildPropertyVendorTaxReport(property, deceasedPeople, []);

    act(() =>
      root.render(
        <PersonInspector
          people={deceasedPeople}
          properties={[property]}
          vendorReport={vendorReport}
          selectedPersonId="seller"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onRecordDonation={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector(".person-succession")).not.toBeNull();
    const transferCheckbox = container.querySelector(
      'input[aria-label="Sold/Donated Property Share"]',
    );
    expect(transferCheckbox.checked).toBe(false);
    expect(container.querySelector(".person-donation-form")).toBeNull();
    act(() => transferCheckbox.click());
    expect(container.querySelector(".person-succession")).not.toBeNull();
    expect(container.querySelector(".person-donation-form")).not.toBeNull();
    expect(container.textContent).not.toContain("1 Republic Street");
  });

  it("reopens a persisted transfer disclosure for a deceased person without relying on local state", () => {
    const deceasedPeople = people.map((person) =>
      person.id === "seller"
        ? {
            ...person,
            isDeceased: true,
            dateOfDeath: "2022-01-01",
            inheritanceBasis: "intestacy",
            designations: ["Deceased"],
          }
        : person,
    );
    const vendorReport = buildPropertyVendorTaxReport(property, deceasedPeople, []);
    const renderInspector = (interVivosStatusSession = null) =>
      root.render(
        <PersonInspector
          people={deceasedPeople}
          properties={[property]}
          vendorReport={vendorReport}
          selectedPersonId="seller"
          interVivosStatusSession={interVivosStatusSession}
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onRecordDonation={vi.fn()}
        />,
      );

    act(() => renderInspector());
    expect(container.querySelector(".person-donation-form")).toBeNull();

    act(() =>
      renderInspector({
        id: "status-toggle:inter-vivos:seller:session",
        type: "inter-vivos",
        personId: "seller",
        propertyId: "prop",
      }),
    );

    expect(container.querySelector('input[aria-label="Sold/Donated Property Share"]').checked).toBe(
      true,
    );
    expect(container.querySelector(".person-succession")).not.toBeNull();
    expect(container.querySelector(".person-donation-form")).not.toBeNull();
  });

  it("asks which provenance a partial transfer comes from and records the answer", () => {
    const vendorReport = buildPropertyVendorTaxReport(property, people, []);
    const onRecordDonation = vi.fn();
    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[property]}
          vendorReport={vendorReport}
          selectedPersonId="seller"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onRecordDonation={onRecordDonation}
        />,
      ),
    );

    const toggle = container.querySelector('input[aria-label="Sold/Donated Property Share"]');
    expect(toggle).toBeTruthy();
    act(() => toggle.click());

    const measurement = container.querySelector('select[aria-label="Transfer measurement"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        measurement,
        "defined-share",
      );
      measurement.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const numerator = container.querySelector('input[aria-label="Transfer numerator"]');
    const denominator = container.querySelector('input[aria-label="Transfer denominator"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(numerator, "1");
      numerator.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        denominator,
        "2",
      );
      denominator.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Transferring 1/2 of the whole property is part of a 3/4 holding with two provenances.
    expect(container.textContent).toContain("Which provenance is being transferred?");
    expect(container.textContent).toContain("Initial ownership");
    expect(container.textContent).toContain("Acquired from Maria Vella");

    const acquirer = container.querySelector('select[aria-label="Existing acquirer"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        acquirer,
        "other",
      );
      acquirer.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const firstProvenance = container.querySelector('.provenance-pick input[type="checkbox"]');
    act(() => firstProvenance.click());

    const donationDate = container.querySelector('input[aria-label="Donation date"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        donationDate,
        "01/01/2021",
      );
      donationDate.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const submit = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Record donation",
    );
    act(() => submit.click());

    expect(onRecordDonation).toHaveBeenCalledTimes(1);
    const { transfer } = onRecordDonation.mock.calls[0][0];
    expect(transfer.kind).toBe("donation");
    // The selected half of the property comes entirely from initial ownership.
    expect(transfer.provenance).toEqual([
      {
        trancheId: "initial-o1",
        label: "Initial ownership",
        cause: "initial",
        acquiredOn: "",
        numerator: 1,
        denominator: 2,
      },
    ]);
  });

  it("attributes a whole-holding transfer automatically without asking", () => {
    const vendorReport = buildPropertyVendorTaxReport(property, people, []);
    const onRecordDonation = vi.fn();
    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[property]}
          vendorReport={vendorReport}
          selectedPersonId="seller"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onRecordDonation={onRecordDonation}
        />,
      ),
    );

    const toggle = container.querySelector('input[aria-label="Sold/Donated Property Share"]');
    act(() => toggle.click());

    expect(container.querySelector(".transfer-fraction")).toBeNull();
    expect(container.textContent).not.toContain("Which provenance is being transferred?");

    const acquirer = container.querySelector('select[aria-label="Existing acquirer"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        acquirer,
        "other",
      );
      acquirer.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const donationDate = container.querySelector('input[aria-label="Donation date"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        donationDate,
        "01/01/2021",
      );
      donationDate.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Record donation",
    );
    act(() => submit.click());

    const { transfer } = onRecordDonation.mock.calls[0][0];
    expect(transfer).toMatchObject({
      numerator: "3",
      denominator: "4",
      amountType: "whole-property",
    });
    // The whole 3/4 holding moves, carrying both provenances with their own fractions.
    expect(transfer.provenance.map((portion) => portion.trancheId).sort()).toEqual([
      "initial-o1",
      "transfer-t1",
    ]);
  });

  it("keeps a newly created transfer acquirer's name through case normalisation", () => {
    const vendorReport = buildPropertyVendorTaxReport(property, people, []);
    const onRecordDonation = vi.fn();
    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[property]}
          vendorReport={vendorReport}
          selectedPersonId="seller"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onRecordDonation={onRecordDonation}
        />,
      ),
    );

    act(() => container.querySelector('input[aria-label="Sold/Donated Property Share"]').click());
    const acquirerSource = container.querySelector('select[aria-label="Acquirer source"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        acquirerSource,
        "new",
      );
      acquirerSource.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const acquirerName = container.querySelector('input[aria-label="New acquirer full name"]');
    const donationDate = container.querySelector('input[aria-label="Donation date"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        acquirerName,
        "maria elena vella",
      );
      acquirerName.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        donationDate,
        "01/01/2021",
      );
      donationDate.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const submit = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Record donation",
    );
    act(() => submit.click());

    expect(onRecordDonation).toHaveBeenCalledTimes(1);
    const payload = onRecordDonation.mock.calls[0][0];
    const normalised = normaliseCase({ id: "case", people: payload.people });
    const acquirer = normalised.people.find((person) => person.id === payload.transfer.buyerId);
    expect(acquirer).toMatchObject({
      givenNames: "Maria Elena",
      surname: "Vella",
      fullName: "Maria Elena Vella",
    });
  });

  it("creates an outside company from the person-card transfer workflow", () => {
    const vendorReport = buildPropertyVendorTaxReport(property, people, []);
    const onOutsidePartiesChange = vi.fn();
    const onRecordDonation = vi.fn();
    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[property]}
          vendorReport={vendorReport}
          selectedPersonId="seller"
          outsideParties={[]}
          onChange={vi.fn()}
          onOutsidePartiesChange={onOutsidePartiesChange}
          onSelectPerson={vi.fn()}
          onRecordDonation={onRecordDonation}
        />,
      ),
    );

    act(() => container.querySelector('input[aria-label="Sold/Donated Property Share"]').click());
    const acquirerSource = container.querySelector('select[aria-label="Acquirer source"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        acquirerSource,
        "new",
      );
      acquirerSource.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const acquirerType = container.querySelector('select[aria-label="New acquirer type"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        acquirerType,
        "company",
      );
      acquirerType.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const companyName = container.querySelector('input[aria-label="New acquirer full name"]');
    const companyRegistration = container.querySelector(
      'input[aria-label="New company registration number"]',
    );
    const donationDate = container.querySelector('input[aria-label="Donation date"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        companyName,
        "Harbour Holdings Limited",
      );
      companyName.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        companyRegistration,
        "C 12345",
      );
      companyRegistration.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        donationDate,
        "01/01/2021",
      );
      donationDate.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const submit = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Record donation",
    );
    act(() => submit.click());

    expect(onOutsidePartiesChange).not.toHaveBeenCalled();
    expect(onRecordDonation).toHaveBeenCalledTimes(1);
    const [company] = onRecordDonation.mock.calls[0][0].outsideParties;
    expect(company).toMatchObject({
      type: "company",
      name: "Harbour Holdings Limited",
      registrationNumber: "C 12345",
    });
    expect(onRecordDonation.mock.calls[0][0]).toMatchObject({
      people,
      outsideParties: [company],
      transfer: {
        buyerId: company.id,
        kind: "donation",
      },
    });
  });

  it("records all of the share held on the entered deed date", () => {
    const vendorReport = buildPropertyVendorTaxReport(property, people, []);
    const onRecordDonation = vi.fn();
    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[property]}
          vendorReport={vendorReport}
          selectedPersonId="seller"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onRecordDonation={onRecordDonation}
        />,
      ),
    );

    act(() => container.querySelector('input[aria-label="Sold/Donated Property Share"]').click());
    const acquirer = container.querySelector('select[aria-label="Existing acquirer"]');
    const donationDate = container.querySelector('input[aria-label="Donation date"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        acquirer,
        "other",
      );
      acquirer.dispatchEvent(new Event("change", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        donationDate,
        "01/01/2019",
      );
      donationDate.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Record donation",
    );
    act(() => submit.click());

    expect(onRecordDonation).toHaveBeenCalledTimes(1);
    expect(onRecordDonation.mock.calls[0][0].transfer).toMatchObject({
      numerator: "1",
      denominator: "2",
      amountType: "whole-property",
      provenance: [
        expect.objectContaining({
          trancheId: "initial-o1",
          numerator: 1,
          denominator: 2,
        }),
      ],
    });
  });

  it("keeps saved transfers compact until another transfer is requested", () => {
    const savedProperty = {
      ...property,
      transfers: [
        ...property.transfers,
        {
          id: "saved-sale",
          kind: "sale",
          sellerId: "seller",
          buyerId: "other",
          numerator: 1,
          denominator: 4,
          amountType: "whole-property",
          date: "2021-01-01",
        },
      ],
    };
    const vendorReport = buildPropertyVendorTaxReport(savedProperty, people, []);
    const onDeleteInterVivosTransfer = vi.fn();

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[savedProperty]}
          vendorReport={vendorReport}
          selectedPersonId="seller"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onRecordDonation={vi.fn()}
          onDeleteInterVivosTransfer={onDeleteInterVivosTransfer}
        />,
      ),
    );

    expect(container.querySelector(".person-donation-form")).toBeNull();
    const addAnother = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Add another transfer",
    );
    expect(addAnother).toBeTruthy();

    act(() => addAnother.click());
    expect(container.querySelector(".person-donation-form")).not.toBeNull();
    const cancel = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Cancel",
    );
    act(() => cancel.click());
    expect(container.querySelector(".person-donation-form")).toBeNull();

    const deleteRecord = container.querySelector('button[aria-label="Delete sale record"]');
    act(() => deleteRecord.click());
    expect(onDeleteInterVivosTransfer).toHaveBeenCalledWith({
      propertyId: "prop",
      transferId: "saved-sale",
    });
  });

  it("opens a saved transfer for editing and replaces the same record", () => {
    const savedProperty = {
      ...property,
      transfers: [
        ...property.transfers,
        {
          id: "saved-sale",
          kind: "sale",
          sellerId: "seller",
          buyerId: "other",
          numerator: 1,
          denominator: 4,
          amountType: "whole-property",
          date: "2021-01-01",
        },
      ],
    };
    const onRecordDonation = vi.fn();
    const onUpdateInterVivosTransfer = vi.fn();

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[savedProperty]}
          vendorReport={buildPropertyVendorTaxReport(savedProperty, people, [])}
          selectedPersonId="seller"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onRecordDonation={onRecordDonation}
          onUpdateInterVivosTransfer={onUpdateInterVivosTransfer}
        />,
      ),
    );

    const edit = container.querySelector('button[aria-label="Edit sale record"]');
    expect(edit).not.toBeNull();
    act(() => edit.click());
    expect(edit.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('input[aria-label="Transfer numerator"]').value).toBe("1");
    expect(container.querySelector('input[aria-label="Transfer denominator"]').value).toBe("4");

    const setTransferField = (label, value) => {
      const input = container.querySelector(`input[aria-label="${label}"]`);
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    setTransferField("Transfer numerator", "3");
    const save = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Save sale",
    );
    act(() => save.click());

    expect(onRecordDonation).not.toHaveBeenCalled();
    expect(onUpdateInterVivosTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId: "prop",
        transferId: "saved-sale",
        transfer: expect.objectContaining({
          id: "saved-sale",
          numerator: "3",
          denominator: "4",
          buyerId: "other",
          date: "2021-01-01",
        }),
      }),
    );

    act(() => edit.click());
    setTransferField("Transfer denominator", "5");
    const cancel = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Cancel",
    );
    act(() => cancel.click());
    expect(onUpdateInterVivosTransfer).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".person-donation-form")).toBeNull();
  });

  it("preserves the exact whole-property amount when editing a legacy seller-holding transfer", () => {
    const legacyProperty = {
      ...property,
      transfers: [
        ...property.transfers,
        {
          id: "legacy-sale",
          kind: "sale",
          sellerId: "seller",
          buyerId: "other",
          numerator: 1,
          denominator: 2,
          amountType: "seller-holding",
          date: "2021-01-01",
        },
      ],
    };
    const onUpdateInterVivosTransfer = vi.fn();

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[legacyProperty]}
          vendorReport={buildPropertyVendorTaxReport(legacyProperty, people, [])}
          selectedPersonId="seller"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onRecordDonation={vi.fn()}
          onUpdateInterVivosTransfer={onUpdateInterVivosTransfer}
        />,
      ),
    );

    act(() => container.querySelector('button[aria-label="Edit sale record"]').click());
    expect(container.querySelector('input[aria-label="Transfer numerator"]').value).toBe("3");
    expect(container.querySelector('input[aria-label="Transfer denominator"]').value).toBe("8");
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.trim() === "Save sale")
        .click(),
    );

    expect(onUpdateInterVivosTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        transfer: expect.objectContaining({
          id: "legacy-sale",
          numerator: "3",
          denominator: "8",
          amountType: "whole-property",
        }),
      }),
    );
  });

  it("shows an invalid saved transfer and its error instead of hiding it", () => {
    const invalidProperty = {
      ...property,
      transfers: [
        {
          id: "invalid-sale",
          kind: "sale",
          sellerId: "seller",
          buyerId: "other",
          numerator: 4,
          denominator: 5,
          amountType: "whole-property",
          date: "2021-01-01",
        },
      ],
    };
    const vendorReport = buildPropertyVendorTaxReport(invalidProperty, people, []);

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[invalidProperty]}
          vendorReport={vendorReport}
          selectedPersonId="seller"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onRecordDonation={vi.fn()}
        />,
      ),
    );

    const invalidRecord = container.querySelector(".lifetime-transfer-record.invalid");
    expect(invalidRecord).not.toBeNull();
    expect(invalidRecord.textContent).toContain("Invalid");
    expect(invalidRecord.textContent).toContain(
      "Joseph Borg is marked as having attempted to sell or donate a larger share than the calculator shows he owned on that date.",
    );
    expect(container.querySelector(".person-donation-form")).toBeNull();

    act(() => invalidRecord.querySelector(".lifetime-transfer-summary").click());
    [
      ["Sale date", "donation-date"],
      ["Existing acquirer", "donation-acquirer"],
      ["Transfer measurement", "donation-share"],
      ["Transfer numerator", "donation-share"],
      ["Transfer denominator", "donation-share"],
    ].forEach(([label, field]) => {
      const control = container.querySelector(`[aria-label="${label}"]`);
      expect(control?.dataset.taxReadinessField).toBe(field);
      expect(control?.dataset.taxReadinessTargetId).toBe("invalid-sale");
    });
  });

  it("marks the exact saved transfer on every editable provenance control", () => {
    const designatedProperty = {
      ...property,
      transfers: [
        ...property.transfers,
        {
          id: "invalid-provenance",
          kind: "donation",
          sellerId: "seller",
          buyerId: "other",
          numerator: 1,
          denominator: 2,
          amountType: "whole-property",
          date: "2021-01-01",
          provenance: [{ trancheId: "initial-o1", numerator: 1, denominator: 2 }],
        },
      ],
    };

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[designatedProperty]}
          vendorReport={buildPropertyVendorTaxReport(designatedProperty, people, [])}
          selectedPersonId="seller"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onRecordDonation={vi.fn()}
          onUpdateInterVivosTransfer={vi.fn()}
        />,
      ),
    );

    const record = container.querySelector('[data-tax-readiness-transfer-id="invalid-provenance"]');
    expect(record).not.toBeNull();
    act(() => record.querySelector(".lifetime-transfer-summary").click());
    const controls = [
      ...container.querySelectorAll('[data-tax-readiness-field="donation-provenance"]'),
    ];
    expect(controls.length).toBeGreaterThan(0);
    expect(
      controls.every((control) => control.dataset.taxReadinessTargetId === "invalid-provenance"),
    ).toBe(true);
  });

  it("moves a deceased owner's full lifetime transfer to the acquirer before succession", () => {
    const deceasedPeople = [
      {
        id: "deceased-seller",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2022-01-01",
        inheritanceBasis: "intestacy",
        spouseIds: [],
        designations: ["Deceased"],
      },
      {
        id: "child",
        fullName: "Paul Borg",
        fatherId: "deceased-seller",
        spouseIds: [],
        designations: [],
      },
      { id: "buyer", fullName: "Maria Vella", spouseIds: [], designations: [] },
    ];
    const deceasedProperty = {
      id: "deceased-property",
      owners: [{ id: "owner", personId: "deceased-seller", sharePercent: 100 }],
      declarations: [],
      transfers: [],
      saleLots: [],
    };
    const vendorReport = buildPropertyVendorTaxReport(deceasedProperty, deceasedPeople, []);
    const onRecordDonation = vi.fn();

    act(() =>
      root.render(
        <PersonInspector
          people={deceasedPeople}
          properties={[deceasedProperty]}
          vendorReport={vendorReport}
          selectedPersonId="deceased-seller"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onRecordDonation={onRecordDonation}
        />,
      ),
    );

    act(() => container.querySelector('input[aria-label="Sold/Donated Property Share"]').click());
    const acquirer = container.querySelector('select[aria-label="Existing acquirer"]');
    const donationDate = container.querySelector('input[aria-label="Donation date"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        acquirer,
        "buyer",
      );
      acquirer.dispatchEvent(new Event("change", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        donationDate,
        "01/01/2021",
      );
      donationDate.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Record donation",
    );
    act(() => submit.click());

    expect(onRecordDonation).toHaveBeenCalledTimes(1);
    const payload = onRecordDonation.mock.calls[0][0];
    expect(payload.people.find((person) => person.id === "deceased-seller")).toMatchObject({
      inheritanceBasis: "intestacy",
    });
    expect(payload.transfer).toMatchObject({
      numerator: "1",
      denominator: "1",
      amountType: "whole-property",
    });

    const nextReport = buildPropertyVendorTaxReport(
      { ...deceasedProperty, transfers: [payload.transfer] },
      payload.people,
      [],
    );
    const holdings = Object.fromEntries(
      nextReport.ledger.owners.map((owner) => [owner.id, owner.share]),
    );
    expect(holdings.buyer).toBeCloseTo(1);
    expect(holdings.child || 0).toBe(0);
    expect(holdings["deceased-seller"] || 0).toBe(0);
  });

  it("explains why an all-share donation after death cannot be recorded", () => {
    const deceasedPeople = [
      {
        id: "deceased-seller",
        fullName: "Joseph Borg",
        sex: "Male",
        isDeceased: true,
        dateOfDeath: "2025-03-20",
        inheritanceBasis: "intestacy",
        spouseIds: [],
        designations: ["Deceased"],
      },
      {
        id: "child",
        fullName: "Paul Borg",
        fatherId: "deceased-seller",
        spouseIds: [],
        designations: [],
      },
      { id: "buyer", fullName: "Mathea Wadge", spouseIds: [], designations: [] },
    ];
    const deceasedProperty = {
      id: "deceased-property",
      owners: [{ id: "owner", personId: "deceased-seller", sharePercent: 6.25 }],
      declarations: [],
      transfers: [],
      saleLots: [],
    };
    const vendorReport = buildPropertyVendorTaxReport(deceasedProperty, deceasedPeople, []);
    const onRecordDonation = vi.fn();

    act(() =>
      root.render(
        <PersonInspector
          people={deceasedPeople}
          properties={[deceasedProperty]}
          vendorReport={vendorReport}
          selectedPersonId="deceased-seller"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onRecordDonation={onRecordDonation}
        />,
      ),
    );

    act(() => container.querySelector('input[aria-label="Sold/Donated Property Share"]').click());
    const acquirer = container.querySelector('select[aria-label="Existing acquirer"]');
    const donationDate = container.querySelector('input[aria-label="Donation date"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        acquirer,
        "buyer",
      );
      acquirer.dispatchEvent(new Event("change", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        donationDate,
        "25/05/2025",
      );
      donationDate.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const submit = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Record donation",
    );
    const transferLimit = container.querySelector(".person-donation-form .transfer-limit");
    expect(submit.disabled).toBe(false);
    expect(submit.getAttribute("aria-describedby")).toBe("lifetime-transfer-error");
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      "Donation date must be on or before Joseph Borg's date of death (20/03/2025).",
    );
    expect(transferLimit.textContent).toContain("Unavailable on 25/05/2025");
    expect(transferLimit.textContent).not.toContain("1/16");
    act(() => submit.click());
    expect(onRecordDonation).not.toHaveBeenCalled();

    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        donationDate,
        "19/03/2025",
      );
      donationDate.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(submit.disabled).toBe(false);
    expect(container.querySelector("#lifetime-transfer-error")).toBeNull();
    expect(transferLimit.textContent).toContain("1/16");
    act(() => submit.click());
    expect(onRecordDonation).toHaveBeenCalledTimes(1);
    expect(onRecordDonation.mock.calls[0][0].transfer).toMatchObject({
      buyerId: "buyer",
      numerator: "1",
      denominator: "16",
      date: "2025-03-19",
    });
  });

  it("keeps a second transfer actionable and explains a sale dated after death", () => {
    const deceasedPeople = [
      {
        id: "seller",
        fullName: "Joseph Borg",
        sex: "Male",
        isDeceased: true,
        dateOfDeath: "2025-03-20",
        inheritanceBasis: "intestacy",
        spouseIds: [],
        designations: ["Deceased"],
      },
      { id: "mathea", fullName: "Mathea Wadge", spouseIds: [], designations: [] },
      { id: "harvey", fullName: "Harvey Wadge", spouseIds: [], designations: [] },
    ];
    const propertyAfterFirstDonation = {
      id: "two-transfer-property",
      owners: [
        {
          id: "owner",
          personId: "seller",
          numerator: 1,
          denominator: 16,
          sharePercent: 6.25,
        },
      ],
      declarations: [],
      transfers: [
        {
          id: "first-donation",
          kind: "donation",
          sellerId: "seller",
          buyerId: "mathea",
          numerator: 1,
          denominator: 32,
          amountType: "whole-property",
          date: "2020-05-25",
        },
      ],
      saleLots: [],
    };
    const vendorReport = buildPropertyVendorTaxReport(
      propertyAfterFirstDonation,
      deceasedPeople,
      [],
    );
    const onRecordDonation = vi.fn();

    act(() =>
      root.render(
        <PersonInspector
          people={deceasedPeople}
          properties={[propertyAfterFirstDonation]}
          vendorReport={vendorReport}
          selectedPersonId="seller"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onRecordDonation={onRecordDonation}
        />,
      ),
    );

    const addAnother = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Add another transfer",
    );
    act(() => addAnother.click());

    const type = container.querySelector('select[aria-label="Type of contract"]');
    const acquirer = container.querySelector('select[aria-label="Existing acquirer"]');
    const saleDate = container.querySelector('input[aria-label="Donation date"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(type, "sale");
      type.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const updatedSaleDate = container.querySelector('input[aria-label="Sale date"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        acquirer,
        "harvey",
      );
      acquirer.dispatchEvent(new Event("change", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        updatedSaleDate || saleDate,
        "25/05/2026",
      );
      (updatedSaleDate || saleDate).dispatchEvent(new Event("input", { bubbles: true }));
    });

    const submit = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Record sale",
    );
    expect(submit.disabled).toBe(false);
    expect(container.querySelector("#lifetime-transfer-error").textContent).toContain(
      "Sale date must be on or before Joseph Borg's date of death (20/03/2025).",
    );
    expect(container.querySelector(".transfer-limit").textContent).toContain(
      "Unavailable on 25/05/2026",
    );
    act(() => submit.click());
    expect(onRecordDonation).not.toHaveBeenCalled();

    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        updatedSaleDate || saleDate,
        "25/05/2024",
      );
      (updatedSaleDate || saleDate).dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector("#lifetime-transfer-error")).toBeNull();
    expect(container.querySelector(".transfer-limit").textContent).toContain("1/32");
    act(() => submit.click());
    expect(onRecordDonation).toHaveBeenCalledTimes(1);
    expect(onRecordDonation.mock.calls[0][0].transfer).toMatchObject({
      kind: "sale",
      buyerId: "harvey",
      numerator: "1",
      denominator: "32",
      date: "2024-05-25",
    });
  });

  it("prevents a defined fraction from exceeding the transferor's exact holding", () => {
    const vendorReport = buildPropertyVendorTaxReport(property, people, []);
    const onRecordDonation = vi.fn();
    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[property]}
          vendorReport={vendorReport}
          selectedPersonId="seller"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onRecordDonation={onRecordDonation}
        />,
      ),
    );

    act(() => container.querySelector('input[aria-label="Sold/Donated Property Share"]').click());
    const measurement = container.querySelector('select[aria-label="Transfer measurement"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        measurement,
        "defined-share",
      );
      measurement.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const numerator = container.querySelector('input[aria-label="Transfer numerator"]');
    const denominator = container.querySelector('input[aria-label="Transfer denominator"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(numerator, "4");
      numerator.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        denominator,
        "5",
      );
      denominator.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.textContent).toContain(
      "The transferred share cannot be greater than this person's current holding.",
    );
    const submit = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Record donation",
    );
    expect(submit.disabled).toBe(false);
    act(() => submit.click());
    expect(onRecordDonation).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      "The transferred share cannot be greater than this person's current holding.",
    );
  });

  it("prevents a defined percentage from exceeding the transferor's exact holding", () => {
    const vendorReport = buildPropertyVendorTaxReport(property, people, []);
    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[property]}
          vendorReport={vendorReport}
          selectedPersonId="seller"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onRecordDonation={vi.fn()}
        />,
      ),
    );

    act(() => container.querySelector('input[aria-label="Sold/Donated Property Share"]').click());
    const measurement = container.querySelector('select[aria-label="Transfer measurement"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        measurement,
        "defined-share",
      );
      measurement.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const format = container.querySelector('select[aria-label="Transfer share format"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        format,
        "percentage",
      );
      format.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const percentage = container.querySelector('input[aria-label="Transfer percentage"]');
    expect(percentage.step).toBe("0.01");
    expect(percentage.inputMode).toBe("decimal");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        percentage,
        "75.015",
      );
      percentage.dispatchEvent(new Event("input", { bubbles: true }));
      percentage.focus();
      percentage.blur();
    });

    expect(container.querySelector('input[aria-label="Transfer percentage"]').value).toBe("75.02");

    expect(container.textContent).toContain(
      "The transferred share cannot be greater than this person's current holding.",
    );
    const submit = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Record donation",
    );
    expect(submit.disabled).toBe(false);
    act(() => submit.click());
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      "The transferred share cannot be greater than this person's current holding.",
    );
  });

  it("rounds and records a standalone transfer percentage when submitted without blur", () => {
    const singleSourceProperty = {
      ...property,
      owners: [{ id: "single-source", personId: "seller", shareNumerator: 1, shareDenominator: 1 }],
      transfers: [],
    };
    const vendorReport = buildPropertyVendorTaxReport(singleSourceProperty, people, []);
    const onRecordDonation = vi.fn();
    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[singleSourceProperty]}
          vendorReport={vendorReport}
          selectedPersonId="seller"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
          onRecordDonation={onRecordDonation}
        />,
      ),
    );

    act(() => container.querySelector('input[aria-label="Sold/Donated Property Share"]').click());
    const setSelect = (selector, value) => {
      const select = container.querySelector(selector);
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    };
    act(() => setSelect('select[aria-label="Transfer measurement"]', "defined-share"));
    act(() => {
      setSelect('select[aria-label="Transfer share format"]', "percentage");
      setSelect('select[aria-label="Existing acquirer"]', "other");
    });
    const percentage = container.querySelector('input[aria-label="Transfer percentage"]');
    const donationDate = container.querySelector('input[aria-label="Donation date"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        percentage,
        "33.335",
      );
      percentage.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        donationDate,
        "01/01/2021",
      );
      donationDate.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(percentage.validity.stepMismatch).toBe(true);
    expect(container.querySelector(".person-donation-form").noValidate).toBe(true);
    act(() => container.querySelector(".person-donation-form").requestSubmit());

    expect(onRecordDonation).toHaveBeenCalledTimes(1);
    expect(onRecordDonation.mock.calls[0][0].transfer).toMatchObject({
      numerator: "1667",
      denominator: "5000",
      amountType: "whole-property",
    });
  });
});

describe("PersonInspector deceased property flow", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows death, lifetime transfer, remaining estate and causa mortis in order", () => {
    const people = [
      {
        id: "owner",
        fullName: "Joseph Borg",
        sex: "Male",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "intestacy",
        designations: ["Deceased"],
        spouseIds: [],
      },
      {
        id: "child",
        fullName: "Maria Borg",
        sex: "Female",
        fatherId: "owner",
        spouseIds: [],
      },
      { id: "buyer", fullName: "Anna Vella", sex: "Female", spouseIds: [] },
    ];
    const property = {
      id: "property",
      address: "1 Republic Street",
      saleValue: 1_000_000,
      owners: [{ id: "initial-owner", personId: "owner", sharePercent: 100 }],
      transfers: [
        {
          id: "lifetime-sale",
          kind: "sale",
          sellerId: "owner",
          buyerId: "buyer",
          numerator: 1,
          denominator: 4,
          amountType: "whole-property",
          date: "2019-01-01",
          provenance: [
            {
              trancheId: "initial-initial-owner",
              numerator: 1,
              denominator: 4,
              cause: "initial",
              acquiredOn: "",
            },
          ],
        },
      ],
    };
    const vendorReport = buildPropertyVendorTaxReport(property, people, []);

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[property]}
          vendorReport={vendorReport}
          selectedPersonId="owner"
          onChange={vi.fn()}
          onRecordDonation={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const death = container.querySelector(".succession-death-date");
    const transfer = container.querySelector(".lifetime-transfer-step");
    const balance = container.querySelector(".estate-balance-step");
    const succession = container.querySelector(".estate-succession-step");
    const causaMortis = container.querySelector(".causa-mortis-records");

    expect(transfer.textContent).toContain("Sale");
    expect(transfer.textContent).toContain("Anna Vella");
    expect(transfer.textContent).toContain("1/4");
    expect(balance.textContent).toContain("3/4");
    expect(balance.textContent).toContain(
      "Current value not shown because this is a historical share.",
    );
    expect(balance.textContent).not.toContain("€750,000.00");
    expect(death.compareDocumentPosition(transfer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      transfer.compareDocumentPosition(balance) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      balance.compareDocumentPosition(succession) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      succession.compareDocumentPosition(causaMortis) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("records a partial lifetime transfer, recalculates the death balance, and removes it on undo", () => {
    const initialCase = normaliseCase({
      id: "case",
      title: "Borg family",
      activeFamilyGroupId: "family",
      people: [
        {
          id: "owner",
          fullName: "Joseph Borg",
          sex: "Male",
          isDeceased: true,
          dateOfDeath: "2020-01-01",
          inheritanceBasis: "intestacy",
          designations: ["Deceased"],
          spouseIds: [],
        },
        {
          id: "child",
          fullName: "Paul Borg",
          sex: "Male",
          fatherId: "owner",
          spouseIds: [],
        },
        { id: "buyer", fullName: "Maria Vella", sex: "Female", spouseIds: [] },
      ],
      familyGroups: [
        {
          id: "family",
          title: "Borg family",
          rootPersonId: "owner",
          personIds: ["owner", "child", "buyer"],
        },
      ],
      properties: [
        {
          id: "property",
          address: "1 Republic Street",
          saleValue: 1_000_000,
          owners: [{ id: "initial-owner", personId: "owner", sharePercent: 100 }],
          declarations: [],
          transfers: [],
          saleLots: [],
        },
      ],
      outsideParties: [],
    });
    const onRecordDonation = vi.fn();
    const onInterVivosStatusChange = vi.fn();
    let latestCase = initialCase;

    function Harness() {
      const [caseData, setCaseData] = useState(initialCase);
      latestCase = caseData;
      const property = caseData.properties[0];
      const interVivosSession = statusToggleSession(caseData, "inter-vivos", "owner", property.id);

      const changeTransferStatus = (payload) => {
        onInterVivosStatusChange(payload);
        setCaseData((current) =>
          payload.checked
            ? beginStatusToggleSession(current, {
                type: "inter-vivos",
                personId: payload.personId,
                propertyId: payload.propertyId,
              })
            : endStatusToggleSession(current, {
                type: "inter-vivos",
                personId: payload.personId,
                propertyId: payload.propertyId,
                activeFamilyGroupId: "family",
              }),
        );
      };

      const recordTransfer = (payload) => {
        onRecordDonation(payload);
        setCaseData((current) =>
          normaliseCase({
            ...current,
            people: payload.people,
            properties: current.properties.map((candidate) =>
              candidate.id === payload.propertyId
                ? {
                    ...candidate,
                    transfers: [...(candidate.transfers || []), payload.transfer],
                  }
                : candidate,
            ),
          }),
        );
      };

      return (
        <PersonInspector
          people={caseData.people}
          properties={caseData.properties}
          outsideParties={caseData.outsideParties}
          selectedPersonId="owner"
          interVivosStatusSession={interVivosSession}
          onChange={(people) => setCaseData((current) => normaliseCase({ ...current, people }))}
          onInterVivosStatusChange={changeTransferStatus}
          onRecordDonation={recordTransfer}
          onSelectPerson={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));

    const transferCheckbox = () =>
      container.querySelector('input[aria-label="Sold/Donated Property Share"]');
    act(() => transferCheckbox().click());

    const measurement = container.querySelector('select[aria-label="Transfer measurement"]');
    const acquirer = container.querySelector('select[aria-label="Existing acquirer"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        measurement,
        "defined-share",
      );
      measurement.dispatchEvent(new Event("change", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        acquirer,
        "buyer",
      );
      acquirer.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const numerator = container.querySelector('input[aria-label="Transfer numerator"]');
    const denominator = container.querySelector('input[aria-label="Transfer denominator"]');
    const transferDate = container.querySelector('input[aria-label="Donation date"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(numerator, "1");
      numerator.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        denominator,
        "4",
      );
      denominator.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        transferDate,
        "01/01/2019",
      );
      transferDate.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const submit = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Record donation",
    );
    act(() => submit.click());

    expect(onRecordDonation).toHaveBeenCalledTimes(1);
    const payload = onRecordDonation.mock.calls[0][0];
    expect(payload).toMatchObject({ propertyId: "property" });
    expect(payload.transfer).toMatchObject({
      kind: "donation",
      sellerId: "owner",
      buyerId: "buyer",
      numerator: "1",
      denominator: "4",
      amountType: "whole-property",
      date: "2019-01-01",
    });
    expect(payload.transfer.statusToggleSessionId).toBeTruthy();
    expect(latestCase.properties[0].transfers).toHaveLength(1);

    const death = container.querySelector(".succession-death-date");
    const transfer = container.querySelector(".lifetime-transfer-step");
    const balance = container.querySelector(".estate-balance-step");
    const succession = container.querySelector(".estate-succession-step");
    const causaMortis = container.querySelector(".causa-mortis-records");
    expect(transfer.textContent).toContain("Donation");
    expect(transfer.textContent).toContain("Maria Vella");
    expect(transfer.textContent).toContain("1/4");
    expect(balance.textContent).toContain("3/4");
    expect(death.compareDocumentPosition(transfer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      transfer.compareDocumentPosition(balance) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      balance.compareDocumentPosition(succession) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      succession.compareDocumentPosition(causaMortis) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    act(() => transferCheckbox().click());

    expect(onInterVivosStatusChange).toHaveBeenLastCalledWith({
      checked: false,
      personId: "owner",
      propertyId: "property",
    });
    expect(latestCase.properties[0].transfers).toEqual([]);
    expect(statusToggleSession(latestCase, "inter-vivos", "owner", "property")).toBeNull();
    expect(container.querySelector(".lifetime-transfer-step")).toBeNull();
    expect(container.querySelector(".estate-balance-step").textContent).toContain("1/1");
  });

  it("allows repeated pre-death donations and a CM declaration for an inherited share", () => {
    const initialCase = normaliseCase({
      id: "inherited-share-case",
      title: "Borg family",
      activeFamilyGroupId: "family",
      people: [
        {
          id: "ancestor",
          fullName: "Anthony Borg",
          sex: "Male",
          isDeceased: true,
          dateOfDeath: "2010-01-01",
          inheritanceBasis: "intestacy",
          designations: ["Deceased"],
          spouseIds: [],
        },
        {
          id: "owner",
          fullName: "Joseph Borg",
          sex: "Male",
          fatherId: "ancestor",
          isDeceased: true,
          dateOfDeath: "2025-01-01",
          inheritanceBasis: "intestacy",
          designations: ["Deceased"],
          spouseIds: [],
        },
        {
          id: "heir",
          fullName: "Paul Borg",
          sex: "Male",
          fatherId: "owner",
          spouseIds: [],
        },
        { id: "buyer-a", fullName: "Maria Vella", sex: "Female", spouseIds: [] },
        { id: "buyer-b", fullName: "Anna Galea", sex: "Female", spouseIds: [] },
      ],
      familyGroups: [
        {
          id: "family",
          title: "Borg family",
          rootPersonId: "ancestor",
          personIds: ["ancestor", "owner", "heir", "buyer-a", "buyer-b"],
        },
      ],
      properties: [
        {
          id: "property",
          address: "1 Republic Street",
          saleValue: 1_000_000,
          owners: [{ id: "initial-owner", personId: "ancestor", sharePercent: 100 }],
          declarations: [],
          transfers: [],
          saleLots: [],
        },
      ],
      outsideParties: [],
    });
    let latestCase = initialCase;

    function Harness() {
      const [caseData, setCaseData] = useState(initialCase);
      latestCase = caseData;
      const recordTransfer = (payload) =>
        setCaseData((current) =>
          normaliseCase({
            ...current,
            people: payload.people,
            properties: current.properties.map((property) =>
              property.id === payload.propertyId
                ? {
                    ...property,
                    transfers: [...(property.transfers || []), payload.transfer],
                  }
                : property,
            ),
          }),
        );
      return (
        <PersonInspector
          people={caseData.people}
          properties={caseData.properties}
          outsideParties={caseData.outsideParties}
          selectedPersonId="owner"
          onChange={(people) => setCaseData((current) => normaliseCase({ ...current, people }))}
          onRecordDonation={recordTransfer}
          onSelectPerson={vi.fn()}
        />
      );
    }

    const setSelect = (selector, value) => {
      const select = container.querySelector(selector);
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
          select,
          value,
        );
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };
    const setInput = (selector, value) => {
      const input = container.querySelector(selector);
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    const recordDefinedDonation = (buyerId, date) => {
      setSelect('select[aria-label="Transfer measurement"]', "defined-share");
      setSelect('select[aria-label="Existing acquirer"]', buyerId);
      setInput('input[aria-label="Transfer numerator"]', "1");
      setInput('input[aria-label="Transfer denominator"]', "4");
      setInput('input[aria-label="Donation date"]', date);
      const submit = [...container.querySelectorAll("button")].find(
        (button) => button.textContent.trim() === "Record donation",
      );
      act(() => submit.click());
    };

    act(() => root.render(<Harness />));
    expect(container.querySelector(".estate-balance-step").textContent).toContain("1/1");

    act(() => container.querySelector('input[aria-label="Sold/Donated Property Share"]').click());
    recordDefinedDonation("buyer-a", "01/01/2015");
    expect(latestCase.properties[0].transfers).toHaveLength(1);
    expect(container.querySelector(".estate-balance-step").textContent).toContain("3/4");

    const addAnother = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Add another transfer",
    );
    act(() => addAnother.click());
    recordDefinedDonation("buyer-b", "01/01/2020");
    expect(latestCase.properties[0].transfers).toHaveLength(2);
    expect(container.querySelector(".estate-balance-step").textContent).toContain("1/2");

    const insertCm = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Insert CM Declaration"),
    );
    expect(insertCm).not.toBeUndefined();
    act(() => insertCm.click());
    expect(
      latestCase.people.find((person) => person.id === "owner").causaMortisDeclarations,
    ).toHaveLength(1);
    expect(container.textContent).toContain("Declaration Causa Mortis 1");
  });
});

describe("PersonInspector legacy lifetime disposal records", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("does not treat a legacy lifetime-disposal marker alone as a saved transfer disclosure", () => {
    act(() =>
      root.render(
        <PersonInspector
          people={[
            {
              id: "d",
              fullName: "Joseph Borg",
              isDeceased: true,
              dateOfDeath: "2020-01-01",
              inheritanceBasis: "lifetime-disposal",
              spouseIds: [],
              designations: ["Deceased"],
            },
          ]}
          selectedPersonId="d"
          onChange={vi.fn()}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).not.toContain("Sold / donated during lifetime");
    expect(container.querySelector(".person-succession")).not.toBeNull();
    expect(container.querySelector('input[aria-label="Sold/Donated Property Share"]').checked).toBe(
      false,
    );
    expect(container.querySelector('[data-person-section="donation"]')).toBeNull();
  });

  it("keeps a completed full transfer available for undo and omits property succession controls", () => {
    const people = [
      {
        id: "d",
        fullName: "Joseph Borg",
        isDeceased: true,
        dateOfDeath: "2020-01-01",
        inheritanceBasis: "lifetime-disposal",
        spouseIds: [],
        designations: ["Deceased"],
      },
      { id: "buyer", fullName: "Maria Vella", spouseIds: [], designations: [] },
    ];
    const property = {
      id: "property",
      owners: [{ id: "owner", personId: "d", sharePercent: 100 }],
      transfers: [
        {
          id: "transfer",
          sellerId: "d",
          buyerId: "buyer",
          numerator: 1,
          denominator: 1,
          amountType: "seller-holding",
          date: "2019-01-01",
        },
      ],
    };

    const onInterVivosStatusChange = vi.fn();

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[property]}
          selectedPersonId="d"
          onChange={vi.fn()}
          onInterVivosStatusChange={onInterVivosStatusChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const transferCheckbox = container.querySelector(
      'input[aria-label="Sold/Donated Property Share"]',
    );
    expect(transferCheckbox.checked).toBe(true);
    expect(transferCheckbox.disabled).toBe(false);
    expect(container.querySelector(".estate-balance-step").textContent).toContain("0/1");
    expect(container.querySelector(".estate-balance-step").textContent).toContain(
      "Current value not calculated",
    );
    expect(container.querySelector(".person-succession").classList).toContain("fully-transferred");
    expect(container.querySelector(".estate-succession-step")).toBeNull();

    act(() => transferCheckbox.click());
    expect(onInterVivosStatusChange).toHaveBeenCalledWith({
      checked: false,
      personId: "d",
      propertyId: "property",
    });
  });
});

describe("PersonInspector reversible status controls", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("restores the pre-click person and deletes parent records created by the deceased session", () => {
    const initialCase = normaliseCase({
      id: "case",
      title: "Borg family",
      activeFamilyGroupId: "family",
      people: [
        {
          id: "person",
          fullName: "Michael Borg",
          givenNames: "Michael",
          surname: "Borg",
          sex: "Male",
          designations: ["Owner"],
          isDeceased: false,
          dateOfDeath: "",
          inheritanceBasis: "intestacy",
          fatherId: "",
          fatherExplicitlyUnassigned: false,
          motherId: "",
          motherExplicitlyUnassigned: false,
          spouseIds: [],
          siblingIds: [],
        },
      ],
      familyGroups: [
        {
          id: "family",
          title: "Borg family",
          rootPersonId: "person",
          personIds: ["person"],
        },
      ],
      properties: [],
      outsideParties: [],
    });
    const originalPerson = structuredClone(initialCase.people[0]);

    function Harness() {
      const [caseData, setCaseData] = useState(initialCase);
      const session = statusToggleSession(caseData, "deceased", "person");
      const replacePeople = (current, nextPeople) =>
        normaliseCase({
          ...current,
          people: nextPeople,
          familyGroups: current.familyGroups.map((group) =>
            group.id === "family"
              ? { ...group, personIds: nextPeople.map((person) => person.id) }
              : group,
          ),
        });

      const changeDeceasedStatus = ({ checked, personId, people, patch }) => {
        setCaseData((current) => {
          let next = checked
            ? beginStatusToggleSession(current, { type: "deceased", personId })
            : current;
          next = replacePeople(
            next,
            people.map((person) => (person.id === personId ? { ...person, ...patch } : person)),
          );
          return checked
            ? next
            : endStatusToggleSession(next, {
                type: "deceased",
                personId,
                activeFamilyGroupId: "family",
              });
        });
      };

      return (
        <>
          <PersonInspector
            people={caseData.people}
            selectedPersonId="person"
            familyPersonIds={caseData.familyGroups[0].personIds}
            deceasedStatusSession={session}
            onChange={(people) => setCaseData((current) => replacePeople(current, people))}
            onDeceasedStatusChange={changeDeceasedStatus}
            onSelectPerson={vi.fn()}
          />
          <output data-testid="case-state">{JSON.stringify(caseData)}</output>
        </>
      );
    }

    act(() => root.render(<Harness />));
    const deceasedCheckbox = () =>
      [...container.querySelectorAll('input[type="checkbox"]')].find((input) =>
        input.parentElement.textContent.includes("This person is deceased."),
      );

    act(() => deceasedCheckbox().click());
    const deathDate = container.querySelector(".succession-death-date input");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        deathDate,
        "01/01/2020",
      );
      deathDate.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const addParents = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Add missing parents"),
    );
    expect(addParents).toBeTruthy();
    act(() => addParents.click());

    let caseState = JSON.parse(container.querySelector('[data-testid="case-state"]').textContent);
    expect(caseState.people).toHaveLength(3);
    expect(
      caseState.people.filter((person) => person.statusToggleSessionRole === "potential-parent"),
    ).toHaveLength(2);
    expect(caseState.people.find((person) => person.id === "person")).toMatchObject({
      isDeceased: true,
      fatherId: expect.any(String),
      motherId: expect.any(String),
    });

    act(() => deceasedCheckbox().click());
    caseState = JSON.parse(container.querySelector('[data-testid="case-state"]').textContent);
    expect(caseState.people).toEqual([originalPerson]);
    expect(caseState.familyGroups[0].personIds).toEqual(["person"]);
    expect(caseState.statusToggleSessions).toEqual([]);
    expect(container.querySelector(".person-succession")).toBeNull();
  });

  it("clears an unfinished transfer draft when unchecked and starts clean when reopened", () => {
    const people = [
      { id: "seller", fullName: "Joseph Borg", spouseIds: [], designations: [] },
      { id: "buyer", fullName: "Maria Vella", spouseIds: [], designations: [] },
    ];
    const property = {
      id: "property",
      owners: [{ id: "owner", personId: "seller", sharePercent: 100 }],
      transfers: [],
      declarations: [],
      saleLots: [],
    };
    const onInterVivosStatusChange = vi.fn();
    const vendorReport = buildPropertyVendorTaxReport(property, people, []);

    act(() =>
      root.render(
        <PersonInspector
          people={people}
          properties={[property]}
          vendorReport={vendorReport}
          selectedPersonId="seller"
          onChange={vi.fn()}
          onRecordDonation={vi.fn()}
          onInterVivosStatusChange={onInterVivosStatusChange}
          onSelectPerson={vi.fn()}
        />,
      ),
    );

    const transferCheckbox = () =>
      container.querySelector('input[aria-label="Sold/Donated Property Share"]');
    act(() => transferCheckbox().click());
    const acquirer = container.querySelector('select[aria-label="Existing acquirer"]');
    const transferDate = container.querySelector('input[aria-label="Donation date"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
        acquirer,
        "buyer",
      );
      acquirer.dispatchEvent(new Event("change", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        transferDate,
        "01/02/2020",
      );
      transferDate.dispatchEvent(new Event("input", { bubbles: true }));
    });

    act(() => transferCheckbox().click());
    expect(container.querySelector(".person-donation-form")).toBeNull();
    expect(onInterVivosStatusChange).toHaveBeenNthCalledWith(2, {
      checked: false,
      personId: "seller",
      propertyId: "property",
    });

    act(() => transferCheckbox().click());
    expect(container.querySelector('select[aria-label="Existing acquirer"]').value).toBe("");
    expect(container.querySelector('input[aria-label="Donation date"]').value).toBe("");
    expect(container.querySelector('select[aria-label="Transfer measurement"]').value).toBe(
      "all-share",
    );
  });
});
