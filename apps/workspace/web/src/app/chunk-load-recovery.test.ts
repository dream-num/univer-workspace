import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installChunkLoadRecovery } from "./chunk-load-recovery";

let browser: EventTarget;
let storage: Map<string, string>;
let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  browser = new EventTarget();
  storage = new Map();
  reload = vi.fn();
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
  it("reloads a stale page once and suppresses its import failure", () => {
    installChunkLoadRecovery("/assets/index-old.js");

    expect(failImport().defaultPrevented).toBe(true);
    failImport();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not loop when the same build still fails after a reload", () => {
    installChunkLoadRecovery("/assets/index-old.js");
    failImport();
    installChunkLoadRecovery("/assets/index-old.js");

    expect(failImport().defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("allows a later build to recover in the same tab", () => {
    installChunkLoadRecovery("/assets/index-old.js");
    failImport();
    installChunkLoadRecovery("/assets/index-new.js");
    failImport();

    expect(reload).toHaveBeenCalledTimes(2);
  });

  it.each([
    "Importing a module script failed.",
    "error loading dynamically imported module: /assets/sheet-old.js",
    "Unable to preload CSS for /assets/sheet-old.css",
  ])("recovers from the browser load failure %s", (message) => {
    installChunkLoadRecovery("/assets/index-old.js");
    expect(failImport(message).defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("preserves application errors for the error boundary", () => {
    installChunkLoadRecovery("/assets/index-old.js");
    expect(failImport("[LocaleService]: Locale not initialized").defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("ignores preload events without an error payload", () => {
    installChunkLoadRecovery("/assets/index-old.js");
    const event = new Event("vite:preloadError", { cancelable: true });
    browser.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("keeps the original error when the reload marker cannot be saved", () => {
    window.sessionStorage.setItem = () => {
      throw new Error("Storage quota exceeded");
    };
    installChunkLoadRecovery("/assets/index-old.js");

    expect(failImport().defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
  });

  it("keeps the original error when storage is unavailable", () => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get: () => {
        throw new Error("Storage is disabled");
      },
    });
    installChunkLoadRecovery("/assets/index-old.js");
    expect(failImport().defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
