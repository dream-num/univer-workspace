import { afterEach, describe, expect, it, vi } from "vitest";

import { isMobileDevice } from "../../web/src/shared/platform";

function stubMatchMedia(matches: Record<string, boolean>) {
  vi.stubGlobal("window", {
    matchMedia: (query: string) => ({
      matches: matches[query] ?? false,
      media: query,
    }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isMobileDevice", () => {
  it("returns true for a coarse-only pointer (phone)", () => {
    stubMatchMedia({ "(pointer: coarse)": true });
    expect(isMobileDevice()).toBe(true);
  });

  it("returns false for a fine pointer even in a narrow window", () => {
    stubMatchMedia({ "(pointer: fine)": true, "(max-width: 720px)": true });
    expect(isMobileDevice()).toBe(false);
  });

  it("returns true for a wide tablet (coarse pointer, wide viewport)", () => {
    stubMatchMedia({ "(pointer: coarse)": true });
    expect(isMobileDevice()).toBe(true);
  });

  it("prefers desktop when both pointers are present (paired mouse)", () => {
    stubMatchMedia({ "(pointer: coarse)": true, "(pointer: fine)": true });
    expect(isMobileDevice()).toBe(false);
  });

  it("falls back to viewport width when no pointer query matches", () => {
    stubMatchMedia({ "(max-width: 720px)": true });
    expect(isMobileDevice()).toBe(true);
    stubMatchMedia({});
    expect(isMobileDevice()).toBe(false);
  });
});
