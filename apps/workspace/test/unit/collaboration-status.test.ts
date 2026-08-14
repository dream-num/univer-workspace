import { CollaborationStatus } from "@univerjs-pro/collaboration-client";
import { describe, expect, it } from "vitest";
import { collaborationStatusMessageKey } from "../../client/src/features/editor/collaboration-status";

describe("collaborationStatusMessageKey", () => {
  it("distinguishes permission rejection from an editing conflict", () => {
    expect(
      collaborationStatusMessageKey(
        CollaborationStatus.CONFLICT,
        "permission"
      )
    ).toBe("collabPermissionError");
    expect(
      collaborationStatusMessageKey(
        CollaborationStatus.CONFLICT,
        "conflict"
      )
    ).toBe("collabConflict");
    expect(
      collaborationStatusMessageKey(CollaborationStatus.CONFLICT, null)
    ).toBe("collabConflict");
  });

  it("keeps the regular collaboration status labels", () => {
    expect(
      collaborationStatusMessageKey(CollaborationStatus.SYNCED, null)
    ).toBe("collabSynced");
    expect(
      collaborationStatusMessageKey(CollaborationStatus.OFFLINE, null)
    ).toBe("collabOffline");
    expect(
      collaborationStatusMessageKey(CollaborationStatus.PENDING, null)
    ).toBe("collabSyncing");
  });
});
