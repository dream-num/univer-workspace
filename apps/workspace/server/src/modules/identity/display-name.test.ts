import { describe, expect, it } from "vitest";
import { deriveDisplayName, validDisplayName } from "./display-name.js";

const HOSTILE: readonly (readonly [string, string, string])[] = [
  ["a right-to-left override", "Alice\u202Etxt.exe", "Alicetxt.exe"],
  ["isolates and embeddings", "\u2066a\u2068b\u202Ac\u202Bd\u202Ce", "abcde"],
  ["newlines and tabs", "Alice\r\n\tBob", "Alice Bob"],
  ["line and paragraph separators", "A\u2028B\u2029C", "A B C"],
  ["C0 and C1 controls", "a\u0000b\u001Bc\u0085d", "a b c d"],
  ["zero-width characters and the soft hyphen", "Cl\u200Ba\u200Cu\u200Dd\u2060e\uFEFF\u00AD", "Claude"],
  ["a Hangul filler between letters", "a\u3164b", "ab"],
  ["the blank Braille pattern", "a\u2800b", "a b"],
  ["a replacement character", "Claude\uFFFDCode", "ClaudeCode"],
  ["a lone surrogate", "Claude\uD800Code", "ClaudeCode"],
  ["CJK and spacing", "  克劳德   代码  ", "克劳德 代码"],
];

const INVISIBLE = ["\u3164", "\u2800", "\u115F\u1160", "\uFFA0", "\uFE0F", "\u200B\u202E\n", "\u3000 \u00A0"];

describe("display-name rule", () => {
  it.each(HOSTILE)("removes %s from typed and derived names", (_, raw, expected) => {
    expect(validDisplayName(raw)).toBe(expected);
    expect(deriveDisplayName(raw)).toBe(expected);
  });

  it.each(INVISIBLE)("refuses a typed name with nothing visible and derives nothing from it (%j)", (raw) => {
    expect(() => validDisplayName(raw)).toThrow(expect.objectContaining({
      code: "INVALID_INPUT", status: 400, field: "displayName", message: "Display name must contain a visible character.",
    }));
    expect(deriveDisplayName(raw)).toBe("");
  });

  it("refuses a typed email address and keeps only the local part of a derived one", () => {
    for (const typed of ["alice@example.com", "Alice <alice@example.com>", "a\u200B@example.com"]) {
      expect(() => validDisplayName(typed)).toThrow(expect.objectContaining({ field: "displayName", message: expect.stringMatching(/cannot contain an email address/u) }));
    }
    expect(deriveDisplayName("alice@example.com")).toBe("alice");
    expect(deriveDisplayName("Alice (alice@example.com)")).toBe("Alice (alice)");
    expect(deriveDisplayName("x@y.com@z.org")).toBe("x");
    expect(deriveDisplayName("odd@under_score.com")).toBe("odd");
    expect(validDisplayName("Team @acme.io")).toBe("Team @acme.io");
    expect(validDisplayName("me@home")).toBe("me@home");
  });

  it("refuses a typed name over 100 characters and cuts a derived one between graphemes", () => {
    expect(() => validDisplayName("x".repeat(101))).toThrow(expect.objectContaining({ field: "displayName" }));
    expect(validDisplayName("x".repeat(100))).toBe("x".repeat(100));
    expect(deriveDisplayName("x".repeat(150))).toBe("x".repeat(100));
    expect(deriveDisplayName(`${"a".repeat(39)}🇨🇳`, 40)).toBe("a".repeat(39));
    expect(deriveDisplayName(`${"a".repeat(36)}🇨🇳🇺🇸`, 40)).toBe(`${"a".repeat(36)}🇨🇳`);
    expect(deriveDisplayName(`${"a".repeat(37)}👍🏽`, 40)).toBe("a".repeat(37));
    expect(deriveDisplayName(`${"a".repeat(39)} ${"b".repeat(5)}`, 40)).toBe("a".repeat(39));
  });

  it("derives the same name again from a derived name", () => {
    const samples = [...HOSTILE.map(([, raw]) => raw), ...INVISIBLE, "alice@example.com", "x@y.com@z.org", "Alice (alice@example.com)", "🇨🇳".repeat(60)];
    for (const raw of samples) {
      const derived = deriveDisplayName(raw);
      expect(deriveDisplayName(derived)).toBe(derived);
      if (derived) expect(validDisplayName(derived)).toBe(derived);
    }
  });
});
