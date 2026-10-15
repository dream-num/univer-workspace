import { describe, expect, it, vi } from "vitest";
import { modes } from "../modes/registry";
import { browserLanguage, messages, type ModeMessages } from "./i18n";

// 文案合同在 Node 中验证；注册表中的浏览器 Shell 和页面 由真实浏览器冒烟覆盖。
vi.mock("../modes/wiki/wiki-shell", () => ({ WikiShell: () => null }));
vi.mock("../modes/repository/repository-shell", () => ({ RepositoryShell: () => null }));
vi.mock("../modes/wiki/pages/home", () => ({ WikiHomePage: () => null }));
vi.mock("../modes/repository/pages/home", () => ({ RepositoryHomePage: () => null }));

describe("browserLanguage", () => {
  it("uses Chinese for any Chinese browser locale", () => {
    expect(browserLanguage(["zh-CN"])).toBe("zh-CN");
    expect(browserLanguage(["zh-TW", "en-US"])).toBe("zh-CN");
    expect(browserLanguage(["zh"])).toBe("zh-CN");
  });

  it("uses English for English browser locales", () => {
    expect(browserLanguage(["en-GB", "zh-CN"])).toBe("en-US");
  });

  it("picks the first supported preference", () => {
    expect(browserLanguage(["ja-JP", "zh-CN", "en-US"])).toBe("zh-CN");
  });

  it("falls back to English when no preference is supported", () => {
    expect(browserLanguage(["ja-JP", "fr-FR"])).toBe("en-US");
    expect(browserLanguage([])).toBe("en-US");
  });
});

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
    expect(Object.keys(overrides["zh-CN"] ?? {}).sort()).toEqual(
      Object.keys(overrides["en-US"] ?? {}).sort(),
    );
  });
});

vi.mock("../modes/wiki/pages/space", () => ({ WikiSpacePage: () => null }));

vi.mock("../modes/repository/pages/space", () => ({ RepositorySpacePage: () => null }));

vi.mock("../modes/wiki/pages/folder", () => ({ WikiFolderPage: () => null }));

vi.mock("../modes/repository/pages/folder", () => ({ RepositoryFolderPage: () => null }));

vi.mock("../modes/wiki/pages/settings", () => ({ WikiSpaceSettingsPage: () => null }));

vi.mock("../modes/repository/pages/settings", () => ({ RepositorySpaceSettingsPage: () => null }));

vi.mock("../modes/wiki/pages/members", () => ({ WikiTeamMembersPage: () => null }));

vi.mock("../modes/repository/pages/members", () => ({ RepositoryTeamMembersPage: () => null }));

vi.mock("../modes/wiki/pages/trash", () => ({ WikiSpaceTrashPage: () => null }));

vi.mock("../modes/repository/pages/trash", () => ({ RepositorySpaceTrashPage: () => null }));

vi.mock("../modes/wiki/pages/worktrees", () => ({ WikiWorktreesPage: () => null }));

vi.mock("../modes/repository/pages/worktrees", () => ({ RepositoryWorktreesPage: () => null }));

vi.mock("../modes/wiki/pages/issues", () => ({ WikiIssueLayout: () => null }));

vi.mock("../modes/repository/pages/issues", () => ({ RepositoryIssueLayout: () => null }));
