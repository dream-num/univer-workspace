import { expect, it } from "vitest";
import { previewMessages } from "./messages";

it("has the same keys, and the same warning and status keys, in both languages", () => {
  const shape = (value: unknown): unknown => value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item)])) : typeof value;
  expect(shape(previewMessages["zh-CN"])).toEqual(shape(previewMessages["en-US"]));
  for (const language of ["zh-CN", "en-US"] as const) {
    const messages = previewMessages[language];
    for (const [key, value] of Object.entries(messages)) if (typeof value === "string") expect(value, key).not.toBe("");
    expect(messages.trustReads(3)).toContain("3");
    expect(messages.errorRefused(403)).toContain("403");
  }
});
