import { describe, expect, it } from "vitest";
import type { WorkspaceShellProps } from "../../shell.types";
import { resolveFrame, type Frame } from "./frame";

const cases: readonly [string, WorkspaceShellProps, Frame][] = [
  ["home", { repositoryView: "home", selectedView: "home" }, { kind: "home" }],
  ["legacy home", { repositoryHome: true }, { kind: "home" }],
  ...(["repositories", "worktrees", "issues", "recent", "apps"] as const).map(
    (view): [string, WorkspaceShellProps, Frame] => [
      view,
      { repositoryView: view },
      { kind: "global", view },
    ],
  ),
  ...(["files", "issues", "prs", "apps", "settings"] as const).map(
    (tab): [string, WorkspaceShellProps, Frame] => [
      tab,
      { selectedSpaceId: "s", repositoryTab: tab },
      { kind: "repository", spaceId: "s", tab },
    ],
  ),
  ["space root", { selectedSpaceId: "s" }, { kind: "repository", spaceId: "s", tab: "files" }],
  [
    "folder",
    {
      selectedSpaceId: "s",
      selectedNodeId: "folder",
      contentMode: "default",
      repositoryTab: "files",
    },
    { kind: "repository", spaceId: "s", tab: "files" },
  ],
  [
    "members",
    {
      selectedSpaceId: "s",
      repositoryTab: "settings",
      repositoryBreadcrumbs: [{ label: "Members" }],
    },
    { kind: "repository", spaceId: "s", tab: "settings" },
  ],
  [
    "trash",
    { selectedSpaceId: "s", repositoryTab: "settings", headerTitle: "Trash" },
    { kind: "repository", spaceId: "s", tab: "settings" },
  ],
  [
    "PR detail",
    { selectedSpaceId: "s", repositoryTab: "prs" },
    { kind: "repository", spaceId: "s", tab: "prs" },
  ],
  ["direct PR fallback", { repositoryView: "worktrees" }, { kind: "global", view: "worktrees" }],
  [
    "editor",
    { selectedSpaceId: "s", selectedNodeId: "n", contentMode: "editor" },
    { kind: "document" },
  ],
  [
    "unit review",
    { selectedSpaceId: "s", repositoryTab: "prs", contentMode: "editor" },
    { kind: "document" },
  ],
  ["no-space worktrees", { selectedView: "worktrees" }, { kind: "document" }],
  ["no-space review", { contentMode: "editor" }, { kind: "document" }],
  [
    "immersive",
    { selectedSpaceId: "s", contentMode: "editor", immersive: true },
    { kind: "immersive" },
  ],
  ["immersive wins", { repositoryView: "home", immersive: true }, { kind: "immersive" }],
  ["default", {}, { kind: "document" }],
];

describe("Repository frames", () => {
  it.each(cases)("resolves %s", (_name, props, frame) => {
    expect(resolveFrame(props)).toEqual(frame);
  });
});
