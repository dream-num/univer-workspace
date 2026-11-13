// Ported from dream-num/unvdp@23446146d48cb948a61bef1f0a31ad0ef75a537d, packages/unvdp-core/src/lens/outline/format.ts
// (reference implementation, read-only; ADR-0006). uxl changes: strict-null typing, no `any`, snapshot types from engine/types,
// stateless refs and sheet counts.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CTRL = /[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g;

/** Collapses control characters / line breaks to one space so a value always fits on one line. */
export const oneLine = (s: string): string => s.replace(CTRL, " ");

/** Spec 7: at most `max` characters (code points) including the ellipsis. */
export function trunc(s: string, max = 40): string {
  const t = oneLine(s);
  const cp = Array.from(t);
  return cp.length <= max ? t : `${cp.slice(0, max - 1).join("")}…`;
}

/** name: always a JSON string of the truncated text. */
// A label taken from cell text (header, title, field) collapses runs of spaces: padded labels are common and cost tokens.
// An identifier (sheet name, name of an explicit region) is printed as it is, because agents pass it back as a locator.
// Values never collapse.
export const nameText = (s: string, exact = false): string =>
  trunc(exact ? oneLine(s) : oneLine(s).replace(/ {2,}/g, " "));
export const nameStr = (s: string, exact = false): string => JSON.stringify(nameText(s, exact));

export const token = (s: string): string =>
  !s || /[\s[\]"]/.test(s) || s.endsWith(",") ? JSON.stringify(s) : s;
export const listItem = (s: string): string =>
  s.includes("|") ? JSON.stringify(trunc(s)) : token(trunc(s));

export function patternStr(pattern: string): string {
  if (Array.from(pattern).length <= 24) return token(pattern);
  let end = pattern.length,
    quoted = false;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "\\") {
      i++;
      continue;
    }
    if (pattern[i] === '"') quoted = !quoted;
    if (pattern[i] === ";" && !quoted) {
      end = i;
      break;
    }
  }
  return token(`${Array.from(pattern.slice(0, end)).slice(0, 23).join("")}…`);
}

/** Date-time pattern kinds: date (y/d), time (h/s only) or datetime (both). */
export function dateKind(pattern: string | undefined): "date" | "time" | "datetime" {
  const q = (pattern ?? "").replace(/"[^"]*"|\[[^\]]*\]|\\.|_.|\*./g, "");
  const hasD = /[yd]/i.test(q);
  const hasT = /[hs]/i.test(q) || /AM\/PM/i.test(q);
  return hasD && hasT ? "datetime" : hasD || !hasT ? "date" : "time";
}

/** Power of ten a number format divides by: each comma right after the last digit placeholder of the first section is 1e3 (`#,##0,` 3, `0.0,,` 6). */
export function numfmtScale(pattern: string | undefined): number {
  const first = (pattern ?? "").replace(/"[^"]*"|\[[^\]]*\]|\\.|_.|\*./g, "").split(";")[0] ?? "";
  const m = /[0#?.](,+)[^0#?]*$/.exec(first);
  return m ? 3 * (m[1] ?? "").length : 0;
}
