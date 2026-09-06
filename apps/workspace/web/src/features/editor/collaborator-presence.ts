import {
  SessionStatus,
  type CollaborationSession,
  type MemberService,
} from "@univerjs-pro/collaboration-client";
import type { FCollaboration } from "@univerjs-pro/collaboration-client/facade";
import type { IMember } from "@univerjs/protocol";
import { clearDisconnectedRoomMembers } from "./workarounds/collaboration-presence-members";

export function observeEditorCollaborators(options: {
  readonly unitId: string;
  readonly session: Pick<CollaborationSession, "sessionStatus$">;
  readonly collaboration: Pick<FCollaboration, "subscribeCollaborators">;
  readonly memberService: Pick<MemberService, "getRoom" | "removeMember">;
  readonly onChange: (members: readonly IMember[]) => void;
}): { dispose(): void } {
  let disposed = false;
  let membersListener: { dispose(): void } | null = null;
  const statusListener = options.session.sessionStatus$.subscribe((status) => {
    if (status !== SessionStatus.ONLINE) {
      membersListener?.dispose();
      membersListener = null;
      clearDisconnectedRoomMembers(options.memberService, options.unitId);
      options.onChange([]);
      return;
    }
    membersListener ??= options.collaboration.subscribeCollaborators(
      options.unitId,
      (members) => {
        if (!disposed) options.onChange(members);
      }
    );
  });
  return {
    dispose() {
      disposed = true;
      statusListener.unsubscribe();
      membersListener?.dispose();
      options.onChange([]);
    },
  };
}
