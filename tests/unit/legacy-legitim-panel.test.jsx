// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("automatically assumes an ordinary recorded child qualifies and takes", () => {
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

    expect(container.textContent).toContain("Children's legitim");
    expect(container.textContent).toContain("1/3 collectively");
    expect(container.textContent).toContain("Personal legitim 1/3");
    expect(container.textContent).toContain("assumed eligible and worthy");
    expect(container.textContent).toContain("will is ignored");
  });

  it("shows the automatically protected child share when a will names an outsider", () => {
    const people = [
      {
        id: "testator",
        fullName: "Testator Borg",
        isDeceased: true,
        dateOfDeath: "2005-02-28",
        inheritanceBasis: "will",
        willHeirs: [{ personId: "outsider", sharePercent: 100 }],
      },
      { id: "child", fullName: "Child Borg", fatherId: "testator" },
    ];

    act(() =>
      root.render(
        <LegacyLegitimPanel
          deceased={people[0]}
          people={people}
          shareDisplay="fraction"
          displayName={(person) => person.fullName}
          onUpdatePerson={() => {}}
        />,
      ),
    );

    expect(container.textContent).toContain("Personal legitim 1/3");
    expect(container.textContent).toContain("Effective share 1/3");
  });

  it("does not show a separate legitim workflow for intestacy", () => {
    const deceased = {
      id: "testator",
      fullName: "Testator Borg",
      isDeceased: true,
      dateOfDeath: "2005-02-28",
      inheritanceBasis: "intestacy",
      intestateHeirs: [{ personId: "child", sharePercent: 100 }],
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

  it("asks only for a complete will before applying the automatic shares", () => {
    const deceased = {
      id: "testator",
      fullName: "Testator Borg",
      isDeceased: true,
      dateOfDeath: "2005-02-28",
      inheritanceBasis: "will",
      willHeirs: [{ personId: "child", sharePercent: 50 }],
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

    expect(container.textContent).toContain(
      "Complete the will beneficiary allocation to 100% before applying",
    );
    expect(container.textContent).not.toContain("Effective share");
  });

  it("keeps exceptional child treatment available as an optional override", () => {
    const onUpdatePerson = vi.fn();
    const deceased = {
      id: "testator",
      fullName: "Testator Borg",
      isDeceased: true,
      dateOfDeath: "1990-01-01",
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
          onUpdatePerson={onUpdatePerson}
        />,
      ),
    );

    const exception = container.querySelector(
      'select[aria-label="Old-law exception for Child Borg"]',
    );
    expect(exception.value).toBe("automatic");
    act(() => {
      exception.value = "renounced";
      exception.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onUpdatePerson).toHaveBeenCalledWith("testator", {
      legacyArticle616Statuses: [
        {
          personId: "child",
          article616Eligibility: "qualifying",
          participation: "renounced",
        },
      ],
    });
  });

  it("does not render the old-law panel from 1 March 2005", () => {
    const deceased = {
      id: "testator",
      fullName: "Testator Borg",
      isDeceased: true,
      dateOfDeath: "2005-03-01",
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

    expect(container.textContent).toBe("");
  });
});
