// @vitest-environment jsdom
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { LanguageProvider } from "../../../shared/i18n";
import { createRoot } from "react-dom/client";
import { JsonView, LongText } from "./json-view";

it.each(["42", "true", "null", '\"hello\"'])("keeps the JSON primitive string %s as text", (value) => {
  const html = renderToStaticMarkup(createElement(LanguageProvider, null, createElement(JsonView, { value })));
  expect(html).not.toContain("JSON string");
  expect(html).toContain("<pre>");
});
it.each(['{"item":"value"}', '["value"]'])("parses the structured JSON string %s in place", (value) => {
  const html = renderToStaticMarkup(createElement(LanguageProvider, null, createElement(JsonView, { value })));
  expect(html).toContain("JSON string");
  expect(html).toContain("value");
});


it("R3 folds short text over 30 lines to ten lines and expands it in full", async () => {
  const text = Array.from({ length: 31 }, (_, index) => `L${index}`).join("\n");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(LanguageProvider, null, createElement(LongText, { text }))));
    const preview = container.querySelector("pre")?.textContent ?? "";
    expect(preview.split("\n")).toHaveLength(10);
    expect(preview.length).toBeLessThanOrEqual(241);
    expect(preview).not.toContain("L30");
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
    if (!toggle) throw new Error("Missing fold toggle");
    expect(toggle.textContent).toContain("31");
    await act(async () => toggle.click());
    expect(container.querySelector("pre")?.textContent).toBe(text);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
