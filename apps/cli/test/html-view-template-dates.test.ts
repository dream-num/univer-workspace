import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";

describe.each(["night-gauge", "swiss-report", "broadsheet"])("%s start month", (name) => {
  let forecast: Script;

  beforeAll(async () => {
    const html = await readFile(
      new URL(`../skill-data/html-view/templates/${name}.univer.html`, import.meta.url),
      "utf8",
    );
    const source = html.match(/function forecast\(value\)\{[\s\S]*?(?=\nfunction renderTable)/)?.[0];
    if (!source) throw new Error(`Missing forecast function in ${name}`);
    forecast = new Script(`let START; ${source}\nforecast(value); START;`);
  });

  it.each(["2026-12", 46357, 46387, 46387.75])("accepts %j as December 2026", (input) => {
    expect(forecast.runInNewContext({ value: [[null, input]] })).toEqual({ y: 2026, m: 12 });
  });

  it.each([
    [46356, { y: 2026, m: 11 }],
    [46388, { y: 2027, m: 1 }],
    [0, { y: 1899, m: 12 }],
  ])("uses the spreadsheet epoch for %j", (input, expected) => {
    expect(forecast.runInNewContext({ value: [[null, input]] })).toEqual(expected);
  });

  it.each(["", "abc", null, true, "46357", "2026-00", "2026-13", NaN, Infinity, 1e20])(
    "rejects invalid month %j with a B7 error",
    (input) => {
      expect(() => forecast.runInNewContext({ value: [[null, input]] })).toThrow(/B7/);
    },
  );
});
