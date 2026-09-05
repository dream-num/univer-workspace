import { describe, expect, it, vi } from "vitest";
import type { ClientContext } from "../src/client/dsh-runtime-types.ts";

vi.mock("react", () => ({
  createElement: (...args: unknown[]) => ({ args }),
  useEffect: () => undefined,
  useState: <T>(value: T) => [value, vi.fn()],
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}),
// @ts-expect-error Vitest's runtime supports the virtual-module option.
{ virtual: true });
vi.mock("react/jsx-runtime", () => ({
  Fragment: "fragment",
  jsx: (...args: unknown[]) => ({ args }),
  jsxs: (...args: unknown[]) => ({ args }),
}),
// @ts-expect-error Vitest's runtime supports the virtual-module option.
{ virtual: true });
vi.mock("react/jsx-dev-runtime", () => ({
  Fragment: "fragment",
  jsxDEV: (...args: unknown[]) => ({ args }),
}),
// @ts-expect-error Vitest's runtime supports the virtual-module option.
{ virtual: true });
import { apply } from "../src/client/index.js";

/**
 * This is the smallest seam that reaches the shell's New Session callback:
 * the Harness composes the published DSH workspaces service, and must leave
 * its synchronous action intact.  A pending bootstrap must not be able to
 * defer the action (or make a click disappear).
 */
function contextFor(workspaces: Record<string, unknown>, sessions: Record<string, unknown>): ClientContext {
  const emptyStore = {
    getSnapshot: () => ({
      items: [],
      ids: [],
      byId: {},
      current: undefined,
      currentAddress: undefined,
      archivedSessionIds: [],
      state: "idle",
      phase: "pending",
      error: null,
      baselinesReady: false,
      recentWorkspaceId: undefined,
      subagentsByParent: {},
      jobsBySession: {},
    }),
    subscribe: () => () => {},
    set: vi.fn(),
  };
  const ctx = {
    plugin: vi.fn(),
    effect: (factory: () => unknown) => factory(),
    slots: { inject: vi.fn(), register: vi.fn() },
    locale: { register: vi.fn(), bind: () => (key: string) => key },
    settingsScope: { bind: () => ({}) },
    workspaces: { list: emptyStore, ...workspaces },
    sessions: { list: emptyStore, ...sessions },
    get: vi.fn(),
  };
  return ctx as unknown as ClientContext;
}

describe("Harness session lifecycle", () => {
  it("invokes the native New Session action synchronously", () => {
    const nativeStartSession = vi.fn();
    const workspaces = {
      startSession: nativeStartSession,
      rename: vi.fn(),
    };
    const sessions = {
      list: {
        ...contextFor({}, {}).sessions.list,
      },
    };
    const ctx = contextFor(workspaces, sessions);
    apply(ctx);

    const composed = (ctx as unknown as { workspaces: typeof workspaces }).workspaces.startSession;
    (composed as () => void)();

    expect(nativeStartSession).toHaveBeenCalledTimes(1);
  });
});
