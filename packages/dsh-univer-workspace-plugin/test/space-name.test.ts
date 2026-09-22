import { describe, expect, it, vi } from "vitest";
import type { WorkspaceSnapshot, WorkspaceSource } from "@deepseek-ai/dsh-api-workspace-controller/client";
import { localizedSpaceName, localizeWorkspaceNames } from "../src/client/space-name.ts";
import { en, zh } from "../src/client/locales.ts";
import type { WorkspaceSpace } from "../src/client/workspace-contract.ts";

const space: WorkspaceSpace = {
  spaceId: "personal", type: "personal", name: "liuyang 的个人空间",
  accessRole: "owner", dshWorkspaceId: "workspace",
};

describe("Space display names", () => {
  it("localizes generated personal names while preserving custom and team names", () => {
    expect(localizedSpaceName(space, en["workspace.personalSpaceName"])).toBe("liuyang's Personal Space");
    expect(localizedSpaceName(space, zh["workspace.personalSpaceName"])).toBe(space.name);
    expect(localizedSpaceName({ ...space, name: "我的资料" }, en["workspace.personalSpaceName"])).toBe("我的资料");
    expect(localizedSpaceName({ ...space, type: "team" }, en["workspace.personalSpaceName"])).toBe(space.name);
  });

  it("updates linked titles on locale/catalogue changes without mutating the source", () => {
    const snapshot: WorkspaceSnapshot = {
      items: [{ workspaceId: "workspace" as never, title: space.name, path: "/workspace",
        sessionIds: [], createdAt: "", updatedAt: "" }],
      archivedSessionIds: [], state: "idle", phase: "ready", error: null,
    };
    const source: WorkspaceSource = { getSnapshot: () => snapshot, subscribe: () => () => {} };
    const originalGet = source.getSnapshot;
    let template: string = en["workspace.personalSpaceName"];
    let spaces: readonly WorkspaceSpace[] = [];
    let changeLocale = () => {};
    const unsubscribeLocale = vi.fn();
    const names = localizeWorkspaceNames(source, () => spaces, () => template, listener => {
      changeLocale = listener;
      return unsubscribeLocale;
    });
    const listener = vi.fn();
    const unsubscribe = source.subscribe(listener);
    expect(source.getSnapshot().items[0]?.title).toBe(space.name);
    spaces = [space];
    names.invalidate();
    expect(listener).toHaveBeenCalledOnce();
    expect(source.getSnapshot().items[0]?.title).toBe("liuyang's Personal Space");
    expect(source.getSnapshot()).toBe(source.getSnapshot());
    expect(snapshot.items[0]?.title).toBe(space.name);
    template = zh["workspace.personalSpaceName"];
    changeLocale();
    expect(source.getSnapshot().items[0]?.title).toBe(space.name);
    names.dispose();
    expect(source.getSnapshot).toBe(originalGet);
    expect(unsubscribeLocale).toHaveBeenCalledOnce();
    unsubscribe();
  });
});
