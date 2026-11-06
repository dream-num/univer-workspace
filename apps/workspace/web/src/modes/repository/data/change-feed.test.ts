import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorktreeChangeFeed } from "../../../features/worktrees/worktree-change-feed";

const state = vi.hoisted((): {
  client: QueryClient | undefined;
  cleanup: (() => void) | undefined;
} => ({ client: undefined, cleanup: undefined }));
vi.mock("@tanstack/react-query", async (original) => ({
  ...await original<typeof import("@tanstack/react-query")>(),
  useQueryClient: () => state.client,
}));
vi.mock("react", () => ({ useEffect: (effect: () => (() => void) | undefined) => { state.cleanup = effect(); } }));
vi.mock("../../../features/nodes/nodes.commands", () => ({ invalidateProductLists: vi.fn() }));

afterEach(() => {
  state.cleanup?.();
  state.client?.clear();
  vi.unstubAllGlobals();
});

describe("Repository activity live refresh", () => {
  it.each(["worktreesChanged", "issuesChanged"])("invalidates cached activity on %s", async (event) => {
    const client = new QueryClient();
    state.client = client;
    const keys = [["activity", "alpha", "UTC"], ["activity", "beta", "Asia/Shanghai"]];
    for (const key of keys) client.setQueryData(key, { complete: true });
    client.setQueryData(["unrelated"], "keep");
    const socket = new EventTarget();
    const listen = vi.spyOn(socket, "addEventListener");
    vi.stubGlobal("window", { location: { protocol: "http:", host: "localhost" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ticket: "test-ticket" }))));
    vi.stubGlobal("WebSocket", class {
      addEventListener = socket.addEventListener.bind(socket);
      close() {}
    });
    useWorktreeChangeFeed(true);
    await vi.waitFor(() => expect(listen).toHaveBeenCalledWith("message", expect.any(Function)));
    socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ event }) }));
    expect(keys.map((key) => client.getQueryState(key)?.isInvalidated)).toEqual([true, true]);
    expect(client.getQueryState(["unrelated"])?.isInvalidated).toBe(false);
  });
});
