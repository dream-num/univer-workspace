import { describe, expect, it } from "vitest";
import { deriveDisplayName, validDisplayName } from "./display-name.js";

const HOSTILE: readonly (readonly [string, string, string])[] = [
  ["a right-to-left override", "Alice‮txt.exe", "Alicetxt.exe"],
  ["isolates and embeddings", "⁦a⁨b‪c‫d‬e", "abcde"],
  ["newlines and tabs", "Alice\r\n\tBob", "Alice Bob"],
  ["line and paragraph separators", "A B C", "A B C"],
  ["C0 and C1 controls", "a\u0000b\u001Bc\u0085d", "a b c d"],
  ["zero-width characters that join nothing", "‍Cl​a⁠u﻿d­e‌", "Claude"],
  ["joiners next to a space or a removed character", "Ann ‍Lee​‌x", "Ann Leex"],
  ["Hangul fillers between letters", "aㅤbᅠcﾠdᅟe", "abcde"],
  ["the blank Braille pattern", "a⠀b", "a b"],
  ["a replacement character", "Claude�Code", "ClaudeCode"],
  ["a lone surrogate", "Claude\uD800Code", "ClaudeCode"],
  ["variation selectors without a base", "️Sam ️️", "Sam"],
  ["tag characters outside a flag", "Eve\u{E0068}\u{E0069}\u{E007F} \u{1F600}\u{E0061}\u{E007F}", "Eve \u{1F600}"],
  ["an unterminated flag tag sequence", "\u{1F3F4}\u{E0067}\u{E0062} Eng", "\u{1F3F4} Eng"],
  ["CJK and spacing", "  克劳德   代码  ", "克劳德 代码"],
];

const LEGITIMATE = [
  "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466} Smith",
  "\u{1F3F3}️‍\u{1F308} Pride",
  "\u{1F1E8}\u{1F1F3} Beijing",
  "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F} Eng",
  "Sam ❤️",
  "#️⃣ first",
  "\u{1F9D1}\u{1F3FD}‍\u{1F4BB}",
  "نامه‌ای",
  "क्‍षिति",
  "葛\u{E0100}城",
  "Café",
  "Sean O’Brien",
  "@handle",
  "C@rl",
  "Team @acme.io",
  "me@home",
];

const INVISIBLE = [
  "ㅤ", "⠀", "ᅟᅠ", "ﾠ", "️", "​‮\n", "　  ", "‍‌",
  "́́́", "￼", "", "\u{F0000}́",
];

const ADDRESSES: readonly (readonly [string, string])[] = [
  ["alice@example.com", "alice"],
  ["Alice <alice@example.com>", "Alice <alice>"],
  ["Alice (alice@example.com)", "Alice (alice)"],
  ["x@y.com@z.org", "x"],
  ["odd@under_score.com", "odd"],
  ["a​@example.com", "a"],
  ["‮alice@example.com‬", "alice"],
  ["alice @ example.com", "alice"],
  ["alice@ example.com", "alice"],
  ["alice⠀@⠀example.com", "alice"],
  ["alice@@example.com", "alice"],
  ["alice＠example.com", "alice"],
  ["alice﹫example.com", "alice"],
  ["alice@example。com", "alice"],
  ["alice＠example．com", "alice"],
  ["mailto:alice@example.com", "alice"],
  ["MAILTO:alice@example.com", "alice"],
  ["ㅤ@example.com", ""],
  ["​ @ example.com", ""],
];

describe("display-name rule", () => {
  it.each(HOSTILE)("removes %s from typed and derived names", (_, raw, expected) => {
    expect(validDisplayName(raw)).toBe(expected);
    expect(deriveDisplayName(raw)).toBe(expected);
  });

  it.each(LEGITIMATE)("keeps %j byte for byte", (name) => {
    expect(validDisplayName(name)).toBe(name);
    expect(deriveDisplayName(name)).toBe(name);
  });

  it.each(INVISIBLE)("refuses a typed name with nothing visible and derives nothing from it (%j)", (raw) => {
    expect(() => validDisplayName(raw)).toThrow(expect.objectContaining({
      code: "INVALID_INPUT", status: 400, field: "displayName", message: "Display name must contain a visible character.",
    }));
    expect(deriveDisplayName(raw)).toBe("");
  });

  it.each(ADDRESSES)("refuses a typed address %j and keeps only its local part when derived", (raw, derived) => {
    expect(() => validDisplayName(raw)).toThrow(expect.objectContaining({ field: "displayName", message: expect.stringMatching(/cannot contain an email address/u) }));
    expect(deriveDisplayName(raw)).toBe(derived);
  });

  it("counts characters, refuses a typed name over 100 and cuts a derived one between graphemes", () => {
    expect(validDisplayName("x".repeat(100))).toBe("x".repeat(100));
    expect(validDisplayName("\u{1F600}".repeat(100))).toBe("\u{1F600}".repeat(100));
    for (const long of ["x".repeat(101), "\u{1F600}".repeat(101)]) {
      expect(() => validDisplayName(long)).toThrow(expect.objectContaining({ field: "displayName", message: "displayName must contain between 1 and 100 characters." }));
    }
    expect(deriveDisplayName("x".repeat(150))).toBe("x".repeat(100));
    expect(deriveDisplayName(`${"a".repeat(38)}🇨🇳`, 40)).toBe(`${"a".repeat(38)}🇨🇳`);
    expect(deriveDisplayName(`${"a".repeat(39)}🇨🇳`, 40)).toBe("a".repeat(39));
    expect(deriveDisplayName(`${"a".repeat(39)}👍🏽`, 40)).toBe("a".repeat(39));
    expect(deriveDisplayName(`${"a".repeat(39)} ${"b".repeat(5)}`, 40)).toBe("a".repeat(39));
    expect(deriveDisplayName(`${"a".repeat(38)}ه‌ا`, 40)).toBe(`${"a".repeat(38)}ه`);
  });

  it("answers a very long name within a small time budget", () => {
    const long = "a".repeat(50_000);
    const started = performance.now();
    expect(() => validDisplayName(long)).toThrow(expect.objectContaining({ field: "displayName", message: "displayName must contain between 1 and 100 characters." }));
    expect(deriveDisplayName(long)).toBe("a".repeat(100));
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("derives the same name again from a derived name", () => {
    const samples = [
      ...HOSTILE.map(([, raw]) => raw), ...LEGITIMATE, ...INVISIBLE, ...ADDRESSES.map(([raw]) => raw),
      "🇨🇳".repeat(60), `${"ه‌".repeat(60)}`,
    ];
    for (const raw of samples) {
      const derived = deriveDisplayName(raw);
      expect(deriveDisplayName(derived)).toBe(derived);
      if (derived) expect(validDisplayName(derived)).toBe(derived);
    }
  });
});
