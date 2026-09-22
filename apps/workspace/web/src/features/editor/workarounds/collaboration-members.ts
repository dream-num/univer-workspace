import type { IMember } from "@univerjs/protocol";
import type { MemberService } from "@univerjs-pro/collaboration-client";
import { of, switchMap, type Observable } from "rxjs";

type MemberRoom = Pick<NonNullable<ReturnType<MemberService["getRoom"]>>, "members$">;

/**
 * SDK 1.0.0-rc.0 subscribeCollaborators dereferences the initial missing room
 * emitted by waitForRoom$. Keep the subscription alive until the room exists,
 * and clear presence if it disappears. Remove when the SDK Facade handles this
 * lifecycle and the delayed-room/reconnect regressions pass without this adapter.
 */
export function subscribeWorkspaceCollaborators(
  members: { waitForRoom$(unitId: string): Observable<MemberRoom | undefined> },
  unitId: string,
  receive: (members: readonly IMember[]) => void,
) {
  const subscription = members.waitForRoom$(unitId).pipe(
    switchMap((room) => room?.members$ ?? of(new Map<string, IMember>())),
  ).subscribe((roomMembers) => receive(Array.from(roomMembers.values())));
  return { dispose: () => subscription.unsubscribe() };
}
