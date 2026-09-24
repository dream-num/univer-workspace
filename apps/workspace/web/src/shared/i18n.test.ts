import { describe, expect, it } from "vitest";
import { browserLanguage } from "./i18n";

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
