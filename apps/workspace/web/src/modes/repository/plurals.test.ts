import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider, useI18n, type MessageKey } from "../../shared/i18n";
import { repositoryMessages } from "./messages";

function translated(language: string, key: MessageKey, count: number, total = count) {
  vi.stubGlobal("window", { localStorage: { getItem: () => language } });
  function Text() {
    const { t } = useI18n();
    return t(key, { count, total, name: "Lin", repository: "Plans" });
  }
  return renderToStaticMarkup(createElement(LanguageProvider, { overrides: repositoryMessages }, createElement(Text)));
}

afterEach(() => vi.unstubAllGlobals());

describe("Repository count messages", () => {
  it.each([
    ["repositoryWorktreeUnits", "1 file", "2 files"],
    ["repositoryAboutMembers", "member", "members"],
    ["repositoryAboutStars", "star", "stars"],
    ["repositoryHomePullDescription", "Lin&#x27;s Pull request contains 1 file in Plans.", "Lin&#x27;s Pull request contains 2 files in Plans."],
    ["repositoryHomeAcross", "across 1 repository", "across 2 repositories"],
    ["dashboardResults", "1 repository found", "2 repositories found"],
    ["repositoryAppsSummary", "1 page. Choose it as the default page.", "2 pages. Choose one as the default page."],
    ["issueCommentCount", "1 comment", "2 comments"],
    ["issueReferenceCount", "1 linked file", "2 linked files"],
  ] satisfies readonly [MessageKey, string, string][])("pluralizes %s with mode overrides", (key, one, other) => {
    expect(translated("en-US", key, 1)).toBe(one);
    expect(translated("en-US", key, 2)).toBe(other);
  });

  it("uses the total for filtered item grammar and preserves zero and Chinese counts", () => {
    expect(translated("en-US", "filteredItemsCount", 0, 1)).toBe("Showing 0 of 1 item");
    expect(translated("en-US", "filteredItemsCount", 1, 2)).toBe("Showing 1 of 2 items");
    expect(translated("en-US", "repositoryWorktreeUnits", 0)).toBe("0 files");
    expect(translated("zh-CN", "repositoryWorktreeUnits", 1)).toBe("1 个文件");
    expect(translated("zh-CN", "repositoryWorktreeUnits", 2)).toBe("2 个文件");
  });
});
