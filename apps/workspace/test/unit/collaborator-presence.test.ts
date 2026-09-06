import { SessionStatus, type MemberService } from "@univerjs-pro/collaboration-client";
import type { IMember } from "@univerjs/protocol";
import { BehaviorSubject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { uniqueCollaborators } from "../../web/src/features/editor/collaborator-members";
import { observeEditorCollaborators } from "../../web/src/features/editor/collaborator-presence";

const alice: IMember = { userID: "alice", memberID: "alice-1", name: "Alice" };
const bob: IMember = { userID: "bob", memberID: "bob-1", name: "Bob", avatar: "/bob.png" };

describe("collaborator presence", () => {
  it("counts users across connections, retains an available avatar and keeps self first", () => {
    const aliceWithAvatar = { ...alice, memberID: "alice-2", avatar: "/alice.png" };
    expect(uniqueCollaborators([alice, bob, aliceWithAvatar], "bob"))
      .toEqual([bob, aliceWithAvatar]);
    // Closing one connection must not remove a user who still has another connection.
    expect(uniqueCollaborators([bob, aliceWithAvatar], "bob"))
      .toEqual([bob, aliceWithAvatar]);
  });

  it("clears the disconnected room, rebuilds on rejoin and releases all listeners", () => {
    const rooms = new Map([
      ["unit-1", new BehaviorSubject<IMember[]>([alice, bob])],
      ["other-unit", new BehaviorSubject<IMember[]>([bob])],
    ]);
    const sessionStatus$ = new BehaviorSubject(SessionStatus.ONLINE);
    const onChange = vi.fn();
    const subscribeCollaborators = vi.fn((unitId: string, callback: (members: IMember[]) => void) => {
      const listener = rooms.get(unitId)!.subscribe(callback);
      return { dispose: () => listener.unsubscribe() };
    });
    const listener = observeEditorCollaborators({
      unitId: "unit-1",
      session: { sessionStatus$ },
      collaboration: { subscribeCollaborators },
      memberService: {
        getRoom: (unitId) => ({
          getAllMembers: () => rooms.get(unitId)!.value,
        }) as NonNullable<ReturnType<MemberService["getRoom"]>>,
        removeMember: (unitId, memberId) => {
          const room = rooms.get(unitId)!;
          room.next(room.value.filter((member) => member.memberID !== memberId));
        },
      },
      onChange,
    });
    expect(onChange).toHaveBeenLastCalledWith([alice, bob]);
    sessionStatus$.next(SessionStatus.OFFLINE);
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(rooms.get("unit-1")!.value).toEqual([]);
    expect(rooms.get("other-unit")!.value).toEqual([bob]);

    sessionStatus$.next(SessionStatus.JOINING);
    sessionStatus$.next(SessionStatus.ONLINE);
    // JOIN supplies the new list. Bob left while this client was disconnected.
    const reconnectedAlice = { ...alice, memberID: "alice-reconnected" };
    rooms.get("unit-1")!.next([reconnectedAlice]);
    expect(onChange).toHaveBeenLastCalledWith([reconnectedAlice]);
    expect(subscribeCollaborators).toHaveBeenCalledTimes(2);

    listener.dispose();
    expect(onChange).toHaveBeenLastCalledWith([]);
    onChange.mockClear();
    sessionStatus$.next(SessionStatus.OFFLINE);
    sessionStatus$.next(SessionStatus.ONLINE);
    rooms.get("unit-1")!.next([bob]);
    expect(onChange).not.toHaveBeenCalled();
    expect(subscribeCollaborators).toHaveBeenCalledTimes(2);
  });
});
