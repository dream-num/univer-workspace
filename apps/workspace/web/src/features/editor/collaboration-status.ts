import { CollaborationStatus } from "@univerjs-pro/collaboration-client";
import type { MessageKey } from "../../shared/i18n";

export type CollaborationIssue = "conflict" | "permission" | null;

export function collaborationStatusMessageKey(
  status: CollaborationStatus,
  issue: CollaborationIssue
): MessageKey {
  switch (status) {
    case CollaborationStatus.SYNCED:
      return "collabSynced";
    case CollaborationStatus.OFFLINE:
      return "collabOffline";
    case CollaborationStatus.CONFLICT:
      return issue === "permission"
        ? "collabPermissionError"
        : "collabConflict";
    case CollaborationStatus.NOT_COLLAB:
      return "collabLocal";
    default:
      return "collabSyncing";
  }
}
