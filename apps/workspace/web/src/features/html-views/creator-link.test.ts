import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { LanguageProvider, useI18n, type AppLanguage } from "../../shared/i18n";
import { htmlViewCreatorLink, type HtmlViewCreatorRequest } from "./creator-link";

afterEach(() => vi.unstubAllGlobals());

const cases = [
  [{ kind: "new" }, "Help me create a page bound to spreadsheet data.", "帮我创建一个绑定表格数据的页面。"],
  [{ kind: "sheet", name: "Sales & 收入", resourceId: "sheet-id" }, 'Make a page from the Sheet "Sales & 收入" (resource sheet-id).', "把表格「Sales & 收入」(resource sheet-id) 做成页面。"],
  [{ kind: "change", name: "Sales.univer.html", resourceId: "page-id" }, 'Help me change the page "Sales.univer.html" (resource page-id).', "帮我修改页面「Sales.univer.html」(resource page-id)。"],
] satisfies readonly (readonly [HtmlViewCreatorRequest, string, string])[];

for (const language of ["en-US", "zh-CN"] satisfies AppLanguage[]) {
  it.each(cases)(`builds the %j entry in ${language}`, (request, english, chinese) => {
    vi.stubGlobal("window", { localStorage: { getItem: () => language } });
    let link: ReturnType<typeof htmlViewCreatorLink> | undefined;
    function ReadLink() {
      link = htmlViewCreatorLink("space-id", request, useI18n().t);
      return null;
    }
    renderToStaticMarkup(createElement(LanguageProvider, null, createElement(ReadLink)));
    expect(link).toEqual({
      to: "/spaces/$spaceId/agents", params: { spaceId: "space-id" },
      search: { prompt: `/html-view-creator ${language === "en-US" ? english : chinese}` },
    });
  });
}
