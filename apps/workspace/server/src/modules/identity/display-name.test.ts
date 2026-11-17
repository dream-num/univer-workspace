import { describe, expect, it } from "vitest";
import { deriveDisplayName, deriveUserDisplayName, isUnsafeDisplayName, validDisplayName } from "./display-name.js";

const HOSTILE: readonly (readonly [string, string, string])[] = [
  ["a right-to-left override", "Alice\u202Etxt.exe", "Alicetxt.exe"],
  ["isolates and embeddings", "\u2066a\u2068b\u202Ac\u202Bd\u202Ce", "abcde"],
  ["newlines and tabs", "Alice\r\n\tBob", "Alice Bob"],
  ["line and paragraph separators", "A\u2028B\u2029C", "A B C"],
  ["C0 and C1 controls", "a\u0000b\u001Bc\u0085d", "a b c d"],
  ["zero-width characters that join nothing", "\u200DCl\u200Ba\u2060u\uFEFFd\u00ADe\u200C", "Claude"],
  ["joiners next to a space or a removed character", "Ann \u200DLee\u200B\u200Cx", "Ann Leex"],
  ["Hangul fillers between letters", "a\u3164b\u1160c\uFFA0d\u115Fe", "abcde"],
  ["the blank Braille pattern", "a\u2800b", "a b"],
  ["a replacement character", "Claude\uFFFDCode", "ClaudeCode"],
  ["a lone surrogate", "Claude\uD800Code", "ClaudeCode"],
  ["variation selectors without a base", "\uFE0FSam \uFE0F\uFE0F", "Sam"],
  ["tag characters outside a flag", "Eve\u{E0068}\u{E0069}\u{E007F} \u{1F600}\u{E0061}\u{E007F}", "Eve \u{1F600}"],
  ["an unterminated flag tag sequence", "\u{1F3F4}\u{E0067}\u{E0062} Eng", "\u{1F3F4} Eng"],
];

const LEGITIMATE = [
  "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466} Smith",
  "\u{1F3F3}\uFE0F\u200D\u{1F308} Pride",
  "\u{1F1E8}\u{1F1F3} Beijing",
  "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F} Eng",
  "Sam ❤\uFE0F",
  "#\uFE0F\u20E3 first",
  "\u{1F9D1}\u{1F3FD}\u200D\u{1F4BB}",
  "نامه\u200Cای",
  "क्\u200Dषिति",
  "葛\u{E0100}城",
  "Cafe\u0301",
  "Sean O’Brien",
  "@handle",
  "C@rl",
  "Team @acme.io",
  "me@home",
];

const INVISIBLE = [
  "\u3164", "\u2800", "\u115F\u1160", "\uFFA0", "\uFE0F", "\u200B\u202E\n", "\u3000 \u00A0", "\u200D\u200C",
  "\u0301\u0301\u0301", "\uFFFC", "\uE000", "\u{F0000}\u0301",
];

const ADDRESSES: readonly (readonly [string, string])[] = [
  ["alice@example.com", "alice"],
  ["Alice <alice@example.com>", "Alice <alice>"],
  ["Alice (alice@example.com)", "Alice (alice)"],
  ["x@y.com@z.org", "x"],
  ["odd@under_score.com", "odd"],
  ["a\u200B@example.com", "a"],
  ["\u202Ealice@example.com\u202C", "alice"],
  ["alice @ example.com", "alice"],
  ["alice@ example.com", "alice"],
  ["alice\u2800@\u2800example.com", "alice"],
  ["alice@@example.com", "alice"],
  ["alice＠example.com", "alice"],
  ["alice﹫example.com", "alice"],
  ["alice@example。com", "alice"],
  ["alice＠example．com", "alice"],
  ["mailto:alice@example.com", "alice"],
  ["MAILTO:alice@example.com", "alice"],
  ["\u3164@example.com", ""],
  ["\u200B @ example.com", ""],
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

  it("collapses whitespace but does not flag a stored name for it", () => {
    expect(validDisplayName("  克劳德   代码  ")).toBe("克劳德 代码");
    expect(deriveDisplayName("  克劳德   代码  ")).toBe("克劳德 代码");
    expect(isUnsafeDisplayName("  克劳德\u3000\u3000代码  ")).toBe(false);
  });

  it("flags a stored name only for an address, a misleading character or nothing visible", () => {
    for (const name of LEGITIMATE) expect(isUnsafeDisplayName(name)).toBe(false);
    for (const name of [...HOSTILE.map(([, raw]) => raw), ...INVISIBLE, ...ADDRESSES.map(([raw]) => raw)]) {
      expect(isUnsafeDisplayName(name)).toBe(true);
    }
  });

  it("falls back through the rule to the next candidate and then to Workspace User", () => {
    expect(deriveUserDisplayName("bob@example.com", "bob")).toBe("bob");
    expect(deriveUserDisplayName("\u2800", "\u3164carol")).toBe("carol");
    expect(deriveUserDisplayName(undefined, "dave\u202E")).toBe("dave");
    expect(deriveUserDisplayName("\u3164", "\u1160")).toBe("Workspace User");
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
    expect(deriveDisplayName(`${"a".repeat(38)}ه\u200Cا`, 40)).toBe(`${"a".repeat(38)}ه`);
  });

  it("answers a very long name within a small time budget", () => {
    const started = performance.now();
    for (const long of ["a".repeat(50_000), "a\u200D".repeat(25_000), "a @ ".repeat(12_500)]) {
      expect(() => validDisplayName(long)).toThrow(expect.objectContaining({ field: "displayName", message: "displayName must contain between 1 and 100 characters." }));
      expect([...deriveDisplayName(long)].length).toBeGreaterThan(90);
      expect(isUnsafeDisplayName(long)).toBe(long.startsWith("a\u200D"));
    }
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("derives the same name again from a derived name", () => {
    const samples = [
      ...HOSTILE.map(([, raw]) => raw), ...LEGITIMATE, ...INVISIBLE, ...ADDRESSES.map(([raw]) => raw),
      "🇨🇳".repeat(60), `${"ه\u200C".repeat(60)}`,
    ];
    for (const raw of samples) {
      const derived = deriveDisplayName(raw);
      expect(deriveDisplayName(derived)).toBe(derived);
      if (derived) expect(validDisplayName(derived)).toBe(derived);
      if (derived) expect(isUnsafeDisplayName(derived)).toBe(false);
    }
  });
});
