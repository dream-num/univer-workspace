import type { MemberService } from "@univerjs-pro/collaboration-client";

/**
 * 当前 SDK baseline 在重新 JOIN 时追加成员，未清理断线前的名单。
 * 只在当前编辑器 Session 离线或重新 JOIN 时清理其本地 Unit 房间；
 * 上游 MemberService 在断线清理或 JOIN 时替换完整名单后删除此 workaround。
 */
export function clearDisconnectedRoomMembers(
  memberService: Pick<MemberService, "getRoom" | "removeMember">,
  unitId: string
): void {
  for (const member of memberService.getRoom(unitId)?.getAllMembers() ?? []) {
    memberService.removeMember(unitId, member.memberID);
  }
}
