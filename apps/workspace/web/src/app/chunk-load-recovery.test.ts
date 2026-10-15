import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { installChunkLoadRecovery } from "./chunk-load-recovery";

let browser: EventTarget;
let notify: Mock<() => void>;
let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  browser = new EventTarget();
  notify = vi.fn();
  reload = vi.fn();
  const storage = new Map<string, string>();
  vi.stubGlobal(
    "window",
    Object.assign(browser, {
      location: { reload },
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function failImport(message = "Failed to fetch dynamically imported module: /assets/sheet-old.js") {
  const event = Object.assign(new Event("vite:preloadError", { cancelable: true }), {
    payload: new Error(message),
  });
  browser.dispatchEvent(event);
  return event;
}

describe("chunk load recovery", () => {
  it("offers recovery without refreshing or swallowing the original error", () => {
    installChunkLoadRecovery(notify);
    expect(failImport().defaultPrevented).toBe(false);
    expect(notify).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not refresh when failures repeat across reloads or builds", () => {
    for (const build of ["A", "B", "A", "B"]) {
      const dispose = installChunkLoadRecovery(notify);
      failImport(`Failed to fetch dynamically imported module: /assets/editor-${build}.js`);
      dispose();
    }
    expect(notify).toHaveBeenCalledTimes(4);
    expect(reload).not.toHaveBeenCalled();
  });

  it("still offers recovery after an earlier temporary network failure", () => {
    installChunkLoadRecovery(notify);
    failImport();
    failImport();
    expect(notify).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it.each([
    "Importing a module script failed.",
    "error loading dynamically imported module: /assets/sheet-old.js",
    "Unable to preload CSS for /assets/sheet-old.css",
  ])("offers recovery from %s", (message) => {
    installChunkLoadRecovery(notify);
    expect(failImport(message).defaultPrevented).toBe(false);
    expect(notify).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });

  it("leaves application errors to the existing error boundary", () => {
    installChunkLoadRecovery(notify);
    expect(failImport("[LocaleService]: Locale not initialized").defaultPrevented).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it("ignores preload events without an error payload", () => {
    installChunkLoadRecovery(notify);
    browser.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));
    expect(notify).not.toHaveBeenCalled();
  });

  it("works when session storage is disabled", () => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get: () => {
        throw new Error("Storage is disabled");
      },
    });
    installChunkLoadRecovery(notify);
    failImport();
    expect(notify).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });

  it("removes the listener when its owner unmounts", () => {
    const dispose = installChunkLoadRecovery(notify);
    dispose();
    failImport();
    expect(notify).not.toHaveBeenCalled();
  });
});
