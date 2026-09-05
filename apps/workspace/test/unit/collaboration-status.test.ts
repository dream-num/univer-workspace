import { CollaborationStatus } from "@univerjs-pro/collaboration-client";
import { describe, expect, it } from "vitest";
import { collaborationStatusMessageKey } from "../../web/src/features/editor/collaboration-status";

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

  it("can hide collaboration status without restoring the SDK display", async () => {
    Object.defineProperty(globalThis, "Path2D", {
      configurable: true,
      value: class Path2D {},
    });
    const { resolveCollaborationStatusPresentation } = await import(
      "../../web/src/features/editor/collaboration-editor"
    );
    expect(resolveCollaborationStatusPresentation(true, undefined)).toEqual({
      suppressNative: true,
      showCustom: false,
    });
    expect(resolveCollaborationStatusPresentation(undefined, true)).toEqual({
      suppressNative: true,
      showCustom: true,
    });
    expect(resolveCollaborationStatusPresentation(undefined, undefined)).toEqual({
      suppressNative: false,
      showCustom: false,
    });
    expect(resolveCollaborationStatusPresentation(true, true)).toEqual({
      suppressNative: true,
      showCustom: false,
    });
  }, 30_000);
});
