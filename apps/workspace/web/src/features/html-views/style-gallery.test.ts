// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { LanguageProvider } from "../../shared/i18n";
import { HtmlViewStyleGallery } from "./style-gallery";
import { htmlViewStylesResult } from "./style-result";

const output = { structuredContent: { default: "night-gauge", styles: [
  { id: "night-gauge", name: { en: "Night Gauge", zh: "仪表夜航" }, mood: { en: "Charcoal, amber and cool cyan; a compact, calm cockpit", zh: "炭黑底配琥珀与冷青，紧凑沉稳的驾驶舱" } },
  { id: "swiss-report", name: { en: "Swiss Report", zh: "瑞士财报" }, mood: { en: "Black, white and red; bold numbers and a crisp, disciplined grid", zh: "黑白红，大号数字与严谨网格" } },
  { id: "citron-poster", name: { en: "Citron Poster", zh: "柠檬海报" }, mood: { en: "Lemon yellow, deep green and bold oversized type", zh: "柠檬黄配深绿，醒目的超大字" } },
] } };

it.each(["zh-CN", "en-US"])("fills a localized reply without submitting in %s and disables unavailable actions", async (language) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.setItem("univer-workspace-language", language);
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const fill = vi.fn(); const send = vi.fn((event: Event) => event.preventDefault());
  const parsed = htmlViewStylesResult("html_view_styles", output);
  if (!parsed) throw new Error("Invalid fixture");
  const catalog = parsed;
  async function render(disabled: boolean, onFill: ((text: string) => void) | undefined) {
    await act(async () => root.render(createElement(LanguageProvider, null,
      createElement("form", { onSubmit: send }, createElement(HtmlViewStyleGallery, { catalog, onFill, disabled })))));
  }
  try {
    await render(false, fill);
    const zh = language === "zh-CN";
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.map((button) => button.querySelector("strong")?.textContent)).toEqual(catalog.styles.map((style) => style.name[zh ? "zh" : "en"]));
    expect(container.querySelector(".html-style-default")?.textContent).toBe(zh ? "默认" : "Default");
    expect(container.querySelectorAll(".html-style-default")).toHaveLength(1);
    expect(container.querySelector(".html-style-mood")?.textContent).toBe(catalog.styles[0]?.mood[zh ? "zh" : "en"]);
    for (const image of container.querySelectorAll("img")) {
      expect(image.alt).toBeTruthy(); expect(image.getAttribute("loading")).toBe("lazy"); expect(image.getAttribute("src")).toMatch(/\.webp/);
    }
    await act(async () => buttons[1]?.click());
    expect(fill).toHaveBeenCalledExactlyOnceWith(zh ? "用「瑞士财报」" : "Use Swiss Report");
    expect(send).not.toHaveBeenCalled();
    await render(true, fill);
    expect([...container.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
    await act(async () => buttons[0]?.click());
    expect(fill).toHaveBeenCalledTimes(1);
    await act(async () => root.render(createElement(LanguageProvider, null, createElement(HtmlViewStyleGallery, {
      catalog: { ...catalog, styles: catalog.styles.map((style) => ({ ...style, id: `missing-${style.id}` })) }, onFill: undefined, disabled: false,
    }))));
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect([...container.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
  }
});
