import { describe, expect, it, vi } from "vitest";
import { modes } from "./registry";
import { messages, type ModeMessages } from "../shared/i18n";

// 文案合同在 Node 中验证；注册表中的浏览器 Shell 和页面 由真实浏览器冒烟覆盖。
vi.mock("./wiki/wiki-shell", () => ({ WikiShell: () => null }));
vi.mock("./repository/repository-shell", () => ({ RepositoryShell: () => null }));
vi.mock("./wiki/pages/home", () => ({ WikiHomePage: () => null }));
vi.mock("./repository/pages/home", () => ({ RepositoryHomePage: () => null }));

describe.each(Object.entries(modes))("%s mode messages", (_, definition) => {
  const overrides: ModeMessages = definition.messages;

  it("only overrides keys present in the base language", () => {
    for (const language of ["zh-CN", "en-US"] as const) {
      for (const key of Object.keys(overrides[language] ?? {})) {
        expect(Object.hasOwn(messages[language], key), `${language}/${key}`).toBe(true);
      }
    }
  });

  it("overrides the same keys in both languages", () => {
    expect(Object.keys(overrides["zh-CN"] ?? {}).sort()).toEqual(Object.keys(overrides["en-US"] ?? {}).sort());
  });
});

vi.mock("./wiki/pages/space", () => ({ WikiSpacePage: () => null }));

vi.mock("./repository/pages/space", () => ({ RepositorySpacePage: () => null }));

vi.mock("./wiki/pages/folder", () => ({ WikiFolderPage: () => null }));

vi.mock("./repository/pages/folder", () => ({ RepositoryFolderPage: () => null }));

vi.mock("./wiki/pages/settings", () => ({ WikiSpaceSettingsPage: () => null }));

vi.mock("./repository/pages/settings", () => ({ RepositorySpaceSettingsPage: () => null }));

vi.mock("./wiki/pages/members", () => ({ WikiTeamMembersPage: () => null }));

vi.mock("./repository/pages/members", () => ({ RepositoryTeamMembersPage: () => null }));

vi.mock("./wiki/pages/trash", () => ({ WikiSpaceTrashPage: () => null }));

vi.mock("./repository/pages/trash", () => ({ RepositorySpaceTrashPage: () => null }));

vi.mock("./wiki/pages/worktrees", () => ({ WikiWorktreesPage: () => null }));

vi.mock("./repository/pages/worktrees", () => ({ RepositoryWorktreesPage: () => null }));

vi.mock("./wiki/pages/issues", () => ({
  WikiIssueLayout: () => null,
  WikiIssueListPage: () => null,
  WikiIssueDetailPage: () => null,
}));

vi.mock("./repository/pages/issues", () => ({
  RepositoryIssueLayout: () => null,
  RepositoryIssueListPage: () => null,
  RepositoryIssueDetailPage: () => null,
}));
