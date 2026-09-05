import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyConversationInset,
  clearConversationInset,
  measureSurfaceLeft,
  measureWorktreeSurfaceWidth,
  observeSurfaceLeft,
} from "../src/client/layout/conversation-inset.ts";

class FakeStyle {
  readonly #properties = new Map<string, { value: string; priority: string }>();

  getPropertyValue(name: string): string {
    return this.#properties.get(name)?.value ?? "";
  }

  getPropertyPriority(name: string): string {
    return this.#properties.get(name)?.priority ?? "";
  }

  setProperty(name: string, value: string, priority = ""): void {
    this.#properties.set(name, { value, priority });
  }

  removeProperty(name: string): string {
    const value = this.getPropertyValue(name);
    this.#properties.delete(name);
    return value;
  }
}

class FakeElement {
  readonly style = new FakeStyle();
  parentElement: FakeElement | null = null;
  right = 0;

  getBoundingClientRect(): DOMRect {
    return { right: this.right } as DOMRect;
  }
}

class FakeResizeObserver {
  static current: FakeResizeObserver | undefined;

  readonly observe = vi.fn();
  readonly disconnect = vi.fn();

  constructor(readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.current = this;
  }

  publish(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

let scrollport: FakeElement | null;
let sidebar: FakeElement | null;
let reduceMotion: boolean;

beforeEach(() => {
  scrollport = new FakeElement();
  scrollport.parentElement = new FakeElement();
  sidebar = new FakeElement();
  sidebar.right = 312.4;
  reduceMotion = false;
  FakeResizeObserver.current = undefined;

  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("document", {
    querySelector: (selector: string) => {
      if (selector === "[data-conversation-scroll]") return scrollport;
      if (selector === '[data-plugin="dsh-univer-workspace"][data-surface="sidebar"]') {
        return sidebar;
      }
      return null;
    },
  });
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches: reduceMotion }),
  });
});

afterEach(() => {
  clearConversationInset();
  vi.unstubAllGlobals();
});

describe("Conversation inset adapter", () => {
  it("restores the exact pre-existing inline styles", () => {
    const host = scrollport?.parentElement as FakeElement;
    host.style.setProperty("padding-left", "7px", "important");
    host.style.setProperty("transition", "opacity 80ms linear", "important");

    expect(applyConversationInset(640)).toBe(host);
    expect(host.style.getPropertyValue("padding-left")).toBe("640px");
    expect(host.style.getPropertyValue("transition")).toBe("padding-left 160ms ease-in-out");

    clearConversationInset();
    expect(host.style.getPropertyValue("padding-left")).toBe("7px");
    expect(host.style.getPropertyPriority("padding-left")).toBe("important");
    expect(host.style.getPropertyValue("transition")).toBe("opacity 80ms linear");
    expect(host.style.getPropertyPriority("transition")).toBe("important");
  });

  it("keeps the original snapshot when the same host is updated", () => {
    const host = scrollport?.parentElement as FakeElement;
    host.style.setProperty("padding-left", "9px");

    applyConversationInset(640);
    applyConversationInset(720);
    clearConversationInset();

    expect(host.style.getPropertyValue("padding-left")).toBe("9px");
  });

  it("restores a replaced host before owning the next host", () => {
    const first = scrollport?.parentElement as FakeElement;
    first.style.setProperty("padding-left", "11px");
    applyConversationInset(640);

    const secondScrollport = new FakeElement();
    const second = new FakeElement();
    second.style.setProperty("padding-left", "13px");
    secondScrollport.parentElement = second;
    scrollport = secondScrollport;

    applyConversationInset(640);
    expect(first.style.getPropertyValue("padding-left")).toBe("11px");

    clearConversationInset();
    expect(second.style.getPropertyValue("padding-left")).toBe("13px");
  });

  it("restores the owned host when the Conversation DOM disappears", () => {
    const host = scrollport?.parentElement as FakeElement;
    host.style.setProperty("padding-left", "15px");
    applyConversationInset(640);

    scrollport = null;
    expect(applyConversationInset(640)).toBeNull();
    expect(host.style.getPropertyValue("padding-left")).toBe("15px");
  });

  it("disables animation for reduced motion", () => {
    reduceMotion = true;
    const host = scrollport?.parentElement as FakeElement;

    applyConversationInset(640);

    expect(host.style.getPropertyValue("transition")).toBe("none");
  });

  it("measures the sidebar edge and falls back when it is unavailable", () => {
    expect(measureSurfaceLeft()).toBe(312);
    sidebar = null;
    expect(measureSurfaceLeft()).toBe(280);
  });

  it("leaves the native Conversation its minimum width when sizing a Worktree page", () => {
    expect(measureWorktreeSurfaceWidth(1600, 280)).toBe(960);
    expect(measureWorktreeSurfaceWidth(1280, 280)).toBe(640);
    expect(measureWorktreeSurfaceWidth(600, 280)).toBe(0);
  });

  it("publishes sidebar geometry changes and releases its observer", () => {
    const listener = vi.fn();
    const stop = observeSurfaceLeft(listener);
    const observer = FakeResizeObserver.current;

    expect(listener).toHaveBeenCalledWith(312);
    expect(observer?.observe.mock.calls[0]?.[0]).toBe(sidebar);

    if (sidebar !== null) sidebar.right = 356.7;
    observer?.publish();
    expect(listener).toHaveBeenLastCalledWith(357);

    stop();
    expect(observer?.disconnect).toHaveBeenCalledOnce();
  });
});
