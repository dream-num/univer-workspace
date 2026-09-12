import { expect, it } from "vitest";
import { parseCellReference, parseHtmlView, getHtmlViewUnitIds } from "../src/index.js";

it("parses encoded IDs, normalizes A1 and groups multiple Units", () => {
  expect(parseCellReference("a%3Ab%25:s%3A1:aa7")).toEqual({
    unitId: "a:b%",
    sheetId: "s:1",
    row: 6,
    col: 26,
  });
  const view = parseHtmlView(
    '<p data-univer-cell-text="u:s:A1"></p><input type="number" data-univer-cell-model="u:s:A1"><p data-univer-cell-text="v:s:B2"></p>',
  );
  expect(getHtmlViewUnitIds(view)).toEqual(["u", "v"]);
  expect(view.bindings.map((b) => b.kind)).toEqual(["text", "model", "text"]);
  expect(view.html).toContain('data-univer-binding="2"');
});
it.each(["a:b", "a:b:A0", "a:b:A1:B2", "a:b:A1+1", "a:b:$A$1", "%:b:A1", ":b:A1"])(
  "rejects invalid references: %s",
  (value) => {
    expect(() => parseCellReference(value)).toThrow();
  },
);
it("reports the element and attribute and rejects incompatible bindings", () => {
  expect(() => parseHtmlView('<div data-univer-cell-model="u:s:A1"></div>')).toThrow(
    "cell-model requires",
  );
  expect(() => parseHtmlView('<input type="file" data-univer-cell-model="u:s:A1">')).toThrow(
    "input type",
  );
  expect(() => parseHtmlView('<select multiple data-univer-cell-model="u:s:A1"></select>')).toThrow(
    "single select",
  );
  expect(() => parseHtmlView('<p data-univer-cell-text="bad"></p>')).toThrow(
    "<p> at line 1: data-univer-cell-text",
  );
  expect(() =>
    parseHtmlView(
      '<p data-univer-cell-text="u:s:A1"><span data-univer-cell-text="u:s:A2"></span></p>',
    ),
  ).toThrow("contain another");
});
it("cleans active content and forged target IDs while preserving CSS and SVG", () => {
  const view = parseHtmlView(
    '<style>.x{color:red}</style><script>alert(1)</script><iframe src="https://x"></iframe><div onclick="bad()" data-univer-binding="99" data-univer-cell-text="u:s:A1"></div><svg><path d="M0 0L2 2" onload="bad()"/></svg>',
  );
  expect(view.html).toContain("script-src 'none'");
  expect(view.html).not.toMatch(/<script|<iframe|onclick|onload|binding="99"/);
  expect(view.html).toContain("<style>.x{color:red}</style>");
  expect(view.html).toContain('d="M0 0L2 2"');
});
it("preserves native form constraints and case-insensitive input types", () => {
  const view = parseHtmlView(
    '<input type="NUMBER" required min="0" data-univer-cell-model="u:s:A1">',
  );
  expect(view.html).toContain("required");
});
it("rejects text bindings on void elements that cannot display a value", () => {
  expect(() => parseHtmlView('<br data-univer-cell-text="u:s:A1">')).toThrow("content element");
});
