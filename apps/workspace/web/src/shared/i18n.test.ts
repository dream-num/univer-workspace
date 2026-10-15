import { describe, expect, it } from "vitest";
import { modes } from "../modes/registry";
import { browserLanguage, messages, type ModeMessages } from "./i18n";

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
