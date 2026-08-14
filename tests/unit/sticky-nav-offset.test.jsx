// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App.jsx";
import { saveLocalWorkspace } from "../../src/services/localWorkspace.js";
import {
  observeStickyNavOffset,
  STICKY_NAV_OFFSET_PROPERTY,
  syncStickyNavOffset,
} from "../../src/components/stickyNavOffset.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fakeShell = (height) => ({ getBoundingClientRect: () => ({ height }) });

describe("sticky navigation offset", () => {
  it("writes the measured sticky height onto the scrolling page", () => {
    const page = document.createElement("main");

    expect(syncStickyNavOffset(page, fakeShell(176.2))).toBe(177);
    expect(page.style.getPropertyValue(STICKY_NAV_OFFSET_PROPERTY)).toBe("177px");
  });

  it("keeps the stylesheet fallback when the navigation has not been laid out", () => {
    const page = document.createElement("main");

    expect(syncStickyNavOffset(page, fakeShell(0))).toBe(0);
    expect(page.style.getPropertyValue(STICKY_NAV_OFFSET_PROPERTY)).toBe("");
  });

  it("ignores a missing page or navigation instead of throwing", () => {
    expect(syncStickyNavOffset(null, fakeShell(120))).toBe(0);
    expect(syncStickyNavOffset(document.createElement("main"), null)).toBe(0);
    expect(observeStickyNavOffset(null, null)).toBeInstanceOf(Function);
  });

  it("re-measures whenever the sticky navigation changes height", () => {
    const page = document.createElement("main");
    let height = 121;
    const shell = { getBoundingClientRect: () => ({ height }) };
    const observed = [];
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback) {
          this.callback = callback;
        }
        observe(target) {
          observed.push(target);
          ResizeObserverStub.latest = this;
        }
        disconnect = disconnect;
      },
    );
    const ResizeObserverStub = { latest: null };

    const stop = observeStickyNavOffset(page, shell);
    expect(page.style.getPropertyValue(STICKY_NAV_OFFSET_PROPERTY)).toBe("121px");
    expect(observed).toEqual([shell]);

    height = 242;
    ResizeObserverStub.latest.callback();
    expect(page.style.getPropertyValue(STICKY_NAV_OFFSET_PROPERTY)).toBe("242px");

    stop();
    expect(disconnect).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("Property & Tax workspace sticky offset", () => {
  let container;
  let root;
  let originalRect;

  beforeEach(() => {
    window.localStorage.clear();
    originalRect = Element.prototype.getBoundingClientRect;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalRect;
    act(() => root.unmount());
    container.remove();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("reserves the measured menu height so a jumped-to section clears the sticky menu", () => {
    // The header wraps onto extra lines on a narrow screen: 191px is what the
    // shell measures on a 390px-wide phone, well past the old 8rem guess.
    Element.prototype.getBoundingClientRect = function getRect() {
      return this.classList?.contains("property-workspace-nav-shell")
        ? { height: 191, width: 390, top: 0, left: 0, right: 390, bottom: 191 }
        : { height: 0, width: 0, top: 0, left: 0, right: 0, bottom: 0 };
    };
    saveLocalWorkspace(
      [
        {
          id: "sticky-tree",
          title: "Borg family",
          people: [{ id: "person-1", fullName: "Joseph Borg" }],
          properties: [{ id: "property-1", address: "1 Republic Street", saleValue: "250000" }],
        },
      ],
      "sticky-tree",
      window.localStorage,
    );

    act(() => root.render(<App />));
    act(() => container.querySelector(".family-name-button").click());
    act(() => container.querySelector(".ownership-tax-button").click());

    const page = container.querySelector(".property-workspace-page");
    expect(page).not.toBeNull();
    expect(page.style.getPropertyValue(STICKY_NAV_OFFSET_PROPERTY)).toBe("191px");
  });
});
