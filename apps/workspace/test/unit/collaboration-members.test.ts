import { BehaviorSubject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import type { IMember } from "@univerjs/protocol";
import { subscribeWorkspaceCollaborators } from "../../web/src/features/editor/workarounds/collaboration-members";

describe("collaborator presence lifecycle", () => {
  it("waits for a room, switches to its replacement, and clears disconnected presence", () => {
    const first = new BehaviorSubject(new Map<string, IMember>());
    const replacement = new BehaviorSubject(new Map<string, IMember>());
    const room = new BehaviorSubject<{ members$: typeof first } | undefined>(undefined);
    const receive = vi.fn();
    const adapter = { waitForRoom$: vi.fn(() => room) };
    const observer = subscribeWorkspaceCollaborators(adapter, "host", receive);
    expect(adapter.waitForRoom$).toHaveBeenCalledWith("host");
    expect(receive).toHaveBeenLastCalledWith([]);
    const alice = { memberID: "alice" } as IMember;
    room.next({ members$: first });
    first.next(new Map([["alice", alice]]));
    expect(receive).toHaveBeenLastCalledWith([alice]);
    room.next(undefined);
    expect(receive).toHaveBeenLastCalledWith([]);
    const calls = receive.mock.calls.length;
    first.next(new Map([["alice", alice]]));
    expect(receive).toHaveBeenCalledTimes(calls);
    room.next({ members$: replacement });
    replacement.next(new Map([["alice", alice]]));
    expect(receive).toHaveBeenLastCalledWith([alice]);
    observer.dispose();
    const disposedCalls = receive.mock.calls.length;
    replacement.next(new Map());
    room.next(undefined);
    expect(receive).toHaveBeenCalledTimes(disposedCalls);
  });
});
