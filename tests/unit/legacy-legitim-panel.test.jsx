// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LegacyLegitimPanel } from "../../src/components/LegacyLegitimPanel.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("LegacyLegitimPanel", () => {
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

  it("requires old-law child status confirmation before using article 616", () => {
    const deceased = {
      id: "testator",
      fullName: "Testator Borg",
      isDeceased: true,
      dateOfDeath: "2005-02-28",
      inheritanceBasis: "will",
      willHeirs: [{ personId: "outsider", sharePercent: 100 }],
    };
    const child = { id: "child", fullName: "Child Borg", fatherId: "testator" };

    act(() =>
      root.render(
        <LegacyLegitimPanel
          deceased={deceased}
          people={[deceased, child]}
          displayName={(person) => person.fullName}
          onUpdatePerson={() => {}}
        />,
      ),
    );

    expect(container.textContent).toContain("Old-law child legitim");
    expect(container.textContent).toContain("Confirm whether Child Borg qualifies");
    expect(container.textContent).toContain("never added on top");
    expect(container.textContent).toContain("does not change property ownership or tax");
  });

  it("shows an outsider-will shortfall after a qualifying child is confirmed", () => {
    function Harness() {
      const [people, setPeople] = useState([
        {
          id: "testator",
          fullName: "Testator Borg",
          isDeceased: true,
          dateOfDeath: "2005-02-28",
          inheritanceBasis: "will",
          willHeirs: [{ personId: "outsider", sharePercent: 100 }],
        },
        { id: "child", fullName: "Child Borg", fatherId: "testator" },
      ]);
      const deceased = people[0];
      return (
        <LegacyLegitimPanel
          deceased={deceased}
          people={people}
          shareDisplay="fraction"
          displayName={(person) => person.fullName}
          willAllocationValid
          onUpdatePerson={(personId, patch) =>
            setPeople((current) =>
              current.map((person) => (person.id === personId ? { ...person, ...patch } : person)),
            )
          }
        />
      );
    }

    act(() => root.render(<Harness />));
    const status = container.querySelector(
      'select[aria-label="Old article 616 status for Child Borg"]',
    );
    act(() => {
      status.value = "qualifying";
      status.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.textContent).toContain("1/3 collectively");
    expect(container.textContent).toContain("Personal minimum 1/3");
    expect(container.textContent).toContain("Indicative property shortfall 1/3");
  });

  it("marks the minimum as absorbed when an intestate child receives the whole estate", () => {
    const deceased = {
      id: "testator",
      fullName: "Testator Borg",
      isDeceased: true,
      dateOfDeath: "2005-02-28",
      inheritanceBasis: "intestacy",
      intestateHeirsConfirmed: true,
      intestateHeirs: [{ personId: "child", sharePercent: 100 }],
      legacyArticle616Statuses: [
        {
          personId: "child",
          article616Eligibility: "qualifying",
          participation: "participating",
        },
      ],
    };
    const child = { id: "child", fullName: "Child Borg", fatherId: "testator" };

    act(() =>
      root.render(
        <LegacyLegitimPanel
          deceased={deceased}
          people={[deceased, child]}
          shareDisplay="fraction"
          displayName={(person) => person.fullName}
          onUpdatePerson={() => {}}
        />,
      ),
    );

    expect(container.textContent).toContain("Personal minimum 1/3");
    expect(container.textContent).toContain("Property allocation 1/1");
    expect(container.textContent).toContain("Covered · absorbed in larger property share");
  });

  it("does not issue a satisfaction result for an incomplete will allocation", () => {
    const deceased = {
      id: "testator",
      fullName: "Testator Borg",
      isDeceased: true,
      dateOfDeath: "2005-02-28",
      inheritanceBasis: "will",
      willHeirs: [{ personId: "child", sharePercent: 50 }],
      legacyArticle616Statuses: [
        {
          personId: "child",
          article616Eligibility: "qualifying",
          participation: "participating",
        },
      ],
    };
    const child = { id: "child", fullName: "Child Borg", fatherId: "testator" };

    act(() =>
      root.render(
        <LegacyLegitimPanel
          deceased={deceased}
          people={[deceased, child]}
          displayName={(person) => person.fullName}
          onUpdatePerson={() => {}}
        />,
      ),
    );

    expect(container.textContent).toContain("Complete and confirm the inheritance allocation");
    expect(container.textContent).not.toContain("Covered by property share");
  });

  it("does not render the old-law panel from 1 March 2005", () => {
    const deceased = {
      id: "testator",
      fullName: "Testator Borg",
      isDeceased: true,
      dateOfDeath: "2005-03-01",
    };
    const child = { id: "child", fullName: "Child Borg", fatherId: "testator" };

    act(() =>
      root.render(
        <LegacyLegitimPanel
          deceased={deceased}
          people={[deceased, child]}
          displayName={(person) => person.fullName}
          onUpdatePerson={() => {}}
        />,
      ),
    );

    expect(container.textContent).toBe("");
  });
});
