import { expect, it } from "vitest";
import { htmlViewStylesResult } from "./style-result";

it("parses only successful html_view_styles structured results", () => {
  const catalog = { default: "night-gauge", styles: [
    { id: "night-gauge", name: { en: "Night Gauge", zh: "仪表夜航" }, mood: { en: "Charcoal, amber and cool cyan; a compact, calm cockpit", zh: "炭黑底配琥珀与冷青，紧凑沉稳的驾驶舱" } },
  ] };
  const output = { structuredContent: catalog };
  expect(htmlViewStylesResult("html_view_styles", output)).toEqual(catalog);
  expect(htmlViewStylesResult("html_view_create", output)).toBeNull();
  expect(htmlViewStylesResult("html_view_styles", { ...output, isError: true })).toBeNull();
  for (const invalid of [null, {}, "invalid JSON", { structuredContent: { default: "night-gauge", styles: [{}] } },
    { structuredContent: { ...catalog, styles: [{ ...catalog.styles[0], name: { en: "Night Gauge" } }] } }]) {
    expect(htmlViewStylesResult("html_view_styles", invalid)).toBeNull();
  }
});
