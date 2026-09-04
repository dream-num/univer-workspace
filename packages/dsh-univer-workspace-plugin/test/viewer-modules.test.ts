import { afterEach, describe, expect, it, vi } from "vitest";
import { buildViewerUrls } from "../src/client/viewer/proxy.ts";
import {
  resolveViewerReadOnlyEnforcement,
  withReadOnlyPermissionLocale,
} from "../src/client/viewer/readonly.ts";
import type { ILanguagePack } from "@univerjs/core";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("embedded viewer seams", () => {
  it("keeps trunk and worktree transport URLs behind the same-origin proxy", () => {
    vi.stubGlobal("window", {
      location: { protocol: "https:", host: "viewer.test" },
    });

    const trunk = buildViewerUrls();
    const worktree = buildViewerUrls("draft/one");

    expect(trunk.snapshotServerUrl).toBe("/univer-workspace/collab/universer-api/snapshot");
    expect(trunk.collabWebSocketUrl).toBe(
      "wss://viewer.test/univer-workspace/collab/connect?target=%2Funiverser-api%2Fcomb%2Fconnect",
    );
    expect(worktree.snapshotServerUrl).toBe(
      "/univer-workspace/collab/universer-api/worktrees/draft%2Fone/snapshot",
    );
    expect(worktree.collabWebSocketUrl).toContain("worktrees%2Fdraft%252Fone%2Fcomb%2Fconnect");
  });

  it("selects sheet permissions while using a mutation gate for future unit presets", () => {
    expect(resolveViewerReadOnlyEnforcement("sheet", false)).toBe("sheet-permission");
    expect(resolveViewerReadOnlyEnforcement("doc", false)).toBe("mutation-gate");
    expect(resolveViewerReadOnlyEnforcement("sheet", true)).toBe("none");
  });

  it("deep-merges read-only copy without dropping native locale entries", () => {
    const source = {
      sheets: { permission: { dialog: { native: "keep" } } },
      "sheets-ui": { permission: { dialog: { native: "keep" } } },
    } as unknown as ILanguagePack;
    const merged = withReadOnlyPermissionLocale(source, { title: "Read only", message: "No edits" });
    const value = merged as unknown as {
      sheets: { permission: { dialog: { native: string; editErr: string } } };
      "sheets-ui": { permission: { dialog: { native: string; alert: string } } };
    };

    expect(value.sheets.permission.dialog.native).toBe("keep");
    expect(value.sheets.permission.dialog.editErr).toBe("No edits");
    expect(value["sheets-ui"].permission.dialog.native).toBe("keep");
    expect(value["sheets-ui"].permission.dialog.alert).toBe("Read only");
  });
});
